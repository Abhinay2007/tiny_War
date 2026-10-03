// First-run guided tour — small, non-blocking coachmarks anchored to screen regions that advance
// as the player acts (or via Next), always skippable, first-run only. Copy is in-world (set by the
// caller). Progress persists so it never repeats. See docs/tutorial-plan.md.

const KEY = 'tinyarmy.tutorial.v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }

function elc(tag, css, text) { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n }

// Pulsing gold glow drawn on whatever control the current step is waiting for, so the eye is led
// straight to the button to press. Injected once; targets carry a [data-tut="…"] attribute.
;(function injectTutGlow() {
  try {
    if (document.getElementById('ta-tut-glow-css')) return
    const s = document.createElement('style'); s.id = 'ta-tut-glow-css'
    s.textContent = '@keyframes ta-tut-pulse{0%,100%{box-shadow:0 0 0 2px rgba(255,224,130,.55),0 0 8px 2px rgba(201,162,39,.35)}50%{box-shadow:0 0 0 3px rgba(255,224,130,.95),0 0 22px 8px rgba(255,224,130,.7)}}.ta-tut-glow{animation:ta-tut-pulse 1.15s ease-in-out infinite;border-color:#ffe082!important;position:relative;z-index:9}'
    document.head.appendChild(s)
  } catch { /* ignore */ }
})()

// The callout is a single draggable banner. Two snap presets keep it out of the way: DOWN (above the
// on-screen controls) and UP (just below the top UI). The handle lets you drag it anywhere, or tap to
// flip between the presets — so on mobile it never has to block whatever you need to reach.
const PRESETS = {
  down: { left: '50%', bottom: '150px', transform: 'translateX(-50%)' },
  up: { left: '50%', top: '64px', transform: 'translateX(-50%)' },
}

export function createTutorial(steps) {
  let state = { step: 0, done: false, dismissed: false, placement: { mode: 'preset', preset: 'down' }, ...load() }
  let idx = -1, box = null
  let glowEl = null, glowTimer = null
  const persist = () => save(state)

  // Keep a pulsing glow on the step's target control. Polled because some targets only appear once a
  // modal/sheet opens, and some get re-rendered (the picker card, skill buttons) — we follow the swap.
  function clearGlow() {
    if (glowTimer) { clearInterval(glowTimer); glowTimer = null }
    if (glowEl) { try { glowEl.classList.remove('ta-tut-glow') } catch { /* ignore */ } glowEl = null }
  }
  function trackGlow(sel) {
    clearGlow()
    if (!sel) return
    const tick = () => {
      const el = document.querySelector(sel)
      if (el === glowEl) return
      if (glowEl) { try { glowEl.classList.remove('ta-tut-glow') } catch { /* ignore */ } }
      glowEl = el
      if (el) { try { el.classList.add('ta-tut-glow') } catch { /* ignore */ } }
    }
    tick(); glowTimer = setInterval(tick, 400)
  }

  // Position the callout from state.placement: a free x/y (after dragging) or one of the snap presets.
  function applyPlacement(b) {
    if (!b) return
    b.style.left = b.style.top = b.style.bottom = b.style.right = b.style.transform = ''
    const pl = state.placement || (state.placement = { mode: 'preset', preset: 'down' })
    if (pl.mode === 'free' && pl.left != null) {
      b.style.left = pl.left + 'px'; b.style.top = pl.top + 'px'
    } else {
      const p = PRESETS[pl.preset] || PRESETS.down
      for (const k in p) b.style[k] = p[k]
    }
  }

  // A grab handle at the top of the callout: DRAG to place it anywhere (clamped to the viewport), or
  // TAP (no real movement) to flip between the up/down snap presets. Pointer events cover touch + mouse.
  function buildHandle() {
    const h = elc('div', 'cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;margin:-13px -15px 10px;padding:9px 15px 8px;border-bottom:1px solid #2a2a17;display:flex;align-items:center;justify-content:center;gap:8px')
    const grip = elc('div', 'display:flex;gap:3px;align-items:center')
    for (let i = 0; i < 3; i++) grip.appendChild(elc('span', 'width:4px;height:4px;border-radius:50%;background:#7a8294'))
    h.append(grip, elc('span', 'font-size:10px;color:#6b7686', 'drag to move · tap to flip'))
    let start = null, moved = false
    const onDown = (e) => {
      const r = box.getBoundingClientRect()
      start = { px: e.clientX, py: e.clientY, bx: r.left, by: r.top }
      moved = false; h.style.cursor = 'grabbing'
      try { h.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      e.preventDefault()
    }
    const onMove = (e) => {
      if (!start) return
      const dx = e.clientX - start.px, dy = e.clientY - start.py
      if (!moved && Math.hypot(dx, dy) > 5) moved = true // small dead zone so a tap isn't read as a drag
      if (!moved) return
      const w = box.offsetWidth, ht = box.offsetHeight
      const nx = Math.max(6, Math.min(window.innerWidth - w - 6, start.bx + dx))
      const ny = Math.max(6, Math.min(window.innerHeight - ht - 6, start.by + dy))
      state.placement = { mode: 'free', preset: (state.placement && state.placement.preset) || 'down', left: nx, top: ny }
      applyPlacement(box)
    }
    const onUp = (e) => {
      if (!start) return
      start = null; h.style.cursor = 'grab'
      try { h.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (!moved) { // a tap → flip to the other snap preset
        const cur = state.placement && state.placement.preset === 'up' ? 'up' : 'down'
        state.placement = { mode: 'preset', preset: cur === 'down' ? 'up' : 'down' }
        applyPlacement(box)
      }
      persist()
    }
    h.addEventListener('pointerdown', onDown)
    h.addEventListener('pointermove', onMove)
    h.addEventListener('pointerup', onUp)
    h.addEventListener('pointercancel', onUp)
    return h
  }

  const shouldAutoStart = () => !state.done && !state.dismissed
  function startOrResume() { if (state.done) return; idx = Math.min(state.step || 0, steps.length - 1); show() }
  function emit(event) { const s = steps[idx]; if (idx >= 0 && s && s.advanceOn === event) advance() }
  function advance() { idx++; state.step = idx; persist(); if (idx >= steps.length) finish(); else show() }
  function skip() { state.dismissed = true; persist(); teardown() }
  function finish() { state.done = true; persist(); teardown() }
  function reset() { state = { step: 0, done: false, dismissed: false }; persist(); idx = 0; show() }
  function teardown() { clearGlow(); if (box) { try { box.remove() } catch { /* ignore */ } } box = null }

  function show() {
    const s = steps[idx]
    if (!s) return finish()
    state.step = idx; persist()
    teardown()
    box = elc('div', 'position:fixed;z-index:40;max-width:300px;background:#11151c;border:1px solid #c9a227;border-radius:12px;padding:13px 15px;color:#e8e8e8;font:13px var(--tac-font,system-ui);box-shadow:0 8px 30px rgba(0,0,0,.55);line-height:1.45')
    box.appendChild(buildHandle())
    const t = elc('div', 'margin-bottom:11px', typeof s.text === 'function' ? s.text() : s.text)
    box.appendChild(t)
    const row = elc('div', 'display:flex;gap:8px;justify-content:flex-end;align-items:center')
    const prog = elc('span', 'margin-right:auto;font-size:10px;color:#6b7686', `${idx + 1}/${steps.length}`)
    row.appendChild(prog)
    if (s.skipLabel !== false) {
      const sk = elc('button', 'background:none;border:none;color:#9aa4b2;font:12px var(--tac-font,system-ui);cursor:pointer;padding:6px 4px', s.skipLabel || 'Skip tour')
      sk.type = 'button'; sk.addEventListener('click', skip); row.appendChild(sk)
    }
    const nx = elc('button', 'background:#2a2410;border:1px solid #c9a227;color:#ffe082;font:600 12px var(--tac-font,system-ui);cursor:pointer;padding:7px 14px;border-radius:8px', s.nextLabel || (idx === steps.length - 1 ? 'Done' : 'Next'))
    nx.type = 'button'; nx.addEventListener('click', advance); row.appendChild(nx)
    box.appendChild(row)
    document.body.appendChild(box)
    applyPlacement(box) // restore the player's chosen position (snap preset or dragged spot)
    trackGlow(s.target) // pulse the control this step is pointing at (if any)
  }

  return { emit, startOrResume, shouldAutoStart, reset, skip, isActive: () => !!box }
}
