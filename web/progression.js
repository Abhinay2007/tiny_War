// Pure progression math + event helpers — the single source of truth for the XP curve
// so no UI re-derives it. See docs/rpg-progression-plan.md (Phase 0/1).
//
// Curve: a gentle quadratic so early levels come fast and later ones slow down.
// xpToNext(L) = BASE + GROWTH * (L-1)^1.5, rounded to a tidy step.

const BASE = 50
const GROWTH = 40
const ATTR_PER_LEVEL = 0 // level-up reward is now the roguelike perk draft (levelUpCards.js), not points

export function xpToNext(level) {
  const l = Math.max(1, level | 0)
  return Math.round((BASE + GROWTH * Math.pow(l - 1, 1.5)) / 10) * 10
}

// Total XP needed to have *reached* a given level from level 1 (handy for bars/among UIs).
export function xpForLevel(level) {
  let sum = 0
  for (let l = 1; l < Math.max(1, level | 0); l++) sum += xpToNext(l)
  return sum
}

// Apply `amount` XP to a progression object, rolling over as many levels as the XP covers.
// Returns a NEW progression object plus what happened, so callers can react (toast, points).
export function applyXp(progression, amount) {
  const p = { level: 1, xp: 0, kills: 0, attributePoints: 0, ...(progression || {}) }
  let { level, xp, attributePoints } = p
  xp += Math.max(0, amount | 0)
  let leveledUp = false, levelsGained = 0
  let need = xpToNext(level)
  while (xp >= need) {
    xp -= need
    level += 1
    levelsGained += 1
    attributePoints += ATTR_PER_LEVEL
    leveledUp = true
    need = xpToNext(level)
  }
  return {
    progression: { ...p, level, xp, attributePoints },
    leveledUp,
    levelsGained,
    xpToNext: need,
  }
}

// Fraction [0,1] toward the next level — for the XP bar.
export function levelProgress(progression) {
  const p = progression || {}
  const need = xpToNext(p.level || 1)
  return need > 0 ? Math.min(1, Math.max(0, (p.xp || 0) / need)) : 0
}

// XP a defeated foe is worth. Small table keyed by a coarse tier/class string; unknown
// enemies fall back to a sane default. Tunable in one place.
const ENEMY_XP = { weak: 8, normal: 12, tough: 20, elite: 40, boss: 100 }
export function enemyXpValue(enemy) {
  if (!enemy) return ENEMY_XP.normal
  if (typeof enemy.xp === 'number') return enemy.xp
  const tier = (enemy.tier || enemy.rank || '').toLowerCase()
  if (ENEMY_XP[tier]) return ENEMY_XP[tier]
  return ENEMY_XP.normal
}

// Combat stat scaling from level + spent attribute points. rank feeds the engine's skill
// scaling; hpMul/dmgMul scale survivability + damage so leveling actually makes you stronger.
export function statBonuses(progression) {
  const p = progression || {}
  const lvl = p.level || 1
  const spent = p.spent || { hp: 0, dmg: 0 }
  return {
    rank: Math.min(20, 7 + lvl),
    hpMul: 1 + (lvl - 1) * 0.07 + (spent.hp || 0) * 0.05,
    dmgMul: 1 + (lvl - 1) * 0.05 + (spent.dmg || 0) * 0.05,
    speedMul: 1 + (spent.spd || 0) * 0.06,
  }
}

// Append a capped, structured event to a persona's log (newest last). Used for the chat
// "what's happening to you" context (woid-style perception log) and the level-up feed.
const MAX_EVENTS = 60
export function appendEvent(events, type, data = {}) {
  const next = Array.isArray(events) ? events.slice() : []
  next.push({ type, ...data })
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
}
