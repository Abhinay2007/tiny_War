// Death after-action — when a hero falls, show what the run achieved AND have the fighter
// recount the battle in its own voice (load-bearing LLM). The recap is banked to the hero's
// event log so it remembers this fight (feeds chat + future "living character" features).
import { streamChat, ensureModel, currentModelId } from '/web/runtime.js'
import { noThink, stripThinkFinal } from '/web/personaPrompts.js'
import { getPersona, patchPersona, addChronicle, listChronicle } from '/web/personaStore.js'
import { appendEvent } from '/web/progression.js'

function recapPrompts(p, run, recentEvents) {
  const system = [
    `You are ${p?.name || 'a fighter'}${p?.unitClass ? `, a ${p.unitClass}` : ''}, in a fantasy auto-battler.`,
    'You just fought a desperate battle and fell in the field. Recount it in FIRST PERSON, past tense,',
    'in 1-2 vivid sentences — proud, rueful or defiant as fits you. No preamble, no markdown.',
  ].join(' ')
  const lines = [
    `This battle: you cut down ${run.killsThisRun} foe${run.killsThisRun === 1 ? '' : 's'}`,
    run.levelEnd > run.levelStart ? `, rose from level ${run.levelStart} to ${run.levelEnd}` : `, at level ${run.levelEnd}`,
    `, the threat climbed to ${run.threat}×`,
    `, and you held for ${run.timeSurvived}s before falling.`,
  ].join('')
  return { system, user: lines + (recentEvents ? `\nAlong the way: ${recentEvents}.` : '') }
}

export function mountAfterAction(host, persona, run, { onAgain, onChoose } = {}) {
  const back = document.createElement('div')
  back.style.cssText = 'position:absolute;inset:0;z-index:13;background:rgba(6,8,12,.82);display:flex;align-items:center;justify-content:center;padding:16px'
  const card = document.createElement('div')
  card.style.cssText = 'width:min(440px,94vw);background:#11151c;border:1px solid #2a3340;border-radius:16px;padding:20px;color:#e8e8e8;box-sizing:border-box;text-align:center'

  const title = document.createElement('div'); title.textContent = `${persona?.name || 'Your hero'} has fallen`
  title.style.cssText = 'font:800 22px var(--tac-font,system-ui);color:#ff8a8a;margin-bottom:4px'
  const sub = document.createElement('div'); sub.textContent = 'After-action report'
  sub.style.cssText = 'font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9aa4b2;margin-bottom:16px'
  card.append(title, sub)

  // Stat grid
  const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px'
  const stat = (label, value, gold) => {
    const c = document.createElement('div'); c.style.cssText = 'background:rgba(20,24,33,.6);border:1px solid #232b36;border-radius:10px;padding:10px'
    const v = document.createElement('div'); v.textContent = value; v.style.cssText = `font:800 20px var(--tac-font,system-ui);color:${gold ? '#ffe082' : '#e8e8e8'}`
    const l = document.createElement('div'); l.textContent = label; l.style.cssText = 'font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9aa4b2;margin-top:2px'
    c.append(v, l); return c
  }
  grid.append(
    stat('Foes felled', String(run.killsThisRun), true),
    stat('Threat reached', run.threat + '×'),
    stat('Levels gained', '+' + Math.max(0, run.levelEnd - run.levelStart)),
    stat('Held for', run.timeSurvived + 's'),
  )
  card.append(grid)

  // Personal best: did this run beat the hero's record? Update + celebrate.
  const prevBest = persona?.progression?.best || { kills: 0, threat: 0 }
  const newRecord = run.killsThisRun > (prevBest.kills || 0)
  if (persona?.id) {
    const fresh0 = getPersona(persona.id)
    if (fresh0) patchPersona(persona.id, { progression: { ...fresh0.progression, best: { kills: Math.max(prevBest.kills || 0, run.killsThisRun), threat: Math.max(prevBest.threat || 0, run.threat), level: Math.max(prevBest.level || 0, run.levelEnd) } } })
  }
  if (newRecord) {
    const rec = document.createElement('div'); rec.textContent = `★ New record — ${run.killsThisRun} foes!`
    rec.style.cssText = 'color:#ffe082;font:700 13px var(--tac-font,system-ui);margin:-6px 0 14px'
    card.append(rec)
  } else if (prevBest.kills) {
    const rec = document.createElement('div'); rec.textContent = `Best: ${prevBest.kills} foes`
    rec.style.cssText = 'color:#9aa4b2;font-size:12px;margin:-6px 0 14px'
    card.append(rec)
  }

  // War-diary recap (streamed, in-voice)
  const recapWrap = document.createElement('div'); recapWrap.style.cssText = 'background:rgba(20,24,33,.5);border-left:3px solid #c9a227;border-radius:8px;padding:12px;margin-bottom:16px;min-height:48px;text-align:left'
  const recap = document.createElement('div'); recap.textContent = '…'; recap.style.cssText = 'font-style:italic;color:#c2c8d2;line-height:1.5;font:italic 14px var(--tac-font,system-ui)'
  recapWrap.append(recap); card.append(recapWrap)

  // The Chronicle: other heroes' recent legends, so the world feels populated by past deeds.
  const legends = listChronicle().slice(0, 3)
  if (legends.length) {
    const lh = document.createElement('div'); lh.textContent = 'The Chronicle remembers'; lh.style.cssText = 'font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9aa4b2;text-align:left;margin-bottom:6px'
    card.append(lh)
    legends.forEach((e) => {
      const row = document.createElement('div'); row.style.cssText = 'text-align:left;font-size:12px;color:#a9b2bf;line-height:1.4;margin-bottom:6px;border-left:2px solid #2a3340;padding-left:8px'
      row.textContent = `${e.name} — felled ${e.kills}: “${(e.recap || '').slice(0, 90)}${(e.recap || '').length > 90 ? '…' : ''}”`
      card.append(row)
    })
    const sp = document.createElement('div'); sp.style.cssText = 'height:8px'; card.append(sp)
  }

  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:10px'
  const again = document.createElement('button'); again.type = 'button'; again.textContent = '⚔ Fight again'
  again.style.cssText = 'flex:1;padding:13px;border-radius:10px;border:1px solid #c9a227;background:#2a2410;color:#ffe082;font:700 14px var(--tac-font,system-ui);cursor:pointer'
  const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Choose hero'
  choose.style.cssText = 'flex:1;padding:13px;border-radius:10px;border:1px solid #2a3340;background:#1a2230;color:#e8e8e8;font:600 14px var(--tac-font,system-ui);cursor:pointer'
  const close = () => back.remove()
  again.addEventListener('click', () => { close(); onAgain && onAgain() })
  choose.addEventListener('click', () => { close(); onChoose && onChoose() })
  btns.append(again, choose); card.append(btns)

  back.append(card); host.append(back)

  // Stream the in-voice recap, then bank it to the hero's memory.
  ;(async () => {
    try {
      const recent = (persona?.events || []).slice(-4).map((e) => e.type === 'skill_learned' ? `forged ${e.skill}` : e.type === 'level_up' ? `reached level ${e.level}` : '').filter(Boolean).join(', ')
      const { system, user } = recapPrompts(persona, run, recent)
      await ensureModel(() => {})
      let raw = ''
      await streamChat(system, user + noThink(currentModelId()), {
        maxTokens: 110, temperature: 0.9,
        onToken: (t) => { raw += t; recap.textContent = stripThinkFinal(raw) || '…' },
      })
      const text = stripThinkFinal(raw).trim() || '…'
      recap.textContent = text
      if (persona?.id) {
        const fresh = getPersona(persona.id)
        if (fresh) patchPersona(persona.id, { events: appendEvent(fresh.events, 'battle', { kills: run.killsThisRun, threat: run.threat, recap: text, ts: Date.now() }) })
      }
      // Post this deed to the shared Chronicle (the living world's history).
      addChronicle({ name: persona?.name || 'A fighter', unitClass: persona?.unitClass || '', kills: run.killsThisRun, threat: run.threat, level: run.levelEnd, recap: text, ts: Date.now() })
    } catch (e) { recap.textContent = '(the memory is a blur of steel and blood)' }
  })()

  return { close }
}
