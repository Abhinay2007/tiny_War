// Character context — a single-player, client-side port of woid's two-part context pattern
// (agent-sandbox/pi-bridge/buildContext.js): a STATIC system prompt that is the fighter's
// identity, plus a DYNAMIC "what's happening to you now" turn assembled from live game state
// (level, recent battle/skill events — woid's perception log) and a VERBATIM slice of the
// recent conversation (woid drops summarization; so do we). See docs/rpg-progression-plan.md.

import { effectSummary } from '/web/skillSchema.js'

// One perception-log line per event, in the fighter's lived-experience voice.
function formatEvent(e) {
  switch (e && e.type) {
    case 'kill': return `You defeated ${e.enemy || 'a foe'} (+${e.xp || 0} xp).`
    case 'level_up': return `You grew stronger — you reached level ${e.level}.`
    case 'skill_learned': return `You forged a new skill: "${e.skill}".`
    case 'battle': return e.recap ? `You remember a battle: "${e.recap}"` : `You fought a hard battle, felling ${e.kills || 0} foes before falling.`
    default: return null
  }
}

// STATIC identity. Built once per chat session; the fighter's "bible".
export function buildSystemPrompt(p) {
  if (!p) return 'You are a fighter in a fantasy auto-battler. Stay in character.'
  const lines = [
    `You are ${p.name || 'a nameless fighter'}${p.unitClass ? `, a ${p.unitClass}` : ''} in a fantasy auto-battler called Tiny Army.`,
    p.about ? `Who you are: ${p.about}` : '',
    [p.personality && `Personality: ${p.personality}`, p.vibe && `Vibe: ${p.vibe}`, p.specialty && `Specialty: ${p.specialty}`].filter(Boolean).join('. '),
    '',
    'You are a REAL fighter who has actually lived the battles described below — speak from that experience, in first person, never as an assistant.',
    'Stay fully in character. Keep replies short and natural (1-3 sentences). Never mention being an AI, a model, or a game system. Do not use markdown or stage directions.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

// Turn a live combat snapshot into in-voice "right now" lines (woid's trigger/needs cue).
function liveLines(live) {
  if (!live) return ''
  const out = []
  if (live.hp != null && live.maxHp) {
    const pct = Math.round((live.hp / live.maxHp) * 100)
    const cond = pct < 25 ? ' — you are badly wounded and bleeding' : pct < 60 ? ' — battered but standing' : ''
    out.push(`Right now you are ${live.inCombat ? 'in the thick of a fight' : 'out roaming the field'}, at ${live.hp}/${live.maxHp} HP (${pct}%)${cond}.`)
  }
  if (live.inCombat && live.threat) out.push(`The threat around you is ${live.threat}× and climbing; you have cut down ${live.kills || 0} foes this push.`)
  if (live.location) out.push(`You are in ${live.location}.`)
  return out.join(' ')
}

// DYNAMIC turn: live combat snapshot + current standing + recent events + verbatim chat + new line.
export function buildStateTurn(p, userMsg, { maxEvents = 5, maxHistory = 8, live = null } = {}) {
  const prog = (p && p.progression) || { level: 1, kills: 0 }
  const cs = (p && p.customSkills) || {}
  const equipped = (p && p.equippedSkills || []).map((id) => cs[id]).filter(Boolean)
  const events = (p && p.events || []).map(formatEvent).filter(Boolean).slice(-maxEvents)
  const history = (p && p.chat && p.chat.history || []).slice(-maxHistory)

  const state = [
    liveLines(live),
    `Level ${prog.level}${prog.kills ? `, ${prog.kills} foes felled in all` : ''}.`,
    equipped.length ? `Skills at the ready: ${equipped.map((s) => `${s.name} (${effectSummary(s)})`).join('; ')}.` : '',
    events.length ? `Lately:\n${events.map((e) => `  - ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')

  const convo = history.map((m) => `${m.role === 'user' ? 'Player' : 'You'}: ${m.text}`).join('\n')

  return [
    '[Where you stand right now]',
    state || 'You are fresh to the field, untested.',
    '',
    convo ? '[Your conversation so far]\n' + convo + '\n' : '',
    `Player: ${userMsg}`,
    '',
    `Reply as ${(p && p.name) || 'yourself'}, in first person, 1-3 sentences.`,
  ].filter((l) => l !== '').join('\n')
}

// Convenience: assemble both halves for a turn. `opts.live` carries a live combat snapshot.
export function buildContext(p, userMsg, opts) {
  return { system: buildSystemPrompt(p), user: buildStateTurn(p, userMsg, opts) }
}
