// TTS engine: Kokoro-82M via kokoro-js (Transformers.js + ONNX, WebGPU/WASM).
// Best-quality model that runs 100% in the browser (Apache-2.0). Weights pull from
// huggingface.co like our LLM models; nothing touches the Space. mode 'pcm' → the
// narrator plays the returned Float32Array through the shared AudioContext.
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
// Curated subset of Kokoro's 54 voices (a = American, b = British; f/m).
const VOICES = [
  { id: 'af_heart', label: 'Heart · US ♀' },
  { id: 'af_bella', label: 'Bella · US ♀' },
  { id: 'af_nicole', label: 'Nicole · US ♀' },
  { id: 'am_michael', label: 'Michael · US ♂' },
  { id: 'am_fenrir', label: 'Fenrir · US ♂' },
  { id: 'bf_emma', label: 'Emma · UK ♀' },
  { id: 'bm_george', label: 'George · UK ♂' },
  { id: 'bm_lewis', label: 'Lewis · UK ♂' },
]

let _tts = null, _p = null

async function ensure(onProgress) {
  if (_tts) return _tts
  if (_p) return _p
  _p = (async () => {
    _tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: (typeof navigator !== 'undefined' && navigator.gpu) ? 'fp32' : 'q8',
      device: (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm',
      progress_callback: (p) => {
        if (onProgress && p && p.status === 'progress' && p.total) onProgress(p.loaded / p.total)
      },
    })
    return _tts
  })().catch((e) => { _p = null; throw e })
  return _p
}

async function synth(text, voice, { speed = 1 } = {}) {
  const out = await _tts.generate(text, { voice: voice || VOICES[0].id, speed })
  return { audio: out.audio, sampleRate: out.sampling_rate }
}

export const engine = {
  id: 'kokoro',
  label: 'Kokoro 82M · best quality',
  mode: 'pcm',
  needsDownload: true,
  available: () => true,
  listVoices: () => VOICES,
  defaultVoice: 'af_heart',
  ensure, synth,
  backendLabel: () => { try { return navigator.gpu ? '⚡ WebGPU' : 'CPU (WASM)' } catch { return 'CPU (WASM)' } },
}
