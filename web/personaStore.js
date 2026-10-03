// Local-first roster of saved heroes (personas-as-agents). Modeled on woid's Shelter
// store: a single JSON blob in localStorage, simple CRUD, change listeners, and a
// pluggable `sync` hook so a backend can push/pull later WITHOUT changing callers.
// Voice is stored as the design TEXT + quote (re-synthesized on replay) — the audio
// blob and cross-device sync are the backend's job (see the plan). Future persona data
// (stats, avatar, xp, relationships) just adds fields to the record.
//
// Progression (level/xp/kills, forged skills, chat history, an event log) is additive:
// `normalize()` default-fills the new fields on read so an existing v1 roster keeps
// working with no explicit migration step. See docs/rpg-progression-plan.md.
const KEY = 'tinyarmy.roster.v1'
const AKEY = 'tinyarmy.activeHeroId'
const CHRON = 'tinyarmy.chronicle.v1' // a shared, capped feed of notable deeds across all heroes

const listeners = new Set()
const activeListeners = new Set()
let _sync = null // optional { push(records), pull() } — wired to a backend later

// Default-fill the progression fields so old records (and partial saves) are always
// well-shaped. Additive only — never drops unknown fields.
function normalize(p) {
  if (!p) return p
  return {
    ...p,
    progression: { level: 1, xp: 0, kills: 0, attributePoints: 0, ...(p.progression || {}) },
    learnedSkills: Array.isArray(p.learnedSkills) ? p.learnedSkills : [],
    equippedSkills: Array.isArray(p.equippedSkills) ? p.equippedSkills : [],
    customSkills: p.customSkills && typeof p.customSkills === 'object' ? p.customSkills : {},
    chat: { history: Array.isArray(p.chat?.history) ? p.chat.history : [] },
    events: Array.isArray(p.events) ? p.events : [],
  }
}

function read() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); return Array.isArray(d.personas) ? d : { personas: [] } }
  catch { return { personas: [] } }
}
function write(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* quota / disabled */ }
  for (const fn of listeners) { try { fn(d.personas) } catch { /* ignore */ } }
  if (_sync && _sync.push) { try { _sync.push(d.personas) } catch { /* best-effort */ } }
}

const newId = () => 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export function listPersonas() { return read().personas.map(normalize) }
export function getPersona(id) { const p = read().personas.find((x) => x.id === id); return p ? normalize(p) : null }
export function onRosterChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function setSync(sync) { _sync = sync }

// Insert or update. Returns the stored record (with id + timestamps). Progression fields
// are carried from `p` when present, else preserved from the existing record, else defaulted —
// so saving a persona edit never wipes its level/skills/chat.
export function savePersona(p) {
  const d = read()
  const now = Date.now()
  const id = p.id || newId()
  const prev = d.personas.find((x) => x.id === id) || {}
  const pick = (k, dflt) => (p[k] !== undefined ? p[k] : (prev[k] !== undefined ? prev[k] : dflt))
  const rec = normalize({
    id,
    name: p.name || 'Unnamed hero',
    unitClass: p.unitClass || '',
    about: p.about || '',
    quote: p.quote || '',
    voice: p.voice || '',
    // Named voice for fixed-voice providers (Kokoro/Kitten/Web Speech); the design `voice`
    // text above is what Qwen3-TTS uses instead. Both are saved so a hero keeps its voice.
    voiceId: p.voiceId || '',
    specialty: p.specialty || '',
    personality: p.personality || '',
    vibe: p.vibe || '',
    seed: p.seed || '',
    // What the cached voice file (IndexedDB) was made for — so after a refresh we know
    // the audio is current (replay it) vs stale (re-make it), instead of always re-synthing.
    voiceQuote: p.voiceQuote || '',
    voiceDesignUsed: p.voiceDesignUsed || '',
    voiceIdUsed: p.voiceIdUsed || '',
    // Portrait: the editable appearance prompt + what the cached image (IndexedDB) was
    // made from, so a reload knows the image is current vs stale (re-generate it).
    appearance: p.appearance || '',
    portraitUsed: p.portraitUsed || '',
    // ── Progression (carried, not clobbered) ──
    progression: pick('progression', undefined),
    learnedSkills: pick('learnedSkills', undefined),
    equippedSkills: pick('equippedSkills', undefined),
    customSkills: pick('customSkills', undefined),
    chat: pick('chat', undefined),
    events: pick('events', undefined),
    createdAt: now,
    updatedAt: now,
  })
  const i = d.personas.findIndex((x) => x.id === id)
  if (i >= 0) { rec.createdAt = d.personas[i].createdAt; d.personas[i] = rec }
  else { d.personas.unshift(rec) }
  write(d)
  return rec
}

// Shallow-merge a partial update into a stored persona and persist. Use this for hot,
// frequent writes (XP on a kill, a chat turn) so a partial update never rebuilds — and
// never drops — the rest of the record. Returns the updated record or null if not found.
export function patchPersona(id, partial) {
  const d = read()
  const i = d.personas.findIndex((x) => x.id === id)
  if (i < 0) return null
  d.personas[i] = normalize({ ...d.personas[i], ...partial, id, updatedAt: Date.now() })
  write(d)
  return d.personas[i]
}

export function removePersona(id) {
  const d = read()
  const next = d.personas.filter((x) => x.id !== id)
  if (next.length !== d.personas.length) write({ personas: next })
  if (getActiveHeroId() === id) setActiveHeroId(null)
  for (const s of [STORE, PSTORE, ICONS, ART, CHATAUDIO]) _del(s, id)
}

// ── Active hero — the one roster member combat/chat/skills currently operate on ──
export function getActiveHeroId() { try { return localStorage.getItem(AKEY) || null } catch { return null } }
export function setActiveHeroId(id) {
  try { id ? localStorage.setItem(AKEY, id) : localStorage.removeItem(AKEY) } catch { /* ignore */ }
  for (const fn of activeListeners) { try { fn(id || null) } catch { /* ignore */ } }
}
export function getActiveHero() { const id = getActiveHeroId(); return id ? getPersona(id) : null }
export function onActiveHeroChange(fn) { activeListeners.add(fn); return () => activeListeners.delete(fn) }

// ── Chronicle — a shared world feed of notable deeds (fallen heroes' legends), newest first ──
export function addChronicle(entry) {
  try { const l = JSON.parse(localStorage.getItem(CHRON) || '[]'); l.unshift({ ...entry }); localStorage.setItem(CHRON, JSON.stringify(l.slice(0, 50))) } catch { /* ignore */ }
}
export function listChronicle() { try { return JSON.parse(localStorage.getItem(CHRON) || '[]') } catch { return [] } }

// ── Media store (IndexedDB — WAV + PNG blobs are too big for localStorage) ──────
// v3 adds skill icons, skill action-shot art, and per-message chat audio alongside
// the original voices + portraits stores.
const DB = 'tinyarmy', STORE = 'voices', PSTORE = 'portraits'
const ICONS = 'skillIcons', ART = 'skillArt', CHATAUDIO = 'chatAudio'
let _dbp = null
function db() {
  if (!_dbp) {
    _dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 3)
      r.onupgradeneeded = () => {
        const d = r.result
        for (const s of [STORE, PSTORE, ICONS, ART, CHATAUDIO]) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s)
        }
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  }
  return _dbp
}
// IndexedDB is a FAST LOCAL CACHE only — it's blocked/evicted inside the HF Space's cross-origin
// iframe. The durable copy lives SERVER-SIDE (/api/blob), keyed by the same id. Same-origin fetch
// works in the iframe; only browser storage is partitioned. So: write both (IDB best-effort +
// server durable); read IDB first, fall back to the server and re-cache.
async function _idbPut(store, id, blob) {
  try {
    const d = await db()
    await new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(blob, id); t.oncomplete = res; t.onerror = () => rej(t.error) })
  } catch { /* IDB unavailable (iframe) — server copy covers it */ }
}
async function _idbGet(store, id) {
  try {
    const d = await db()
    return await new Promise((res) => { const t = d.transaction(store, 'readonly'); const q = t.objectStore(store).get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) })
  } catch { return null }
}
async function _serverPut(store, id, blob) {
  try { await fetch(`/api/blob/${store}/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }) } catch { /* offline / best-effort */ }
}
async function _serverGet(store, id) {
  try { const r = await fetch(`/api/blob/${store}/${encodeURIComponent(id)}`); if (!r.ok) return null; const b = await r.blob(); return b && b.size ? b : null } catch { return null }
}
// In a storage-blocked iframe, indexedDB.open() can HANG forever (neither onsuccess nor onerror
// fires), so never AWAIT an IDB op on the critical path — it would stall the server write/read and
// nothing would persist. IDB is fire-and-forget cache; the awaited path is always the server.
const _withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))])
async function _put(store, id, blob) {
  _idbPut(store, id, blob)             // best-effort cache — NOT awaited (may hang in a blocked iframe)
  await _serverPut(store, id, blob)    // durable copy — the one we depend on
}
async function _get(store, id) {
  const local = await _withTimeout(_idbGet(store, id), 700) // cap IDB so a hang can't block the read
  if (local) return local
  const remote = await _serverGet(store, id)
  if (remote) { _idbPut(store, id, remote); return remote } // re-cache for next time
  return null
}
async function _del(store, id) {
  try { const d = await db(); d.transaction(store, 'readwrite').objectStore(store).delete(id) } catch { /* ignore */ }
  try { fetch(`/api/blob/${store}/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch { /* ignore */ }
}
export const putAudio = (id, blob) => _put(STORE, id, blob)
export const getAudio = (id) => _get(STORE, id)
export const putPortrait = (id, blob) => _put(PSTORE, id, blob)
export const getPortrait = (id) => _get(PSTORE, id)
// Skill media is keyed by skillId; chat audio by message id.
export const putSkillIcon = (skillId, blob) => _put(ICONS, skillId, blob)
export const getSkillIcon = (skillId) => _get(ICONS, skillId)
export const delSkillIcon = (skillId) => _del(ICONS, skillId)
export const putSkillArt = (skillId, blob) => _put(ART, skillId, blob)
export const getSkillArt = (skillId) => _get(ART, skillId)
export const putChatAudio = (msgId, blob) => _put(CHATAUDIO, msgId, blob)
export const getChatAudio = (msgId) => _get(CHATAUDIO, msgId)
