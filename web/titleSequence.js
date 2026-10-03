// Cinematic title sequence for the hero-select screen. The hero picker is usable immediately;
// this just runs an ambient camera tour over decorative "warbands" (spawned via
// comboCtrl.startCinematic) and lays a TINY ARMY wordmark + letterbox/vignette over the map,
// with an optional looping theme. Everything here is non-blocking (pointer-events:none) and below
// the picker (z-index 6), so it never gets in the player's way.
//
//   const seq = mountTitleSequence(host, comboCtrl, { groups, audioUrl, title, tagline })
//   ...later, on hero pick/teardown:  seq.stop()

export function mountTitleSequence(host, comboCtrl, opts = {}) {
  // Music is owned by the caller (tiny.js) so it can persist (ducked) into gameplay and be muted —
  // this module only drives the camera tour + wordmark overlay.
  const { groups = [], title = 'TINY ARMY', tagline = 'Pick a hero. Hold the line.' } = opts
  let stopped = false
  const timers = new Set()
  const sleep = (ms) => new Promise((res) => { const t = setTimeout(() => { timers.delete(t); res() }, ms); timers.add(t) })

  // ── Overlay: letterbox bars + vignette + wordmark (all non-interactive) ──
  const layer = document.createElement('div')
  layer.className = 'title-seq'
  layer.style.cssText = 'position:absolute;inset:0;z-index:5;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .8s ease'
  const bar = (edge) => {
    const b = document.createElement('div')
    b.style.cssText = `position:absolute;left:0;right:0;${edge}:0;height:7vh;background:linear-gradient(${edge === 'top' ? '180deg' : '0deg'},rgba(0,0,0,.75),rgba(0,0,0,0));`
    return b
  }
  const vignette = document.createElement('div')
  vignette.style.cssText = 'position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 42%,transparent 55%,rgba(4,6,10,.55) 100%)'
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute;left:0;right:0;top:13%;text-align:center;padding:0 16px;transition:opacity 1s ease,transform 1s ease'
  const h = document.createElement('div')
  h.textContent = title
  h.style.cssText = 'font:800 clamp(34px,8vw,76px) var(--tac-font,Georgia,serif);letter-spacing:.06em;color:#f4ecd8;text-shadow:0 3px 0 rgba(0,0,0,.35),0 0 26px rgba(255,196,92,.35);line-height:1'
  const sub = document.createElement('div')
  sub.textContent = tagline
  sub.style.cssText = 'margin-top:10px;font:600 clamp(12px,2.4vw,17px) var(--tac-font,system-ui);color:#cdb98e;letter-spacing:.18em;text-transform:uppercase;opacity:.9'
  wrap.append(h, sub)
  layer.append(bar('top'), bar('bottom'), vignette, wrap)
  host.appendChild(layer)
  requestAnimationFrame(() => { layer.style.opacity = '1' })
  // The big wordmark holds, then settles smaller/translucent so it reads as ambient branding
  // rather than a blocking splash (the picker is live the whole time).
  const settle = setTimeout(() => {
    if (stopped) return
    wrap.style.opacity = '.5'
    wrap.style.transform = 'translateY(-4%) scale(.7)'
  }, 4200)
  timers.add(settle)

  // ── Camera director: tour the warband anchors with push-in / pull-out, looping forever. ──
  const rand = (a, b) => a + Math.random() * (b - a)
  async function fly(x, y, z, ms) {
    if (stopped) return
    try { await comboCtrl.map.flyTo(x, y, z, ms) } catch { /* interrupted */ }
  }
  async function director(anchors) {
    if (!anchors.length) { // nothing spawned — just drift the overview so it's not dead-still
      const b = comboCtrl.map.getBounds()
      while (!stopped) { await fly((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.45, 4000); await sleep(2500) }
      return
    }
    const b = comboCtrl.map.getBounds()
    const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
    let i = 0
    while (!stopped) {
      const a = anchors[i % anchors.length]
      // Push in on the warband and dwell. Wide enough to show lots of map; the decor sprites are
      // scaled up (CINE_SPRITE_MUL in startCinematic) to compensate, so characters keep their size.
      await fly(a.x, a.y, rand(1.15, 1.4), 2600)
      await sleep(1900)
      // Every third beat, pull out to a wide establishing shot before the next group.
      if (i % 3 === 2) { await fly(mid.x + rand(-400, 400), mid.y + rand(-300, 300), rand(0.4, 0.55), 2300); await sleep(900) }
      i++
    }
  }

  // Spawn the warbands, then start the tour over wherever they actually landed.
  ;(async () => {
    let anchors = []
    try { anchors = (await comboCtrl.startCinematic({ groups })) || [] } catch { anchors = [] }
    if (stopped) { try { comboCtrl.stopCinematic() } catch {} ; return }
    director(anchors)
  })()

  function stop() {
    if (stopped) return
    stopped = true
    for (const t of timers) clearTimeout(t)
    timers.clear()
    try { comboCtrl.stopCinematic() } catch { /* ignore */ }
    layer.style.opacity = '0'
    setTimeout(() => { try { layer.remove() } catch {} }, 800)
  }

  return { stop }
}
