// Skill Forge tab — author a REAL, engine-resolvable combat skill for a chosen hero. The forge
// pipeline (model → validate → Klein icon → persist) lives in skillForge.js and is shared with
// the in-Game character sheet, so a hero can learn skills from either place.
import { currentCodingModel, onCodingModelChange } from '/web/codingModel.js'
import { listPersonas, getPersona, onRosterChange, getSkillIcon } from '/web/personaStore.js'
import { effectSummary } from '/web/skillSchema.js'
import { forgeSkillForHero } from '/web/skillForge.js'

// Loading spinner for a skill whose scene is still painting. Idempotent — tiny.js injects the same
// keyframes/class; we re-inject (id-guarded) so the Forge tab works even before the game module loads.
;(function injectSkillSpin() {
  try {
    if (document.getElementById('ta-skill-spin-css')) return
    const s = document.createElement('style'); s.id = 'ta-skill-spin-css'
    s.textContent = '@keyframes ta-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}.ta-skill-spin{position:absolute;top:50%;left:50%;width:18px;height:18px;border:2px solid #2a3340;border-top-color:#c9a227;border-radius:50%;animation:ta-spin .8s linear infinite}'
    document.head.appendChild(s)
  } catch { /* ignore */ }
})()

function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'style') n.style.cssText = v
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid)
  return n
}

export function mountSkillForgePanel(host) {
  const sel = el('select', { class: 'persona-input skillforge-hero' })
  const req = el('textarea', { class: 'persona-prompt-edit skillforge-req', rows: 4,
    placeholder: 'what skill should this hero learn? (e.g. “a defensive shout that shields nearby allies”)' })
  const btn = el('button', { class: 'persona-go', type: 'button' }, '⚒ Forge skill')
  const status = el('div', { class: 'persona-status' })
  const card = el('div', { class: 'skillforge-card', style: 'display:none;margin-top:10px;border:1px solid #2a3340;border-radius:12px;padding:12px;background:rgba(20,24,33,.6)' })
  const empty = el('div', { class: 'persona-roster-empty' },
    'No heroes yet — recruit one in the Personas tab, then come back to forge its skills.')

  const controls = el('aside', { class: 'persona-controls skillforge' }, [
    el('div', { class: 'persona-sec' }, [el('div', { class: 'persona-sec-title' }, 'Skill Forge'), el('span')]),
    el('label', { class: 'persona-label' }, 'Hero'), sel,
    empty,
    el('label', { class: 'persona-label' }, 'Skill request'), req,
    el('div', { class: 'persona-prompt-actions' }, [btn]),
    status,
    card,
  ])
  host.append(controls)

  function refreshHeroes() {
    const people = listPersonas()
    const prev = sel.value
    sel.replaceChildren(...people.map((p) => el('option', { value: p.id }, p.name || 'Unnamed hero')))
    if (people.some((p) => p.id === prev)) sel.value = prev
    const none = people.length === 0
    empty.style.display = none ? '' : 'none'
    sel.style.display = none ? 'none' : ''
    btn.disabled = none
  }
  function refreshStatus() { if (!status.dataset.busy) status.textContent = `Coding model: ${currentCodingModel().label}` }

  let shownSkillId = null // skill currently in the card — so we can repaint its icon when it finishes
  async function renderCard(skill) {
    shownSkillId = skill.id
    card.style.display = ''
    card.replaceChildren()
    const head = el('div', { style: 'display:flex;gap:12px;align-items:center' })
    const icon = el('div', { style: 'position:relative;width:64px;height:64px;border-radius:10px;border:1px solid #2a3340;background:#0d1015;flex:none;background-size:cover;background-position:center' })
    if (skill.iconPending) icon.append(el('div', { class: 'ta-skill-spin', title: 'painting its scene…' })) // still painting → spinner, never a stale (reused-id) icon
    else { const b = await getSkillIcon(skill.id); if (b) icon.style.backgroundImage = `url(${URL.createObjectURL(b)})` }
    const meta = el('div', {}, [
      el('div', { style: 'font:700 16px var(--tac-font,system-ui);color:#e8e8e8' }, skill.name),
      el('div', { style: 'font-size:11px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.06em;margin:2px 0' }, `${skill.category.replace('_', ' ')} · ${effectSummary(skill)}`),
    ])
    head.append(icon, meta)
    const flav = el('div', { style: 'color:#c2c8d2;font-style:italic;margin:10px 0 0;line-height:1.45' }, skill.flavor || '')
    const note = skill.iconPending ? 'painting its scene… (already usable on the character sheet)' : '✓ Learned — view it on the hero’s character sheet.'
    const saved = el('div', { style: 'color:#34d058;font-size:12px;margin-top:8px' }, note)
    card.append(head, flav, saved)
  }

  // When the background image finishes, the hero's skill flips iconPending → false (onRosterChange).
  // If that skill is the one in the card, repaint it so the spinner swaps for the finished art.
  function repaintShownCard() {
    if (!shownSkillId || card.style.display === 'none') return
    const owner = listPersonas().find((p) => p.customSkills && p.customSkills[shownSkillId])
    const sk = owner && owner.customSkills[shownSkillId]
    if (sk && !sk.iconPending) renderCard(sk)
  }

  let running = false
  async function forge() {
    if (running) return
    const p = getPersona(sel.value)
    if (!p) { status.textContent = 'Pick a hero first.'; return }
    if (!req.value.trim()) { status.textContent = 'Describe the skill you want.'; return }
    running = true; status.dataset.busy = '1'; btn.disabled = true; card.style.display = 'none'
    try {
      const res = await forgeSkillForHero(p.id, req.value, { onStatus: (s) => { status.textContent = s } })
      if (!res.ok) { status.textContent = 'Forge failed: ' + res.error; return }
      await renderCard(res.skill)
      status.textContent = 'Done.'
    } catch (e) {
      status.textContent = 'Forge failed: ' + (e && e.message ? e.message : e)
    } finally {
      running = false; delete status.dataset.busy; btn.disabled = listPersonas().length === 0
    }
  }

  btn.addEventListener('click', forge)
  onRosterChange(() => { refreshHeroes(); repaintShownCard() })
  onCodingModelChange(refreshStatus)
  refreshHeroes(); refreshStatus()
  return { refresh: refreshHeroes }
}
