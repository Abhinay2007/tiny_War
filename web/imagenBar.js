// Portrait-model picker for the Settings page. Chooses the engine that draws hero
// portraits (local Z-Image on your GPU, or cloud FLUX). Mirrors ttsBar.js: it only sets
// the engine on the shared imagen.js facade; the persona panel reads that choice.
import {
  listImageEngines, getImageEngineId, setImageEngine,
  imageBackendLabel, imageNeedsDownload, onImageEngineChange,
  portraitGenerationAvailable,
} from '/web/imagen.js'

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

export function mountImagenBar(host, { onChange } = {}) {
  if (!portraitGenerationAvailable()) {
    host.textContent = 'Portrait generation is disabled for this demo.'
    return { refresh() {} }
  }
  const engSel = el('select', { class: 'model-select engine-select' })
  const info = el('div', { class: 'model-info' })
  host.append(el('div', { class: 'model-bar imagen-bar' }, [
    el('label', { class: 'persona-label' }, '🖼 Portrait model'),
    engSel, info,
  ]))

  engSel.replaceChildren(...listImageEngines().map((e) =>
    el('option', { value: e.id, ...(e.available ? {} : { disabled: 'disabled' }) },
      `${e.label}${e.available ? '' : ' · ' + (e.note || 'n/a')}`)))
  engSel.value = getImageEngineId()

  function renderInfo() {
    info.textContent = `${imageBackendLabel()}${imageNeedsDownload() ? ' · downloads on first use' : ''}`
  }

  engSel.addEventListener('change', () => { setImageEngine(engSel.value); renderInfo(); onChange && onChange() })
  onImageEngineChange((id) => { engSel.value = id; renderInfo() })

  renderInfo()
  return { refresh: renderInfo }
}
