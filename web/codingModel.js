// Coding-model store for the Skill Forge. SEPARATE from runtime.js (the persona/diary
// "Text Generation Model") so picking a coding model never clobbers the writer model.
// All candidates are large (Mellum2 ~8GB, BLS Mini-Code 30B MoE, Nemotron-30B ~24GB) with no
// browser-viable build, so this is ZeroGPU-only: every choice routes through the same server
// endpoint (/text/generate/stream) the `server` engine uses, by model id. Mellum2
// (TINY_MELLUM_SPACE) and BLS Mini-Code (TINY_BLS_CODE_SPACE) are ZeroGPU sidecars; Nemotron-30B
// routes through hosted NVIDIA NIM (NVIDIA_NIM_API_KEY) since it's too big to self-host.
import { statsTracker } from '/web/genStats.js'
import { streamSse } from '/web/sseText.js'

const MODELS = [
  { id: 'nemotron-3-nano-30b-nim', label: 'Nemotron 3 Nano 30B-A3B', params: '30B (3B active)', backend: 'NVIDIA NIM', note: 'reasoning + agentic code (NVIDIA)' },
  { id: 'mellum2-zerogpu', label: 'Mellum2 12B-A2.5B', params: '12B (2.5B active)', backend: 'ZeroGPU sidecar', note: 'code model (JetBrains)' },
  { id: 'bls-mini-code-zerogpu', label: 'BLS Mini-Code 1.0', params: '30B MoE', backend: 'ZeroGPU sidecar', note: 'code model (Cohere); reasoning suppressed' },
]
const DEFAULT = 'nemotron-3-nano-30b-nim'
const KEY = 'tinyarmy.codingModel'

const get = (id) => MODELS.find((m) => m.id === id) || MODELS[0]
const loadStr = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }

let _sel = (() => { const s = loadStr(KEY); return MODELS.some((m) => m.id === s) ? s : DEFAULT })()

const _listeners = new Set()
export function onCodingModelChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
const _notify = () => { for (const fn of _listeners) { try { fn() } catch { /* ignore */ } } }

export const listCodingModels = () => MODELS
export const getCodingModelId = () => _sel
export const currentCodingModel = () => get(_sel)
export function setCodingModel(id) {
  if (!MODELS.some((m) => m.id === id) || id === _sel) return
  _sel = id
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  _notify()
}

// Stream a coding-model completion. Same delta protocol as engineServer.stream.
// think=true asks reasoning models (Nemotron, BLS) to surface their <think>…</think> trace
// instead of hiding it, so the caller can show it in a debug panel.
export async function streamCoding(system, user, { maxTokens = 512, temperature = 0.6, think = false, onToken, onStats, signal } = {}) {
  const st = statsTracker(onStats)
  let full = ''
  await streamSse('/text/generate/stream', {
    model: _sel,
    system,
    user,
    max_tokens: maxTokens,
    temperature,
    think,
  }, {
    signal, kind: 'skill', label: (get(_sel) && get(_sel).label) || _sel,
    onEvent(evt, parsed) {
      if (evt !== 'delta') return
      const piece = parsed?.content || ''
      if (!piece) return
      full += piece
      onToken?.(piece)
      st.tick()
    },
  })
  return { text: full, stats: st.finish() }
}
