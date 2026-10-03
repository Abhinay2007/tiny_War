// Shared audio output for the PCM TTS engines (Kokoro, Kitten). One AudioContext,
// one source at a time — the narrator awaits playSamples() per sentence so chunks
// play in order without overlap. Created lazily on first use (which happens after a
// user gesture, so resume() is allowed by autoplay policy).
let _ctx = null
let _cur = null

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  return _ctx
}

export async function playSamples(float32, sampleRate) {
  const ac = ctx()
  if (ac.state === 'suspended') { try { await ac.resume() } catch { /* ignore */ } }
  const buf = ac.createBuffer(1, float32.length, sampleRate)
  buf.getChannelData(0).set(float32)
  return new Promise((resolve) => {
    const src = ac.createBufferSource()
    src.buffer = buf
    src.connect(ac.destination)
    _cur = src
    src.onended = () => { if (_cur === src) _cur = null; resolve() }
    src.start()
  })
}

export function stopAudio() {
  try { if (_cur) _cur.stop() } catch { /* ignore */ }
  _cur = null
}

// Encode mono Float32 samples to a 16-bit PCM WAV ArrayBuffer — so PCM engines
// (Kokoro/Kitten) can produce a cacheable voice file like Qwen3-TTS does.
export function encodeWav(float32, sampleRate) {
  const n = float32.length
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  str(36, 'data'); dv.setUint32(40, n * 2, true)
  let off = 44
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, float32[i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2 }
  return buf
}

// Decode a WAV/audio ArrayBuffer to { audio: Float32Array, sampleRate } via the shared
// AudioContext (decoding needs no user gesture; only playback does).
export async function decodeAudio(arrayBuffer) {
  const ac = ctx()
  const buf = await ac.decodeAudioData(arrayBuffer)
  return { audio: buf.getChannelData(0), sampleRate: buf.sampleRate }
}
