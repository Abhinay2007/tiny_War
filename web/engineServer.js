// Engine: server-side text generation. Keeps API keys/model hosts off the client and
// lets the same picker choose either a configured local llama.cpp server or a ZeroGPU
// hosted model such as Tiny Aya Global.
import { statsTracker } from '/web/genStats.js'
import { streamSse } from '/web/sseText.js'

const MODELS = [
  { id: 'server-local', label: 'Configured server model', params: 'local/remote', note: 'uses TINY_LLM_* on the Space or local app' },
  { id: 'tiny-aya-global-zerogpu', label: 'Tiny Aya Global 3.35B', params: '3.35B', note: 'ZeroGPU sidecar; multilingual' },
  { id: 'minicpm5-1b-zerogpu', label: 'MiniCPM5 1B', params: '1B', note: 'ZeroGPU sidecar; efficient MiniCPM5 text model' },
]
const get = (id) => MODELS.find((m) => m.id === id) || MODELS[0]

async function stream(id, system, user, { maxTokens = 200, temperature = 0.8, onToken, onStats, signal } = {}) {
  const m = get(id)
  const st = statsTracker(onStats)
  let full = ''
  await streamSse('/text/generate/stream', {
    model: m.id,
    system,
    user,
    max_tokens: maxTokens,
    temperature,
  }, {
    signal, kind: 'text', label: m.id,
    onEvent(evt, parsed) {
      if (evt !== 'delta') return
      const piece = parsed?.content || ''
      if (!piece) return
      full += piece
      onToken?.(piece)
      st.tick()
    },
  })
  return { text: full, stats: st.finish() }
}

export const engine = {
  id: 'server',
  label: 'Server / ZeroGPU',
  available: () => true,
  needsDownload: false,
  models: MODELS,
  defaultModel: 'tiny-aya-global-zerogpu',
  ensure: async () => {},
  stream,
  backendLabel: () => 'server',
}
