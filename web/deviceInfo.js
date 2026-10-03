// Best-effort device/GPU/RAM probe for the Settings "Your device" panel — handy for
// debugging and benchmarking which quality preset a machine can handle. Everything is
// guarded: unsupported APIs just read "—" rather than throwing.
import { storageEstimate } from '/web/storage.js'
import { fmtBytes } from '/web/modelCatalog.js'

function webglRenderer() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return '—'
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : (gl.getParameter(gl.RENDERER) || '—')
  } catch { return '—' }
}

async function webgpuInfo() {
  try {
    if (!navigator.gpu) return 'unavailable'
    const ad = await navigator.gpu.requestAdapter()
    if (!ad) return 'no adapter'
    const info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null)
    const desc = info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' ').trim() : ''
    return desc || 'available'
  } catch { return 'error' }
}

export function isMobile() {
  try { if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') return navigator.userAgentData.mobile } catch { /* ignore */ }
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
}

// A combined, lowercased GPU descriptor (WebGL renderer + WebGPU adapter info) for
// heuristic matching. WebGL's ANGLE string usually carries the real chip name, e.g.
// "…nvidia geforce rtx 3090…" on desktop or "adreno (tm) 730" on Android.
async function gpuDescriptor() {
  let s = webglRenderer()
  try {
    if (navigator.gpu) {
      const ad = await navigator.gpu.requestAdapter()
      const info = ad && (ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null))
      if (info) s += ' ' + [info.vendor, info.architecture, info.description].filter(Boolean).join(' ')
    }
  } catch { /* ignore */ }
  return s.toLowerCase()
}

// Recommend a quality preset for this device:
//   • Mobile → Low, but Medium if a Qualcomm Adreno 700-series (or higher) is detected.
//   • Desktop → Medium, but High if an NVIDIA RTX 3090 (or higher) is detected.
// "or higher" for RTX = a newer generation, or the same 30-gen at ≥90 (so 3090/3090 Ti
// and all 40xx/50xx qualify; 3080 and below don't).
export async function recommendPreset() {
  const gpu = await gpuDescriptor()
  if (isMobile()) {
    const a = gpu.match(/adreno[^\d]*(\d{3,4})/)
    if (a && parseInt(a[1], 10) >= 700) return { id: 'medium', reason: `mobile · Adreno ${a[1]} (≥700)` }
    return { id: 'low', reason: 'mobile device' }
  }
  const r = gpu.match(/rtx\s*0*(\d{3,4})/)
  if (r) {
    const n = parseInt(r[1], 10), gen = Math.floor(n / 100), model = n % 100
    if (gen > 30 || (gen === 30 && model >= 90)) return { id: 'high', reason: `desktop · RTX ${r[1]} (≥3090)` }
  }
  return { id: 'medium', reason: 'desktop' }
}

// Returns an ordered array of [label, value] rows.
export async function gatherDeviceInfo() {
  const rows = []
  const add = (k, v) => rows.push([k, v == null || v === '' ? '—' : String(v)])

  add('CPU threads', navigator.hardwareConcurrency)
  add('Device memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB (approx)` : '— (not reported)')
  add('WebGPU', await webgpuInfo())
  add('GPU (WebGL)', webglRenderer())
  try {
    const { usage, quota } = await storageEstimate()
    add('Storage cache', quota ? `${fmtBytes(usage || 0)} / ${fmtBytes(quota)}` : '—')
  } catch { add('Storage cache', '—') }
  try { add('Screen', `${screen.width}×${screen.height} @ ${window.devicePixelRatio || 1}×`) } catch { add('Screen', '—') }
  add('Platform', (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform)
  add('Language', navigator.language)
  add('User agent', navigator.userAgent)
  return rows
}
