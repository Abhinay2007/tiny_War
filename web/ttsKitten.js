// TTS engine: KittenTTS Nano (15M, ~24MB ONNX) — the smallest usable browser TTS.
// Pipeline (mirrors clowerweb/kitten-tts-web-demo): phonemize → map to token ids →
// ONNX run (input_ids/style/speed → waveform @ 24kHz). Runs on WASM for robustness
// (the WebGPU EP produces NaNs on some drivers). Experimental: depends on
// onnxruntime-web + phonemizer loading from CDN, so it degrades to an error if either
// fails. Model from HF; tokenizer + voice embeddings vendored under /web/kitten/.
const ORT_VER = '1.26.0'
const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.wasm.mjs`
const MODEL_URL = 'https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx'
const SAMPLE_RATE = 24000

const VOICES = [
  { id: 'expr-voice-2-f', label: 'Voice 2 · ♀' },
  { id: 'expr-voice-2-m', label: 'Voice 2 · ♂' },
  { id: 'expr-voice-3-f', label: 'Voice 3 · ♀' },
  { id: 'expr-voice-3-m', label: 'Voice 3 · ♂' },
  { id: 'expr-voice-4-f', label: 'Voice 4 · ♀' },
  { id: 'expr-voice-4-m', label: 'Voice 4 · ♂' },
  { id: 'expr-voice-5-f', label: 'Voice 5 · ♀' },
  { id: 'expr-voice-5-m', label: 'Voice 5 · ♂' },
]

let _ort = null, _session = null, _vocab = null, _voiceEmb = null, _phon = null, _p = null

async function ensure(onProgress) {
  if (_session) return _session
  if (_p) return _p
  _p = (async () => {
    _ort = await import(ORT_URL)
    _ort.env.wasm.numThreads = 1 // HF Space lacks COOP/COEP → no SharedArrayBuffer
    _ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`

    const [tok, voices] = await Promise.all([
      fetch('/web/kitten/tokenizer.json').then((r) => r.json()),
      fetch('/web/kitten/voices.json').then((r) => r.json()),
    ])
    _vocab = tok.model.vocab
    _voiceEmb = voices

    const resp = await fetch(MODEL_URL)
    const total = +(resp.headers.get('content-length') || 0)
    let loaded = 0
    const reader = resp.body.getReader()
    const parts = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value); loaded += value.length
      if (onProgress && total) onProgress(loaded / total)
    }
    const bytes = new Uint8Array(loaded)
    let off = 0
    for (const p of parts) { bytes.set(p, off); off += p.length }

    _session = await _ort.InferenceSession.create(bytes.buffer, {
      executionProviders: [{ name: 'wasm', simd: true }],
    })
    return _session
  })().catch((e) => { _p = null; throw e })
  return _p
}

async function phonemes(text) {
  if (!_phon) { const m = await import('https://esm.run/phonemizer@1.2.1'); _phon = m.phonemize }
  const ph = await _phon(text, 'en-us')
  return Array.isArray(ph) ? ph.join(' ') : String(ph)
}

async function synth(text, voice, { speed = 1 } = {}) {
  const ph = await phonemes(text)
  const ids = `$${ph}$`.split('').map((ch) => (_vocab[ch] != null ? _vocab[ch] : 0))
  const emb = _voiceEmb[voice] || _voiceEmb[VOICES[0].id]
  const inputs = {
    input_ids: new _ort.Tensor('int64', BigInt64Array.from(ids.map((i) => BigInt(i))), [1, ids.length]),
    style: new _ort.Tensor('float32', new Float32Array(emb[0]), [1, emb[0].length]),
    speed: new _ort.Tensor('float32', new Float32Array([speed]), [1]),
  }
  const out = await _session.run(inputs)
  const data = out.waveform.data
  // Scrub NaNs to silence so a bad frame can't poison the whole clip.
  const audio = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) audio[i] = Number.isNaN(data[i]) ? 0 : data[i]
  return { audio, sampleRate: SAMPLE_RATE }
}

export const engine = {
  id: 'kitten',
  label: 'Kitten TTS 15M · smallest (experimental)',
  mode: 'pcm',
  experimental: true,
  needsDownload: true,
  available: () => true,
  listVoices: () => VOICES,
  defaultVoice: 'expr-voice-2-f',
  ensure, synth,
  backendLabel: () => 'CPU (WASM)',
}
