// Skill Forge validator — turns a model-authored skill into a SAFE, engine-resolvable
// CB skill object. The combat resolver (auto-battler src/engine/teamBattle.js) switches on
// effect `op`s and reads {category, target, cost, recharge, effects[]}; anything outside the
// whitelist here is dropped or clamped so a forged skill can never crash the resolver or be
// wildly unbalanced. Mirrors the op/condition vocabulary in teamBattle.js — keep in sync.

// Effect ops the resolver understands AND we consider safe to expose to generation.
// Each entry clamps/normalizes its payload to engine-ready numbers.
const NUM = (v, lo, hi, dflt) => {
  let n = typeof v === 'number' ? v : (v && Array.isArray(v.scale) ? (v.scale[1] ?? v.scale[0]) : Number(v))
  if (!Number.isFinite(n)) n = dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
const CONDITIONS = ['bleeding', 'poison', 'burning', 'deepWound', 'weakness', 'crippled', 'blind', 'dazed']

// Forged skills are a hero's signature: signature-strong, and most are AREA — they hit every foe
// within this radius of the caster (field units, ~7 tiles), routed through the engine's
// area_around_caster scope. Damage clamps are higher than canon, but capped so they can't trivially
// melt a Champion boss.
const AOE_RANGE = 180

const OPS = {
  damage: (e) => ({ op: 'damage', amount: NUM(e.amount, 12, 90, 45) }),
  bonus_damage: (e) => ({ op: 'damage', amount: NUM(e.amount, 12, 90, 40) }), // bonus_damage only works on the attack path; treat as damage for forged AoE
  heal: (e) => ({ op: 'heal', amount: NUM(e.amount, 1, 80, 30) }),
  life_steal: (e) => ({ op: 'life_steal', amount: NUM(e.amount, 6, 60, 24) }),
  apply_condition: (e) => CONDITIONS.includes(e.condition)
    ? { op: 'apply_condition', condition: e.condition, duration: NUM(e.duration, 1, 25, 8) }
    : null,
  knockdown: (e) => ({ op: 'knockdown', duration: NUM(e.duration, 1, 4, 2) }),
  interrupt: () => ({ op: 'interrupt' }),
  lose_all_adrenaline: () => ({ op: 'lose_all_adrenaline' }),
}
const CATEGORIES = ['melee_attack', 'ranged_attack', 'spell', 'shout', 'stance']
const TARGETS = ['foe', 'self', 'ally', 'area']

// Visual identity (cosmetic — drives the in-combat VFX; a bad value just falls back).
export const ELEMENTS = ['fire', 'ice', 'lightning', 'nature', 'poison', 'shadow', 'holy', 'arcane']
export const SHAPES = ['nova', 'ring', 'beam', 'pillar', 'projectile', 'shockwave', 'slash']
const ELEMENT_COLOR = { fire: '#ff6a2a', ice: '#6ad1ff', lightning: '#ffe14d', nature: '#5ad860', poison: '#9be24a', shadow: '#a56cff', holy: '#ffe9a8', arcane: '#c46cff' }
function validateVisual(v) {
  v = v && typeof v === 'object' ? v : {}
  const element = ELEMENTS.includes(v.element) ? v.element : 'arcane'
  const shape = SHAPES.includes(v.shape) ? v.shape : 'nova'
  const color = /^#[0-9a-fA-F]{6}$/.test(String(v.color || '')) ? v.color : ELEMENT_COLOR[element]
  const intensity = Math.max(1, Math.min(3, Math.round(Number(v.intensity)) || 2))
  return { element, shape, color, intensity }
}

export const SAFE_OPS = Object.keys(OPS)
export const SAFE_CONDITIONS = CONDITIONS.slice()

// A fresh id that won't collide with the canon skills (ids ~0–700) or the hero's own forged
// skills. Forged ids live in the 9000+ band.
export function nextSkillId(persona) {
  const used = Object.keys((persona && persona.customSkills) || {}).map((k) => +k).filter((n) => n >= 9000)
  return used.length ? Math.max(...used) + 1 : 9000
}

// Validate + normalize a raw model object into an engine-ready skill. Returns
// { ok, skill, errors }. `skill` is always engine-safe when ok is true.
export function validateSkill(raw, { persona, profession } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object') return { ok: false, skill: null, errors: ['not an object'] }
  const name = String(raw.name || '').trim().slice(0, 40)
  if (!name) errors.push('missing name')
  const target = TARGETS.includes(raw.target) ? raw.target : 'foe'
  const isSupport = target === 'self' || target === 'ally'
  const rawEffects = Array.isArray(raw.effects) ? raw.effects : []
  let effects = rawEffects.map((e) => (e && OPS[e.op] ? OPS[e.op](e) : null)).filter(Boolean).slice(0, 3)
  // Offensive forged skills are POWERFUL AREA skills: ensure a damage effect and make every
  // effect hit all foes in range (area_around_caster). Support skills (heal/buff) stay self/ally.
  if (!isSupport) {
    if (!effects.some((e) => e.op === 'damage' || e.op === 'life_steal')) effects.unshift({ op: 'damage', amount: 45 })
    effects = effects.slice(0, 3).map((e) => ({ ...e, scope: 'area_around_caster', range: AOE_RANGE }))
  } else {
    if (!effects.length) effects = [{ op: 'heal', amount: 30, scope: 'self' }]
    effects = effects.map((e) => ({ ...e, scope: e.op === 'heal' ? 'self' : (e.scope || 'self') }))
  }
  if (!effects.length) errors.push('no valid effects')
  // Routed through the engine's effect path (not single-target strike): offensive → 'spell',
  // support → 'shout'. Both gate on adrenaline (built by basic attacks → unleash), so every class
  // can power them. ATTACK categories (melee_attack) would single-target, so we avoid them here.
  const category = isSupport ? 'shout' : 'spell'
  const cost = { adrenaline: NUM(raw.cost?.adrenaline ?? raw.cost, 3, 12, 7) }
  const recharge = NUM(raw.recharge ?? raw.cooldown, 0, 20, isSupport ? 6 : 2)
  const flavor = String(raw.flavor || raw.description || '').trim().slice(0, 200)
  const visual = validateVisual(raw.visual)
  if (errors.length) return { ok: false, skill: null, errors }
  const skill = {
    id: nextSkillId(persona),
    name,
    profession: profession || (persona && persona.unitClass) || 'Warrior',
    attribute: 'Forged',
    category, target,
    cost, cast: 0, recharge,
    requires: [],
    effects,
    // ── metadata (ignored by the resolver, used by the UI/VFX) ──
    custom: true, flavor, visual, aoe: !isSupport,
  }
  return { ok: true, skill, errors: [] }
}

// Human one-line effect summary for skill cards (mirrors the engine's label style).
export function effectSummary(skill) {
  if (!skill || !Array.isArray(skill.effects)) return ''
  const parts = skill.effects.map((e) => {
    switch (e.op) {
      case 'damage': case 'bonus_damage': return `+${e.amount} dmg`
      case 'heal': return `+${e.amount} heal`
      case 'life_steal': return `${e.amount} life steal`
      case 'apply_condition': return e.condition
      case 'knockdown': return 'knockdown'
      case 'interrupt': return 'interrupt'
      case 'lose_all_adrenaline': return 'spend adrenaline'
      default: return e.op
    }
  })
  const s = parts.join(' · ')
  return skill.aoe ? `AoE · ${s}` : s
}

// Resolve a persona's equipped skill ids into engine-ready objects (custom objects pass
// through; numeric ids are left for the engine to resolve against CB_SKILLS).
export function resolveEquipped(persona) {
  if (!persona) return []
  const custom = persona.customSkills || {}
  return (persona.equippedSkills || [])
    .map((id) => custom[id] || (typeof id === 'number' ? id : null))
    .filter((x) => x != null)
    .slice(0, 3)
}
