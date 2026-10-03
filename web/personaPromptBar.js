// Persona-prompt viewer/editor for the Settings page. Shows the system prompt that
// writes each hero (name / about / quote / voice design) and lets you edit it. A saved
// edit is stored locally (personaPrompts.js → setPersonaSystem) and used by the persona
// panel on the next "Recruit hero"; Reset restores the built-in default.
import {
  PERSONA_SYSTEM_DEFAULT, getPersonaSystem, setPersonaSystem, resetPersonaSystem, isPersonaSystemCustom,
} from '/web/personaPrompts.js'

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

export function mountPersonaPromptBar(host) {
  const ta = el('textarea', { class: 'persona-prompt-edit', rows: 12, spellcheck: 'false' })
  const saveBtn = el('button', { class: 'persona-go persona-prompt-save', type: 'button' }, 'Save')
  const resetBtn = el('button', { class: 'persona-ico persona-prompt-reset', type: 'button' }, 'Reset to default')
  const note = el('div', { class: 'persona-status persona-prompt-note' })

  ta.value = getPersonaSystem()

  function refreshNote() {
    note.textContent = isPersonaSystemCustom() ? 'Using your custom prompt.' : 'Using the built-in default.'
  }
  // Badge the Save button while the textarea differs from the prompt in effect —
  // i.e. there are unsaved edits. Cleared once saved (or the edit matches default).
  function refreshEdited() {
    saveBtn.classList.toggle('badged', ta.value.trim() !== getPersonaSystem().trim())
  }
  refreshNote(); refreshEdited()
  ta.addEventListener('input', refreshEdited)

  saveBtn.addEventListener('click', () => {
    setPersonaSystem(ta.value)
    ta.value = getPersonaSystem() // reflect (a default-equal edit clears the override)
    refreshNote(); refreshEdited()
    saveBtn.textContent = '✓ Saved'; setTimeout(() => { saveBtn.textContent = 'Save' }, 1400)
  })
  resetBtn.addEventListener('click', () => {
    resetPersonaSystem()
    ta.value = PERSONA_SYSTEM_DEFAULT
    refreshNote(); refreshEdited()
  })

  host.append(el('div', { class: 'persona-prompt-bar' }, [
    ta,
    el('div', { class: 'persona-prompt-actions' }, [saveBtn, resetBtn]),
    note,
  ]))
  return { refresh: () => { ta.value = getPersonaSystem(); refreshNote(); refreshEdited() } }
}
