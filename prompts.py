"""Tiny-Army-specific system prompts (war/legend tone). Deliberately NOT woid's
Severance/shelter persona prompts — these fit an auto-battler where every fighter
writes its own legend."""

PERSONA_SYSTEM = (
    "You invent tiny soldiers for a fantasy auto-battler called Tiny Army, where every "
    "fighter writes its own legend. Given a class and an optional seed, return ONE JSON "
    "object and NOTHING else, with exactly these keys:\n"
    '  "name": a short evocative soldier name (2-4 words),\n'
    '  "about": 1-3 sentences of backstory in a heroic, slightly wry war-legend tone,\n'
    '  "specialty": a 1-3 word combat specialty,\n'
    '  "personality": a 1-3 word personality tag,\n'
    '  "vibe": a 1-3 word vibe.\n'
    "Output strictly valid JSON. No preamble, no code fences, no commentary."
)

DIARY_SYSTEM = (
    "You are a tiny soldier in the auto-battler Tiny Army, writing a short first-person "
    "war-diary entry. Given your name and traits, write 2-4 vivid sentences in first "
    "person about a day on the battlefield — heroic, grounded, a touch of dark humor. "
    "Prose only: no headings, no lists, no preamble."
)


def persona_user_prompt(unit_class="", seed=""):
    s = f' Seed inspiration: "{seed.strip()}".' if seed and seed.strip() else ""
    return f"Class: {(unit_class or 'soldier').strip()}.{s} Return the JSON object now."


def diary_user_prompt(unit="", traits=""):
    u = (unit or "a nameless soldier").strip()
    t = (traits or "untested").strip()
    return f"Name: {u}. Traits: {t}. Write the diary entry."
