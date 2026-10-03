# Skill Upgrade Plan — impressive unique VFX + powerful AoE forged skills

**Goals (from the ask):**
1. Forged skills get **impressive graphics when used** in combat (today they look plain).
2. The **coding model makes each skill visually unique** (not just mechanically).
3. **Most skills are powerful and hit all units in their range** (AoE).

## Why forged skills look plain today (grounded findings)
- VFX is config-driven: `combatRenderer.buildSkillPlay(id, def)` reads `def.skillFx[skillId] =
  { animUrl, effects:[{url,cell}] }`. **Canon** skills get this from the sandbox's skill configs;
  **forged** skills (id 9000+) have **no `skillFx` entry**, so on `cast` the renderer falls through
  to `playAttack()` — a **basic sword swing** — and `spawnEffects(undefined)` is a no-op.
- AoE is **target-centric**: `resolveScope()` supports `self/party/nearby/area/target_and_adjacent/
  adjacent_to_target`, but `area`/`nearby` = **target + units within `ADJACENT_GW=140` of the
  TARGET**. There is **no "all enemies within the caster's range" scope.** Forged skills also don't
  set any `scope`, so each effect hits the single auto-target.
- Asset palette is rich: `web/assets/effects.json` (228 entries) has element sheets — **fire, ice,
  nature, poison, shock, petrification**, plus `attack` arcs (slash/pierce/shot) and `hit` pops —
  all minifantasy strips with `{cell, rows, cols}`. Great raw material for element-themed VFX.
- The Game wires VFX per actor: `comboBattler.spawnHero` builds `defsById.P0 = {name, profession,
  ...sheets}` and passes it to `createCombatRenderer`. **Adding `defsById.P0.skillFx` is the hook**
  for the hero's forged-skill VFX. `spawnEffects` positions effects at the **caster's body centre**.

---

## Phase A — Visual identity in the forge IR (model makes each unique)

Extend the Skill-Forge output so the coding model emits a **`visual` block** alongside the mechanics.
Cosmetic, so a bad value just falls back (never crashes the resolver).

**New IR fields** (`skillSchema.js` → `validateSkill`):
```js
visual: {
  element: 'fire'|'ice'|'lightning'|'nature'|'poison'|'shadow'|'holy'|'arcane',  // → tint + sprite sheet
  shape:   'slash'|'nova'|'ring'|'beam'|'pillar'|'projectile'|'shockwave',        // procedural motion
  color:   '#rrggbb',                                                             // accent (validated hex)
  intensity: 1..3,                                                                // particle count / scale / flash
}
```
All whitelisted/clamped. `element` maps to an `effects.json` sheet; `shape`+`color`+`intensity` drive
a procedural layer (Phase B). The model picks them to match the flavor → **every skill is visually
distinct** (element × shape × color × intensity is a huge space), and consistent with its name/lore.

**Prompt (`FORGE_SYSTEM`)** gains: "Also choose a `visual` that fits the skill's theme: an element,
a shape (how it manifests), an accent color, and intensity 1-3." Keep the JSON-only contract.

## Phase B — Render impressive, unique VFX

Two composited layers, wired by giving the hero's forged skills a `skillFx` entry at spawn.

**B1 — Element sprite layer (reuse existing pipeline).**
- Build `ELEMENT_FX` map: element → an `effects.json` URL (fire→fire sheet, lightning→shock, etc.).
- In `comboBattler.spawnHero`, construct `defsById.P0.skillFx` from the equipped forged skills:
  `skillFx[skill.id] = { animUrl: null, effects: [ ELEMENT_FX[skill.visual.element] ] }`.
  `buildSkillPlay` already loads these; `processLog` 'cast' already calls `spawnEffects`. So forged
  skills immediately stop looking like a basic swing.

**B2 — Procedural Pixi VFX layer (new `src/render/skillVfx.js`).**
A small, asset-free effect generator drawn into the combat root (world space), parameterised by
`visual`: an **expanding tinted ring/nova** (shape `nova/ring/shockwave`, radius = the skill's AoE
range → reads as "everything in here is hit"), a **beam/line** to the farthest target, a **pillar**,
or a **projectile** burst. Color = `visual.color`; particle count/scale/duration scale with
`intensity`. Big skills also trigger a brief **screen flash + shake** (reuse the existing
`addShake`/juice hooks). This guarantees uniqueness + scale even when no sprite matches.

**B3 — Hit feedback on every struck unit.**
When an AoE skill resolves, pop a small element `hit` sprite (from `effects.json` `hit` category) +
the yellow skill-name float on each affected enemy — so the player sees the whole area get hit.

**Wiring:** comboBattler's `processLog` 'cast' hook (it already runs per cast) calls
`skillVfx.play(caster, skill.visual, rangeRadius, targets)`. The renderer change is additive.

## Phase C — Powerful + hit all units in range (AoE)

**C1 — New engine scope (`teamBattle.resolveScope`):**
```js
case 'area_around_caster': {
  const r = e.range || DEFAULT_AOE        // effect-supplied radius (field units)
  return b.actors.filter(x => x.alive && x.team !== src.team && dist(src, x) <= r)
}
```
Allow effects to carry a clamped `range`. (Also extend `damage/heal/...` op validators to accept
`scope` + `range`, not just `apply_condition`.)

**C2 — Forge defaults to powerful AoE:**
- Schema: when the model omits scope, **default most forged skills to `area_around_caster`** (a
  config flag, e.g. attack/spell categories get AoE by default; `self`/`ally` targets don't).
- Prompt: "Most skills should be POWERFUL and hit ALL foes in range — prefer an area scope and
  meaningful damage/conditions."
- Numbers: raise the forged damage clamp (these are a hero's signature ultimate-ish skills), with a
  balance ceiling. AoE radius derived from the skill's reach/element (clamped to ~the on-screen
  ranged reach so it's readable, not whole-map).

**C3 — Readability tie-in:** the AoE radius from C1 drives the Phase-B nova scale, so the visual
ring exactly covers the hit area — the player *sees* who's caught.

---

## Files to touch
| File | Change |
|---|---|
| `tiny-army/web/skillSchema.js` | `visual` block + validation; `scope`/`range` on more ops; AoE-by-default; higher damage clamp |
| `tiny-army/web/skillForge.js` | `FORGE_SYSTEM` prompt: emit `visual` + prefer powerful AoE |
| `auto-battler/src/engine/teamBattle.js` | `area_around_caster` scope + `range` on effects |
| `auto-battler/src/render/skillVfx.js` (new) | procedural element VFX (nova/ring/beam/pillar/projectile) |
| `auto-battler/src/render/comboBattler.js` | build `defsById.P0.skillFx` from forged visuals; call `skillVfx.play` on cast; AoE-scaled nova + flash |
| `auto-battler/src/render/combatRenderer.js` | (light) expose a per-target hit-effect helper for AoE pops |

## Sequencing
1. **C (engine AoE + power)** first — biggest gameplay impact, smallest surface; verify in-engine
   that an `area_around_caster` skill damages all foes in radius.
2. **A (visual schema + prompt)** — model emits `visual`; validate; re-forge produces visual params.
3. **B1 (element sprites)** — forged skills stop looking plain (quick win, reuses pipeline).
4. **B2/B3 (procedural VFX + AoE nova + hit pops)** — the "impressive + unique" payoff.

## Decisions (locked 2026-06-13)
- **Power/AoE:** signature-strong, **capped** — most forged attacks/spells are AoE + high damage, ceiling so they can't trivially one-shot a Champion boss.
- **VFX:** **both** element sprites + procedural nova/beam scaled to the AoE.

## Open decisions
1. **VFX approach** — element sprites only, procedural only, or **both composited** (recommended: both — sprites give theme, procedural gives unique scale/motion + guaranteed coverage).
2. **AoE default** — make *most* forged attacks/spells AoE (recommended), or only when the model opts in.
3. **Power level** — how strong? Recommend "signature strong": higher damage + AoE, but capped so a forged skill can't trivially one-shot a Champion boss.
4. **Should canon (non-forged) skills also get the new procedural VFX?** Optional follow-up — they already have authored sprites.
