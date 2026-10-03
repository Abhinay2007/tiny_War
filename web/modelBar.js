// Shared engine + model picker with cache controls for the in-browser panels.
// Lets you pick an ENGINE (wllama / Transformers.js / WebLLM) to benchmark which is
// fastest, then a model from that engine's catalog (showing size if known + whether
// it's already downloaded), and delete a downloaded model from the browser cache
// (wllama only) — like the wllama demo space.
import {
  listEngines, getEngineId, setEngine,
  listModels, currentModel, setModel,
  cacheSupported, cachedSet, deleteCached, backendLabel, onModelChange,
} from '/web/runtime.js'
import { fmtBytes } from '/web/modelCatalog.js'
import { storageEstimate } from '/web/storage.js'

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

// Byte size only (params is already shown in the label/info) — avoids "0.6B · 0.6B".
const sizeOf = (m) => (m && m.bytes ? fmtBytes(m.bytes) : '')

export function mountModelBar(host, { onChange } = {}) {
  const engSel = el('select', { class: 'model-select engine-select' })
  const sel = el('select', { class: 'model-select' })
  const del = el('button', { class: 'model-del', type: 'button', title: 'Delete this model from your browser cache' }, '🗑 delete')
  const info = el('div', { class: 'model-info' })
  host.append(el('div', { class: 'model-bar' }, [
    el('label', { class: 'persona-label' }, 'Runtime'),
    engSel,
    el('label', { class: 'persona-label' }, 'Model'),
    sel, el('div', { class: 'model-row' }, [info, del]),
  ]))

  // Engine options are fixed; unavailable ones (e.g. WebLLM with no WebGPU) are disabled.
  engSel.replaceChildren(...listEngines().map((e) =>
    el('option', { value: e.id, ...(e.available ? {} : { disabled: 'disabled' }) },
      `${e.label}${e.available ? '' : ' · needs WebGPU'}`)))
  engSel.value = getEngineId()

  let cached = new Set()
  let storeNote = ''
  function render() {
    const models = listModels()
    const cur = currentModel().id
    sel.replaceChildren(...models.map((m) =>
      el('option', { value: m.id }, `${m.label}${sizeOf(m) ? ` · ${sizeOf(m)}` : ''}${cached.has(m.id) ? ' · ✓ downloaded' : ''}`)))
    sel.value = cur
    const m = currentModel()
    const size = sizeOf(m)
    const cacheText = cacheSupported() ? (cached.has(m.id) ? 'cached' : 'downloads on first use') : (m.note || 'no browser download')
    info.textContent = `${m.params || ''}${size ? ` · ${size}` : ''} · ${backendLabel()} · ${cacheText}${storeNote}`
    del.style.display = (cacheSupported() && cached.has(m.id)) ? '' : 'none'
  }
  async function refresh() {
    cached = cacheSupported() ? await cachedSet() : new Set()
    const { usage, quota } = await storageEstimate()
    storeNote = cacheSupported() && quota ? ` · cache ${fmtBytes(usage)}/${fmtBytes(quota)}` : ''
    render()
  }

  engSel.addEventListener('change', async () => {
    setEngine(engSel.value)
    await refresh()
    onChange && onChange(sel.value)
  })
  sel.addEventListener('change', async () => { setModel(sel.value); render(); onChange && onChange(sel.value) })
  del.addEventListener('click', async () => {
    del.disabled = true; const prev = info.textContent; info.textContent = 'deleting from cache…'
    try { await deleteCached(sel.value) } catch (e) { info.textContent = 'delete failed: ' + (e.message || e) }
    await refresh(); del.disabled = false
    if (info.textContent.startsWith('delete failed')) setTimeout(() => { info.textContent = prev }, 2500)
  })

  // A preset (or any other surface) may change the engine/model — re-sync this bar.
  // render() updates the selects immediately; refresh() then refreshes cache/size info.
  onModelChange(() => { engSel.value = getEngineId(); render(); refresh() })

  render()
  refresh()
  return { refresh }
}
