// Engine: Transformers.js — Hugging Face's ONNX Runtime, WebGPU (or WASM fallback).
// NOT llama.cpp (so it doesn't earn 🦙), but great for benchmarking against wllama.
import { statsTracker } from '/web/genStats.js'

const MODELS = [
  { id: 'qwen2.5-0.5b', label: 'Qwen2.5 0.5B', params: '0.5B', repo: 'onnx-community/Qwen2.5-0.5B-Instruct' },
  { id: 'smollm2-360m', label: 'SmolLM2 360M', params: '360M', repo: 'HuggingFaceTB/SmolLM2-360M-Instruct' },
  { id: 'llama3.2-1b', label: 'Llama 3.2 1B', params: '1B', repo: 'onnx-community/Llama-3.2-1B-Instruct' },
  { id: 'nemotron-3-nano-4b', label: 'Nemotron 3 Nano 4B', params: '4B', repo: 'onnx-community/NVIDIA-Nemotron-3-Nano-4B-BF16-ONNX', webgpuOnly: true, note: 'WebGPU only; large browser download' },
]
const get = (id) => MODELS.find((m) => m.id === id) || MODELS[0]

// Only choose WebGPU if we can actually get a *device* (not just an adapter):
// navigator.gpu can exist and requestAdapter() can succeed, yet Transformers.js still
// throws "no available backend" (headless, flaky drivers). And once a WebGPU pipeline
// attempt fails, the in-context WASM retry is poisoned too — so we must decide up front
// and never attempt WebGPU unless it's real. WASM always works and caches fine.
async function pickDevice() {
  try {
    if (!navigator.gpu) return 'wasm'
    const a = await navigator.gpu.requestAdapter()
    if (!a) return 'wasm'
    const d = await a.requestDevice()
    if (d) { try { d.destroy() } catch { /* ignore */ } return 'webgpu' }
  } catch { /* fall through */ }
  return 'wasm'
}

let _lib = null, _pipe = null, _loadedId = null, _loadingId = null, _loadPromise = null, _device = 'wasm', _chain = Promise.resolve()
async function lib() { if (!_lib) _lib = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.8'); return _lib }

async function ensure(id, onProgress) {
  const m = get(id)
  if (_pipe && _loadedId === m.id) return _pipe
  // Guard on _loadingId (set now), not _loadedId (set after load) — else a re-entrant
  // ensure() during a slow download starts a second download.
  if (_loadPromise && _loadingId === m.id) return _loadPromise
  if (_pipe && _loadedId !== m.id) { try { await _pipe.dispose?.() } catch { /* ignore */ } _pipe = null; _loadedId = null }
  _loadingId = m.id
  _loadPromise = (async () => {
    const { pipeline } = await lib()
    _device = await pickDevice()
    if (m.webgpuOnly && _device !== 'webgpu') throw new Error(`${m.label} requires WebGPU support in this browser.`)
    const mk = (device) => pipeline('text-generation', m.repo, {
      device, dtype: 'q4',
      progress_callback: (p) => { if (onProgress && p.status === 'progress' && p.total) onProgress(p.loaded / p.total) },
    })
    let pipe
    try { pipe = await mk(_device) }
    catch (e) { if (!m.webgpuOnly && _device !== 'wasm') { _device = 'wasm'; pipe = await mk('wasm') } else throw e }
    _pipe = pipe; _loadedId = m.id; return pipe
  })().catch((e) => { _loadPromise = null; _loadingId = null; throw e })
  return _loadPromise
}

function stream(id, system, user, { maxTokens = 200, temperature = 0.8, onToken, onStats } = {}) {
  const run = async () => {
    const pipe = await ensure(id)
    const { TextStreamer } = await lib()
    const st = statsTracker(onStats)
    let full = ''
    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: (text) => { if (!text) return; full += text; if (onToken) onToken(text); st.tick() },
    })
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
    if (get(id).id === 'nemotron-3-nano-4b') {
      await pipe(messages, {
        max_new_tokens: maxTokens,
        do_sample: true,
        temperature,
        top_k: 40,
        top_p: 0.9,
        streamer,
        tokenizer_encode_kwargs: { enable_thinking: false },
      })
    } else {
      const prompt = pipe.tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true })
      await pipe(prompt, { max_new_tokens: maxTokens, do_sample: true, temperature, top_k: 40, top_p: 0.9, streamer })
    }
    return { text: full, stats: st.finish() }
  }
  const p = _chain.then(run, run); _chain = p.catch(() => {}); return p
}

// Transformers.js caches model files in the Cache API store 'transformers-cache',
// keyed by the remote HF URL — so we match by the model's repo name.
const CACHE = 'transformers-cache'
const repoKey = (m) => m.repo.split('/').pop()

export const engine = {
  id: 'transformers',
  label: 'Transformers.js · ONNX (WebGPU/WASM)',
  requiresWebGPU: false,
  available: () => true,
  models: MODELS,
  defaultModel: 'qwen2.5-0.5b',
  ensure, stream,
  backendLabel: () => (_device === 'webgpu' ? '⚡ WebGPU' : 'CPU (WASM)'),
  async cachedSet() {
    try {
      if (typeof caches === 'undefined') return new Set()
      const urls = (await (await caches.open(CACHE)).keys()).map((r) => r.url)
      const ids = new Set()
      // Require the actual weights (*.onnx) in cache, not just the metadata JSONs —
      // Transformers.js sometimes caches config/tokenizer but not the big model file.
      for (const m of MODELS) if (urls.some((u) => u.includes(repoKey(m)) && /\.onnx(\?|$)/i.test(u))) ids.add(m.id)
      return ids
    } catch { return new Set() }
  },
  async deleteCached(id) {
    const m = get(id)
    if (_loadedId === id && _pipe) { try { await _pipe.dispose?.() } catch { /* ignore */ } _pipe = null; _loadedId = null; _loadPromise = null; _loadingId = null }
    try { const c = await caches.open(CACHE); for (const req of await c.keys()) if (req.url.includes(repoKey(m))) await c.delete(req) } catch { /* ignore */ }
  },
}
