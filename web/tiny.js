// Tiny Army — head module for the Gradio app. Renders Pixi into the gr.HTML
// canvas divs (#battle-stage, #sprite-stage). The slicing + facing/anim
// convention come from the SAME shared source as the auto-battler
// (src/render/spriteSheet.js → /web/sheet.js). Pixi is injected (CDN) so there's
// one Pixi instance.
// PINNED to 8.18.1 — the exact Pixi the auto-battler app is built/tested against. Floating to
// `@8` (latest) pulled 8.19.0, whose "updateTransform honors zero scale" render change crashes the
// chunked map's batcher ("Cannot read properties of null (reading 'geometry')"). Keep in lockstep
// with auto-battler/package.json's pixi.js version.
import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@8.18.1/dist/pixi.min.mjs'
import { mountSpritePlayground } from '/web/playground.js'
import { mountClassesSandbox } from '/web/classesSandbox.js'
import { mountEnemiesSandbox } from '/web/enemiesSandbox.js'
import { mountMapSandbox } from '/web/mapSandbox.js'
import { mountComboBattler } from '/web/comboBattler.js'
import { mountPersonaPanel, CLASS_SLUG } from '/web/personaPanel.js'
import { mountHeroCreator, animateIdleIcon } from '/web/heroCreator.js'
import { listPersonas, onRosterChange, getPortrait, getPersona, patchPersona, setActiveHeroId, getAudio } from '/web/personaStore.js'
import { applyXp, enemyXpValue, levelProgress, xpToNext, appendEvent, statBonuses } from '/web/progression.js'
import { getSkillIcon } from '/web/personaStore.js'
import { effectSummary, resolveEquipped } from '/web/skillSchema.js'
import { mountCharacterChat } from '/web/characterChat.js'
import { forgeSkillForHero } from '/web/skillForge.js'
import { mountAfterAction } from '/web/afterAction.js'
import { mountLevelUp, applyPerk } from '/web/levelUpCards.js'
import { createTutorial } from '/web/tutorial.js'
import { mountTitleSequence } from '/web/titleSequence.js'
import { playWav, stopPreview } from '/web/tts.js'
import { portraitGenerationAvailable } from '/web/imagen.js'

// First-run guided tour (in-world copy). Steps advance as the player acts; always skippable.
const TUTORIAL_STEPS = [
  { anchor: 'center', nextLabel: 'Begin', skipLabel: 'No thanks', text: 'Welcome, commander. Your champions aren’t chosen from a roster — each is forged anew, body and soul. A quick tour?' },
  { anchor: 'bottom-center', advanceOn: 'create-open', target: '[data-tut="create"]', text: 'Recruit your first champion — tap “+ Create hero”.' },
  { anchor: 'center', advanceOn: 'persona', target: '[data-tut="recruit"]', text: 'Choose a calling and Recruit. Their name and legend are written for them alone — here and now.' },
  ...(portraitGenerationAvailable() ? [
    { anchor: 'center', advanceOn: 'portrait', target: '[data-tut="portrait"]', text: 'Give them a face — tap 🎨 to paint their portrait.' },
  ] : []),
  { anchor: 'center', advanceOn: 'voice', target: '[data-tut="voice"]', text: 'A voice is optional — tap ▶ to hear the line with your selected voice provider.' },
  { anchor: 'center', advanceOn: 'spawn', target: '[data-tut="save"]', text: 'Now they’re whole — Save & Play to bring them to the field.' },
  { anchor: 'bottom-left', advanceOn: 'move', target: '[data-tut="move"]', text: 'Lead them with the stick — or WASD on a keyboard.' },
  { anchor: 'bottom-right', advanceOn: 'kill', target: '[data-tut="attack"]', text: 'Strike with ⚔ (or Space). Most foes fall in a blow or two — thin the ranks.' },
  { anchor: 'bottom-right', target: '[data-tut="dodge"]', text: 'Roll with ⟲ (or Shift) to slip a blow — untouchable for a heartbeat.' },
  { anchor: 'top-left', text: 'Felling foes earns XP. Fill the bar to level up and draft a boon.' },
  { anchor: 'top-right', advanceOn: 'sheet', target: '[data-tut="sheet"]', text: 'Press C (or the ☰ button) to open your champion’s sheet.' },
  { anchor: 'right', advanceOn: 'forge', target: '[data-tut="forge"]', text: portraitGenerationAvailable()
    ? 'Forge a skill from your own words, then set it to a slot and hold 1/2/3 to aim, release to unleash — it strikes all who stand near.'
    : 'Forge a skill from your own words, then set it to a slot and hold 1/2/3 to aim, release to unleash — it strikes all who stand near. Optional artwork is unavailable in this demo.' },
  { anchor: 'right', target: '[data-tut="talk"]', text: 'Tap “Talk” — they remember every battle they’ve lived, and answer in their own voice (🔊).' },
  { anchor: 'center', nextLabel: 'To battle!', text: 'Recruit, fight, forge, speak. The field is yours, commander.' },
]
const tut = createTutorial(TUTORIAL_STEPS)
try { window.tinyArmyReplayTutorial = () => tut.reset() } catch { /* ignore */ }
import { mountDiaryPanel } from '/web/diaryPanel.js'
import { mountSettingsPanel } from '/web/settingsPanel.js'
import { mountSkillForgePanel } from '/web/skillForgePanel.js'

// ── Asset-URL shim ───────────────────────────────────────────────────────────
// The map renderers (and their Tilesheet / mockup <img>s) hardcode '/assets/minifantasy/…'
// paths. The Space serves those at /sprites/… — but '/assets' is ALSO Gradio's own UI bundle,
// which we must NOT touch. So rewrite ONLY the sprite sub-roots, at every load path the
// renderers use: Pixi texture loads, <img> src, and fetch. This lets mapSandbox.js stay
// byte-identical to the React app's copy — the host (here) does the remap.
const reroot = (u) => (typeof u === 'string'
  ? u.replace(/^\/assets\/(minifantasy|derived|generated)\//, '/sprites/$1/') // sprite/tileset roots
    .replace(/^\/assets\/([^/?#]+\.json)/, '/sprites/$1') // data files fetched by hardcoded path (effects.json, …)
  : u)
const _assetsLoad = PIXI.Assets.load.bind(PIXI.Assets)
PIXI.Assets.load = (src, ...rest) => _assetsLoad(Array.isArray(src) ? src.map(reroot) : reroot(src), ...rest)
const _imgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true, enumerable: _imgSrc.enumerable,
  get() { return _imgSrc.get.call(this) },
  set(v) { _imgSrc.set.call(this, reroot(v)) },
})
// …and via setAttribute('src', …) too — the shared h() DOM helper sets img src that way
// (e.g. the Forgotten Plains Reference mockup), which bypasses the property setter above.
const _imgSetAttr = HTMLImageElement.prototype.setAttribute
HTMLImageElement.prototype.setAttribute = function (name, value) {
  return _imgSetAttr.call(this, name, (name === 'src' || name === 'srcset') ? reroot(value) : value)
}
const _fetch = window.fetch.bind(window)
window.fetch = (input, init) => _fetch(typeof input === 'string' ? reroot(input) : input, init)

function whenEl(id, cb) {
  const found = document.getElementById(id)
  if (found && !found.dataset.tmounted) { found.dataset.tmounted = '1'; cb(found); return }
  const o = new MutationObserver(() => {
    const el = document.getElementById(id)
    if (el && !el.dataset.tmounted) { el.dataset.tmounted = '1'; o.disconnect(); cb(el) }
  })
  o.observe(document.body, { childList: true, subtree: true })
}

// The app-sidebar toggle (‹/›) sits top-left over the XP bar — hide it; the nav drawer is now
// shown/hidden with the ` or ~ key instead. (The drawer starts collapsed via tac-collapsed.)
;(function navDrawerKey() {
  const css = document.createElement('style'); css.textContent = '.tac-toggle{display:none !important}'
  document.head.appendChild(css)
  window.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.code === 'Backquote' || e.key === '`' || e.key === '~') { document.body.classList.toggle('tac-collapsed'); e.preventDefault() }
  })
})()

// Paint a forged skill's icon into a square box, or a spinner if its image is still generating in
// the background (iconPending). Shared by the bar slots + skill cards.
;(function injectSkillSpin() { try { const s = document.createElement('style'); s.textContent = '@keyframes ta-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}.ta-skill-spin{position:absolute;top:50%;left:50%;width:18px;height:18px;border:2px solid #2a3340;border-top-color:#c9a227;border-radius:50%;animation:ta-spin .8s linear infinite}'; document.head.appendChild(s) } catch { /* ignore */ } })()
function paintSkillIcon(box, sk) {
  // While the scene is still painting, ALWAYS show the spinner — never a leftover icon. Forged skill
  // ids are reused (9000+ band), so getSkillIcon(id) can return a previous skill's art for a brand-new
  // pending one; checking iconPending first keeps that stale image from flashing in.
  if (sk.iconPending) {
    box.style.backgroundImage = ''
    box.style.position = box.style.position || 'relative'
    const sp = document.createElement('div'); sp.className = 'ta-skill-spin'; box.appendChild(sp)
    return
  }
  getSkillIcon(sk.id).then((b) => { if (b) box.style.backgroundImage = `url(${URL.createObjectURL(b)})` })
}

// Gradio wraps each gr.HTML block in a `<div class="prose gradio-style …">` whose versioned rules
// (.gradio-container-X .prose h2 / .prose * ; .gradio-container-X .gradio-style button) outrank the
// shared component CSS — recolouring/resizing our headings and stripping pill/button borders +
// padding. The sandbox stages fully own their styling, so drop BOTH classes from their wrapper
// chain. (NOT applied to the diary/persona panels — those ARE prose content.)
const unprose = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) { n.classList?.remove('prose'); n.classList?.remove('gradio-style') }
}

// Character manifest (slug → sheet URLs). Sheets are served at /sprites (not
// /assets — that's Gradio's bundle); the manifest paths are authored as /assets/…
const spriteUrl = (u) => (u || '').replace('/assets/', '/sprites/')
let charMap = null
async function loadChars() {
  if (charMap) return charMap
  const d = await fetch('/sprites/characters.json').then((r) => r.json())
  charMap = {}
  for (const p of d.packs || []) for (const c of p.characters || []) charMap[c.slug] = c
  return charMap
}

let playground = null, comboCtrl = null
window.tinyResize = () => {
  try { comboCtrl?.resize?.() } catch {}
  // Re-fit + re-centre: the sprite stage mounts in a hidden (0-size) tab, so the
  // character must be re-placed once the tab is actually shown.
  try { if (playground) { playground.resize(); playground.recenter() } } catch {}
}
window.tinySnap = () => (playground ? playground.getSnapshot() : null) // read-only debug accessor

// ── Sprite Animations tab — shared playground ────────────────────────────────
// The SAME module the React app uses (auto-battler src/render/spritePlayground.js
// → /web/playground.js, Pixi injected) builds the entire page: team-grouped
// character picker, stage, canvas, instructions, aimed-attack compass and extras
// list — and the shared render core. styled by /web/shell/spriteScene.css.
whenEl('sprite-stage', async (el) => {
  unprose(el)
  const man = await fetch('/sprites/characters.json').then((r) => r.json())
  playground = mountSpritePlayground(PIXI, el, { packs: man.packs || [], urlFor: spriteUrl })
})

// ── Classes sandbox — the shared playground (auto-battler src/render/classesSandbox.js
// → /web/classesSandbox.js, Pixi injected) builds the whole page: class picker + WASD
// combat + customize panel. Sheet/effect URLs in the data are authored as /assets/…;
// the Space serves them at /sprites/…, so we remap before handing the data over.
const remapAssets = (o) => JSON.parse(JSON.stringify(o).replaceAll('/assets/', '/sprites/'))
whenEl('classes-stage', async (el) => {
  unprose(el)
  const j = (u) => fetch(u).then((r) => r.json()).catch(() => ({}))
  const [chars, effects, classes] = await Promise.all([j('/sprites/characters.json'), j('/sprites/effects.json'), j('/sprites/classes.json')])
  mountClassesSandbox(PIXI, el, {
    packs: remapAssets(chars).packs || [],
    fx: remapAssets(effects).effects || [],
    config: { classes: {}, skills: {}, ...remapAssets(classes) },
    editable: false, // no /api on the Space — the customize panel is read-only
  })
})
whenEl('enemies-stage', async (el) => {
  unprose(el)
  const j = (u) => fetch(u).then((r) => r.json()).catch(() => ({}))
  const [chars, effects, enemies] = await Promise.all([j('/sprites/characters.json'), j('/sprites/effects.json'), j('/sprites/enemies.json')])
  mountEnemiesSandbox(PIXI, el, {
    packs: remapAssets(chars).packs || [],
    fx: remapAssets(effects).effects || [],
    config: { enemies: {}, ...remapAssets(enemies) },
    editable: false,
  })
})

// ── World Map tab — the shared Map sandbox (auto-battler src/render/mapSandbox.js
// → /web/mapSandbox.js, Pixi injected): the pill switcher + all six sub-pages (World Map /
// Necropolis / Orc Kingdom / Forgotten Plains / Interiors / Towers). The renderers hardcode
// '/assets/minifantasy/…' URLs; the shim above reroots them to /sprites for the Space.
whenEl('worldmap-stage', (el) => { unprose(el); mountMapSandbox(PIXI, el, { page: 'gameworld' }) })

// ── Personas + War Diary tabs — in-browser llama.cpp (wllama), runs on the device ──
whenEl('persona-stage', (el) => { mountPersonaPanel(el) })
whenEl('diary-stage', (el) => { mountDiaryPanel(el) })
whenEl('skillforge-stage', (el) => { mountSkillForgePanel(el) })
// Engine + model + voice pickers are injected into Gradio's own Settings page (footer
// link / sidebar ⚙), shared across pages via the runtime.js + tts.js singletons.
mountSettingsPanel()

// Relocate Gradio's footer links — Use via API, Built with Gradio, Settings — into the sidebar's App
// slot (#tac-extlinks), then hide the footer. We move the LIVE elements, so each keeps its native
// behaviour (API panel / open gradio.app / open Settings). They are styled via .tac-extlink only —
// NOT .tac-nav-item, which would make sidebar.js hijack the click (mark active=white, swallow nav).
function relocateFooterLinks() {
  const wanted = (t) => /^(use via api|built with gradio|settings)$/i.test((t || '').trim())
  const move = () => {
    const footer = document.querySelector('footer')
    const host = document.getElementById('tac-extlinks')
    if (!footer || !host) return false
    const links = Array.prototype.filter.call(footer.querySelectorAll('a, button'), (e) => wanted(e.textContent))
    if (links.length < 3) return false // wait until all three exist
    const ref = document.querySelector('.tac-sidebar .tac-nav-item') // a real nav item, to copy its padding
    const pad = ref ? getComputedStyle(ref).padding : ''
    for (const e of links) { e.classList.add('tac-extlink'); if (pad) e.style.padding = pad; host.appendChild(e) }
    footer.style.display = 'none'
    return true
  }
  if (move()) return
  const o = new MutationObserver(() => { if (move()) o.disconnect() })
  o.observe(document.body, { childList: true, subtree: true })
}
relocateFooterLinks()

// Sidebar "⚙ Settings" item opens the SAME Gradio settings page as the footer link.
// Wrap sidebar.js's tacNavigate (already set, since that's a non-module script): the
// "Settings" nav target clicks Gradio's footer Settings button; everything else routes
// to its tab as before.
const _tacNav = window.tacNavigate
window.tacNavigate = function (target) {
  if (target === 'Settings') {
    const footer = document.querySelector('footer')
    const btn = footer && Array.prototype.find.call(
      footer.querySelectorAll('button, a'), (e) => /^settings$/i.test((e.textContent || '').trim()))
    if (btn) btn.click()
    return
  }
  if (_tacNav) _tacNav(target)
}

// ── Game tab (#battle-stage) — Forgotten Plains roam + on-map combat ──────────
// Drops a persona from the roster onto the map, lets it wander (A*), and fights enemies that aggro
// on proximity in real-time on the map. The old hardcoded 4v4 demo lived here; this is the shared
// comboBattler surface (auto-battler source, bundled to /web/comboBattler.js).
const sheetsOf = (c) => ({ idle: spriteUrl(c.idle), walk: spriteUrl(c.walk), attack: spriteUrl(c.attack), dmg: spriteUrl(c.dmg), die: spriteUrl(c.die) })
// Free-roam enemy rosters, one per biome band — the spawner draws from the roster of whichever land
// the spawn point lands on. Forgotten Plains = human patrols, Orc Kingdom = orcs, Necropolis = the
// Dark Brotherhood. (slug + combat stats, resolved against characters.json.)
const GAME_ROSTERS = {
  forgottenPlains: [
    { name: 'Swordsman', slug: 'rts-humans-swordsman', stats: { hp: 110, armor: 20, basicDamage: 12 }, attackType: 'melee' },
    { name: 'Spearman', slug: 'rts-humans-spearman', stats: { hp: 100, armor: 18, basicDamage: 11 }, attackType: 'melee' },
    { name: 'Knight', slug: 'rts-humans-knight', stats: { hp: 150, armor: 35, basicDamage: 14 }, attackType: 'melee' },
    { name: 'Archer', slug: 'rts-humans-archer', stats: { hp: 80, armor: 10, basicDamage: 12 }, attackType: 'ranged' },
  ],
  orc: [
    { name: 'Orc Blade', slug: 'dark-orc-army-orc-blade', stats: { hp: 130, armor: 25, basicDamage: 13 }, attackType: 'melee' },
    { name: 'Orc Raider', slug: 'dark-orc-army-orc-raider', stats: { hp: 120, armor: 20, basicDamage: 12 }, attackType: 'melee' },
    { name: 'Orc Scout', slug: 'dark-orc-army-orc-scout', stats: { hp: 90, armor: 12, basicDamage: 10 }, attackType: 'melee' },
    { name: 'Feral Berserker', slug: 'dark-orc-army-feral-berserker', stats: { hp: 160, armor: 30, basicDamage: 16 }, attackType: 'melee' },
    { name: 'Feral Arbalist', slug: 'dark-orc-army-feral-arbalist', stats: { hp: 95, armor: 14, basicDamage: 13 }, attackType: 'ranged' },
    { name: 'Cave Troll', slug: 'dark-orc-army-cave-troll', stats: { hp: 220, armor: 40, basicDamage: 20 }, attackType: 'melee' },
  ],
  necropolis: [
    { name: 'Acolyte', slug: 'dark-brotherhood-acolyte', stats: { hp: 100, armor: 15, basicDamage: 10 }, attackType: 'melee' },
    { name: 'Dark Cultist', slug: 'dark-brotherhood-dark-cultist', stats: { hp: 95, armor: 12, basicDamage: 12 }, attackType: 'ranged' },
    { name: 'Devoted Blade', slug: 'dark-brotherhood-devoted-blade', stats: { hp: 120, armor: 20, basicDamage: 12 }, attackType: 'melee' },
    { name: 'Dark Hound', slug: 'dark-brotherhood-dark-hound', stats: { hp: 85, armor: 10, basicDamage: 13 }, attackType: 'melee' },
    { name: 'Zealot', slug: 'dark-brotherhood-zealot', stats: { hp: 110, armor: 18, basicDamage: 13 }, attackType: 'melee' },
    { name: 'Dark Abomination', slug: 'dark-brotherhood-dark-abomination', stats: { hp: 200, armor: 35, basicDamage: 18 }, attackType: 'melee' },
  ],
}
// Persona class → engine profession (the engine has templates + skills for these five).
const PERSONA_PROF = { Warrior: 'Warrior', Ranger: 'Ranger', Monk: 'Monk', Assassin: 'Assassin', Mage: 'Necromancer', Paladin: 'Monk', Cleric: 'Monk', Knight: 'Warrior' }
const ENEMY_AGGRO = 220 // FIELD units (~8 tiles): enemy idles until the player is this near
// Ranged reach is authored in arena GW units (BOW_GW=1000 ≈ 37 roam tiles — whole-screen). The
// roam map is far smaller, so scale ranged weapon range + kite distance down to ~8 tiles here.
const ROAM_RANGE_MUL = 0.22
// Early foes should die in ~2 Warrior basics, then ramp with threat (hpMul). Lower base HP + armor.
const ENEMY_HP_SCALE = 0.2, ENEMY_ARMOR_SCALE = 0.25
// A persona → controllable hero (class → sheets + engine profession).
const buildPlayer = (chars, p) => {
  const pc = chars[CLASS_SLUG[p?.unitClass]] || chars['true-heroes-iii-fighter']
  // Equipped Skill-Forge skills (objects) flow straight into the engine bar; if none are
  // equipped, leaving skills unset lets comboBattler pick the class's default three.
  const equipped = resolveEquipped(p)
  const unit = { profession: PERSONA_PROF[p?.unitClass] || 'Warrior', name: p?.name || 'Hero' }
  if (equipped.length) unit.skills = equipped
  // Leveling makes the fighter stronger: level + spent points → rank (skill scaling) + HP/damage.
  const sb = statBonuses(p?.progression)
  unit.rank = sb.rank; unit.hpMul = sb.hpMul; unit.dmgMul = sb.dmgMul; unit.speedMul = sb.speedMul; unit.rangeMul = ROAM_RANGE_MUL
  return { name: p?.name || pc?.name || 'Hero', sheets: sheetsOf(pc), unit }
}
const PICK_CARD_CSS = 'display:flex;flex-direction:column;align-items:center;gap:4px;width:76px;padding:8px 6px;border-radius:10px;border:1px solid #2a3340;background:rgba(20,24,33,.92);color:#e8e8e8;cursor:pointer;font:600 11px var(--tac-font,system-ui)'
// Fill a square box with the hero's saved PORTRAIT (if any), else an animated idle GIF-style sprite
// of their class (same loop as the class selector). `sizePx` sizes the idle-sprite cell math.
async function fillAvatar(box, persona, chars, sizePx) {
  let blob = null
  try { if (persona?.id && persona.portraitUsed) blob = await getPortrait(persona.id) } catch { /* none */ }
  box.getAnimations?.().forEach((a) => a.cancel())
  if (blob) {
    box.style.backgroundImage = `url(${URL.createObjectURL(blob)})`
    box.style.backgroundSize = 'cover'; box.style.backgroundPosition = 'center'; box.style.imageRendering = 'auto'
  } else {
    box.style.imageRendering = 'pixelated'
    const pc = chars[CLASS_SLUG[persona?.unitClass]] || chars['true-heroes-iii-fighter']
    if (pc?.idle) animateIdleIcon(box, spriteUrl(pc.idle), sizePx)
  }
}
// Play a hero's SAVED voice — the cached quote WAV (IndexedDB) made when the hero was created.
// Never regenerates; silent no-op for heroes that have no saved voice yet (e.g. the Fighter fallback).
async function playHeroVoice(hero) {
  if (!hero?.id || !hero.voiceQuote) return
  try {
    const blob = await getAudio(hero.id)
    if (!blob) return
    try { stopPreview() } catch { /* ignore */ }
    await playWav(await blob.arrayBuffer())
  } catch { /* ignore */ }
}
// Hero detail page (before spawning): big portrait/idle + name/class/about/quote and a Select button.
// onSelect fires when confirmed; Back / backdrop just close (returns to the picker).
function openHeroDetail(host, persona, chars, onSelect) {
  const backdrop = document.createElement('div'); backdrop.className = 'hero-detail-backdrop'
  const card = document.createElement('div'); card.className = 'hero-detail'
  const portrait = document.createElement('div'); portrait.className = 'hero-detail-portrait'
  fillAvatar(portrait, persona, chars, 240)
  const info = document.createElement('div'); info.className = 'hero-detail-info'
  const name = document.createElement('div'); name.className = 'hero-detail-name'; name.textContent = persona?.name || 'Hero'
  info.append(name)
  if (persona?.unitClass) { const c = document.createElement('div'); c.className = 'hero-detail-class'; c.textContent = persona.unitClass; info.append(c) }
  if (persona?.about) { const a = document.createElement('div'); a.className = 'hero-detail-about'; a.textContent = persona.about; info.append(a) }
  if (persona?.quote) { const q = document.createElement('blockquote'); q.className = 'hero-detail-quote'; q.textContent = persona.quote; info.append(q) }
  const foot = document.createElement('div'); foot.className = 'hero-detail-foot'
  const back = document.createElement('button'); back.className = 'hero-detail-back'; back.type = 'button'; back.textContent = 'Back'
  const select = document.createElement('button'); select.className = 'hero-detail-select'; select.type = 'button'; select.textContent = 'Select ▶'
  foot.append(back, select)
  card.append(portrait, info, foot); backdrop.append(card); host.appendChild(backdrop)
  playHeroVoice(persona) // greet the player in the hero's own saved voice when their page opens
  const close = () => { try { stopPreview() } catch { /* ignore */ } backdrop.remove() }
  back.addEventListener('click', close)
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close() })
  select.addEventListener('click', () => { close(); onSelect() })
}
// Bottom-of-screen hero picker: a card per saved persona (idle-sprite avatar + name) plus a
// "+ Create hero" card. onPick gets the chosen persona; onCreate opens the create modal. Overlays
// the map (pointer-events only on the cards, so the map still pans).
function buildHeroPicker(host, personas, chars, onPick, onCreate) {
  const bar = document.createElement('div')
  bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:6;display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 12px 18px;pointer-events:none;background:linear-gradient(to top,rgba(8,11,16,.86),rgba(8,11,16,0));font-family:var(--tac-font,system-ui)'
  const title = document.createElement('div')
  title.textContent = 'Choose your hero'
  title.style.cssText = 'color:#e8e8e8;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;text-shadow:0 1px 3px #000'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:100%;pointer-events:auto'
  for (const p of personas) {
    const pc = chars[CLASS_SLUG[p?.unitClass]] || chars['true-heroes-iii-fighter']
    const card = document.createElement('button')
    card.style.cssText = PICK_CARD_CSS
    const av = document.createElement('div')
    av.style.cssText = 'width:48px;height:48px;border-radius:8px;background:#0b0e12 no-repeat;border:1px solid #20262e'
    fillAvatar(av, p, chars, 48) // portrait if saved, else animated class idle
    const nm = document.createElement('div'); nm.textContent = p?.name || pc?.name || 'Hero'
    nm.style.cssText = 'max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    card.append(av, nm)
    if (p?.unitClass) { const cl = document.createElement('div'); cl.textContent = p.unitClass; cl.style.cssText = 'color:#8a93a0;font-weight:500;font-size:10px'; card.append(cl) }
    card.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(p) })
    row.appendChild(card)
  }
  // "+ Create hero" card → opens the create modal.
  const create = document.createElement('button')
  create.className = 'hero-pick-create'; create.dataset.tut = 'create'; create.style.cssText = PICK_CARD_CSS
  const plus = document.createElement('div'); plus.className = 'hero-pick-plus'; plus.textContent = '+'
  plus.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center'
  const clbl = document.createElement('div'); clbl.textContent = 'Create hero'; clbl.style.cssText = 'max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  create.append(plus, clbl)
  create.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); onCreate && onCreate() })
  row.appendChild(create)
  // Replay the guided tour — only here, on the hero-selection screen (no hero picked yet).
  const replay = document.createElement('button'); replay.type = 'button'; replay.textContent = '↻ Replay tour'
  replay.style.cssText = 'pointer-events:auto;background:none;border:none;color:#8a93a0;font:600 11px var(--tac-font,system-ui);letter-spacing:.04em;cursor:pointer;padding:4px 8px;text-shadow:0 1px 3px #000'
  replay.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { tut.reset() } catch { /* ignore */ } })
  bar.append(title, row, replay); host.appendChild(bar)
  return bar
}
// "Create a Hero" modal over the map: hosts the shared creator (heroCreator.js — stream details,
// generate a portrait + quote + voice, autosaved to the roster). onCreated(persona) fires on
// "Save & Play"; Cancel/✕/backdrop just close (a generated hero is already saved to the barracks).
function openCreateModal(host, onCreated) {
  try { tut.emit('create-open') } catch { /* ignore */ }
  const backdrop = document.createElement('div'); backdrop.className = 'hero-modal-backdrop'
  const card = document.createElement('div'); card.className = 'hero-modal'
  const head = document.createElement('div'); head.className = 'hero-modal-head'
  const title = document.createElement('div'); title.className = 'hero-modal-title'; title.textContent = 'Create a Hero'
  const x = document.createElement('button'); x.className = 'hero-modal-x'; x.type = 'button'; x.title = 'Close'; x.textContent = '✕'
  head.append(title, x)
  const body = document.createElement('div'); body.className = 'hero-modal-body'
  const foot = document.createElement('div'); foot.className = 'hero-modal-foot'
  const cancel = document.createElement('button'); cancel.className = 'hero-modal-cancel'; cancel.type = 'button'; cancel.textContent = 'Cancel'
  const save = document.createElement('button'); save.className = 'hero-modal-save'; save.dataset.tut = 'save'; save.type = 'button'; save.textContent = 'Save & Play ▶'; save.disabled = true
  foot.append(cancel, save) // the creator prepends its ← Back here (shown only once a hero exists)
  card.append(head, body, foot); backdrop.append(card); host.appendChild(backdrop)

  // Save & Play is enabled once a hero is saved; ← Back resets the creator → recruit state → disabled.
  const creator = mountHeroCreator(body, {
    showBarracks: true,
    backSlot: foot,
    onSaved: () => { save.disabled = false; try { tut.emit('persona') } catch { /* ignore */ } },
    onPortrait: () => { try { tut.emit('portrait') } catch { /* ignore */ } },
    onVoice: () => { try { tut.emit('voice') } catch { /* ignore */ } },
    onState: (s) => { title.textContent = s === 'portrait' ? 'Hero Details' : 'Create a Hero'; if (s === 'recruit') save.disabled = true },
  })
  const close = () => { try { creator.stop() } catch { /* ignore */ } backdrop.remove() }
  x.addEventListener('click', close)
  cancel.addEventListener('click', close)
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close() })
  save.addEventListener('click', () => {
    const cur = creator.current(); if (!cur.persona) return
    // The creator tracks the roster id separately (savedId) from the persona object — carry it
    // through so spawnWithFly resolves the SAVED record (portrait/voice in IndexedDB, equipped
    // skills, chat history). Without the id the freshly-created hero spawns "anonymous" and its
    // portrait/voice/skills/chat aren't recognized until you re-pick it from the roster.
    close(); onCreated(cur.savedId ? { ...cur.persona, id: cur.savedId } : cur.persona)
  })
}
whenEl('battle-stage', async (el) => {
  unprose(el)
  const chars = await loadChars()
  const buildRoster = (list) => list.map((e) => {
    const c = chars[e.slug]; if (!c) return null
    // aggroRadius null = always engage → foes advance toward the hero (waves), not idle until near.
    // Weaker base stats so early foes die in ~2 Warrior basics (they still ramp with threat via hpMul).
    // noKite: ranged foes hold ground + shoot instead of backing away.
    const stats = { ...e.stats, hp: Math.max(1, Math.round((e.stats.hp || 100) * ENEMY_HP_SCALE)), armor: Math.round((e.stats.armor || 0) * ENEMY_ARMOR_SCALE) }
    return { name: e.name, sheets: sheetsOf(c), unit: { name: e.name, stats, attackType: e.attackType, skills: [], aggroRadius: null, rangeMul: ROAM_RANGE_MUL, noKite: true } }
  }).filter(Boolean)
  const rosters = Object.fromEntries(Object.entries(GAME_ROSTERS).map(([k, v]) => [k, buildRoster(v)]))
  // Mount with NO hero → the map shows and the player picks a persona from the bottom picker. The
  // picker reappears whenever there's no live hero (initial, and after the current one dies).
  // Award XP to the active hero when it defeats a foe (the loop fires this once per kill).
  // Declared as a closure so it always reads the *current* hero + freshest stored progression.
  const onEnemyDefeated = (enemy) => { try { awardKill(enemy) } catch { /* never break combat */ } }
  comboCtrl = mountComboBattler(PIXI, el, { seed: 1, rosters, onEnemyDefeated, emoteSheetUrl: '/sprites/emotes.png' })
  await comboCtrl.ready
  const FALLBACK = { name: 'Fighter', unitClass: 'Warrior' }
  const OVERVIEW_ZOOM = 0.45, GAMEPLAY_ZOOM = 2.5
  let picker = null, currentHero = null
  // Cinematic: the picker presents a zoomed-out overview; confirming a hero flies the camera DOWN to
  // the spawn point and drops them in there.
  const flyToOverview = () => { const b = comboCtrl.map.getBounds(); if (b) comboCtrl.map.flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, OVERVIEW_ZOOM, 700).catch(() => {}) }
  // ── Music: one looping theme that plays at full on the title screen and DUCKS (weaker) once the
  // game starts. Owned here (not in the title sequence) so it survives the hero-pick handoff and can
  // be muted. Autoplay is gated until a user gesture, so we retry on the first interaction. ──
  const music = (() => {
    const MUTE_KEY = 'tinyarmy.musicMuted'
    const FULL = 0.55, DUCK = 0.16
    const a = new Audio('/web/audio/title-theme.mp3'); a.loop = true; a.volume = 0
    let target = FULL, muted = false, fade = null
    try { muted = localStorage.getItem(MUTE_KEY) === '1' } catch { /* ignore */ }
    const fadeTo = (want) => {
      clearInterval(fade)
      fade = setInterval(() => {
        if (Math.abs(a.volume - want) < 0.02) { a.volume = want; clearInterval(fade); return }
        a.volume += (want - a.volume) * 0.18
      }, 60)
    }
    // Apply current state: muted → hard pause (truly stops it); else play + fade to target volume.
    const apply = () => {
      if (muted) { clearInterval(fade); try { a.pause() } catch { /* ignore */ } a.volume = 0 }
      else { a.play().catch(() => {}); fadeTo(target) }
    }
    // Autoplay is gated until a user gesture — start (if not muted) on the first interaction.
    const onGesture = () => { apply(); window.removeEventListener('pointerdown', onGesture); window.removeEventListener('keydown', onGesture) }
    window.addEventListener('pointerdown', onGesture); window.addEventListener('keydown', onGesture)
    const mutedListeners = new Set()
    return {
      full() { target = FULL; apply() },
      duck() { target = DUCK; apply() },
      isMuted: () => muted,
      toggleMute() { muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* ignore */ } apply(); for (const fn of mutedListeners) { try { fn(muted) } catch { /* ignore */ } } return muted },
      onMuteChange(fn) { mutedListeners.add(fn) },
    }
  })()
  // ── Cinematic title sequence (ambient camera tour over decorative warbands behind the picker) ──
  let titleSeq = null
  const ROSTER_POOL = Object.values(rosters).flat().filter(Boolean)
  // Build "little armies" at scenic anchors: mostly the anchor-biome roster, with the odd wildcard
  // pulled from the whole pool so groups read as a varied mix of characters and monsters.
  const buildCineGroups = () => {
    if (!ROSTER_POOL.length) return []
    // 4 anchors × ~15 = ~60 decor sprites — enough armies for the tour without the per-frame cost
    // of ~90 animated sprites (which caused slowdowns).
    const anchors = comboCtrl.getCineAnchors?.(4) || []
    return anchors.map((an) => {
      const br = (rosters[an.biome] && rosters[an.biome].length) ? rosters[an.biome] : ROSTER_POOL
      const n = 13 + (Math.random() * 5 | 0)  // ~15 per group (13–17)
      const units = []
      for (let i = 0; i < n; i++) {
        const src = Math.random() < 0.8 ? br : ROSTER_POOL
        const e = src[Math.random() * src.length | 0]
        if (e) units.push(e)
      }
      return { world: { x: an.x, y: an.y }, units }
    }).filter((g) => g.units.length)
  }
  const startTitle = () => {
    music.full() // theme at full on the title screen
    if (titleSeq) return
    titleSeq = mountTitleSequence(el, comboCtrl, {
      groups: buildCineGroups(),
      title: 'TINY ARMY',
      tagline: 'Pick a hero. Hold the line.',
    })
  }
  const stopTitle = () => { titleSeq?.stop(); titleSeq = null }
  const spawnWithFly = (p) => {
    stopTitle()
    music.duck() // theme keeps playing but weaker now the game has started
    picker?.remove(); picker = null
    // Re-read from the store so we carry live progression (level/xp/skills), not a stale picker copy.
    currentHero = (p && p.id && getPersona(p.id)) || p
    playHeroVoice(currentHero) // hero's saved voice as they deploy (no regeneration)
    setActiveHeroId(currentHero?.id || null)
    runStart = { level: currentHero?.progression?.level || 1 } // for the after-action "levels gained"
    deathShown = false
    updateXpHud()
    try { tut.emit('spawn') } catch { /* ignore */ }
    const s = comboCtrl.getSpawnWorld()
    comboCtrl.selectHero(buildPlayer(chars, currentHero))
    comboCtrl.map.flyTo(s.x, s.y, GAMEPLAY_ZOOM, 1000).catch(() => {})
  }
  // Hero died → after-action report (run stats + an in-voice war-diary recap), then re-enter.
  let runStart = null, deathShown = false
  const onHeroDown = () => {
    if (deathShown) return; deathShown = true
    const th = comboCtrl.getThreat?.() || { kills: 0, time: 0, diff: 1 }
    const fresh = (currentHero?.id && getPersona(currentHero.id)) || currentHero
    const run = {
      killsThisRun: th.kills, threat: +th.diff.toFixed(1), timeSurvived: Math.round(th.time),
      levelStart: runStart?.level || fresh?.progression?.level || 1, levelEnd: fresh?.progression?.level || 1,
    }
    mountAfterAction(el, fresh, run, {
      onAgain: () => { if (fresh) spawnWithFly(fresh) },
      onChoose: () => showPicker(),
    })
  }

  // ── Leveling: a foe defeat grants XP to the active hero, persisted to the roster. ──
  const awardKill = (enemy) => {
    try { tut.emit('kill') } catch { /* ignore */ }
    const id = currentHero?.id; if (!id) return
    const cur = getPersona(id); if (!cur) return
    const gained = enemyXpValue(enemy)
    const res = applyXp(cur.progression, gained)
    const prog = res.progression
    prog.kills = (cur.progression.kills || 0) + 1
    let events = appendEvent(cur.events, 'kill', { enemy: enemy?.name || 'a foe', xp: gained, ts: Date.now() })
    if (res.leveledUp) events = appendEvent(events, 'level_up', { level: prog.level, ts: Date.now() })
    patchPersona(id, { progression: prog, events })
    currentHero = getPersona(id)
    updateXpHud()
    if (sheetOpen) renderSheet()
    if (res.leveledUp) { comboCtrl?.heroEmote?.('love'); startLevelUpDrafts(res.levelsGained) }
  }
  // Roguelike level-up: pause and present a 1-of-3 perk draft per level gained (sequential).
  const startLevelUpDrafts = (count) => {
    let remaining = count || 1
    const showNext = () => {
      if (remaining <= 0 || !currentHero?.id) { comboCtrl?.setPaused?.(false); return }
      remaining--
      comboCtrl?.setPaused?.(true)
      const lvl = currentHero?.progression?.level || 1
      mountLevelUp(el, { level: lvl, seed: lvl * 7 + remaining }, (perk) => {
        const fresh = getPersona(currentHero.id); if (!fresh) { comboCtrl?.setPaused?.(false); return }
        patchPersona(currentHero.id, { progression: applyPerk(fresh.progression, perk) })
        currentHero = getPersona(currentHero.id)
        comboCtrl?.buffHero?.(perk.live || {})
        updateXpHud(); if (sheetOpen) renderSheet()
        showNext()
      })
    }
    showNext()
  }
  // Picking a hero opens its detail page (portrait/about/quote + Select); Select confirms → spawnWithFly.
  const onPick = (p) => openHeroDetail(el, p, chars, () => spawnWithFly(p))
  const buildPicker = () => {
    const personas = listPersonas()
    return buildHeroPicker(el, personas.length ? personas : [FALLBACK], chars, onPick,
      () => openCreateModal(el, spawnWithFly))
  }
  // Picker is usable immediately; the title sequence runs the ambient camera tour behind it (so we
  // start that instead of the old static fly-to-overview). flyToOverview stays as a fallback.
  const showPicker = () => { xpHud.style.display = 'none'; if (!picker) { picker = buildPicker(); if (ROSTER_POOL.length) startTitle(); else flyToOverview() } }
  // Rebuild the open picker whenever the roster changes — so a hero just created (or removed) shows
  // up in the "Choose your hero" bar without waiting for the next time it reopens.
  const refreshPicker = () => { if (picker) { picker.remove(); picker = buildPicker() } }

  // ── Character sheet — a top-right button slides a hero panel in from the right (sidebar-style). ──
  let sheetOpen = false
  const sheetBtn = document.createElement('button'); sheetBtn.type = 'button'; sheetBtn.title = 'Character (C)'; sheetBtn.dataset.tut = 'sheet'
  sheetBtn.innerHTML = '☰<span style="font:700 9px var(--tac-font,system-ui);display:block;margin-top:-2px;color:#9aa4b2;letter-spacing:.04em">C</span>'
  sheetBtn.style.cssText = 'position:absolute;top:14px;right:14px;z-index:7;width:44px;height:46px;border-radius:10px;border:1px solid #2a3340;background:rgba(20,24,33,.85);color:#e8e8e8;font:600 17px var(--tac-font,system-ui);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1'
  // Mute toggle for the music, sitting just left of the character-sheet button.
  const muteBtn = document.createElement('button'); muteBtn.type = 'button'
  muteBtn.style.cssText = 'position:absolute;top:14px;right:66px;z-index:7;width:44px;height:46px;border-radius:10px;border:1px solid #2a3340;background:rgba(20,24,33,.85);color:#e8e8e8;font:600 18px var(--tac-font,system-ui);cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1'
  const renderMute = (m) => { muteBtn.textContent = m ? '🔇' : '🔊'; muteBtn.title = m ? 'Unmute music' : 'Mute music' }
  renderMute(music.isMuted())
  music.onMuteChange(renderMute)
  muteBtn.addEventListener('click', () => renderMute(music.toggleMute()))
  const sheet = document.createElement('aside')
  sheet.style.cssText = 'position:absolute;top:0;right:0;bottom:0;width:min(300px,82vw);z-index:8;background:rgba(16,20,27,.97);border-left:1px solid #2a3340;box-shadow:-8px 0 24px rgba(0,0,0,.45);transform:translateX(100%);transition:transform .22s ease;overflow-y:auto;color:#e8e8e8;font:13px var(--tac-font,system-ui);box-sizing:border-box;padding:18px 16px'
  // A forged-skill detail bottom-sheet: big action illustration (lazy Klein render, cached),
  // flavor, effects, and an equip/unequip toggle (max 3 equipped).
  let skillSheet = null
  const openSkillDetail = (sk) => {
    skillSheet?.remove()
    const back = document.createElement('div'); back.style.cssText = 'position:absolute;inset:0;z-index:10;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center'
    const sh = document.createElement('div'); sh.style.cssText = 'width:min(440px,96vw);max-height:90%;overflow-y:auto;background:#11151c;border:1px solid #2a3340;border-radius:16px 16px 0 0;padding:16px;color:#e8e8e8;box-sizing:border-box'
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.style.cssText = 'float:right;background:none;border:none;color:#9aa4b2;font-size:20px;cursor:pointer'
    const closeDetail = () => { back.remove(); skillSheet = null }
    x.addEventListener('click', closeDetail); sh.append(x)
    const art = document.createElement('div'); art.style.cssText = 'width:100%;aspect-ratio:1/1;border-radius:12px;border:1px solid #2a3340;background:#0d1015;background-size:cover;background-position:center;margin:6px 0 12px;display:flex;align-items:center;justify-content:center;color:#5a6573;font-size:12px'
    art.textContent = sk.iconPending ? '✦ painting the scene…' : ''; sh.append(art)
    const nm = document.createElement('div'); nm.textContent = sk.name; nm.style.cssText = 'font:700 19px var(--tac-font,system-ui)'; sh.append(nm)
    const cat = document.createElement('div'); cat.textContent = `${(sk.category || '').replace('_', ' ')} · ${effectSummary(sk)}`; cat.style.cssText = 'font-size:11px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.06em;margin:3px 0 10px'; sh.append(cat)
    if (sk.flavor) { const fl = document.createElement('div'); fl.textContent = sk.flavor; fl.style.cssText = 'font-style:italic;color:#c2c8d2;line-height:1.5;margin-bottom:14px'; sh.append(fl) }
    const eqBtn = document.createElement('button'); eqBtn.type = 'button'
    const isEq = () => (getPersona(currentHero.id)?.equippedSkills || []).includes(sk.id)
    const paintEq = () => { const on = isEq(); eqBtn.textContent = on ? '★ Equipped — tap to remove' : '☆ Equip (uses a skill slot)'; eqBtn.style.cssText = `width:100%;padding:12px;border-radius:10px;border:1px solid ${on ? '#c9a227' : '#2a3340'};background:${on ? '#2a2410' : '#1a2230'};color:${on ? '#ffe082' : '#e8e8e8'};font:600 13px var(--tac-font,system-ui);cursor:pointer` }
    eqBtn.addEventListener('click', () => {
      const cur = getPersona(currentHero.id); if (!cur) return
      let eq = (cur.equippedSkills || []).slice()
      if (eq.includes(sk.id)) eq = eq.filter((i) => i !== sk.id)
      else { if (eq.length >= 3) { eqBtn.textContent = 'Slots full (3) — remove one first'; return } eq.push(sk.id) }
      patchPersona(cur.id, { equippedSkills: eq }); currentHero = getPersona(cur.id)
      comboCtrl?.setHeroSkills?.(resolveEquipped(currentHero)) // live-update the on-field hero's bar so it's usable at once
      paintEq(); renderSheet()
    })
    paintEq(); sh.append(eqBtn)
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeDetail() })
    back.append(sh); el.append(back); skillSheet = back
    // The skill's single image (the character performing it) — generated in the background by the forge.
    // While pending, keep the "painting…" label and don't pull a stale (reused-id) icon from the store.
    if (!sk.iconPending) getSkillIcon(sk.id).then((b) => { if (b) { art.textContent = ''; art.style.backgroundImage = `url(${URL.createObjectURL(b)})` } else art.textContent = 'no image' })
  }
  // Chat with the current hero in a bottom-sheet (woid-context chat + per-message voice).
  let chatSheet = null
  const openChat = () => {
    if (!currentHero || !currentHero.id) return
    chatSheet?.remove()
    const back = document.createElement('div'); back.style.cssText = 'position:absolute;inset:0;z-index:11;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center'
    const sh = document.createElement('div'); sh.style.cssText = 'width:min(440px,96vw);height:82%;display:flex;flex-direction:column;background:#11151c;border:1px solid #2a3340;border-radius:16px 16px 0 0;padding:14px;color:#e8e8e8;box-sizing:border-box'
    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'
    const ttl = document.createElement('div'); ttl.textContent = `💬 ${currentHero.name || 'Hero'}`; ttl.style.cssText = 'font:700 16px var(--tac-font,system-ui)'
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.style.cssText = 'background:none;border:none;color:#9aa4b2;font-size:20px;cursor:pointer'
    const closeChat = () => { back.remove(); chatSheet = null }
    x.addEventListener('click', closeChat); head.append(ttl, x); sh.append(head)
    const body = document.createElement('div'); body.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column'; sh.append(body)
    // Feed the live combat snapshot in so the fighter's chat reflects what's happening NOW.
    const getLive = () => {
      const h = comboCtrl?.getHero?.(); const th = comboCtrl?.getThreat?.()
      if (!h || h.name !== (currentHero.name || h.name)) return null // only when THIS hero is on the field
      const inCombat = h.hp < h.maxHp || (th && th.kills > 0)
      return { hp: h.hp, maxHp: h.maxHp, inCombat: !!inCombat, threat: th ? +th.diff.toFixed(1) : null, kills: th ? th.kills : 0, location: 'the Forgotten Plains' }
    }
    const chat = mountCharacterChat(body, currentHero.id, { getLive }); setTimeout(() => chat.focus(), 50)
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeChat() })
    back.append(sh); el.append(back); chatSheet = back
  }
  // ── Skill-bar management (equippedSkills = ordered list, max 3 = the in-combat bar) ──
  const learnedSkills = () => { const cs = currentHero?.customSkills || {}; return (currentHero?.learnedSkills || []).map((id) => cs[id]).filter(Boolean) }
  const writeEquipped = (eq) => {
    patchPersona(currentHero.id, { equippedSkills: eq.slice(0, 3) })
    currentHero = getPersona(currentHero.id)
    comboCtrl?.setHeroSkills?.(resolveEquipped(currentHero)) // live-update the on-field hero's bar + buttons
    renderSheet()
  }
  const toggleEquip = (id) => {
    const eq = (getPersona(currentHero.id)?.equippedSkills || []).slice()
    if (eq.includes(id)) writeEquipped(eq.filter((x) => x !== id))
    else if (eq.length < 3) writeEquipped([...eq, id])
  }
  const setSlot = (i, id) => {
    let eq = (getPersona(currentHero.id)?.equippedSkills || []).slice()
    if (id == null) eq.splice(i, 1)                       // clear the slot
    else { eq = eq.filter((x) => x !== id); if (i < eq.length) eq[i] = id; else eq.push(id) } // replace / fill, no dupes
    writeEquipped(eq)
  }
  // Generic bottom-sheet shell (used by the bar picker + forge form).
  let toolSheet = null
  const openToolSheet = (title) => {
    toolSheet?.remove()
    const back = document.createElement('div'); back.style.cssText = 'position:absolute;inset:0;z-index:12;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center'
    const sh = document.createElement('div'); sh.style.cssText = 'width:min(440px,96vw);max-height:88%;overflow-y:auto;background:#11151c;border:1px solid #2a3340;border-radius:16px 16px 0 0;padding:16px;color:#e8e8e8;box-sizing:border-box'
    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px'
    const ttl = document.createElement('div'); ttl.textContent = title; ttl.style.cssText = 'font:700 16px var(--tac-font,system-ui)'
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.style.cssText = 'background:none;border:none;color:#9aa4b2;font-size:20px;cursor:pointer'
    const close = () => { back.remove(); toolSheet = null }
    x.addEventListener('click', close); head.append(ttl, x); sh.append(head)
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close() })
    back.append(sh); el.append(back); toolSheet = back
    return { sh, close }
  }
  // Choose what goes in bar slot i (assign a learned skill or clear it).
  const openBarPicker = (i) => {
    const { sh, close } = openToolSheet(`Skill slot ${i + 1}`)
    const eq = currentHero.equippedSkills || []
    const skills = learnedSkills()
    if (!skills.length) { const e = document.createElement('div'); e.textContent = 'No forged skills yet — forge one below.'; e.style.cssText = 'color:#9aa4b2;font-size:13px'; sh.append(e); return }
    skills.forEach((sk) => {
      const on = eq[i] === sk.id, elsewhere = eq.includes(sk.id) && !on
      const row = document.createElement('button'); row.type = 'button'
      row.style.cssText = `display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:9px;border:1px solid ${on ? '#c9a227' : '#232b36'};border-radius:10px;margin-bottom:7px;background:rgba(20,24,33,.6);color:#e8e8e8;cursor:pointer`
      const ic = document.createElement('div'); ic.style.cssText = 'width:36px;height:36px;border-radius:8px;border:1px solid #2a3340;background:#0d1015;background-size:cover;background-position:center;flex:none'
      paintSkillIcon(ic, sk)
      const t = document.createElement('div')
      const nm = document.createElement('div'); nm.textContent = sk.name + (on ? '  ★' : elsewhere ? '  (in another slot)' : ''); nm.style.cssText = 'font:600 13px var(--tac-font,system-ui)'
      const ef = document.createElement('div'); ef.textContent = effectSummary(sk); ef.style.cssText = 'font-size:11px;color:#9aa4b2'
      t.append(nm, ef); row.append(ic, t)
      row.addEventListener('click', () => { setSlot(i, sk.id); close() })
      sh.append(row)
    })
    if (eq[i]) { const clr = document.createElement('button'); clr.type = 'button'; clr.textContent = 'Clear slot'; clr.style.cssText = 'width:100%;padding:10px;border-radius:10px;border:1px solid #3a2530;background:#241a1e;color:#ff8a8a;font:600 13px var(--tac-font,system-ui);cursor:pointer;margin-top:4px'; clr.addEventListener('click', () => { setSlot(i, null); close() }); sh.append(clr) }
  }
  // Forge a new skill for this hero, right here on the character page.
  const openForge = () => {
    const { sh, close } = openToolSheet(`⚒ Forge a skill for ${currentHero.name || 'this hero'}`)
    const ta = document.createElement('textarea'); ta.rows = 3; ta.placeholder = 'describe the skill (e.g. “a whirlwind that bleeds everyone around me”)'
    ta.style.cssText = 'width:100%;resize:vertical;background:#0d1015;border:1px solid #2a3340;border-radius:10px;color:#e8e8e8;padding:10px;font:13px var(--tac-font,system-ui);box-sizing:border-box'
    const go = document.createElement('button'); go.type = 'button'; go.textContent = '⚒ Forge skill'; go.dataset.tut = 'forge'
    go.style.cssText = 'width:100%;margin-top:10px;padding:12px;border-radius:10px;border:1px solid #c9a227;background:#2a2410;color:#ffe082;font:600 14px var(--tac-font,system-ui);cursor:pointer'
    const status = document.createElement('div'); status.style.cssText = 'color:#9aa4b2;font-size:12px;margin-top:8px;min-height:16px'
    sh.append(ta, go, status); setTimeout(() => ta.focus(), 50)
    let busy = false
    go.addEventListener('click', async () => {
      if (busy) return
      if (!ta.value.trim()) { status.textContent = 'Describe the skill you want.'; return }
      busy = true; go.disabled = true; ta.disabled = true
      try {
        const res = await forgeSkillForHero(currentHero.id, ta.value, { onStatus: (s) => { status.textContent = s + '…' } })
        if (!res.ok) { status.textContent = 'Forge failed: ' + res.error; busy = false; go.disabled = false; ta.disabled = false; return }
        currentHero = getPersona(currentHero.id)
        status.textContent = `✓ Learned “${res.skill.name}”.`
        try { tut.emit('forge') } catch { /* ignore */ }
        renderSheet()                                  // reflect the new skill behind the sheet
        setTimeout(close, 900)
      } catch (e) { status.textContent = 'Forge failed: ' + (e && e.message ? e.message : e); busy = false; go.disabled = false; ta.disabled = false }
    })
  }
  const renderSheet = () => {
    sheet.innerHTML = ''
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '✕'
    close.style.cssText = 'position:absolute;top:10px;right:12px;background:none;border:none;color:#9aa4b2;font-size:18px;cursor:pointer'
    close.addEventListener('click', () => setSheet(false)); sheet.append(close)
    if (!currentHero) { const e = document.createElement('div'); e.textContent = 'No hero selected.'; e.style.cssText = 'color:#9aa4b2;margin-top:8px'; sheet.append(e); return }
    const portrait = document.createElement('div'); portrait.style.cssText = 'width:120px;height:120px;border-radius:12px;border:1px solid #2a3340;background:#0d1015;margin:6px auto 12px'
    fillAvatar(portrait, currentHero, chars, 120); sheet.append(portrait)
    const hero = comboCtrl.getHero?.()
    const name = document.createElement('div'); name.textContent = currentHero.name || hero?.name || 'Hero'; name.style.cssText = 'font:700 18px var(--tac-font,system-ui);text-align:center'; sheet.append(name)
    const cls = document.createElement('div'); cls.textContent = [currentHero.unitClass, hero?.profession].filter(Boolean).join(' · '); cls.style.cssText = 'text-align:center;color:#9aa4b2;letter-spacing:.06em;text-transform:uppercase;font-size:11px;margin-bottom:14px'; sheet.append(cls)
    // ── Progression: level chip + XP bar + kills/points ──
    {
      const prog = currentHero.progression || { level: 1, xp: 0, kills: 0, attributePoints: 0 }
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:2px 0 10px'
      const lv = document.createElement('span'); lv.textContent = 'LV ' + prog.level; lv.style.cssText = 'font:700 12px var(--tac-font,system-ui);color:#ffe082;background:#2a2410;border:1px solid #c9a227;border-radius:6px;padding:2px 8px;flex:none'
      const barWrap = document.createElement('div'); barWrap.style.cssText = 'flex:1'
      const xpLab = document.createElement('div'); xpLab.style.cssText = 'font-size:10px;color:#9aa4b2;margin-bottom:2px'; xpLab.textContent = `XP ${prog.xp} / ${xpToNext(prog.level)}`
      const xpTrack = document.createElement('div'); xpTrack.style.cssText = 'height:6px;border-radius:5px;background:#222a35;overflow:hidden'
      const xpFill = document.createElement('div'); xpFill.style.cssText = `height:100%;background:#c9a227;width:${Math.round(levelProgress(prog) * 100)}%`
      xpTrack.append(xpFill); barWrap.append(xpLab, xpTrack); row.append(lv, barWrap); sheet.append(row)
      const meta = document.createElement('div'); meta.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#9aa4b2;margin-bottom:10px'
      const kills = document.createElement('span'); kills.textContent = `⚔ ${prog.kills} kills`
      meta.append(kills)
      sheet.append(meta)
      if (prog.best && prog.best.kills) { const bst = document.createElement('div'); bst.textContent = `🏆 Best run: ${prog.best.kills} foes · threat ${prog.best.threat || 1}×`; bst.style.cssText = 'font-size:11px;color:#c9a227;margin:-4px 0 10px'; sheet.append(bst) }
    }
    // Talk to this fighter (chat + voice). Needs a saved hero (id) to persist the conversation.
    if (currentHero.id) {
      const talk = document.createElement('button'); talk.type = 'button'; talk.dataset.tut = 'talk'; talk.textContent = `💬 Talk to ${currentHero.name || 'them'}`
      talk.style.cssText = 'width:100%;padding:11px;border-radius:10px;border:1px solid #2a3340;background:#16202e;color:#e8e8e8;font:600 13px var(--tac-font,system-ui);cursor:pointer;margin-bottom:12px'
      talk.addEventListener('click', openChat); sheet.append(talk)
    }
    if (hero) {
      const wrap = document.createElement('div'); wrap.style.cssText = 'margin:6px 0 12px'
      const lab = document.createElement('div'); lab.style.cssText = 'font-size:11px;color:#9aa4b2;margin-bottom:3px'
      const track = document.createElement('div'); track.style.cssText = 'height:8px;border-radius:6px;background:#222a35;overflow:hidden'
      const fill = document.createElement('div'); fill.style.cssText = 'height:100%'
      track.append(fill); wrap.append(lab, track); sheet.append(wrap); sheet._hp = { lab, fill }
      updateHp(hero)
    }
    const skills = hero?.skills || []
    if (skills.length) {
      const h = document.createElement('div'); h.textContent = 'Skills'; h.style.cssText = 'font:600 10px var(--tac-font,system-ui);letter-spacing:.18em;text-transform:uppercase;color:#9aa4b2;margin:12px 0 6px'; sheet.append(h)
      skills.forEach((s, i) => { const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:7px 9px;border:1px solid #232b36;border-radius:8px;margin-bottom:6px'; const n = document.createElement('span'); n.textContent = String(i + 1); n.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#222a35;display:flex;align-items:center;justify-content:center;font-size:11px;color:#9aa4b2;flex:none'; const t = document.createElement('span'); t.textContent = s; row.append(n, t); sheet.append(row) })
    }
    // ── Skill bar + forged skills: learn here, switch the 3 equipped, tap for detail ──
    if (currentHero.id) {
      const headerCss = 'font:600 10px var(--tac-font,system-ui);letter-spacing:.18em;text-transform:uppercase;color:#9aa4b2;margin:16px 0 6px'
      const learned = learnedSkills()
      const eq = currentHero.equippedSkills || []
      const cs = currentHero.customSkills || {}
      // Skill bar — three tappable slots = the in-combat 1/2/3 buttons.
      const barH = document.createElement('div'); barH.textContent = 'Skill bar (tap a slot to assign)'; barH.style.cssText = headerCss; sheet.append(barH)
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px'
      for (let i = 0; i < 3; i++) {
        const sk = cs[eq[i]]
        const slot = document.createElement('button'); slot.type = 'button'; slot.title = sk ? sk.name : 'Assign a skill'
        slot.style.cssText = `flex:1;aspect-ratio:1/1;border-radius:10px;border:1px ${sk ? 'solid #c9a227' : 'dashed #2a3340'};background:#0d1015;background-size:cover;background-position:center;cursor:pointer;position:relative;padding:0;overflow:hidden`
        const num = document.createElement('span'); num.textContent = String(i + 1); num.style.cssText = 'position:absolute;top:3px;left:5px;font-size:10px;color:#9aa4b2;text-shadow:0 1px 2px #000;z-index:1'; slot.append(num)
        if (sk) {
          paintSkillIcon(slot, sk)
          const cap = document.createElement('span'); cap.textContent = sk.name; cap.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.62);padding:2px 3px;font-size:9px;color:#e8e8e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; slot.append(cap)
        } else { const plus = document.createElement('span'); plus.textContent = '+'; plus.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;color:#3a4250'; slot.append(plus) }
        slot.addEventListener('click', () => openBarPicker(i)); bar.append(slot)
      }
      sheet.append(bar)
      // Forged skills — quick ★ equip toggle + tap for the detail/action-art sheet.
      if (learned.length) {
        const lh = document.createElement('div'); lh.textContent = 'Forged skills'; lh.style.cssText = headerCss; sheet.append(lh)
        learned.forEach((sk) => {
          const onBar = eq.includes(sk.id)
          const row = document.createElement('div'); row.style.cssText = `display:flex;gap:10px;align-items:center;width:100%;padding:8px;border:1px solid ${onBar ? '#c9a227' : '#232b36'};border-radius:10px;margin-bottom:7px;background:rgba(20,24,33,.6)`
          const ic = document.createElement('button'); ic.type = 'button'; ic.title = 'Details'; ic.style.cssText = 'position:relative;width:40px;height:40px;border-radius:8px;border:1px solid #2a3340;background:#0d1015;background-size:cover;background-position:center;flex:none;cursor:pointer;padding:0'
          paintSkillIcon(ic, sk)
          ic.addEventListener('click', () => openSkillDetail(sk))
          const txt = document.createElement('button'); txt.type = 'button'; txt.style.cssText = 'flex:1;text-align:left;background:none;border:none;color:#e8e8e8;cursor:pointer;padding:0'
          const nm = document.createElement('div'); nm.textContent = sk.name; nm.style.cssText = 'font:600 13px var(--tac-font,system-ui)'
          const ef = document.createElement('div'); ef.textContent = effectSummary(sk); ef.style.cssText = 'font-size:11px;color:#9aa4b2'
          txt.append(nm, ef); txt.addEventListener('click', () => openSkillDetail(sk))
          const eqb = document.createElement('button'); eqb.type = 'button'; eqb.textContent = onBar ? '★' : '☆'; eqb.title = onBar ? 'Remove from bar' : (eq.length >= 3 ? 'Bar full' : 'Add to bar')
          eqb.style.cssText = `flex:none;width:34px;height:34px;border-radius:8px;border:1px solid ${onBar ? '#c9a227' : '#2a3340'};background:${onBar ? '#2a2410' : '#1a2230'};color:${onBar ? '#ffe082' : '#9aa4b2'};font-size:15px;cursor:pointer`
          eqb.addEventListener('click', () => toggleEquip(sk.id))
          row.append(ic, txt, eqb); sheet.append(row)
        })
      }
      const forgeBtn = document.createElement('button'); forgeBtn.type = 'button'; forgeBtn.textContent = '⚒ Forge a new skill'
      forgeBtn.style.cssText = 'width:100%;padding:11px;border-radius:10px;border:1px solid #c9a227;background:#2a2410;color:#ffe082;font:600 13px var(--tac-font,system-ui);cursor:pointer;margin:6px 0 12px'
      forgeBtn.addEventListener('click', openForge); sheet.append(forgeBtn)
    }
    if (currentHero.about) { const a = document.createElement('div'); a.textContent = currentHero.about; a.style.cssText = 'color:#c2c8d2;margin:12px 0;line-height:1.45'; sheet.append(a) }
    const sw = document.createElement('button'); sw.type = 'button'; sw.textContent = '⇄ Switch / New hero'
    sw.style.cssText = 'width:100%;margin-top:14px;padding:11px;border-radius:10px;border:1px solid #2a3340;background:#1a2230;color:#e8e8e8;font:600 13px var(--tac-font,system-ui);cursor:pointer'
    sw.addEventListener('click', () => { setSheet(false); showPicker() }); sheet.append(sw)
  }
  const updateHp = (hero) => { if (!sheet._hp || !hero) return; const pct = hero.maxHp ? Math.max(0, Math.min(100, hero.hp / hero.maxHp * 100)) : 0; sheet._hp.lab.textContent = `HP ${hero.hp} / ${hero.maxHp}`; sheet._hp.fill.style.width = pct + '%'; sheet._hp.fill.style.background = pct > 33 ? '#34d058' : '#ff3b30' }
  // A transparent backdrop over the game area while the sheet is open — tapping the game dismisses
  // the sidebar (the sheet itself sits above it; nested overlays like chat have their own backdrop).
  let sheetBackdrop = null
  const setSheet = (open) => {
    sheetOpen = open; sheet.style.transform = open ? 'translateX(0)' : 'translateX(100%)'
    comboCtrl?.setPaused?.(open) // freeze the game while the character page is open
    if (open) { try { tut.emit('sheet') } catch { /* ignore */ } }
    if (open) {
      renderSheet()
      if (!sheetBackdrop) { sheetBackdrop = document.createElement('div'); sheetBackdrop.style.cssText = 'position:absolute;inset:0;z-index:7;background:transparent'; sheetBackdrop.addEventListener('pointerdown', () => setSheet(false)); el.append(sheetBackdrop) }
    } else { sheetBackdrop?.remove(); sheetBackdrop = null }
  }
  sheetBtn.addEventListener('click', () => setSheet(!sheetOpen))
  // Press C to open/close the character sheet (ignored while typing).
  window.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'c' || e.key === 'C') { setSheet(!sheetOpen); e.preventDefault() }
  })
  el.append(sheetBtn, muteBtn, sheet)

  // ── XP / level HUD chip (top-left) — always visible while a hero is in play ──
  const xpHud = document.createElement('div')
  xpHud.style.cssText = 'position:absolute;top:14px;left:14px;z-index:6;pointer-events:none;display:none;align-items:center;gap:8px;background:rgba(20,24,33,.8);border:1px solid #2a3340;border-radius:999px;padding:5px 12px 5px 9px;font:700 12px monospace;color:#e8e8e8'
  const xpLv = document.createElement('span'); xpLv.style.cssText = 'color:#ffe082'
  const xpTrack = document.createElement('div'); xpTrack.style.cssText = 'width:90px;height:6px;border-radius:4px;background:#222a35;overflow:hidden'
  const xpFill = document.createElement('div'); xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#c9a227,#ffe082);transition:width .2s'
  xpTrack.append(xpFill); xpHud.append(xpLv, xpTrack); el.append(xpHud)
  const updateXpHud = () => {
    const prog = currentHero && currentHero.id ? currentHero.progression : null
    if (!prog) { xpHud.style.display = 'none'; return }
    xpHud.style.display = 'flex'; xpLv.textContent = 'LV ' + prog.level
    xpFill.style.width = Math.round(levelProgress(prog) * 100) + '%'
  }

  showPicker()
  // Detect the hero's first real move (for the tour's "lead them" step).
  let moveAnchor = null
  comboCtrl.onChange((s) => {
    if (s.over) onHeroDown()
    if (sheetOpen) updateHp(comboCtrl.getHero?.())
    if (s.player) { if (!moveAnchor) moveAnchor = { x: s.player.x, y: s.player.y }; else if (Math.hypot(s.player.x - moveAnchor.x, s.player.y - moveAnchor.y) > 40) { moveAnchor = { x: s.player.x, y: s.player.y }; try { tut.emit('move') } catch { /* ignore */ } } }
  })
  onRosterChange(() => { refreshPicker(); if (sheetOpen && currentHero?.id) { currentHero = getPersona(currentHero.id) || currentHero; renderSheet() } })
  // First-run guided tour (skippable, persisted). Kicks off shortly after the Game mounts.
  if (tut.shouldAutoStart()) setTimeout(() => tut.startOrResume(), 900)
})
