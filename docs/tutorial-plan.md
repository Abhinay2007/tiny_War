# Tutorial / onboarding plan — show off the LLM features, stay out of the way

**Goal:** a first-run tour that makes the *load-bearing AI* obvious — characters are
**generated** (persona + portrait + voice), you can **talk** to them, and you **forge** their
skills with a coding model — while teaching the basic gameplay loop. **Non-intrusive**: contextual
coachmarks that advance as you play, never a forced wall, always skippable, first-time only.

## Design principles
- **Contextual, not modal.** Small callouts anchored to the real control (the joystick, the ⚔
  button, the ☰/C menu, the Forge button), with one line of copy + `Next` / `Skip tour`. The game
  stays fully playable underneath — coachmarks point, they don't block.
- **Advance on action.** Each step completes when the player *does the thing* (moves, kills a foe,
  opens the sheet, forges a skill) — or taps `Next`. We already have the hooks for most of these.
- **First-run only + opt-out.** One friendly opener: "New here? Take a 60-sec tour. [Start] [No
  thanks]." Either choice is remembered (localStorage); it never nags again. A `?` help button +
  a Settings "Replay tutorial" let them re-run it.
- **Sell the magic in-world.** At each generation step the copy leans on *uniqueness + life*
  ("forged anew", "written for them alone", "made real from your words", "their own voice") rather
  than naming the tech. The existing elapsed-time status shows it working. The AI is the star — in
  costume.

## The coachmark engine — `web/tutorial.js` (new)
A tiny, framework-free coach:
- `startTour()` / `resumeTour()` — runs the step list from saved progress.
- A **step** = `{ id, anchor, text, placement, advanceOn, optional }` where `anchor` is a selector
  or a getter for the live element, `advanceOn` is an event name or a predicate, `placement` is
  top/bottom/left/right. Renders a positioned callout (arrow + text + `Next`/`Skip`), repositions on
  resize/scroll, and dims-but-doesn't-block the rest (a soft spotlight).
- **Progress** persisted to `localStorage['tinyarmy.tutorial.v1']` = `{ step, done, dismissed }`,
  so it survives refresh and won't repeat.
- **Event bus**: the tutorial subscribes to gameplay events. tiny.js already exposes the hooks we
  need — `onRosterChange` (hero created), `spawnWithFly` (spawned), `onEnemyDefeated`→`awardKill`
  (kills), the level-up draft, `setSheet` (sheet opened), `openForge`/`forgeSkillForHero` done,
  `openChat` (chat opened). We add a small `tutorialEmit(event)` at those points (one line each) so
  steps advance naturally.

## DECISION (locked): a **guided opt-in tour**, copy in **in-world game terminology**.
Frame the generation as fantasy ("forged anew", "a tale written just for them", "a voice all their
own", "made real from your words") — never "LLM / coding model / TTS". The AI is still the star;
it just wears a costume. (The wonder = uniqueness + that they're *alive*.)

## The flow (5 phases · ~11 steps) — game-flavored copy

### Phase 1 — Recruit a champion (generated persona + portrait + voice)
1. **Opener** (centered, dismissible): "Welcome, commander. Your champions aren't chosen from a
   roster — each is forged anew, body and soul. A quick tour?" `[Begin] [Skip]`.
2. **Create** — anchor the picker's `+ Create hero`: "Recruit your first champion." *advanceOn:
   create modal opens.*
3. **Recruit** — anchor class picker + Recruit: "Choose a calling and **Recruit** — their name and
   legend are written for them alone, here and now." *advanceOn: persona streamed (name appears).*
4. **Their face & voice** — anchor portrait + ▶: "A face all their own, and a voice to match. Bring
   them to the field." *advanceOn: `Next` (don't gate on a slow paint).* Then **Save & Play**.
   *advanceOn: hero spawns.*

### Phase 2 — Take the field (move · attack · dodge · level)
5. **Lead them** — anchor the joystick: "Lead them with the stick — or WASD." *advanceOn: moves.*
6. **Strike** — anchor ⚔: "Strike with ⚔ (or Space). Most foes fall in a blow or two — thin the
   ranks." *advanceOn: 3 kills.*
7. **Dodge** — anchor ⟲: "Roll with ⟲ (or Shift) to slip a blow — untouchable for a heartbeat."
   *advanceOn: a dodge, or `Next`.*
8. **Grow stronger** — fires on the level-up draft: "Victory makes them stronger. Choose a boon."
   *advanceOn: a card chosen.*

### Phase 3 — Forge a skill (made real from your words) ★
9. **Open their sheet** — anchor the ☰/**C** button: "Press **C** for your champion's sheet — their
   skills, story and voice." *advanceOn: sheet opens.*
10. **Forge** — anchor `⚒ Forge a new skill`: "Forge a skill from your own words — describe it and
    it's made real, unlike any other, with art of its own." *advanceOn: a skill forged.* Then anchor
    a bar slot: "Set it to a slot, then **hold 1/2/3 to aim, release to unleash** — it strikes all
    who stand near." *advanceOn: cast once.*

### Phase 4 — Speak with them (they remember + answer aloud) ★
11. **Talk** — anchor `💬 Talk to {name}`: "They remember every battle they've lived. Speak with
    them — and hear them answer (tap 🔊)." *advanceOn: a reply, or `Next`.* End: "Recruit, fight,
    forge, speak. The field is yours, commander." (one-time done flag.)

### Phase 5 — Payoff (passive, no coachmark)
- On the champion's first fall, the **after-action war-diary recap** is the closing flourish — they
  recount the run in their own voice. One-time caption: "Your champion penned this." It sells itself.

## Persistence, replay, controls
- `tinyarmy.tutorial.v1` tracks `{ step, done, dismissed }`. Done/dismissed → never auto-starts.
- A small `?` button (near ☰) and a **Settings → "Replay tutorial"** reset the flag and re-run.
- `Skip tour` on every callout sets `dismissed` (and can be undone via Replay).
- `Esc` dismisses the current callout (pauses, resumes next session unless done/dismissed).

## Build sequencing
1. `web/tutorial.js` coachmark engine (callout render + positioning + persistence + event bus).
2. Add the ~6 `tutorialEmit(...)` hooks in tiny.js / heroCreator / skillForge (one line each).
3. Author the step list + copy.
4. Settings "Replay tutorial" + the `?` help button.
5. Verify each step advances on its action and the whole thing is skippable + first-run only.

## Status
Decision locked: **guided opt-in tour, game-flavored copy** (above). Ready to build on approval.
