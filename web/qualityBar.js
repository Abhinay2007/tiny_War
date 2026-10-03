// "Recommended settings" — a High/Medium/Low/Custom preset picker (sets the LLM model +
// voice provider together) plus an expandable "Your device" readout for debugging and
// benchmarking. Mounted at the TOP of the Settings page, above Local AI Model.
import { PRESETS, applyPreset, getActivePreset, onPresetChange, detectPreset } from '/web/qualityPreset.js'
import { gatherDeviceInfo, recommendPreset } from '/web/deviceInfo.js'

const presetLabel = (id) => (PRESETS.find((p) => p.id === id) || {}).label || id

function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid)
  return n
}

export function mountQualityBar(host) {
  // Preset buttons (+ a derived "Custom" that only highlights, never applies).
  const OPTS = [...PRESETS, { id: 'custom', label: 'Custom', sub: 'Your own model + voice + portrait' }]
  const btns = {}
  const row = el('div', { class: 'tac-preset-row' }, OPTS.map((p) => {
    const b = el('button', { class: 'tac-preset-btn', type: 'button', 'data-id': p.id },
      [el('span', { class: 'tac-preset-name' }, p.label), el('span', { class: 'tac-preset-sub' }, p.sub)])
    if (p.id !== 'custom') b.addEventListener('click', () => applyPreset(p.id))
    else b.disabled = true // Custom is a status, not an action
    btns[p.id] = b
    return b
  }))

  function highlight(active) {
    for (const id of Object.keys(btns)) btns[id].classList.toggle('active', id === active)
  }
  highlight(getActivePreset())
  onPresetChange((id) => highlight(id))

  // Expandable device readout (debug / benchmark) + a one-click "recommend for me".
  const recBtn = el('button', { class: 'persona-go tac-device-rec', type: 'button' }, '✦ Use recommended for this device')
  const recNote = el('div', { class: 'persona-status tac-device-rec-note' })
  recBtn.addEventListener('click', async () => {
    recBtn.disabled = true; recNote.textContent = 'detecting…'
    try {
      const { id, reason } = await recommendPreset()
      applyPreset(id)
      recNote.textContent = `Chose ${presetLabel(id)} (${reason}).`
    } catch { recNote.textContent = 'Could not detect — pick a preset above.' }
    recBtn.disabled = false
  })
  const devBody = el('div', { class: 'tac-device-body' }, 'reading…')
  const dev = el('details', { class: 'tac-device' }, [
    el('summary', {}, 'Your device (GPU / RAM / storage)'),
    el('div', { class: 'tac-device-actions' }, [recBtn, recNote]),
    devBody,
  ])
  dev.addEventListener('toggle', async () => {
    if (!dev.open || dev.dataset.loaded) return
    dev.dataset.loaded = '1'
    try {
      const rows = await gatherDeviceInfo()
      devBody.replaceChildren(...rows.map(([k, v]) =>
        el('div', { class: 'tac-device-row' }, [el('span', { class: 'tac-device-k' }, k), el('span', { class: 'tac-device-v' }, v)])))
    } catch { devBody.textContent = 'could not read device info' }
  })

  host.append(el('div', { class: 'tac-quality' }, [row, dev]))
  return { refresh: () => highlight(detectPreset()) }
}
