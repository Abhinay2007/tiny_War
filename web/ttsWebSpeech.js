// TTS engine: Web Speech API (speechSynthesis). Zero download, instant — uses the
// OS/browser's built-in voices. Not a "model" (quality varies by platform, and on
// some platforms the voice is cloud-backed), but it's the no-wait fallback. mode
// 'native' → the engine speaks the sentence itself and resolves when it finishes.
const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null)

const enVoices = () => {
  const s = synth()
  if (!s) return []
  return s.getVoices()
    .filter((v) => /^en\b|^en[-_]/i.test(v.lang))
    .map((v) => ({ id: v.voiceURI, label: `${v.name} · ${v.lang}`, _v: v }))
}

let _voiceCache = []
function voices() {
  const v = enVoices()
  if (v.length) _voiceCache = v
  return _voiceCache
}
const findVoice = (id) => (voices().find((x) => x.id === id) || {})._v || null

export const engine = {
  id: 'webspeech',
  label: 'Web Speech · built-in (no download)',
  mode: 'native',
  needsDownload: false,
  available: () => !!synth(),
  listVoices: () => voices(),
  defaultVoice: '', // empty → browser default voice
  ensure: async () => { /* nothing to load */ },
  speak(text, voiceId) {
    return new Promise((resolve) => {
      const s = synth()
      if (!s) return resolve()
      const u = new SpeechSynthesisUtterance(text)
      const v = findVoice(voiceId)
      if (v) u.voice = v
      u.onend = () => resolve()
      u.onerror = () => resolve()
      s.speak(u)
    })
  },
  stop() { const s = synth(); if (s) s.cancel() },
  backendLabel: () => 'OS voices',
}
