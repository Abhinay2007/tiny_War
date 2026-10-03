// Image engines backed by our /portrait route (server-side, so keys stay off the client):
//   • zimage-local — Z-Image-Turbo on YOUR GPU (TINY_IMAGE_MODE=local). Localhost only.
//   • flux / flux-dev — FLUX via NVIDIA NIM (or HF Inference) in the cloud.
// Mirrors ttsQwen3.js (engine + engineLocal). generate() returns a PNG Blob.
import { diagFetch } from '/web/diag.js'

export const isLocalhost = () => {
  try { return /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/i.test(location.hostname) } catch { return false }
}

// 2-minute ceiling: image gen on a cold ZeroGPU can take a while, but past this it's hung —
// fail loudly (logged via diag) instead of spinning the loader forever.
async function postPortrait(body) {
  const resp = await diagFetch('image', '/portrait', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { timeoutMs: 120000, label: `${body.engine || ''}${body.provider ? '/' + body.provider : ''}` })
  if (!resp.ok) throw new Error(`portrait ${resp.status}: ${(await resp.text()).slice(0, 160)}`)
  return resp.blob() // image/png
}

const common = { needsDownload: false, networked: true, ensure: async () => {} }

// LOCAL: same-origin /portrait on a locally-run app.py (TINY_IMAGE_MODE=local → Z-Image
// on your GPU). Only offered on localhost; shown disabled with a note in prod.
export const engineLocal = {
  ...common,
  id: 'zimage-local',
  label: 'Z-Image-Turbo · local (your GPU)',
  available: () => isLocalhost(),
  note: 'run the project locally',
  generate: (prompt, { seed, refImage } = {}) => postPortrait({ prompt, seed, engine: 'local', ref_image: refImage }),
  backendLabel: () => '🖥 local model',
}

export const engineKleinZeroGpu = {
  ...common,
  id: 'klein-zerogpu',
  label: 'FLUX.2 klein 4B · ZeroGPU',
  available: () => true,
  generate: (prompt, { seed, refImage } = {}) => postPortrait({ prompt, seed, engine: 'klein', provider: 'flux-klein-4b', ref_image: refImage }),
  backendLabel: () => 'ZeroGPU FLUX.2 klein 4B',
}

// CLOUD: FLUX via the backend proxy (NVIDIA NIM, else HF Inference). `provider` picks the
// NIM sub-model. schnell = fast (4 steps), dev = higher quality (28 steps).
export const engineCloud = {
  ...common,
  id: 'flux',
  label: 'FLUX schnell · cloud (fast)',
  available: () => true,
  generate: (prompt, { seed } = {}) => postPortrait({ prompt, seed, engine: 'cloud', provider: 'flux-schnell' }),
  backendLabel: () => '☁ FLUX (NIM)',
}

export const engineCloudDev = {
  ...common,
  id: 'flux-dev',
  label: 'FLUX dev · cloud (higher quality)',
  available: () => true,
  generate: (prompt, { seed } = {}) => postPortrait({ prompt, seed, engine: 'cloud', provider: 'flux-dev' }),
  backendLabel: () => '☁ FLUX dev (NIM)',
}
