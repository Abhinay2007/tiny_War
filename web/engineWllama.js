// Engine: wllama — llama.cpp compiled to WebAssembly, with a WebGPU backend (V3).
// Loads GGUF from HF. Local-first + actual llama.cpp. Runs WASM if no WebGPU.
import { Wllama, ModelManager } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.4.1/esm/index.js'
import { MODELS, DEFAULT_MODEL, getModel } from '/web/modelCatalog.js'
import { statsTracker } from '/web/genStats.js'

const WASM = { default: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.4.1/esm/wasm/wllama.wasm' }
const mm = new ModelManager()
let _w = null, _loadedId = null, _loadPromise = null, _chain = Promise.resolve()

async function ensure(id, onProgress) {
  const m = getModel(id)
  if (_w && _loadedId === m.id) return _w
  if (_loadPromise && _loadedId === null) return _loadPromise
  if (_w && _loadedId !== m.id) { try { await _w.exit() } catch { /* ignore */ } _w = null; _loadedId = null; _loadPromise = null }
  _loadPromise = (async () => {
    const w = new Wllama(WASM)
    await w.loadModelFromHF({ repo: m.repo, file: m.file }, {
      n_ctx: 2048, progressCallback: ({ loaded, total }) => onProgress && onProgress(total ? loaded / total : 0),
    })
    _w = w; _loadedId = m.id; return w
  })().catch((e) => { _loadPromise = null; throw e })
  return _loadPromise
}

function stream(id, system, user, { maxTokens = 200, temperature = 0.8, onToken, onStats } = {}) {
  const run = async () => {
    const w = await ensure(id)
    const st = statsTracker(onStats)
    let full = ''
    const s = await w.createChatCompletion({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens, temperature, top_k: 40, top_p: 0.9, stream: true,
    })
    for await (const ch of s) {
      const piece = ch?.choices?.[0]?.delta?.content || ''
      if (!piece) continue
      full += piece; if (onToken) onToken(piece); st.tick()
    }
    return { text: full, stats: st.finish() }
  }
  const p = _chain.then(run, run); _chain = p.catch(() => {}); return p
}

const _match = (model, entry) => (model.files || []).map((f) => f.name || '').join('|').includes(entry.file)

export const engine = {
  id: 'wllama',
  label: 'wllama · llama.cpp (WASM + WebGPU)',
  requiresWebGPU: false,
  available: () => true,
  models: MODELS,
  defaultModel: DEFAULT_MODEL,
  ensure, stream,
  backendLabel: () => { try { return navigator.gpu ? '⚡ WebGPU' : 'CPU (WASM)' } catch { return 'CPU (WASM)' } },
  async cachedSet() {
    try {
      const models = await mm.getModels(); const ids = new Set()
      for (const m of models) for (const c of MODELS) if (_match(m, c)) ids.add(c.id)
      return ids
    } catch { return new Set() }
  },
  async deleteCached(id) {
    const c = getModel(id)
    if (_loadedId === id && _w) { try { await _w.exit() } catch { /* ignore */ } _w = null; _loadedId = null; _loadPromise = null }
    try { for (const m of await mm.getModels()) if (_match(m, c) && m.remove) await m.remove() } catch { /* ignore */ }
  },
}
