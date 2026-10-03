// Shared hero-creator — the recruit/stream/edit experience used by BOTH the Personas page
// (personaPanel.js, which adds a barracks roster around it) and the Game page's "Create a hero"
// modal (tiny.js). Renders the two-column `.persona-view` (class/seed/recruit controls on the left,
// streamed name/about/quote + voice + portrait on the right), runs the whole generation pipeline
// (local LLM → JSON persona, image engine → portrait, TTS → voice) and autosaves to the roster.
//
//   const creator = mountHeroCreator(host, { extraControls, onSaved })
//   creator.load(persona, { savedId })   // show an existing hero for editing
//   creator.current()                    // { persona, savedId }
import { streamChat, ensureModel, currentModel, currentModelId, getEngineId, backendLabel } from '/web/runtime.js'
import { extractLivePersona } from '/web/personaStream.js'
import { parsePersonaJson } from '/web/personaParse.js'
import { getPersonaSystem, personaUserPrompt, stripThink, stripThinkFinal, noThink } from '/web/personaPrompts.js'
import {
  createVoiceWav, cloneVoiceWav, playWav, synthVoiceWav, speakVoiceLive, stopVoiceLive,
  activeEngineIsDesign, activeEngineIsNative, activeVoices, activeDefaultVoice, onTtsEngineChange, ttsBackendLabel,
} from '/web/tts.js'
import { listPersonas, savePersona, removePersona, onRosterChange, putAudio, getAudio, putPortrait, getPortrait } from '/web/personaStore.js'
import { generatePortrait, imageBackendLabel, imageNeedsDownload, ensureImage, portraitGenerationAvailable } from '/web/imagen.js'
import { withElapsed } from '/web/elapsed.js'

const CLASSES = ['Warrior', 'Ranger', 'Monk', 'Assassin', 'Mage', 'Paladin', 'Cleric', 'Knight']
const MAX_TOKENS = 200 // persona JSON + a voice line + a quote

// Each class shows the idle pose of a fitting sprite (character slug → see
// characters.json). The sheet's front-right row is animated as a tiny looping
// icon beside the class name in the dropdown.
export const CLASS_SLUG = {
  Warrior: 'true-heroes-iii-fighter',
  Ranger: 'true-heroes-iii-ranger',
  Monk: 'true-heroes-ii-bard',
  Assassin: 'true-heroes-iv-ninja-assassin',
  Mage: 'true-heroes-iii-wizard',
  Paladin: 'true-heroes-ii-paladin',
  Cleric: 'true-heroes-ii-cleric',
  Knight: 'rts-humans-knight',
}
const ICON_PX = 30        // on-screen size of the class icon box
const ICON_ZOOM = 2.4     // sheets pad the character inside each cell — zoom in so it fills the box
const spriteUrl = (u) => (u || '').replace('/assets/', '/sprites/') // sheets serve at /sprites

function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid)
  return n
}

// Idle sheets are 4 rows (facings) × N frame columns; cell = height/4. We render
// the front-right row (row 0) and step across the columns to loop the idle — no
// canvas, just a sized background + the Web Animations API.
export function animateIdleIcon(box, idleUrl, sizePx = ICON_PX) {
  box.getAnimations?.().forEach((a) => a.cancel())
  box.style.backgroundImage = ''
  const img = new Image()
  img.onload = () => {
    const cell = (img.naturalHeight / 4) || img.naturalHeight
    const cols = Math.max(1, Math.round(img.naturalWidth / cell))
    const rows = Math.max(1, Math.round(img.naturalHeight / cell))
    const cellPx = sizePx * ICON_ZOOM                  // zoomed on-screen cell size (fills the box)
    const off = (cellPx - sizePx) / 2                  // inset to centre the box on a cell
    box.style.backgroundImage = `url("${idleUrl}")`
    box.style.backgroundSize = `${cols * cellPx}px ${rows * cellPx}px`
    const y = `-${off}px`                              // row 0, vertically centred
    box.animate(
      [{ backgroundPosition: `-${off}px ${y}` }, { backgroundPosition: `-${cols * cellPx + off}px ${y}` }],
      { duration: cols * 110, iterations: Infinity, easing: `steps(${cols})` },
    )
  }
  img.src = idleUrl
}

// A class picker that mirrors a native <select> API (.value get/set, 'change'
// event) but renders an animated idle icon beside each class.
function makeClassDropdown(classes) {
  const triggerIco = el('span', { class: 'persona-class-ico' })
  const triggerLabel = el('span', { class: 'persona-classdrop-label' })
  const trigger = el('button', { class: 'persona-input persona-classdrop-trigger', type: 'button' },
    [triggerIco, triggerLabel, el('span', { class: 'persona-classdrop-chev' }, '▾')])
  const menu = el('div', { class: 'persona-classdrop-menu' })
  const root = el('div', { class: 'persona-classdrop' }, [trigger, menu])

  let value = classes[0]
  let icons = {}            // class → idle sheet URL (filled by setIcons)
  const optIco = {}         // class → menu icon span

  const items = classes.map((c) => {
    const ico = el('span', { class: 'persona-class-ico' }); optIco[c] = ico
    const it = el('button', { class: 'persona-classdrop-opt', type: 'button' }, [ico, el('span', {}, c)])
    it.addEventListener('click', () => { set(c); close() })
    return it
  })
  menu.append(...items)

  function set(c) {
    if (!classes.includes(c)) return
    const changed = c !== value
    value = c
    triggerLabel.textContent = c
    items.forEach((it, i) => it.classList.toggle('sel', classes[i] === c))
    if (icons[c]) animateIdleIcon(triggerIco, icons[c])
    if (changed) root.dispatchEvent(new Event('change'))
  }
  const close = () => root.classList.remove('open')
  trigger.addEventListener('click', (e) => { e.stopPropagation(); root.classList.toggle('open') })
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })

  root.setIcons = (map) => {
    icons = map
    for (const c of classes) if (map[c]) animateIdleIcon(optIco[c], map[c])
    if (map[value]) animateIdleIcon(triggerIco, map[value])
  }
  Object.defineProperty(root, 'value', { get: () => value, set: (v) => set(v) })
  triggerLabel.textContent = value
  items.forEach((it, i) => it.classList.toggle('sel', classes[i] === value))
  return root
}

// Resolve each class's idle sheet via characters.json and light up the dropdown.
async function loadClassIcons(dropdown) {
  try {
    const d = await fetch('/sprites/characters.json').then((r) => r.json())
    const bySlug = {}
    for (const p of d.packs || []) for (const c of p.characters || []) bySlug[c.slug] = c
    const map = {}
    for (const [cls, slug] of Object.entries(CLASS_SLUG)) {
      const idle = bySlug[slug]?.idle
      if (idle) map[cls] = spriteUrl(idle)
    }
    dropdown.setIcons(map)
  } catch { /* no icons — the dropdown still works with labels only */ }
}

// Mount the creator into `host`. `opts.extraControls` (DOM) is appended into the controls aside
// (the Personas page passes its barracks roster here). `opts.onSaved(rec)` fires after every
// autosave (generate + inline edits + portrait/voice), so the host can refresh a roster, enable a
// "Save & Play" button, etc. Returns a controller (load / current / reset / stop).
export function mountHeroCreator(host, opts = {}) {
  const DEFAULT_STATUS = 'Runs on your device — no cloud.'
  const sel = makeClassDropdown(CLASSES)
  loadClassIcons(sel)
  const seed = el('input', { class: 'persona-input', type: 'text', placeholder: 'a word, a vibe… (optional)' })
  const stats = el('div', { class: 'persona-stats' })
  const status = el('div', { class: 'persona-status' }, DEFAULT_STATUS)
  const btn = el('button', { class: 'persona-go', type: 'button', 'data-tut': 'recruit' }, '⚔ Recruit hero')

  const nameEl = el('div', { class: 'persona-name persona-edit', 'data-ph': 'Name' })
  const aboutEl = el('div', { class: 'persona-about persona-edit', 'data-ph': 'Their story…' })
  const quoteEl = el('blockquote', { class: 'persona-quote persona-edit', 'data-ph': 'A line they say…' })
  const voiceEl = el('div', { class: 'persona-voice-desc persona-edit', 'data-ph': 'How they sound…' })
  const voicePickEl = el('select', { class: 'persona-input persona-voice-pick' })
  const voicePickRow = el('div', { class: 'persona-voice-pick-row' },
    [el('label', { class: 'persona-label' }, 'Voice'), voicePickEl])
  const playBtn = el('button', { class: 'persona-ico persona-play', type: 'button', title: 'Play voice', 'data-tut': 'voice' }, '▶')
  const voiceStatus = el('span', { class: 'persona-act-status' })       // "generating voice via …" beside ▶
  const appearanceEl = el('div', { class: 'persona-appearance persona-edit', 'data-ph': 'How they look…' })
  const portraitBtn = el('button', { class: 'persona-ico persona-portrait-btn', type: 'button', title: 'Paint portrait', 'data-tut': 'portrait' }, '🎨')
  const portraitStatus = el('span', { class: 'persona-act-status' })    // "painting via …" beside 🎨
  const portraitImg = el('img', { class: 'persona-portrait-img', alt: '' })
  const portraitWrap = el('div', { class: 'persona-portrait-wrap' }, [portraitImg])
  // The general status line + token rate live INSIDE the debug section (only per-action voice/portrait
  // notes show beside their buttons). No copy button.
  const thinkEl = el('pre', { class: 'persona-think' })
  const thinkWrap = el('details', { class: 'persona-think-wrap' },
    [el('summary', {}, 'model output / debug (raw)'), status, stats, thinkEl])

  // Plain section header (top line + small heading) with an optional right-side action.
  const secHead = (title, action) =>
    el('div', { class: 'persona-sec' }, [el('div', { class: 'persona-sec-title' }, title), action || el('span')])
  // Header whose action is a create button with an inline status note to its RIGHT (full model name).
  const actionHead = (title, button, note) =>
    el('div', { class: 'persona-sec' }, [el('div', { class: 'persona-sec-title' }, title), el('div', { class: 'persona-sec-action' }, [button, note])])

  const backBtn = el('button', { class: 'persona-back', type: 'button' }, '← Back')
  // Optional barracks roster (saved heroes) — always visible in the left column when enabled.
  const rosterEl = opts.showBarracks ? el('div', { class: 'persona-roster' }) : null
  const barracksEl = opts.showBarracks
    ? el('div', { class: 'persona-barracks' }, [el('label', { class: 'persona-label persona-roster-label' }, 'Barracks (saved)'), rosterEl])
    : null

  // Left column has two states. STATE A (recruit): class + seed + Recruit. STATE B (a hero exists): a
  // portrait panel — placeholder/image + 🎨 paint button & badge + the editable appearance prompt. The
  // barracks (if any) and the model-output debug are shown in BOTH states; the debug is anchored bottom.
  const recruitBox = el('div', { class: 'persona-recruit-box' }, [
    el('label', { class: 'persona-label' }, 'Class'), sel,
    el('label', { class: 'persona-label' }, 'Seed'), seed,
    btn,
  ])
  const portraitBox = el('div', { class: 'persona-portrait-panel' }, [
    actionHead('Portrait', portraitBtn, portraitStatus),
    portraitWrap,
    appearanceEl,
  ])
  if (!portraitGenerationAvailable()) {
    portraitBtn.hidden = true
    portraitStatus.hidden = true
  }
  const controls = el('aside', { class: 'persona-controls' }, [
    recruitBox, portraitBox, barracksEl, thinkWrap,
  ])
  const emptyEl = el('div', { class: 'persona-empty' }, opts.emptyText || 'Every legend starts here — pick a class and recruit your hero.')
  const bodyEl = el('div', { class: 'persona-body' }, [
    nameEl,
    secHead('About'), aboutEl,
    actionHead('Quote', playBtn, voiceStatus), quoteEl,
    secHead('Voice design'), voiceEl, voicePickRow,
  ])
  const result = el('div', { class: 'persona-result' }, [emptyEl, bodyEl])
  const view = el('div', { class: 'persona-view' }, [controls, result])
  host.appendChild(view)

  // Back button: in the host-provided footer slot (the Game modal) or, by default, at the top of the
  // portrait panel. It RESETS the creator and returns to the recruit state; only shown in STATE B.
  if (opts.backSlot) opts.backSlot.prepend(backBtn)
  else portraitBox.prepend(backBtn)
  backBtn.addEventListener('click', () => resetAll())

  function setLeftState(s) {
    const portrait = s === 'portrait'
    recruitBox.style.display = portrait ? 'none' : ''
    portraitBox.style.display = portrait ? '' : 'none'
    backBtn.style.display = portrait ? '' : 'none'
    if (barracksEl) barracksEl.style.display = portrait ? 'none' : '' // barracks only in the recruit state
    try { opts.onState?.(s) } catch { /* host hook */ }
  }
  setLeftState('recruit')

  let lastPersona = null  // the persona currently shown
  let savedId = null      // its roster id (set the moment it's shown — always saved)
  let hasVoice = false    // a cached voice file exists for this persona
  let hasPortrait = false // a cached portrait exists for this persona
  let portraitBusy = false
  let portraitUrl = null  // object URL for the shown image (revoked on replace)
  let working = false
  let busy = false
  let playing = false     // audio is currently sounding (▶ becomes ⏹)

  const fireSaved = (rec) => { try { opts.onSaved?.(rec, { persona: lastPersona, savedId }) } catch { /* host hook */ } }

  function setPlaying(on) {
    playing = on
    playBtn.classList.toggle('playing', on)
    playBtn.textContent = on ? '⏹' : '▶'
    if (on) playBtn.title = 'Stop'
    else updateVoiceUI()
  }
  function stopVoice() { stopVoiceLive(); setPlaying(false) }
  async function playBuf(arrayBuffer) {
    setPlaying(true)
    try { await playWav(arrayBuffer) } catch { /* autoplay blocked / cut short */ }
    finally { setPlaying(false) }
  }

  function refreshVisibility() {
    const show = !!lastPersona || busy
    bodyEl.style.display = show ? '' : 'none'
    emptyEl.style.display = show ? 'none' : ''
  }
  refreshVisibility()

  const lineFor = (p) => (p.quote || '').trim() || (p.about || '').trim() || `${p.name || 'A hero'} reporting for duty.`
  const isDesign = () => activeEngineIsDesign()
  const isNative = () => activeEngineIsNative()
  const voiceNow = () => (isDesign() ? (lastPersona?.voice || '') : (lastPersona?.voiceId || ''))
  const voiceUsed = () => (isDesign() ? (lastPersona?.voiceDesignUsed || '') : (lastPersona?.voiceIdUsed || ''))
  const isDirty = () => !isNative() && hasVoice && lastPersona && (lineFor(lastPersona) !== lastPersona.voiceQuote || voiceNow() !== voiceUsed())
  const designChanged = () => isDesign() && hasVoice && lastPersona && (lastPersona.voice || '') !== (lastPersona.voiceDesignUsed || '')
  function updateVoiceUI() {
    const needs = !!lastPersona && !isNative() && (!hasVoice || isDirty())
    playBtn.classList.toggle('badged', needs)
    if (playing) return
    playBtn.title = (!lastPersona || isNative()) ? 'Play voice' : (!hasVoice ? 'Create voice' : (isDirty() ? 'Update & play' : 'Play voice'))
  }

  function refreshVoiceMode() {
    const design = isDesign()
    voiceEl.contentEditable = design ? 'true' : 'false'
    voiceEl.classList.toggle('readonly', !design)
    voiceEl.setAttribute('data-ph', design ? 'How they sound…' : '(only used by Qwen3-TTS Voice Design)')
    voicePickRow.style.display = design ? 'none' : ''
    if (!design) {
      const voices = activeVoices()
      voicePickEl.replaceChildren(...voices.map((v) => el('option', { value: v.id }, v.label)))
      let cur = (lastPersona && lastPersona.voiceId) || activeDefaultVoice()
      if (!voices.some((v) => v.id === cur)) cur = voices[0] ? voices[0].id : ''
      voicePickEl.value = cur
      if (lastPersona) lastPersona.voiceId = cur
    }
  }
  voicePickEl.addEventListener('change', () => {
    if (!lastPersona) return
    lastPersona.voiceId = voicePickEl.value
    autosave(); updateVoiceUI()
  })
  onTtsEngineChange(() => { stopVoice(); if (lastPersona) { refreshVoiceMode(); updateVoiceUI() } })

  function autosave() {
    if (!lastPersona) return
    const rec = savePersona({ ...lastPersona, id: savedId, unitClass: lastPersona.unitClass || sel.value, seed: lastPersona.seed || seed.value })
    savedId = rec.id
    fireSaved(rec)
  }

  function editable(elm, field, { single = false } = {}) {
    elm.contentEditable = 'true'
    elm.spellcheck = false
    if (single) elm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); elm.blur() } })
    if (field === 'quote' || field === 'voice') {
      elm.addEventListener('input', () => { if (lastPersona) { lastPersona[field] = elm.textContent.trim(); updateVoiceUI() } })
    }
    elm.addEventListener('blur', () => {
      if (!lastPersona) return
      lastPersona[field] = elm.textContent.trim()
      autosave(); updateVoiceUI()
    })
  }
  editable(nameEl, 'name', { single: true })
  editable(aboutEl, 'about')
  editable(quoteEl, 'quote', { single: true })
  editable(voiceEl, 'voice')

  // ── Portrait ──────────────────────────────────────────────────────────────
  const PORTRAIT_STYLE = 'Fantasy hero character portrait, painterly digital art, dramatic lighting, head and shoulders, detailed face, plain background.'
  const buildAppearance = (p) => [
    [p.name, p.unitClass && `a ${p.unitClass}`].filter(Boolean).join(', '),
    (p.about || '').trim(),
  ].filter(Boolean).join('. ')
  const appearanceFor = (p) => (p.appearance || '').trim() || buildAppearance(p)
  const portraitDirty = () => hasPortrait && lastPersona && appearanceFor(lastPersona) !== (lastPersona.portraitUsed || '')

  function setPortrait(blob) {
    if (portraitUrl) { try { URL.revokeObjectURL(portraitUrl) } catch { /* ignore */ } }
    portraitUrl = blob ? URL.createObjectURL(blob) : null
    portraitImg.src = portraitUrl || ''
    portraitWrap.classList.toggle('has-img', !!blob)
  }
  function updatePortraitUI() {
    // Paintable when there's no portrait yet, or the appearance changed since the last one. When the
    // portrait already matches the definition, repainting is disabled (nothing to redo).
    const paintable = !!lastPersona && (!hasPortrait || portraitDirty())
    portraitBtn.classList.toggle('badged', portraitGenerationAvailable() && paintable)
    portraitBtn.hidden = !portraitGenerationAvailable()
    portraitBtn.disabled = !portraitGenerationAvailable() || portraitBusy || (!!lastPersona && !paintable)
    portraitBtn.title = !lastPersona ? 'Paint portrait' : (!hasPortrait ? 'Paint portrait' : (portraitDirty() ? 'Repaint portrait' : 'Portrait is up to date'))
  }
  appearanceEl.contentEditable = 'true'; appearanceEl.spellcheck = false
  appearanceEl.addEventListener('input', () => { if (lastPersona) { lastPersona.appearance = appearanceEl.textContent.trim(); updatePortraitUI() } })
  appearanceEl.addEventListener('blur', () => { if (!lastPersona) return; lastPersona.appearance = appearanceEl.textContent.trim(); autosave(); updatePortraitUI() })

  async function makePortrait() {
    if (!portraitGenerationAvailable() || portraitBusy || !lastPersona) return
    if (hasPortrait && !portraitDirty()) return // no change to the appearance — don't repaint
    autosave() // ensure an id to key the image
    const appearance = appearanceFor(lastPersona)
    portraitBusy = true; portraitBtn.classList.add('busy'); portraitBtn.disabled = true
    try {
      if (imageNeedsDownload()) {
        portraitStatus.textContent = 'loading model…'
        await ensureImage((f) => { portraitStatus.textContent = `downloading model… ${Math.round(f * 100)}%` })
      }
      // Ticking elapsed counter so a slow (~12s) ZeroGPU paint reads as "working", not stuck.
      const blob = await withElapsed((t) => { portraitStatus.textContent = t }, `painting via ${imageBackendLabel()}…`, generatePortrait(`${appearance}. ${PORTRAIT_STYLE}`, { seed: 42 }))
      await putPortrait(savedId, blob)
      lastPersona.appearance = appearance; lastPersona.portraitUsed = appearance
      hasPortrait = true; setPortrait(blob); autosave()
      try { opts.onPortrait?.() } catch { /* host hook */ }
      portraitStatus.textContent = ''
    } catch (e) { portraitStatus.textContent = `failed: ${e.message || e}` }
    finally { portraitBusy = false; portraitBtn.classList.remove('busy'); portraitBtn.disabled = false; updatePortraitUI() }
  }
  portraitBtn.addEventListener('click', makePortrait)

  async function showPersona(p, o = {}) {
    stopVoice() // picking another hero cuts the current voice
    lastPersona = { ...p }
    savedId = o.savedId || null
    nameEl.textContent = p.name || ''
    aboutEl.textContent = p.about || ''
    quoteEl.textContent = p.quote || ''
    voiceEl.textContent = p.voice || ''
    appearanceEl.textContent = p.appearance || buildAppearance(p)
    hasVoice = savedId && p.voiceQuote ? !!(await getAudio(savedId)) : false
    let pblob = null
    hasPortrait = savedId && p.portraitUsed ? !!(pblob = await getPortrait(savedId)) : false
    setPortrait(pblob)
    refreshVoiceMode(); updateVoiceUI(); updatePortraitUI(); refreshVisibility()
    setLeftState('portrait') // a hero exists → show the portrait panel in place of class/recruit
  }

  async function play() {
    if (playing) { stopVoice(); return }
    if (working || !lastPersona) return
    const line = lineFor(lastPersona)

    if (isNative()) {
      setPlaying(true)
      try { await speakVoiceLive(lastPersona.voiceId || '', line) }
      catch (e) { voiceStatus.textContent = `failed: ${e.message || e}` }
      finally { setPlaying(false) }
      return
    }

    if (hasVoice && !isDirty()) {
      const blob = savedId ? await getAudio(savedId) : null
      if (blob) { await playBuf(await blob.arrayBuffer()); return }
      hasVoice = false
    }
    if (isDesign() && !lastPersona.voice) { voiceStatus.textContent = 'add a voice design first'; return }
    autosave() // ensure an id to key the audio

    const design = isDesign()
    const reclone = design && hasVoice && !designChanged()
    working = true; playBtn.classList.add('busy'); playBtn.disabled = true
    const verb = reclone ? 'updating' : (design ? 'designing' : 'generating')
    const prefix = `${verb} voice via ${ttsBackendLabel()}…`
    const setVS = (t) => { voiceStatus.textContent = t }
    let wav = null
    try {
      if (design && reclone) {
        const blob = await getAudio(savedId)
        wav = await withElapsed(setVS, prefix, cloneVoiceWav(await blob.arrayBuffer(), lastPersona.voiceQuote || '', line, lastPersona.voice || ''))
      } else if (design) {
        wav = await withElapsed(setVS, prefix, createVoiceWav(lastPersona.voice, line))
      } else {
        wav = await withElapsed(setVS, prefix, synthVoiceWav(lastPersona.voiceId || '', line))
      }
      await putAudio(savedId, new Blob([wav], { type: 'audio/wav' }))
      lastPersona.voiceQuote = line
      lastPersona.voiceDesignUsed = lastPersona.voice || ''
      lastPersona.voiceIdUsed = lastPersona.voiceId || ''
      hasVoice = true; autosave()
      try { opts.onVoice?.() } catch { /* host hook */ }
      voiceStatus.textContent = ''
    } catch (e) { voiceStatus.textContent = `failed: ${e.message || e}` }
    finally { working = false; playBtn.classList.remove('busy'); playBtn.disabled = false; updateVoiceUI() }
    if (wav) await playBuf(wav.slice(0))
  }
  playBtn.addEventListener('click', play)

  try {
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) { if (playing) stopVoice() }
        else if (lastPersona) { refreshVoiceMode(); updateVoiceUI() }
      }
    }).observe(host)
  } catch { /* no IntersectionObserver — playback just won't auto-stop on nav */ }

  // ← Back: wipe every field and return to a blank recruit state.
  function resetAll() {
    stopVoice()
    lastPersona = null; savedId = null; hasVoice = false; hasPortrait = false
    nameEl.textContent = ''; aboutEl.textContent = ''; quoteEl.textContent = ''
    voiceEl.textContent = ''; appearanceEl.textContent = ''
    setPortrait(null)
    voiceStatus.textContent = ''; portraitStatus.textContent = ''
    stats.textContent = ''; status.textContent = DEFAULT_STATUS; thinkEl.textContent = ''; thinkWrap.open = false
    updateVoiceUI(); updatePortraitUI(); refreshVisibility(); setLeftState('recruit')
  }

  // ── Barracks (saved heroes) — clicking one loads it for editing; always visible when enabled. ──
  function renderRoster(personas) {
    if (!rosterEl) return
    if (!personas.length) { rosterEl.replaceChildren(el('div', { class: 'persona-roster-empty' }, 'No heroes saved yet.')); return }
    rosterEl.replaceChildren(...personas.map((p) =>
      el('div', { class: 'persona-roster-item' + (p.id === savedId ? ' active' : '') }, [
        el('button', { class: 'persona-roster-name', type: 'button', title: 'View', onclick: () => showPersona(p, { savedId: p.id }).then(() => renderRoster(listPersonas())) },
          `${p.name || 'Hero'}${p.unitClass ? ` · ${p.unitClass}` : ''}`),
        el('button', { class: 'persona-roster-x', type: 'button', title: 'Remove', onclick: () => removePersona(p.id) }, '🗑'),
      ])))
  }
  if (opts.showBarracks) { renderRoster(listPersonas()); onRosterChange(renderRoster) }

  async function generate() {
    if (busy) return
    busy = true; btn.disabled = true
    setLeftState('portrait') // swap the left column to the portrait panel the moment we start
    refreshVisibility()
    if (window.innerWidth <= 768) result.scrollIntoView({ behavior: 'smooth', block: 'start' })
    nameEl.textContent = '…'; aboutEl.textContent = ''
    quoteEl.textContent = ''; voiceEl.textContent = ''; appearanceEl.textContent = ''
    lastPersona = null; savedId = null; hasVoice = false; hasPortrait = false
    stopVoice(); setPortrait(null); voiceStatus.textContent = ''; portraitStatus.textContent = ''; updateVoiceUI(); updatePortraitUI()
    thinkEl.textContent = ''; stats.textContent = '' // debug stays COLLAPSED — status/tokens update inside it
    let acc = ''
    try {
      status.textContent = `loading ${currentModel().label}…`
      await ensureModel((frac, label) => { status.textContent = label || `downloading ${currentModel().label}… ${Math.round(frac * 100)}% (one-time)` })
      status.textContent = `writing on your device with ${currentModel().label}…`
      await streamChat(getPersonaSystem(), personaUserPrompt(sel.value, seed.value) + noThink(currentModelId()), {
        maxTokens: MAX_TOKENS,
        onToken: (piece) => {
          acc += piece
          thinkEl.textContent = acc; thinkEl.scrollTop = thinkEl.scrollHeight
          const live = extractLivePersona(stripThink(acc))
          if (live.name) nameEl.textContent = live.name
          if (live.about) aboutEl.textContent = live.about
        },
        onStats: (s) => { stats.textContent = `● ${s.tokPerSec} tok/s · ${s.tokens} tok${s.ttftSeconds != null ? ` · first ${s.ttftSeconds}s` : ''}` },
      })
      try {
        const p = parsePersonaJson(stripThinkFinal(acc))
        await showPersona(p)
        autosave()                  // generated personas are saved immediately (no Save button)
        status.textContent = 'enlisted ✓ (saved) — edit any field, or create a voice'
      } catch (e) {
        status.textContent = `the model rambled — couldn't parse a clean persona (${e.message || e})`
        setLeftState('recruit') // back to recruit so they can retry
      }
    } catch (e) {
      status.textContent = `couldn't run the local model: ${e.message || e}`
      setLeftState('recruit')
    } finally { busy = false; btn.disabled = false; refreshVisibility() }
  }
  btn.addEventListener('click', generate)

  return {
    root: view,
    load: (p, o = {}) => showPersona(p, o),
    current: () => ({ persona: lastPersona, savedId }),
    reset: resetAll,
    stop: stopVoice,
  }
}
