// TTS facade — mirrors runtime.js (the LLM facade). Picks the active TTS engine
// (Kokoro / Kitten / Web Speech) and voice, and exposes makeNarrator(): a streaming
// reader that speaks sentence-by-sentence so a war diary can narrate itself while the
// LLM is still writing. Panels + the TTS bar import only from here.
import { engine as kokoro } from '/web/ttsKokoro.js'
import { engine as qwen3, engineLocal as qwen3local } from '/web/ttsQwen3.js'
import { engine as voxcpm } from '/web/ttsVoxcpm.js'
import { engine as kitten } from '/web/ttsKitten.js'
import { engine as webspeech } from '/web/ttsWebSpeech.js'
import { playSamples, stopAudio, decodeAudio, encodeWav } from '/web/ttsAudio.js'
import { ensurePersistentStorage } from '/web/storage.js'

const ENGINES = [kokoro, qwen3local, qwen3, voxcpm, kitten, webspeech]
const defaultEngine = () => ENGINES.find((x) => x.id === 'webspeech' && x.available()) || ENGINES.find((x) => x.available())
// Default voice provider: local-GPU Qwen3-TTS on localhost (your GPU designs voices),
// in-browser Kokoro in prod (runs on the device — no exhaustible cloud quota). Cloud
// Qwen3-TTS and the others remain selectable in Settings. Persisted across refreshes.
const TTS_ENGINE_KEY = 'tinyarmy.ttsEngine'
let activeId = (() => {
  let saved = ''
  try { saved = localStorage.getItem(TTS_ENGINE_KEY) || '' } catch { /* ignore */ }
  const e = ENGINES.find((x) => x.id === saved)
  return e && e.available() ? saved : (defaultEngine()?.id || 'webspeech')
})()

// Qwen3-TTS designs a voice from a free-form description (the persona's `voice`).
// Panels set it before narrating; previewVoice() plays a one-off sample.
export function setVoiceDescription(desc) { qwen3.setDesc(desc); voxcpm.setDesc(desc) }
export async function previewVoice(desc, text) {
  const e = eng()
  if (e.setDesc) e.setDesc(desc)
  const { audio, sampleRate } = await e.synth(text, 'persona')
  return playSamples(audio, sampleRate)
}
export const stopPreview = () => stopAudio()

// Create a persona's voice FILE: synth the line in the designed voice and return the
// raw WAV (ArrayBuffer) so it can be cached + replayed verbatim. Caller plays it.
export async function createVoiceWav(desc, text) {
  const e = eng()
  if (e.setDesc) e.setDesc(desc)
  return e.synthWav(text, 'persona')
}
// Clone `text` from a reference voice file (keep timbre, change words). `desc` is the
// voice design — a fallback so prod (no clone model) can re-design instead. Returns WAV.
export async function cloneVoiceWav(refArrayBuffer, refText, text, desc) {
  const e = eng()
  if (e.setDesc) e.setDesc(desc)
  return e.cloneWav(text, refArrayBuffer, refText, desc)
}
export async function playWav(arrayBuffer) {
  const { audio, sampleRate } = await decodeAudio(arrayBuffer)
  return playSamples(audio, sampleRate)
}

// ── Fixed-voice engines (Kokoro / Kitten / Web Speech) ───────────────────────
// These don't "design" a voice from text; a hero picks one of the engine's named
// voices. The persona panel uses these when the active engine is NOT Qwen3.
export const activeEngineIsDesign = () => !!eng().design          // Qwen3 → designs from a description
export const activeEngineIsNative = () => eng().mode === 'native' // Web Speech → speaks live, no WAV
export const activeEngineId = () => activeId
export const activeVoices = () => eng().listVoices()
export const activeDefaultVoice = () => eng().defaultVoice

// Synthesize `text` in a NAMED voice with the active PCM engine → a cacheable WAV
// (encode Kokoro/Kitten PCM, or pass through an engine that already returns WAV).
export async function synthVoiceWav(voiceId, text) {
  const e = eng()
  if (e.needsDownload) { await ensurePersistentStorage(); await e.ensure() }
  if (e.synthWav) return e.synthWav(text, voiceId)
  const { audio, sampleRate } = await e.synth(text, voiceId)
  return encodeWav(audio, sampleRate)
}
// Speak `text` live in a named voice (native engines that can't render to a file).
export async function speakVoiceLive(voiceId, text) {
  const e = eng()
  if (e.speak) return e.speak(text, voiceId)
  const { audio, sampleRate } = await e.synth(text, voiceId)
  return playSamples(audio, sampleRate)
}
export function stopVoiceLive() { const e = eng(); if (e.stop) e.stop(); stopAudio() }

const voiceSel = {} // engineId -> chosen voice id

const eng = () => ENGINES.find((e) => e.id === activeId) || ENGINES[0]

export const listTtsEngines = () =>
  ENGINES.map((e) => ({ id: e.id, label: e.label, available: e.available(), experimental: !!e.experimental, note: e.note || '' }))
export const getTtsEngineId = () => activeId
// Notify listeners (e.g. the persona panel, on another tab) when the provider changes,
// so they can re-render voice controls without polling or relying on tab visibility.
const _engineListeners = new Set()
export function onTtsEngineChange(fn) { _engineListeners.add(fn); return () => _engineListeners.delete(fn) }
export function setTtsEngine(id) {
  const next = ENGINES.find((e) => e.id === id)
  if (!next || !next.available() || id === activeId) return
  activeId = id
  try { localStorage.setItem(TTS_ENGINE_KEY, id) } catch { /* ignore */ }
  for (const fn of _engineListeners) { try { fn(id) } catch { /* ignore */ } }
}

export const listVoices = () => eng().listVoices()
export const currentVoiceId = () => (voiceSel[activeId] !== undefined ? voiceSel[activeId] : eng().defaultVoice)
export function setVoice(id) { voiceSel[activeId] = id }

export const ttsNeedsDownload = () => !!eng().needsDownload
export const ttsBackendLabel = () => eng().backendLabel()
export const ttsNetworked = () => !!eng().networked

// "Narrate as it writes" — global now that the picker lives in Settings (the diary
// reads it; the settings voice bar sets it).
let _autoNarrate = false
export const getAutoNarrate = () => _autoNarrate
export const setAutoNarrate = (v) => { _autoNarrate = !!v }

export async function ensureTts(onProgress) {
  if (eng().needsDownload) await ensurePersistentStorage()
  return eng().ensure(onProgress)
}

// Speak text sentence-by-sentence. push() text as it streams; end() to flush the
// tail; stop() to abort. PCM engines pre-generate the next sentence while the current
// one plays; native engines (Web Speech) just speak each sentence in order.
export function makeNarrator({ onState } = {}) {
  const engine = eng()
  const voice = currentVoiceId()
  let pending = '', sentences = [], closed = false, stopped = false, running = false
  const SENT = /[\s\S]*?[.!?…]["')\]]*(?:\s+|$)/g
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  function drain(force) {
    SENT.lastIndex = 0
    let m, last = 0
    while ((m = SENT.exec(pending)) !== null) {
      const s = m[0].trim()
      if (s) sentences.push(s)
      last = SENT.lastIndex
    }
    pending = pending.slice(last)
    if (force && pending.trim()) { sentences.push(pending.trim()); pending = '' }
  }

  async function loop() {
    running = true
    onState && onState('speaking')
    try {
      if (engine.mode === 'native') {
        while (!stopped) {
          if (sentences.length) await engine.speak(sentences.shift(), voice)
          else if (closed) break
          else await wait(60)
        }
      } else {
        const startNext = () => (sentences.length ? engine.synth(sentences.shift(), voice, {}) : null)
        let synthP = null
        while (!stopped) {
          if (!synthP) synthP = startNext()
          if (!synthP) { if (closed) break; await wait(60); continue }
          let cur = null
          try { cur = await synthP } catch { cur = null }
          synthP = startNext() // pre-generate next while current plays
          if (cur && !stopped) { try { await playSamples(cur.audio, cur.sampleRate) } catch { /* ignore */ } }
        }
      }
    } finally {
      running = false
      onState && onState(stopped ? 'stopped' : 'done')
    }
  }

  return {
    push(text) { pending += text; drain(false); if (!running && !stopped) loop() },
    end() { drain(true); closed = true; if (!running && !stopped) loop() },
    stop() { stopped = true; sentences = []; pending = ''; if (engine.stop) engine.stop(); stopAudio() },
  }
}
