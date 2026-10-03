// Recommended settings presets. Each preset can set the text engine/model, voice
// provider, and portrait model together. Manual changes move the picker to Custom.
import { setEngine, getEngineId, setModel, currentModelId, listModels, onModelChange } from '/web/runtime.js'
import { setTtsEngine, getTtsEngineId, onTtsEngineChange } from '/web/tts.js'
import { setImageEngine, getImageEngineId, onImageEngineChange } from '/web/imagen.js'
import { setCodingModel, getCodingModelId, onCodingModelChange } from '/web/codingModel.js'

export const PRESETS = [
  { id: 'build-small', label: 'BUILD SMALL', engine: 'server', model: 'tiny-aya-global-zerogpu', family: 'tiny-aya', voice: 'voxcpm', image: 'klein-zerogpu', coding: 'mellum2-zerogpu', sub: 'Tiny Aya - VoxCPM2 - FLUX.2 klein - Mellum2 (Nemotron NIM fallback)' },
  { id: 'high', label: 'High', engine: 'webllm', model: 'qwen3-0.6b', family: 'qwen3', voice: 'kokoro', image: '', coding: 'mellum2-zerogpu', sub: 'Qwen3 - Kokoro 82M' },
  { id: 'medium', label: 'Medium', engine: 'transformers', model: 'qwen2.5-0.5b', family: 'qwen2.5', voice: 'kitten', image: '', coding: 'mellum2-zerogpu', sub: 'Qwen2.5 - Kitten TTS' },
  { id: 'low', label: 'Low', engine: 'transformers', model: 'qwen2.5-0.5b', family: 'qwen2.5', voice: 'webspeech', image: '', coding: 'mellum2-zerogpu', sub: 'Qwen2.5 - Web Speech' },
]
const KEY = 'tinyarmy.qualityPreset'
const VALID = new Set([...PRESETS.map((p) => p.id), 'custom'])

const byId = (id) => PRESETS.find((p) => p.id === id)

function resolveModel(p) {
  const ms = listModels()
  const m = ms.find((x) => x.id === p.model) || ms.find((x) => x.id.startsWith(p.family))
  return m ? m.id : ''
}

export function detectPreset() {
  const eid = getEngineId()
  const mid = currentModelId()
  const voice = getTtsEngineId()
  const image = getImageEngineId()
  const coding = getCodingModelId()
  const p = PRESETS.find((x) =>
    (!x.engine || eid === x.engine) &&
    (mid === x.model || mid.startsWith(x.family)) &&
    voice === x.voice &&
    (!x.image || image === x.image) &&
    (!x.coding || coding === x.coding))
  return p ? p.id : 'custom'
}

let _applying = false
let _current = (() => {
  let saved = ''
  try { saved = localStorage.getItem(KEY) || '' } catch { /* ignore */ }
  if (!VALID.has(saved)) return detectPreset()
  if (saved === 'custom') return 'custom'
  return detectPreset() === saved ? saved : detectPreset()
})()

export const getActivePreset = () => _current

function commit(id) {
  _current = id
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  for (const fn of _listeners) { try { fn(id) } catch { /* ignore */ } }
}

export function applyPreset(id) {
  const p = byId(id)
  if (!p) return
  _applying = true
  if (p.engine) setEngine(p.engine)
  const mid = resolveModel(p)
  if (mid) setModel(mid)
  setTtsEngine(p.voice)
  if (p.image) setImageEngine(p.image)
  if (p.coding) setCodingModel(p.coding)
  _applying = false
  commit(id)
}

const _listeners = new Set()
export function onPresetChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }

const _onManual = () => { if (!_applying) commit('custom') }
onModelChange(_onManual)
onTtsEngineChange(_onManual)
onImageEngineChange(_onManual)
onCodingModelChange(_onManual)
