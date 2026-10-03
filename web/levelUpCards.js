// Roguelike level-up draft — on level-up the game pauses and the player picks 1 of 3 perk cards.
// Each perk bumps a persisted stat (progression.spent, read by statBonuses at spawn) AND applies
// an immediate live effect to the on-field hero (comboCtrl.buffHero). See tiny.js awardKill.

// Perk pool. `spend` mutates the spent counters (authoritative, applied next spawn); `live` is the
// immediate effect on the current hero.
const POOL = [
  { key: 'vigor', icon: '❤', title: 'Vigor', desc: '+10% Max HP & heal', spend: (s) => ({ ...s, hp: (s.hp || 0) + 2 }), live: { hpMul: 1.10, heal: true } },
  { key: 'toughness', icon: '🛡', title: 'Toughness', desc: '+15% Max HP', spend: (s) => ({ ...s, hp: (s.hp || 0) + 3 }), live: { hpMul: 1.15, heal: true } },
  { key: 'might', icon: '⚔', title: 'Might', desc: '+10% Damage', spend: (s) => ({ ...s, dmg: (s.dmg || 0) + 2 }), live: { dmgMul: 1.10 } },
  { key: 'berserker', icon: '🔥', title: 'Berserker', desc: '+15% Damage', spend: (s) => ({ ...s, dmg: (s.dmg || 0) + 3 }), live: { dmgMul: 1.15 } },
  { key: 'swift', icon: '💨', title: 'Swiftness', desc: '+12% Move speed', spend: (s) => ({ ...s, spd: (s.spd || 0) + 2 }), live: { speedMul: 1.12 } },
  { key: 'second-wind', icon: '✨', title: 'Second Wind', desc: 'Full heal +5% Max HP', spend: (s) => ({ ...s, hp: (s.hp || 0) + 1 }), live: { hpMul: 1.05, heal: true } },
]

// Pick `n` distinct perks. Seeded-ish via the level so multi-level-ups vary without Math.random reliance.
export function drawPerks(n = 3, seed = 0) {
  const pool = POOL.slice()
  // Fisher–Yates with a tiny LCG so draws differ between levels.
  let x = (seed * 2654435761 + 12345) >>> 0
  const rnd = () => (x = (1103515245 * x + 12345) >>> 0) / 4294967296
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]] }
  return pool.slice(0, Math.min(n, pool.length))
}

// Apply a chosen perk to a progression object → new progression (updated spent counters).
export function applyPerk(progression, perk) {
  const p = { level: 1, xp: 0, kills: 0, attributePoints: 0, spent: { hp: 0, dmg: 0, spd: 0 }, ...(progression || {}) }
  p.spent = { hp: 0, dmg: 0, spd: 0, ...(p.spent || {}) }
  p.spent = perk.spend(p.spent)
  return p
}

// Render the 3-card draft over `host`. Calls onPick(perk) when a card is chosen, then closes.
export function mountLevelUp(host, { level, seed = level }, onPick) {
  const back = document.createElement('div')
  back.style.cssText = 'position:absolute;inset:0;z-index:14;background:rgba(6,8,12,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:14px'
  const title = document.createElement('div'); title.textContent = `⚔ Level ${level} — choose a boon`
  title.style.cssText = 'font:800 22px var(--tac-font,system-ui);color:#ffe082;text-shadow:0 2px 8px #000;text-align:center'
  back.append(title)
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:560px'
  const close = () => back.remove()
  for (const perk of drawPerks(3, seed)) {
    const card = document.createElement('button'); card.type = 'button'
    card.style.cssText = 'width:150px;min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px 12px;border-radius:14px;border:1px solid #2a3340;background:linear-gradient(180deg,#1a2230,#11151c);color:#e8e8e8;cursor:pointer;transition:transform .1s,border-color .1s;user-select:none'
    card.addEventListener('pointerenter', () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#c9a227' })
    card.addEventListener('pointerleave', () => { card.style.transform = 'none'; card.style.borderColor = '#2a3340' })
    const icon = document.createElement('div'); icon.textContent = perk.icon; icon.style.cssText = 'font-size:40px'
    const nm = document.createElement('div'); nm.textContent = perk.title; nm.style.cssText = 'font:700 16px var(--tac-font,system-ui)'
    const ds = document.createElement('div'); ds.textContent = perk.desc; ds.style.cssText = 'font-size:12px;color:#9aa4b2;text-align:center;line-height:1.4'
    card.append(icon, nm, ds)
    card.addEventListener('click', () => { close(); onPick(perk) })
    row.append(card)
  }
  back.append(row); host.append(back)
  return { close }
}
