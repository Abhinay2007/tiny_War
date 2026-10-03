// Inject our settings sections into Gradio's OWN settings page (footer "Settings" or the
// sidebar ⚙ button → ?view=settings). Not an official extension point, so we anchor on
// the "Display Theme" section, clone its styling, and prepend matching sections:
//   • Text Generation Model — the LLM engine/model picker (modelBar)
//   • Voice          — the read-aloud TTS engine/voice picker (ttsBar)
// Both drive the shared runtime.js / tts.js singletons, so every page uses the same
// choice. Fragile by nature (rides Gradio's DOM): if the structure changes the sections
// just won't appear (graceful no-op) and the app still runs on defaults.
import { mountModelBar } from '/web/modelBar.js'
import { mountTtsBar } from '/web/ttsBar.js'
import { mountImagenBar } from '/web/imagenBar.js'
import { mountPersonaPromptBar } from '/web/personaPromptBar.js'
import { mountQualityBar } from '/web/qualityBar.js'
import { mountCodingModelBar } from '/web/codingModelBar.js'
import { recentCalls, onDiag } from '/web/diag.js'

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

function injectSection(sample, id, title, intro, mountFn) {
  const list = sample.parentElement
  if (!list || list.querySelector('#' + id)) return
  const section = el('div', { class: sample.className + ' tac-set-section', id })
  const h = document.createElement('h2')
  h.className = sample.querySelector('h2')?.className || ''
  h.textContent = title
  const host = el('div')
  section.append(h, el('p', { class: 'tac-set-intro' }, intro), host)
  list.insertBefore(section, sample) // above Display Theme, below the title
  mountFn(host)
}

// Gameplay toggles. Currently just emotes on/off, persisted to the same localStorage flag the
// emote layer reads ('tinyarmy.emotes', default on → only '0' disables).
function mountGameplayBar(host) {
  const cb = el('input', { type: 'checkbox' })
  try { cb.checked = localStorage.getItem('tinyarmy.emotes') !== '0' } catch { cb.checked = true }
  cb.addEventListener('change', () => { try { localStorage.setItem('tinyarmy.emotes', cb.checked ? '1' : '0') } catch { /* ignore */ } })
  const lab = el('label', { class: 'tac-set-row', style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [cb, 'Show character emotes'])
  host.append(lab)
  // Replay the first-run tour. tiny.js exposes the reset; reset the flag too so it re-arms even if
  // the Game tab isn't mounted yet (it'll auto-start next time you open it).
  const replay = el('button', { type: 'button', style: 'margin-top:10px;padding:9px 14px;border-radius:8px;border:1px solid #2a3340;background:#1a2230;color:#e8e8e8;font:600 13px var(--tac-font,system-ui);cursor:pointer',
    onclick: () => {
      if (typeof window.tinyArmyReplayTutorial === 'function') { window.tinyArmyReplayTutorial(); replay.textContent = 'Tour restarted — open the Game tab' }
      else { try { localStorage.removeItem('tinyarmy.tutorial.v1') } catch { /* ignore */ } replay.textContent = 'Tour re-armed — open the Game tab' }
    } }, 'Replay tutorial')
  host.append(replay)
}

// Diagnostics: a live readout of recent model/media calls (image, voice, skill, text) with
// status + timing — for troubleshooting "stuck loading" / silent failures without devtools.
function mountDiagnosticsBar(host) {
  const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms || 0) + 'ms')
  const list = el('div', { style: 'font:11px ui-monospace,monospace;max-height:240px;overflow:auto;border:1px solid #2a3340;border-radius:8px;padding:8px;background:rgba(20,24,33,.5)' })
  const render = () => {
    const calls = recentCalls().slice(-25).reverse()
    list.replaceChildren()
    if (!calls.length) { list.append(el('div', { style: 'color:#9aa4b2' }, 'No model/media calls yet — generate a portrait, voice or skill.')); return }
    for (const c of calls) {
      const mark = c.ok ? '✓' : (c.timedOut ? '⏱ TIMEOUT' : '✗')
      const detail = c.label || c.error || (c.status ? 'HTTP ' + c.status : '') || c.url || ''
      const row = el('div', { style: `padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${c.ok ? '#8fe388' : '#ff8a8a'}` },
        `${new Date(c.ts).toLocaleTimeString()}  ${c.kind}  ${mark}  ${fmt(c.ms)}  ${detail}`)
      list.append(row)
    }
  }
  const hint = el('p', { class: 'tac-set-intro', style: 'margin:0 0 6px' }, 'Tip: also run tinyDiag() in the browser console for the full table.')
  host.append(hint, list)
  render(); onDiag(render)
}

export function mountSettingsPanel() {
  const tryInject = () => {
    const sample = [...document.querySelectorAll('.banner-wrap')].find((e) => /Display Theme/i.test(e.textContent))
    if (!sample) return
    // Recommended (preset) first so it sits at the very top, then Model, Voice, etc.
    // Each injectSection inserts just above Display Theme, so call order = on-screen order.
    injectSection(sample, 'tac-quality-settings', 'Recommended settings',
      'Pick a quality preset — it sets the AI model and voice together, like graphics ' +
      'presets in a game. Changing either by hand switches to Custom.', mountQualityBar)
    injectSection(sample, 'tac-model-settings', 'Text Generation Model',
      'The model that writes your soldiers and their war diaries. Use browser-local ' +
      'models, a configured local server, or a ZeroGPU-hosted model.', mountModelBar)
    injectSection(sample, 'tac-voice-settings', 'Voice',
      'The provider that voices your heroes. Qwen3-TTS designs a voice from each hero’s ' +
      'description; Kokoro/Kitten run on your device with a named voice you pick per hero. ' +
      'The voice belongs to the hero, so there’s no global voice to choose here.', mountTtsBar)
    injectSection(sample, 'tac-image-settings', 'Portrait',
      'The model that paints hero portraits. Z-Image-Turbo runs on your GPU when you host ' +
      'the project locally; FLUX runs in the cloud otherwise.', mountImagenBar)
    injectSection(sample, 'tac-persona-prompt-settings', 'Persona Prompt',
      'The system prompt that writes each hero (name, about, quote and voice design). ' +
      'Edit it to change their style; Save uses it on the next “Recruit hero”.', mountPersonaPromptBar)
    injectSection(sample, 'tac-coding-model-settings', 'Coding Model',
      'The model that powers the Skill Forge — it writes a skill for a chosen hero. ' +
      'Nemotron 3 Nano (NVIDIA) runs via NVIDIA NIM; Mellum2 (JetBrains) runs as a ' +
      'ZeroGPU sidecar and falls back to Nemotron (NIM) if its sidecar is unavailable.',
      mountCodingModelBar)
    injectSection(sample, 'tac-diagnostics-settings', 'Diagnostics',
      'Recent model/media calls (image, voice, skill, text) with status + timing. Use this to ' +
      'troubleshoot generation that is stuck loading or failing — timeouts now surface as ⏱.', mountDiagnosticsBar)
    injectSection(sample, 'tac-gameplay-settings', 'Gameplay',
      'On-map flourishes during the Game. Emotes pop little reaction bubbles above heroes ' +
      'and enemies when they take a hit, get afflicted, drop low, or score a kill.', mountGameplayBar)
  }
  new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true })
  tryInject()
}
