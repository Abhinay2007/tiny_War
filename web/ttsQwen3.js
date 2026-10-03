// TTS engine: Qwen3-TTS Voice Design via Alibaba DashScope, proxied through our backend
// (/qwen-tts) so the API key stays server-side. The "voice" here is a free-form natural-
// language DESCRIPTION (the persona's `voice` field, or a preset), used as DashScope's
// `voice_prompt`. NETWORKED — not local-first (clearly labeled). mode 'pcm'.
import { decodeAudio } from '/web/ttsAudio.js'
import { diagFetch } from '/web/diag.js'

// Endpoint: default is our Space backend (/qwen-tts → DashScope). A `?tts=<base>` query
// param (persisted to localStorage) points it at a self-run local server instead —
// the LeLab-style bridge: hosted UI → Qwen3-TTS on YOUR GPU, off the grid. `?tts=`
// (empty) clears the override. e.g. ?tts=http://localhost:8800
const TTS_STORE = 'tinyarmy.ttsBase'
function ttsBase() {
  try {
    const q = new URLSearchParams(location.search).get('tts')
    if (q !== null) {
      if (q) localStorage.setItem(TTS_STORE, q.replace(/\/+$/, ''))
      else localStorage.removeItem(TTS_STORE)
    }
    return (localStorage.getItem(TTS_STORE) || '').replace(/\/+$/, '')
  } catch { return '' }
}

// `desc()` returns the instruct string. 'persona' uses the dynamically-set description.
let _desc = ''
const VOICES = [
  { id: 'persona', label: '✨ Persona voice (designed)', desc: () => _desc },
  { id: 'veteran', label: 'Gruff veteran', desc: () => 'A gravelly, battle-worn male baritone — slow, deliberate, weary, with a wry edge.' },
  { id: 'herald', label: 'Bright herald', desc: () => 'A clear, bright young male voice — brisk, energetic, projecting and confident.' },
  { id: 'medic', label: 'Steady medic', desc: () => 'A calm, warm female voice — measured pace, clear articulation, reassuring.' },
  { id: 'rogue', label: 'Sly rogue', desc: () => 'A low, smooth voice with a sly, amused lilt — unhurried, with a dangerous edge.' },
]
const get = (id) => VOICES.find((v) => v.id === id) || VOICES[0]

export const isLocalhost = () => {
  try { return /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/i.test(location.hostname) } catch { return false }
}

// POST to `${base}/qwen-tts` → raw WAV ArrayBuffer. base '' = same-origin.
async function postSynthWav(base, text, voiceId) {
  const instruct = (get(voiceId).desc() || '').trim()
  const resp = await diagFetch('voice', `${base}/qwen-tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instruct, language: 'English' }),
  }, { timeoutMs: 90000, label: 'qwen3 synth' })
  if (!resp.ok) throw new Error(`Qwen3-TTS ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return resp.arrayBuffer()
}
const postSynth = async (base, text, voiceId) => decodeAudio(await postSynthWav(base, text, voiceId))

// Voice CLONE: synth `text` using a reference WAV (the last created voice) so the timbre
// stays identical — only the words change. ref is an ArrayBuffer; sent as base64.
function abToB64(ab) {
  let s = ''; const u = new Uint8Array(ab); const C = 0x8000
  for (let i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C))
  return btoa(s)
}
async function postClone(base, text, refAb, refText, instruct) {
  const resp = await diagFetch('voice', `${base}/qwen-tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // instruct lets prod (DashScope, no clone model) gracefully re-design from the
    // description instead of cloning; local mode uses ref_audio to clone the timbre.
    body: JSON.stringify({ text, ref_audio: abToB64(refAb), ref_text: refText || '', instruct: instruct || '', language: 'English' }),
  }, { timeoutMs: 90000, label: 'qwen3 clone' })
  if (!resp.ok) throw new Error(`Qwen3-TTS clone ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return resp.arrayBuffer()
}

const common = {
  mode: 'pcm', needsDownload: false, networked: true,
  design: true, // designs a voice from a free-form description (the persona's `voice`)
  listVoices: () => VOICES, defaultVoice: 'persona',
  ensure: async () => { /* nothing to load — server-side */ },
  setDesc(d) { _desc = (d || '').trim() }, // shared _desc across both variants
}

// CLOUD: the hosted backend (/qwen-tts → DashScope). `?tts=` can still bridge it.
export const engine = {
  ...common,
  id: 'qwen3',
  label: 'Qwen3-TTS · Voice Design (cloud)',
  // Needs a server-side DashScope key (or a `?tts=` local bridge). Without one the backend 503s,
  // so don't claim availability — that keeps it from being the auto-selected default and lets a
  // saved-on-qwen3 hero fall back to a working engine (VoxCPM). Pick it explicitly if you have a key.
  available: () => { try { return new URLSearchParams(location.search).has('tts') } catch { return false } },
  synth: (text, voiceId) => postSynth(ttsBase(), text, voiceId),
  synthWav: (text, voiceId) => postSynthWav(ttsBase(), text, voiceId),
  cloneWav: (text, refAb, refText, instruct) => postClone(ttsBase(), text, refAb, refText, instruct),
  backendLabel: () => { const b = ttsBase(); try { return b ? '🖥 ' + new URL(b).host : '☁ DashScope' } catch { return '☁ DashScope' } },
}

// LOCAL: same-origin /qwen-tts on a locally-run app.py (TINY_TTS_MODE=local → the open
// weights on your GPU). Only offered on localhost; disabled with a note in prod.
export const engineLocal = {
  ...common,
  id: 'qwen3local',
  label: 'Qwen3-TTS · local (your GPU)',
  available: () => isLocalhost(),
  note: 'run the project locally',
  synth: (text, voiceId) => postSynth('', text, voiceId),
  backendLabel: () => '🖥 local model',
}
