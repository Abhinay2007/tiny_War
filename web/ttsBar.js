// Voice-PROVIDER picker for the Settings page: choose the TTS engine that voices your
// heroes (Qwen3-TTS designs a voice from each hero's description; Kokoro/Kitten/Web Speech
// use a named voice picked per-hero on the persona page). No voice dropdown here — the
// voice is a property of the hero, not a global setting. This bar only sets the engine on
// the shared tts.js facade; every page reads that choice.
import {
  listTtsEngines, getTtsEngineId, setTtsEngine,
  ttsBackendLabel, ttsNeedsDownload, activeEngineIsDesign, onTtsEngineChange,
} from '/web/tts.js'

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

export function mountTtsBar(host, { onChange } = {}) {
  const engSel = el('select', { class: 'model-select engine-select' })
  const info = el('div', { class: 'model-info' })
  host.append(el('div', { class: 'model-bar tts-bar' }, [
    el('label', { class: 'persona-label' }, '🔊 Voice provider'),
    engSel, info,
  ]))

  engSel.replaceChildren(...listTtsEngines().map((e) =>
    el('option', { value: e.id, ...(e.available ? {} : { disabled: 'disabled' }) },
      `${e.label}${e.available ? '' : ' · ' + (e.note || 'n/a')}`)))
  engSel.value = getTtsEngineId()

  function renderInfo() {
    const how = activeEngineIsDesign()
      ? 'designs a voice from each hero’s description'
      : 'pick a named voice per hero on the Personas page'
    info.textContent = `${ttsBackendLabel()} · ${how}${ttsNeedsDownload() ? ' · downloads on first use' : ''}`
  }

  engSel.addEventListener('change', () => { setTtsEngine(engSel.value); renderInfo(); onChange && onChange() })
  // A preset (Settings → Recommended) may switch the provider — keep this select in sync.
  onTtsEngineChange((id) => { engSel.value = id; renderInfo() })

  renderInfo()
  return { refresh: renderInfo }
}
