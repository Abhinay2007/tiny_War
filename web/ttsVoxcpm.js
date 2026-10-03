// TTS engine: VoxCPM2 via a ZeroGPU sidecar, proxied through /voxcpm-tts so
// tokens and sidecar details stay server-side. Like Qwen3, this designs a voice
// from each hero's free-form voice description.
import { decodeAudio } from '/web/ttsAudio.js'
import { diagFetch } from '/web/diag.js'
import { optionalServices } from '/web/optionalServices.js'

let _desc = ''
const VOICES = [
  { id: 'persona', label: '✨ Persona voice (designed)', desc: () => _desc },
  { id: 'veteran', label: 'Gruff veteran', desc: () => 'A gravelly, battle-worn male baritone - slow, deliberate, weary, with a wry edge.' },
  { id: 'herald', label: 'Bright herald', desc: () => 'A clear, bright young male voice - brisk, energetic, projecting and confident.' },
  { id: 'medic', label: 'Steady medic', desc: () => 'A calm, warm female voice - measured pace, clear articulation, reassuring.' },
  { id: 'rogue', label: 'Sly rogue', desc: () => 'A low, smooth voice with a sly, amused lilt - unhurried, with a dangerous edge.' },
]
const get = (id) => VOICES.find((v) => v.id === id) || VOICES[0]

async function postSynthWav(text, voiceId) {
  const instruct = (get(voiceId).desc() || '').trim()
  const resp = await diagFetch('voice', '/voxcpm-tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instruct, language: 'English' }),
  }, { timeoutMs: 90000, label: 'voxcpm synth' })
  if (!resp.ok) throw new Error(`VoxCPM ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return resp.arrayBuffer()
}
const postSynth = async (text, voiceId) => decodeAudio(await postSynthWav(text, voiceId))

function abToB64(ab) {
  let s = ''; const u = new Uint8Array(ab); const C = 0x8000
  for (let i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C))
  return btoa(s)
}
async function postCloneWav(text, refAb, refText, instruct) {
  const resp = await diagFetch('voice', '/voxcpm-clone', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ref_audio: abToB64(refAb), ref_text: refText || '', instruct: instruct || '', language: 'English' }),
  }, { timeoutMs: 90000, label: 'voxcpm clone' })
  if (!resp.ok) throw new Error(`VoxCPM clone ${resp.status}: ${(await resp.text()).slice(0, 140)}`)
  return resp.arrayBuffer()
}

export const engine = {
  mode: 'pcm', needsDownload: false, networked: true, design: true,
  id: 'voxcpm',
  label: 'VoxCPM2 · Voice Design (ZeroGPU)',
  experimental: true,
  available: () => optionalServices.voxcpm,
  note: 'disabled for this demo',
  listVoices: () => VOICES,
  defaultVoice: 'persona',
  ensure: async () => {},
  setDesc(d) { _desc = (d || '').trim() },
  synth: (text, voiceId) => postSynth(text, voiceId),
  synthWav: (text, voiceId) => postSynthWav(text, voiceId),
  cloneWav: (text, refAb, refText, instruct) => postCloneWav(text, refAb, refText, instruct),
  backendLabel: () => 'ZeroGPU VoxCPM2',
}
