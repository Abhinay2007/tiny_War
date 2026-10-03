// Runtime facade — picks the active engine (wllama / Transformers.js / WebLLM / server) and
// model, and delegates load/stream/cache. Lets you A/B the same model across engines
// and compare tok/s. Panels + the model bar import only from here. (Named runtime.js,
// not engine.js — that one is the game-engine bundle.)
import { engine as wllama } from '/web/engineWllama.js'
import { engine as transformers } from '/web/engineTransformers.js'
import { engine as webllm } from '/web/engineWebllm.js'
import { engine as server } from '/web/engineServer.js'
import { ensurePersistentStorage } from '/web/storage.js'

const ENGINES = [wllama, transformers, webllm, server]
// Persisted choices (survive refresh). Defaults: WebLLM where there's WebGPU (fastest),
// else wllama so the app still works without it.
const ENGINE_KEY = 'tinyarmy.llmEngine', MODELS_KEY = 'tinyarmy.llmModels'
const loadJSON = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb } catch { return fb } }
const loadStr = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }

let activeId = (() => {
  const saved = loadStr(ENGINE_KEY)
  const e = ENGINES.find((x) => x.id === saved)
  return e && e.available() ? saved : 'server'
})()
const modelSel = loadJSON(MODELS_KEY, {}) // engineId -> chosen model id (remembered per engine)

function persist() {
  try { localStorage.setItem(ENGINE_KEY, activeId); localStorage.setItem(MODELS_KEY, JSON.stringify(modelSel)) } catch { /* ignore */ }
}

// Change listeners (the Settings "Recommended" preset bar + the model bar re-render).
const _listeners = new Set()
export function onModelChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
const _notify = () => { for (const fn of _listeners) { try { fn() } catch { /* ignore */ } } }

const eng = () => ENGINES.find((e) => e.id === activeId) || ENGINES[0]

export const listEngines = () => ENGINES.map((e) => ({ id: e.id, label: e.label, available: e.available() }))
export const getEngineId = () => activeId
export function setEngine(id) {
  if (!ENGINES.some((e) => e.id === id) || id === activeId) return
  activeId = id; persist(); _notify()
}

export const listModels = () => eng().models
// A stored model id only counts if it actually exists in the active engine's catalog
// (otherwise fall back to that engine's default — handles cross-engine presets cleanly).
export const currentModelId = () => {
  const sel = modelSel[activeId]
  return (sel && eng().models.some((m) => m.id === sel)) ? sel : eng().defaultModel
}
export const currentModel = () => eng().models.find((m) => m.id === currentModelId()) || eng().models[0]
export function setModel(id) {
  if (modelSel[activeId] === id) return
  modelSel[activeId] = id; persist(); _notify()
}

export const ensureModel = async (onProgress) => {
  if (eng().needsDownload === false) return eng().ensure(currentModelId(), onProgress)
  await ensurePersistentStorage() // keep downloads from being evicted across engine switches
  return eng().ensure(currentModelId(), onProgress)
}
export const streamChat = (sys, user, opts) => eng().stream(currentModelId(), sys, user, opts)
export const backendLabel = () => eng().backendLabel()

// Cache management (only wllama exposes per-model delete; others manage their own cache).
export const cacheSupported = () => !!eng().cachedSet
export const cachedSet = async () => (eng().cachedSet ? eng().cachedSet() : new Set())
export const deleteCached = async (id) => (eng().deleteCached ? eng().deleteCached(id) : null)
