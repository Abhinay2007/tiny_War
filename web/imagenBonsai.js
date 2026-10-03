// In-browser image engine: Bonsai Image 4B (FLUX.2-Klein, 1-bit/ternary, Apache-2.0) on
// WebGPU. Bonsai's engine is a bespoke WGSL app with no JS API and a custom 1-bit weight
// packing only its own shaders can run — so we can't load the weights into a generic
// pipeline. Instead we VENDOR its self-contained static bundle under /web/bonsai/ and run
// it in a same-origin hidden iframe, driving its UI directly (load → prompt → generate →
// read the output image). Same-origin = no postMessage bridge and no cross-origin iframe
// throttling. Desktop-only: the model is ~4-5 GB. generate() → an image Blob.
const APP = '/web/bonsai/index.html'

const isMobile = () => { try { return /Mobi|Android|iPhone|iPad|iPod|IEMobile/i.test(navigator.userAgent) } catch { return false } }

let _iframe = null, _readyP = null, _loaded = false, _loadP = null

const doc = () => _iframe.contentDocument
const win = () => _iframe.contentWindow
const btns = () => Array.from(doc().querySelectorAll('button'))
const findBtn = (re, enabledOnly) => btns().find((b) => re.test((b.textContent || '').trim()) && (!enabledOnly || !b.disabled))
const promptEl = () => doc().querySelector('textarea[placeholder*="Describe" i], input[placeholder*="Describe" i]')
const bodyText = () => (doc().body && doc().body.innerText) || ''
const isLoading = () => /downloading|loading model|compiling|preparing|fetching/i.test(bodyText())
const loadBtn = () => findBtn(/load .*model/i, false)
// "Load … model" persists in the picker post-load, so detect readiness via the prompt UI.
const isLoaded = () => /enter a prompt|running locally/i.test(bodyText()) && !isLoading()

function wait(test, { timeout = 600000, interval = 400, onTick } = {}) {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    ;(function tick() {
      let v
      try { v = test() } catch (e) { return rej(e) }
      if (v) return res(v)
      if (onTick) { try { onTick() } catch { /* ignore */ } }
      if (Date.now() - t0 > timeout) return rej(new Error('bonsai timeout'))
      setTimeout(tick, interval)
    })()
  })
}

function setValue(el, val) {
  const W = win() // use the iframe realm's prototypes/constructors
  const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)
  el.dispatchEvent(new W.Event('input', { bubbles: true }))
  el.dispatchEvent(new W.Event('change', { bubbles: true }))
}

function progFrac() {
  const m = bodyText().match(/([\d.]+)\s*(MB|GB)\s*\/\s*([\d.]+)\s*(MB|GB)/i)
  if (!m) return null
  const toMB = (v, u) => parseFloat(v) * (/GB/i.test(u) ? 1024 : 1)
  const f = toMB(m[1], m[2]) / toMB(m[3], m[4])
  return isFinite(f) ? Math.max(0, Math.min(0.99, f)) : null
}

// Read the iframe's output <img> into a Blob in OUR realm (same-origin → no canvas taint).
function imgToBlob(img) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  c.getContext('2d').drawImage(img, 0, 0)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

function ensureFrame() {
  if (_readyP) return _readyP
  _iframe = document.createElement('iframe')
  _iframe.setAttribute('aria-hidden', 'true')
  // Fill the viewport (so the app renders its DESKTOP controls) but invisible + click-through.
  // Same-origin avoids the cross-origin background throttling; in-viewport keeps it painted.
  _iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;opacity:.004;pointer-events:none;border:0;z-index:2147483647'
  _readyP = new Promise((res, rej) => {
    _iframe.addEventListener('load', () => {
      wait(() => promptEl() || loadBtn(), { timeout: 60000 }).then(() => res(), rej)
    })
    _iframe.addEventListener('error', () => rej(new Error('bonsai app failed to load')))
    document.body.appendChild(_iframe)
    _iframe.src = APP
  })
  return _readyP
}

async function ensure(onProgress) {
  await ensureFrame()
  if (_loaded) return
  if (_loadP) return _loadP
  _loadP = (async () => {
    if (!isLoaded()) {
      const lb = loadBtn(); if (lb) lb.click()
      await wait(isLoaded, { onTick: () => { const f = progFrac(); if (onProgress && f != null) onProgress(f) } })
    }
    _loaded = true
  })()
  return _loadP
}

async function generate(prompt) {
  await ensure()
  const p = promptEl(); if (!p) throw new Error('bonsai prompt field not found')
  setValue(p, prompt)
  const before = new Set(Array.from(doc().querySelectorAll('img')).map((i) => i.src).filter((s) => s.startsWith('blob:')))
  const gen = await wait(() => findBtn(/generate/i, true), { timeout: 15000 })
  gen.click()
  const img = await wait(() => {
    const fresh = Array.from(doc().querySelectorAll('img')).filter((i) => (i.src || '').startsWith('blob:') && !before.has(i.src) && i.complete && i.naturalWidth > 0)
    return fresh.length ? fresh[fresh.length - 1] : null
  }, { timeout: 300000 })
  return imgToBlob(img)
}

export const engine = {
  id: 'bonsai',
  label: 'Bonsai · in-browser (WebGPU, desktop)',
  available: () => { try { return !!navigator.gpu && !isMobile() } catch { return false } },
  note: 'desktop WebGPU · ~4-5 GB first use',
  needsDownload: true,
  networked: false,
  ensure,
  generate: (prompt, _opts = {}) => generate(prompt),
  backendLabel: () => '⚡ WebGPU · Bonsai (on-device)',
}
