# Tiny Army — RPG Progression, Skill Forge, Character Chat & Voice

> **Status (2026-06-13): all 6 phases implemented & committed** on branch `local`
> (tiny-army) + `local` (auto-battler). Phase 0 state · Phase 1 leveling · Phase 2
> skill forge + detail art · Phase 3 chat · Phase 4 voice · Phase 5 emotes. Each
> verified in-browser (logic + mount + live sidecar round-trip). Not yet pushed.
>
> **Fun + living-world milestone (2026-06-13, also committed, not pushed):**
> The core game loop was shallow, so a second pass made combat actually fun and
> wove in more load-bearing LLM:
> - **Leveling scales power** — level+spent points → rank/HP/damage (`statBonuses`); a
>   level-up gives an immediate live buff + full heal; attribute points spendable (+HP/+DMG).
> - **Escalating waves** — foes ramp with time+kills; Elite (2.4× HP) and Champion boss
>   (4.6× HP, bigger sprite) on kill milestones, worth far more XP.
> - **Hit juice** — hitstop + screenshake (processLog onHit/onDeath hooks); existing red flash.
> - **Dodge roll** — Shift / ⟲ button → fast i-frame dash (engine `invulnUntil` in dealDamage).
> - **Combat HUD** — adrenaline meter, per-skill ready-dim, top threat badge (surfaces the
>   engine's hidden adrenaline/condition/combo depth).
> - **Live combat state in chat** — `buildStateTurn` takes a live snapshot (HP/threat) so a
>   fighter answers aware of its current wounds, not just persisted history.
> - **Death after-action + war-diary recap** — on death, a report (kills/threat/levels/time)
>   + an in-voice LLM recap of the run, banked to the hero's memory (feeds chat).
> - **Personal-best records + shared Chronicle** — a record to beat per hero; fallen heroes'
>   legends post to a world feed shown on the after-action (the world feels populated).
>
> Still open (good next swings): loot/rewards, the bigger living-world LLM features
> (social fabric/relationships, off-screen evolution, skill+soul mutation, an LLM director).

**Goal:** turn each fighter from a static persona into a living, evolving character that
**levels up**, **forges unique skills** (code + flavor + art), and you can **talk to**
on its character page and **hear it speak**. Mobile-first throughout.

This plan is grounded in the current architecture:

- **Souls persist client-side**: `web/personaStore.js` → `localStorage['tinyarmy.roster.v1']`
  + IndexedDB (`portraits`, `voices` blob stores). No backend DB; we extend this.
- **Combat is in the browser**: source in `../auto-battler/src/`, bundled into `web/*.js`
  by `build.sh` (esbuild). Roam combat = `src/render/comboBattler.js`; resolver =
  `src/engine/teamBattle.js`; skill IR = `src/engine/skills.js` (`CB_SKILLS`).
- **Skill IR is a clean object**: `{id, name, profession, attribute, category, target,
  cost, cast, recharge, requires, effects[]}`, icon at `/gw/skills/<id>.jpg`. This is the
  exact output contract for the Skill Forge model.
- **Models wired via facades**: text = `web/runtime.js` + `/text/generate/stream` (SSE);
  image = `web/imagen.js` + `/portrait` (Klein on :7865); TTS = `web/tts.js`
  (Kokoro in-browser / Qwen3 / VoxCPM). Code model = **BLS Mini-Code 30B** (the "skill forge").
- **Context pattern to copy from woid**: `agent-sandbox/pi-bridge/buildContext.js` —
  static system prompt + dynamic per-turn delta (perception event log, needs/mood line,
  verbatim memory of recent scenes). We port a single-player, client-side slice of this.

> ⚠️ Two-repo build: engine/skill changes are authored in `../auto-battler/src/**`, then
> `./build.sh` re-bundles into `tiny-army/web/`. UI shell + endpoints live in tiny-army
> (`app.py`, `web/*.js`). Verify on the auto-battler dev server (:5173) and the tiny-army
> server (:7860).

---

## Phase 0 — Foundations: persistent progression state

Everything else depends on the soul being able to *carry* progression. Do this first.

**0.1 Extend the persona schema** (`web/personaStore.js`)
Add, with a version bump + migration (default-fill on load so existing roster survives):
```js
progression: { level: 1, xp: 0, kills: 0, attributePoints: 0 },
learnedSkills: [],        // skillIds owned by THIS character (refs into customSkills or CB_SKILLS)
equippedSkills: [],       // up to 3 skillIds → the bar comboBattler reads
customSkills: {},         // skillId → forged skill IR + {flavor, iconKey, forgedFrom, forgedAt}
chat: { history: [] },    // [{ role:'user'|'char', text, ts, audioKey? }]
events: [],               // append-only progression log (see Phase 3 memory)
```
New IndexedDB stores: `skillIcons` (PNG blobs, keyed by skillId), `chatAudio` (WAV blobs,
keyed by message id). Mirror the existing `portraits`/`voices` blob pattern.

**0.2 "Active hero" selection** — a small shared store so the character page, combat, and
chat all agree on *which* roster member is in play. Persist `tinyarmy.activeHeroId`.

**0.3 XP curve util** (`web/progression.js`) — pure functions:
`xpToNext(level)`, `applyXp(progression, amount) → {progression, leveledUp, levelsGained}`.
Single source of truth; no curve math scattered in UI.

**Acceptance:** existing roster loads unchanged; new fields present with defaults; refresh
preserves a hand-set `xp`/`level`.

---

## Phase 1 — Leveling: defeat enemies → grow

**1.1 Emit a defeat event from combat** (`../auto-battler/src/render/comboBattler.js`)
The roam loop already tracks foe `.alive` and culls corpses via a `deadAt` map (~L372-377).
Add a one-shot hook when a foe transitions alive→dead *and* the player dealt the kill:
`opts.onEnemyDefeated?.({ id, name, enemyClass, x, y, t })`. Fire it once per foe at the
transition, before culling. Rebuild with `./build.sh`.

**1.2 Award XP in the shell** (`web/comboBattler.js` host / `web/tiny.js` wiring)
Pass `onEnemyDefeated` from tiny-army. On each defeat: look up enemy XP value
(small table by enemy class/tier), `applyXp` on the active hero, persist, and if
`leveledUp` push a `level_up` event + grant `attributePoints`.

**1.3 Level-up feedback (mobile)** — a lightweight toast/banner over the canvas
("⚔️ {name} reached level {n}!") + a dismissible level-up sheet offering: spend
attribute point, and (Phase 2) "Forge a new skill." Bottom-sheet style, thumb-reachable.

**1.4 Character page: progression header** (`web/heroCreator.js` barracks card / character sheet)
Show level, an XP progress bar, kill count, and attribute points available. Reuse existing
`.persona-*` CSS tokens; keep single-column on ≤768px.

**Acceptance:** killing foes in roam raises the active hero's XP bar; crossing a threshold
levels them up, persists across refresh, and grants a spendable point.

---

## Phase 2 — Skill Forge: unique skills (code + flavor + art)

Each learned skill is **generated**, not picked from a list — unique IR from the code model,
flavor text from the text model, an icon from Klein.

**2.1 Skill IR validator** (`web/skillSchema.js`, mirrors `src/engine/skills.js`)
Whitelist of legal `category`, `target`, `effects[].op`, `condition`, and `cost` keys, with
numeric clamps (so a forged skill can't be game-breaking or crash the resolver). The engine
is the source of truth — keep the whitelist in sync with `CB_SKILLS` ops
(`apply_condition`, `bonus_damage`, `interrupt`, `lose_all_adrenaline`, …). Assign a fresh
non-colliding `id` (e.g. `9000+`) so icons/refs don't clash with the canon 0–~700 range.

**2.2 Forge endpoint** (`app.py` → `POST /skill/forge`, SSE)
Input: `{ heroId, persona, level, theme? }`. Pipeline:
1. **Code model (BLS Mini-Code 30B / `TINY_BLS_CODE_SPACE`)** — system prompt embeds the
   skill IR spec + 2-3 `CB_SKILLS` examples; asked to emit **one JSON skill object** themed
   to the character's class/persona/specialty. Strip the model's reasoning block (already
   handled for BLS in `llm.py`). Validate via 2.1; **one retry** on invalid with the error
   fed back; fall back to a templated mutation of a canon skill if still invalid (never block
   a level-up on model failure).
2. **Text model** — short **flavor text** (1-2 sentences, in-world) for the skill, using the
   persona's voice fields.
3. **Klein (`/portrait` reuse or `/skill-icon`)** — generate a square icon from a prompt
   built off skill name + flavor + class palette; store blob in `skillIcons` IndexedDB.
Stream progress events (`forging-code`, `forging-flavor`, `forging-art`, `done`) so the UI
shows a live "forging…" state.

**2.3 Save + learn** — write the IR into `customSkills[id]`, push id to `learnedSkills`,
log a `skill_learned` event. Offer to **equip** (into the ≤3 `equippedSkills`). `comboBattler`
already reads `player.unit.skills` (L320) — feed it `equippedSkills` resolved against
`customSkills` ∪ `CB_SKILLS`.

**2.4 Two Klein renders per skill — icon + action shot.** The forge generates **two** images:
1. **Icon** — square, for the skill card (prompt: skill name + flavor + class palette).
2. **Action illustration** — a larger scene of **this character performing the skill**, built
   from the persona's appearance/portrait fields + the skill's flavor + effect (e.g. "{name},
   a {class}, mid-{skill} — {flavor}, motion + impact"). Stored in `skillIcons` (or a sibling
   `skillArt`) IndexedDB store keyed by skillId. Generate the action shot lazily (on first
   detail open) so forging stays fast, then cache.

**2.5 Character page: Skills tab + detail sheet (mobile)** — a grid of skill **cards** (icon,
name, compact effect summary via the engine's effect-label helper, e.g. `+bleeding`). Tap a
card → a **larger skill detail sheet**: the **action illustration** up top (the character
performing the skill), then name, full flavor text, effect breakdown, cost/attribute, and
equip/unequip (cap 3). Bottom-sheet style; single-column on phones; lazy-load art from IndexedDB.

**Acceptance:** on level-up you can forge a skill; it appears as a card with a unique Klein
icon + flavor; opening it shows a bigger detail screen with a Klein image of the character
performing the skill; equipping it makes it usable on the bar in roam combat; all survives refresh.

---

## Phase 3 — Character Chat: talk to your fighter (woid-style context)

Port a **single-player, client-assembled** slice of woid's `buildContext.js`: a static
**system prompt** (identity) + a dynamic **state turn** ("what's happening to you now") +
**verbatim memory** of the recent conversation. No Colyseus/needs-decay complexity — just the
context-assembly shape.

**3.1 Context builder** (`web/characterContext.js`, modeled on woid `buildContext.js`)
- `buildSystemPrompt(persona)` — name, class, `about`, personality/vibe/specialty, plus a
  "stay in voice, you are a real fighter who lived these events" rule. Built once per session.
- `buildStateTurn(persona, userMsg)` — the **delta**: current `level`, recent `events`
  (battles won, skills forged, level-ups — woid's "perception log", here from `persona.events`),
  equipped skills, last battle outcome / current HP if mid-roam. One compact block, like
  woid's needs/mood/trigger lines.
- `buildMemory(persona.chat.history)` — verbatim last N turns (woid drops summarization;
  we do too), char-budgeted.

**3.2 Chat endpoint** (`app.py` → `POST /chat/stream`, SSE)
Thin wrapper over the existing `/text/generate/stream` path (souls are client-side, so the
**client sends the assembled system + turn**; the server just streams the chosen text model —
Tiny Aya / MiniCPM / Mellum via `runtime.js`). Append the streamed reply to `chat.history`.

**3.3 Chat UI on the character screen (mobile)** — a message thread under the character
sheet: bubbles, a sticky bottom input + send (thumb zone), streamed tokens appear live (reuse
the SSE parser pattern from `personaStream.js`). Persist history in `chat.history`.

**Acceptance:** on a character's page you can ask "how was that last fight?" and get an
in-voice reply that references real state (their level, a skill they forged, the enemy they
just beat); the thread persists across refresh.

---

## Phase 4 — Voice: hear them speak

**4.1 Per-message play button** — every character chat bubble gets a ▶ button. On tap, run
the existing TTS narrator (`web/tts.js`) with the persona's `voiceId`/`voice` design fields
(the same pipeline the diary + persona preview already use). Show a loading→playing→replay
state on the button.

**4.2 Cache audio** — store generated WAV in the `chatAudio` IndexedDB store keyed by message
id (mirror `voices`/`portraits`); replay is instant and offline. Skip regeneration if cached.

**4.3 (Optional) auto-speak toggle** — a per-character setting to auto-play replies as they
finish streaming.

**Acceptance:** tapping ▶ on a reply speaks it in the character's voice; replays from cache
with no re-synth; works on mobile (respects the tap-to-unlock-audio gesture).

---

## Phase 5 — Emotes: condition-driven character/enemy reactions

Heroes **and** enemies pop a little emote bubble above their sprite when something happens
(took a hit, killed a foe, low HP, afflicted, leveled, idle). Uses the **Minifantasy UI
Overhaul "Character_Emotions"** pack already in the repo — no model needed.

**Assets (already present in `../auto-battler/public/assets/.../Character_Emotions/`):**
- `_Emotions.png` (152×104) — a sheet of **8×8px** emoticon faces: angry, happy, sad,
  surprised, dizzy/dazed, ❤ love, 💤 sleepy, ♪ music, sweat/fear, sick, etc.
- `_Bubble.png` (280×72) — speech-bubble frames with the tail pointing 8 directions, so the
  bubble can sit above a sprite. (`Bubble_Only` / `Bubble_Outline` variants too.)

**5.1 Curate the pack into tiny-army** — add the emote + bubble PNGs to `curate_assets.py`'s
keep-list so `./build.sh` copies them into `web/assets/`. They're tiny (KBs).

**5.2 Emote sheet decoder** (`../auto-battler/src/render/emotes.js`, bundled to `web/`)
Decode `_Emotions.png` as an 8×8 grid → a named map (`{ angry, happy, sad, surprised, dizzy,
love, sleepy, music, sweat, sick, ... }`), and the bubble frame by tail direction. Mirror the
existing `spriteSheet.js`/`sheet.js` decode pattern (rows×cols, nearest-neighbor scale).

**5.3 Emote render layer** (`../auto-battler/src/render/comboBattler.js` + sprite scene)
A small overlay attached to each actor sprite: `showEmote(actorId, key, { ms })` spawns the
bubble + 8×8 icon above the sprite (scaled to match `groundScale`), auto-expires, and is
culled with the actor. Pixel-snapped, no blur. One emote at a time per actor (latest wins).

**5.4 Condition → emote mapping** (engine events → render)
Drive it off events the resolver/roam loop already produces (`teamBattle.js` logs hits,
conditions, deaths; `comboBattler` knows `.alive`/HP). A small, tunable table, e.g.:

| Trigger (condition)            | Hero emote | Enemy emote |
|--------------------------------|-----------|-------------|
| Took a hit / `dmg`             | 😠 angry  | 😠 angry    |
| Afflicted (`bleeding`/`poison`)| 😣 sick   | 😣 sick     |
| Stunned / `interrupt` / dazed  | 😵 dizzy  | 😵 dizzy    |
| HP crosses low threshold       | 😨 sweat  | 😨 sweat    |
| Killed a foe                   | 😄 happy  | —           |
| On death                       | —         | 💀/😵 dizzy |
| Level-up (hero, Phase 1)       | ❤ love    | —           |
| Idle a while / out of combat   | 💤 sleepy | 💤 sleepy   |

Debounce so a flurry of hits doesn't strobe (min interval per actor). Keep the table in one
place so it's easy to retune. Rebuild via `./build.sh`.

**5.5 (small) Settings toggle** — an "emotes" on/off in the existing settings; default on.

**Acceptance:** in roam combat, taking damage, getting bled/stunned, dropping low, and killing
foes each pop the right 8×8 emote bubble over the correct sprite (hero and enemies); a level-up
shows the ❤ emote; the bubble scales correctly on mobile and is pixel-crisp.

---

## Cross-cutting

- **Mobile-first**: every new surface is single-column ≤768px, controls in the thumb zone,
  bottom-sheets over modals, lazy-loaded media. Matches the existing joystick/attack mobile work.
- **Graceful degradation**: any model call (forge/chat/voice) can fail → always a non-blocking
  fallback (templated skill, text-only reply, silent button). The app already degrades when
  sidecars are down; preserve that.
- **Build discipline**: engine/skill edits → `../auto-battler/src` → `./build.sh` → verify.
  Run local model sidecars with `./run_sidecars.sh` (Aya :7864, Klein :7865); BLS code model
  via its space/sidecar.
- **Persistence is client-side** by design (hackathon). If cross-device sync is ever needed,
  the one new thing required is a `/personas` GET/POST backend store — out of scope here.

## Dependency order
```
Phase 0 (state)  ──►  Phase 1 (leveling)  ──►  Phase 2 (skill forge + detail art)
                 └─►  Phase 3 (chat) ──► Phase 4 (voice)

Phase 5 (emotes) ── needs only engine/render access; richer once Phase 1 events exist.
                    Can be built in parallel; level-up emote depends on Phase 1.
```
Phase 1, 3, and 5 can proceed in parallel once Phase 0 lands (chat doesn't need leveling but
reads richer state once leveling/forge exist; emotes are mostly self-contained render work).

## Model assignments
| Capability        | Model                          | Path |
|-------------------|--------------------------------|------|
| Skill code (IR)   | BLS Mini-Code 30B              | `TINY_BLS_CODE_SPACE`, reasoning stripped |
| Skill flavor      | Tiny Aya / MiniCPM / Mellum    | `/text/generate/stream` |
| Skill icon + action shot | FLUX.2 Klein 4B          | `/portrait` (:7865) — icon (square) + character-performing-skill illustration |
| Emote graphics    | none (Minifantasy art pack)    | `Character_Emotions/_Emotions.png` (8×8) + `_Bubble.png` |
| Character chat     | Tiny Aya / MiniCPM / Mellum   | `/chat/stream` → `/text/generate/stream` |
| Voice             | Kokoro / Qwen3-TTS / VoxCPM    | `web/tts.js` |

## Open decisions (pick before/while building)
1. **XP source**: kills-only (simplest), or also reward skill use / survival? → start kills-only.
2. **Forge trigger**: auto-offer one skill per level, or a spendable "forge token"? → token, so
   forging is a deliberate, art-worthy moment.
3. **Equipped cap**: keep the engine's 3-skill bar, or expand? → keep 3 for balance + UI fit.
4. **Chat state breadth**: how much game state in the turn (just stats, or full recent event
   log)? → start with stats + last 5 events; expand if replies feel thin.
