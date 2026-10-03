// Coding-model picker for the Settings page. A trimmed modelBar: no engine selector and
// no cache/delete controls (these are ZeroGPU sidecars with no browser download). Drives
// the shared codingModel.js store, so the Skill Forge uses whatever is chosen here.
import {
  listCodingModels, getCodingModelId, setCodingModel, currentCodingModel, onCodingModelChange,
} from '/web/codingModel.js'

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

export function mountCodingModelBar(host, { onChange } = {}) {
  const sel = el('select', { class: 'model-select' })
  const info = el('div', { class: 'model-info' })
  host.append(el('div', { class: 'model-bar' }, [
    el('label', { class: 'persona-label' }, 'Model'),
    sel,
    el('div', { class: 'model-row' }, [info]),
  ]))

  function render() {
    sel.replaceChildren(...listCodingModels().map((m) =>
      el('option', { value: m.id }, `${m.label}${m.params ? ` · ${m.params}` : ''}`)))
    sel.value = getCodingModelId()
    const m = currentCodingModel()
    info.textContent = [m.params, m.backend, m.note].filter(Boolean).join(' · ')
  }

  sel.addEventListener('change', () => { setCodingModel(sel.value); render(); onChange && onChange(sel.value) })
  onCodingModelChange(render)
  render()
  return { refresh: render }
}
