// Engine: WebLLM — MLC's WebGPU LLM engine. Fastest of the three, but WebGPU is
// REQUIRED (no WASM fallback), so it only shows when the browser exposes WebGPU.
// NOT llama.cpp (doesn't earn 🦙) — here for benchmarking.
import { statsTracker } from '/web/genStats.js'

// `mlcBase` is the model name without the quantization suffix; we append
// q4f16_1 on GPUs that expose shader-f16, else q4f32_1. q4f16 models compile a
// WGSL kernel that needs the WebGPU `shader-f16` feature — without it MLC throws
// "Invalid ShaderModule … index_kernel". q4f32 works everywhere (a bit slower).
const MODELS = [
  { id: 'qwen2.5-0.5b', label: 'Qwen2.5 0.5B', params: '0.5B', mlcBase: 'Qwen2.5-0.5B-Instruct' },
  { id: 'qwen3-0.6b', label: 'Qwen3 0.6B', params: '0.6B', mlcBase: 'Qwen3-0.6B' },
  { id: 'smollm2-360m', label: 'SmolLM2 360M', params: '360M', mlcBase: 'SmolLM2-360M-Instruct' },
  { id: 'llama3.2-1b', label: 'Llama 3.2 1B', params: '1B', mlcBase: 'Llama-3.2-1B-Instruct' },
]
const get = (id) => MODELS.find((m) => m.id === id) || MODELS[0]
const hasGPU = () => { try { return !!(typeof navigator !== 'undefined' && navigator.gpu) } catch { return false } }

let _f16 = null
async function hasF16() {
  if (_f16 !== null) return _f16
  try { const a = await navigator.gpu.requestAdapter(); _f16 = !!a?.features?.has('shader-f16') } catch { _f16 = false }
  return _f16
}
const mlcId = async (m) => `${m.mlcBase}-${(await hasF16()) ? 'q4f16_1' : 'q4f32_1'}-MLC`

let _lib = null, _engine = null, _loadedId = null, _loadingId = null, _loadPromise = null, _chain = Promise.resolve()
async function lib() { if (!_lib) _lib = await import('https://esm.run/@mlc-ai/web-llm'); return _lib }

async function ensure(id, onProgress) {
  const m = get(id)
  if (_engine && _loadedId === m.id) return _engine
  // Reuse the in-flight load for the SAME model (guard on _loadingId, not _loadedId,
  // which isn't set until the load finishes — otherwise a re-entrant ensure() during
  // a slow download starts a SECOND download).
  if (_loadPromise && _loadingId === m.id) return _loadPromise
  _loadingId = m.id
  _loadPromise = (async () => {
    const { CreateMLCEngine } = await lib()
    const target = await mlcId(m)
    // MLC reports two phases through this one callback: "Fetching param cache…"
    // (network) then "Loading model from cache…" (into GPU). Pass the text so the UI
    // can show which is happening — the 2nd 0→100% is a cache-load, not a re-download.
    const cb = (p) => { if (onProgress) onProgress(typeof p.progress === 'number' ? p.progress : 0, p.text) }
    if (_engine && _engine.reload) { await _engine.reload(target); _loadedId = m.id; return _engine }
    _engine = await CreateMLCEngine(target, { initProgressCallback: cb })
    _loadedId = m.id; return _engine
  })().catch((e) => { _loadPromise = null; _loadingId = null; throw e })
  return _loadPromise
}

function stream(id, system, user, { maxTokens = 200, temperature = 0.8, onToken, onStats } = {}) {
  const run = async () => {
    const e = await ensure(id)
    const st = statsTracker(onStats)
    let full = ''
    const chunks = await e.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true, stream_options: { include_usage: true }, temperature, max_tokens: maxTokens,
    })
    // MLC routes Qwen3's reasoning into a separate `reasoning_content` field. Re-wrap
    // it as <think>…</think> and prepend, so the rest of the app (stripThink + the raw
    // "thinking" view) treats every engine's output the same.
    let thinkOpen = false
    const emit = (s) => { if (!s) return; full += s; if (onToken) onToken(s); st.tick() }
    for await (const ch of chunks) {
      const d = ch.choices?.[0]?.delta || {}
      const r = d.reasoning_content || ''
      const c = d.content || ''
      if (r) { if (!thinkOpen) { emit('<think>'); thinkOpen = true } emit(r) }
      if (c) { if (thinkOpen) { emit('</think>'); thinkOpen = false } emit(c) }
    }
    if (thinkOpen) emit('</think>')
    return { text: full, stats: st.finish() }
  }
  const p = _chain.then(run, run); _chain = p.catch(() => {}); return p
}

export const engine = {
  id: 'webllm',
  label: 'WebLLM · MLC (WebGPU only)',
  requiresWebGPU: true,
  available: () => hasGPU(),
  models: MODELS,
  defaultModel: 'qwen3-0.6b',
  ensure, stream,
  backendLabel: () => (hasGPU() ? '⚡ WebGPU' : 'needs WebGPU'),
  // Cache list/delete via MLC's own helpers (Cache API or IndexedDB, per appConfig).
  async cachedSet() {
    try {
      const wl = await lib()
      const cfg = wl.prebuiltAppConfig
      const ids = new Set()
      for (const m of MODELS) { if (await wl.hasModelInCache(await mlcId(m), cfg)) ids.add(m.id) }
      return ids
    } catch { return new Set() }
  },
  async deleteCached(id) {
    const wl = await lib()
    const m = get(id)
    const target = await mlcId(m)
    if (_loadedId === id && _engine) { try { await _engine.unload?.() } catch { /* ignore */ } _engine = null; _loadedId = null; _loadPromise = null; _loadingId = null }
    try { await wl.deleteModelAllInfoInCache(target, wl.prebuiltAppConfig) } catch { /* ignore */ }
  },
}
