// Shared Skill-Forge pipeline — used by BOTH the Skill Forge tab and the in-Game character
// sheet so a hero can learn skills from either place. Streams a skill from the coding model,
// validates/clamps it into an engine-runnable CB skill (skillSchema.js), paints a Klein icon,
// and persists it onto the hero (customSkills + learnedSkills + event). See skillForgePanel.js
// and tiny.js (character sheet).
import { streamCoding, currentCodingModel } from '/web/codingModel.js'
import { stripThinkFinal } from '/web/personaPrompts.js'
import { validateSkill, SAFE_OPS, SAFE_CONDITIONS, ELEMENTS, SHAPES } from '/web/skillSchema.js'
import { generatePortrait, portraitGenerationAvailable } from '/web/imagen.js'
import { getPersona, patchPersona, putSkillIcon, delSkillIcon, getPortrait } from '/web/personaStore.js'
import { appendEvent } from '/web/progression.js'

export const FORGE_SYSTEM = [
  'You are the Skill Forge for a fantasy auto-battler. Author ONE POWERFUL signature skill for a',
  'specific hero, tailored to their class, story and personality. Respond with a SINGLE fenced',
  '```json block (no prose outside it) of the form:',
  '{"name": string, "flavor": string (one vivid in-world sentence),',
  '"target": "foe"|"area"|"self"|"ally", "effects": [ {"op": <op>, ...args} ],',
  '"visual": {"element": <element>, "shape": <shape>, "color": "#rrggbb", "intensity": 1-3} }.',
  `Allowed effect ops: ${SAFE_OPS.join(', ')}.`,
  'damage/bonus_damage/heal/life_steal take {"amount": int (be generous — these are signature skills)}.',
  `apply_condition takes {"condition": one of [${SAFE_CONDITIONS.join(', ')}], "duration": int}.`,
  'knockdown takes {"duration": int}. interrupt and lose_all_adrenaline take no args. Use 1-3 effects.',
  'MOST skills should be offensive AREA attacks (target "foe"/"area") that strike EVERY enemy nearby —',
  'make them hit hard. Only use target "self"/"ally" for heals/buffs.',
  `For "visual", pick an element from [${ELEMENTS.join(', ')}], a shape from [${SHAPES.join(', ')}]`,
  '(how it manifests), a hex color, and intensity 1-3 — all chosen to match the skill\'s theme so it',
  'looks unique. Output ONLY the json block.',
].join(' ')

export function personaBlock(p) {
  if (!p) return ''
  return [
    `Hero: ${p.name || 'Unnamed'}${p.unitClass ? ` — ${p.unitClass}` : ''}`,
    p.about ? `About: ${p.about}` : '',
    p.personality ? `Personality: ${p.personality}` : '',
    p.specialty ? `Specialty: ${p.specialty}` : '',
  ].filter(Boolean).join('\n')
}

export function parseSkillJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const a = body.indexOf('{'), b = body.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(body.slice(a, b + 1)) } catch { return null }
}

// Stream one skill from the coding model and validate it. `onToken` streams raw text for a
// debug view; `extra` lets a retry feed validation errors back in.
async function generateOnce(p, ask, { think = false, onToken, extra = '' } = {}) {
  const user = `${personaBlock(p)}\n\nSkill to create: ${ask}${extra}`
  let raw = ''
  await streamCoding(FORGE_SYSTEM, user, {
    maxTokens: 512, temperature: 0.6, think,
    onToken: (t) => { raw += t; onToken && onToken(raw) },
  })
  const clean = stripThinkFinal(raw)
  return { v: validateSkill(parseSkillJson(clean), { persona: p }), raw, clean }
}

const blobToDataURL = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob) })

// The skill's image: a scene of THE CHARACTER performing the skill. Klein gets the hero's portrait
// as an identity reference (refImage) so the actual character appears. This single image is the
// skill's icon (and the detail-sheet art) — no separate icon + art any more.
export function skillImagePrompt(p, skill) {
  return `${p.name || 'A warrior'}, a ${p.unitClass || 'fighter'}, unleashing the skill "${skill.name}": ${skill.flavor || ''}. dynamic fantasy action scene, the character mid-cast, motion and magical impact, dramatic lighting, painterly`
}

// Generate the skill image in the BACKGROUND (the skill is already usable). Stores it as the icon
// and clears iconPending → the UI swaps its spinner for the image (via onRosterChange).
async function generateSkillImage(personaId, skill) {
  let refImage = null
  try { const portrait = await getPortrait(personaId); if (portrait) refImage = await blobToDataURL(portrait) } catch { /* no portrait → text-only */ }
  try {
    const blob = await generatePortrait(skillImagePrompt(getPersona(personaId) || {}, skill), { seed: skill.id, refImage })
    if (blob) await putSkillIcon(skill.id, blob)
  } catch (e) { console.warn('[tinyarmy:skill] image generation failed (skill still usable):', (e && e.message) || e) }
  finally {
    const cur = getPersona(personaId)
    if (cur && cur.customSkills && cur.customSkills[skill.id]) {
      patchPersona(personaId, { customSkills: { ...cur.customSkills, [skill.id]: { ...cur.customSkills[skill.id], iconPending: false } } })
    }
  }
}

// Forge a skill for `personaId`. The skill is defined by the coding model, persisted IMMEDIATELY
// (so it's usable at once), and its image is painted in the BACKGROUND. Returns { ok, skill } as
// soon as the skill is defined; the image arrives later (iconPending → spinner until then).
export async function forgeSkillForHero(personaId, request, { onStatus, onToken, think = false } = {}) {
  const p = getPersona(personaId)
  if (!p) return { ok: false, error: 'no hero' }
  const ask = (request || '').trim()
  if (!ask) return { ok: false, error: 'describe the skill you want' }

  onStatus && onStatus(`forging via ${currentCodingModel().label}…`) // name the model (like image/voice)
  let { v } = await generateOnce(p, ask, { think, onToken })
  if (!v.ok) {
    onStatus && onStatus(`refining via ${currentCodingModel().label} (retrying)…`)
    ;({ v } = await generateOnce(p, ask, { think, onToken, extra: `\n\nYour previous attempt was invalid: ${v.errors.join('; ')}. Return ONLY a corrected json block.` }))
  }
  if (!v.ok) return { ok: false, error: v.errors.join('; ') }

  const skill = { ...v.skill, iconPending: portraitGenerationAvailable() } // image paints in the background when enabled
  try { await delSkillIcon(skill.id) } catch { /* ignore */ } // forged ids are reused — drop any old art so the spinner shows, not a stale icon
  const fresh = getPersona(p.id) || p
  patchPersona(p.id, {
    customSkills: { ...(fresh.customSkills || {}), [skill.id]: skill },
    learnedSkills: [...(fresh.learnedSkills || []), skill.id],
    events: appendEvent(fresh.events, 'skill_learned', { skill: skill.name, id: skill.id, ts: Date.now() }),
  })
  onStatus && onStatus('learned ✓ (painting its scene…)')
  if (portraitGenerationAvailable()) generateSkillImage(p.id, skill) // optional art never blocks skill use
  return { ok: true, skill }
}
