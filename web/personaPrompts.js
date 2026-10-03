// Tiny-Army persona + war-diary prompts (mirrors the Python prompts.py for the
// in-browser path). War-legend tone, not woid's.

// The default persona system prompt. Editable at runtime from the Settings page —
// see getPersonaSystem()/setPersonaSystem() below; personaPanel.js calls
// getPersonaSystem() so a saved override wins.
export const PERSONA_SYSTEM_DEFAULT =
  'You invent tiny heroes for a fantasy auto-battler called Tiny Army, where every ' +
  'fighter writes its own legend. Given a class and an optional seed, return ONE JSON ' +
  'object and NOTHING else, with exactly these keys:\n' +
  '  "name": a short evocative hero name (2-4 words),\n' +
  '  "about": 1-2 short sentences of backstory (about 25 words) in a heroic, wry war-legend tone,\n' +
  '  "quote": one short punchy line they say aloud — a battle-cry or wry remark, ' +
  'first person, under 15 words,\n' +
  '  "voice": one sentence describing how THIS hero sounds for a text-to-speech voice — ' +
  'pick a gender, age, pitch, accent, texture, pace and emotion that FIT their class and ' +
  'personality, and make it DISTINCT from a generic gruff soldier. Vary it widely between ' +
  'heroes — e.g. a bright quick-tongued young woman, a wheezing ancient sage, a velvet-smooth ' +
  'rogue, a booming jolly giant, a cold precise duelist, a sing-song forest spirit.\n' +
  'Output strictly valid JSON. No preamble, no code fences, no commentary.'

// Runtime-editable persona prompt (Settings page). A non-empty localStorage override
// replaces the default; clearing it falls back to PERSONA_SYSTEM_DEFAULT.
const PERSONA_PROMPT_KEY = 'tinyarmy.personaPrompt'
export function getPersonaSystem() {
  try { return localStorage.getItem(PERSONA_PROMPT_KEY) || PERSONA_SYSTEM_DEFAULT } catch { return PERSONA_SYSTEM_DEFAULT }
}
export function setPersonaSystem(text) {
  try {
    if (text && text.trim() && text.trim() !== PERSONA_SYSTEM_DEFAULT.trim()) localStorage.setItem(PERSONA_PROMPT_KEY, text)
    else localStorage.removeItem(PERSONA_PROMPT_KEY)
  } catch { /* storage blocked — just use the default */ }
}
export function resetPersonaSystem() { try { localStorage.removeItem(PERSONA_PROMPT_KEY) } catch { /* ignore */ } }
export function isPersonaSystemCustom() { try { return !!localStorage.getItem(PERSONA_PROMPT_KEY) } catch { return false } }

export const DIARY_SYSTEM =
  'You are a tiny hero in the auto-battler Tiny Army, writing a short first-person ' +
  'war-diary entry. Given your name and traits, write just 1-2 vivid sentences (about ' +
  '60 words, no more) in first person about a day on the battlefield — heroic, grounded, ' +
  'a touch of dark humor. Prose only: no headings, no lists, no preamble. Be brief.'

export function personaUserPrompt(unitClass = '', seed = '') {
  const s = seed && seed.trim() ? ` Seed inspiration: "${seed.trim()}".` : ''
  return `Class: ${(unitClass || 'hero').trim()}.${s} Return the JSON object now.`
}

export function diaryUserPrompt(unit = '', traits = '') {
  const u = (unit || 'a nameless hero').trim()
  const t = (traits || 'untested').trim()
  return `Name: ${u}. Traits: ${t}. Write the diary entry.`
}

// LIVE/streaming strip: hide the model's reasoning as it streams, including a still-open
// <think> block (so the reasoning doesn't flash in the preview mid-thought).
export function stripThink(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/^\s+/, '')
}

// FINAL strip (after generation is done): drop completed <think>…</think> blocks and any
// stray, never-closed <think>/</think> tags, but KEEP the answer that follows. Some models
// (Qwen3 on WebLLM/MLC) open <think> and jump straight to the answer WITHOUT ever closing
// it — the aggressive streaming strip above would delete the whole answer, so the parser
// saw 0 chars. This keeps it. Use this for parsing/final display, not for the live preview.
export function stripThinkFinal(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

// Qwen3 is a thinking model: left alone it burns the whole token budget on a
// <think> block and never reaches the JSON/answer.
export const isThinking = (modelId) => /qwen3/i.test(String(modelId || ''))

// `/no_think` soft-switch tells Qwen3 to skip reasoning. llama.cpp/Transformers.js
// honour it (the model finishes in a few tokens); WebLLM's MLC template does NOT
// reliably, so we ALSO budget extra tokens (see thinkMaxTokens) for those — enough to
// reason AND still finish the answer. No-op for non-thinking models.
export const noThink = (modelId) => (isThinking(modelId) ? ' /no_think' : '')

// Token budget: thinking models may spend the budget reasoning, so give them headroom
// to still complete the answer. (When /no_think works, they stop early anyway.)
export const thinkMaxTokens = (modelId, base) => (isThinking(modelId) ? Math.max(base, 768) : base)
