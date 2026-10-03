// Image facade — mirrors tts.js. Picks the active portrait engine (local Z-Image on your
// GPU, or cloud FLUX; in-browser SD-Turbo / Janus get added here later) and exposes one
// generatePortrait(). The persona panel + the Settings image bar import only from here.
import { engineLocal as zimagelocal, engineKleinZeroGpu as klein, engineCloud as flux, engineCloudDev as fluxdev } from '/web/imagenServer.js'
import { engine as bonsai } from '/web/imagenBonsai.js'
import { optionalServices } from '/web/optionalServices.js'

const ENGINES = [zimagelocal, klein, bonsai, flux, fluxdev]
const engineAvailable = (e) => optionalServices.portraitGeneration && e.available()
export const portraitGenerationAvailable = () => optionalServices.portraitGeneration
// Default: local Z-Image on localhost (your GPU), Klein ZeroGPU in prod. Persisted across
// refreshes; a saved choice wins if it's still available.
const KEY = 'tinyarmy.imageEngine'
let activeId = (() => {
  let saved = ''
  try { saved = localStorage.getItem(KEY) || '' } catch { /* ignore */ }
  const e = ENGINES.find((x) => x.id === saved)
  return e && engineAvailable(e) ? saved : (ENGINES.find(engineAvailable)?.id || 'klein-zerogpu')
})()

const eng = () => ENGINES.find((e) => e.id === activeId) || ENGINES.find(engineAvailable) || ENGINES[0]

export const listImageEngines = () =>
  ENGINES.map((e) => ({ id: e.id, label: e.label, available: engineAvailable(e), note: e.note || 'disabled for this demo' }))
export const getImageEngineId = () => activeId

const _listeners = new Set()
export function onImageEngineChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
export function setImageEngine(id) {
  const next = ENGINES.find((e) => e.id === id)
  if (!next || !engineAvailable(next) || id === activeId) return
  activeId = id
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  for (const fn of _listeners) { try { fn(id) } catch { /* ignore */ } }
}

export const imageNeedsDownload = () => !!eng().needsDownload
export const imageBackendLabel = () => eng().backendLabel()
export const imageNetworked = () => !!eng().networked

export async function ensureImage(onProgress) {
  if (!portraitGenerationAvailable()) return
  return eng().ensure(onProgress)
}

// Generate a portrait → PNG Blob. `prompt` is the appearance description; `seed` keeps it
// reproducible where the engine supports it.
// `refImage` (optional, base64 PNG / data URL) is an identity reference passed to Klein, so a
// generated image can depict a specific character (e.g. a skill scene of the hero). Engines that
// don't support references (cloud FLUX, in-browser) simply ignore it.
export async function generatePortrait(prompt, { seed, refImage } = {}) {
  if (!portraitGenerationAvailable()) throw new Error('Portrait generation is unavailable in this demo.')
  return eng().generate(prompt, { seed, refImage })
}
