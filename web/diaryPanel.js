// War-diary panel — vanilla DOM, mounted into #diary-stage. Streams a first-person
// diary entry generated ON THE USER'S DEVICE via the LLM facade, and can READ IT ALOUD
// on the user's device too (Kokoro / Kitten / Web Speech via the TTS facade). Shares
// the persona styling (.persona-*), the model picker, and tok/s stats.
import { streamChat, ensureModel, currentModel, currentModelId, getEngineId, backendLabel } from '/web/runtime.js'
import { makeNarrator, ensureTts, setVoiceDescription, getAutoNarrate } from '/web/tts.js'
import { DIARY_SYSTEM, diaryUserPrompt, stripThinkFinal, noThink } from '/web/personaPrompts.js'

const MAX_TOKENS = 100 // short diary entries — cap matches the "~60 words" prompt

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

export function mountDiaryPanel(host) {
  const unit = el('input', { class: 'persona-input', type: 'text', value: 'Bram the Warrior' })
  const traits = el('input', { class: 'persona-input', type: 'text', value: 'Cautious, Veteran, Vengeful' })
  const stats = el('div', { class: 'persona-stats' })
  const status = el('div', { class: 'persona-status' }, 'Runs on your device — no cloud.')
  const btn = el('button', { class: 'persona-go', type: 'button' }, '✒ Write war diary')
  const narrateBtn = el('button', { class: 'persona-go persona-go-alt', type: 'button' }, '🔊 Read aloud')
  const ttsStatus = el('div', { class: 'persona-status tts-status' })
  const out = el('div', { class: 'persona-about' }, 'A first-person diary entry, written by a small model in your browser — and read aloud on your device.')
  const dbgEl = el('pre', { class: 'persona-think' })
  const copyBtn = el('button', { class: 'persona-copy', type: 'button' }, '📋 Copy debug')
  const dbgWrap = el('details', { class: 'persona-think-wrap' }, [el('summary', {}, 'model output / debug (raw)'), copyBtn, dbgEl])

  const controls = el('aside', { class: 'persona-controls' }, [
    el('label', { class: 'persona-label' }, 'Unit'), unit,
    el('label', { class: 'persona-label' }, 'Traits'), traits,
    btn, stats, status,
    narrateBtn, ttsStatus,
  ])
  const result = el('div', { class: 'persona-result' }, [out, dbgWrap])
  host.appendChild(el('div', { class: 'persona-view' }, [controls, result]))

  let lastDebug = ''
  function buildDebug(outcome, raw) {
    return [
      '=== TINY ARMY · DIARY DEBUG ===',
      `engine:   ${getEngineId()} · ${backendLabel()}`,
      `model:    ${currentModelId()} (${currentModel().label})`,
      `input:    unit=${unit.value} traits=${traits.value} maxTokens=${MAX_TOKENS}`,
      `outcome:  ${outcome}`,
      `--- raw output (${(raw || '').length} chars) ---`,
      raw || '(empty)',
    ].join('\n')
  }
  copyBtn.addEventListener('click', async () => {
    const text = lastDebug || buildDebug('(no generation yet)', '')
    try {
      await navigator.clipboard.writeText(text)
      copyBtn.textContent = '✓ copied'; setTimeout(() => { copyBtn.textContent = '📋 Copy debug' }, 1600)
    } catch {
      dbgEl.textContent = text; dbgWrap.open = true
      const r = document.createRange(); r.selectNodeContents(dbgEl)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      copyBtn.textContent = 'selected ↓ — ⌘/Ctrl+C'
    }
  })

  let busy = false
  let lastBody = '' // diary text (no header), what gets narrated
  let narrator = null
  let speaking = false

  function setSpeaking(on) {
    speaking = on
    narrateBtn.textContent = on ? '⏹ Stop reading' : '🔊 Read aloud'
  }
  function stopNarration() { if (narrator) narrator.stop() }

  // Ensure the TTS model is loaded (showing progress), then return a fresh narrator.
  async function makeReadyNarrator() {
    // For Qwen3-TTS's "persona voice", design a voice from this unit's traits.
    setVoiceDescription(`A war-weary hero's voice — ${(traits.value || 'battle-hardened').trim()}.`)
    ttsStatus.textContent = 'loading voice…'
    await ensureTts((frac) => { ttsStatus.textContent = `downloading voice… ${Math.round(frac * 100)}% (one-time)` })
    ttsStatus.textContent = 'reading on your device…'
    return makeNarrator({
      onState: (s) => {
        if (s === 'done' || s === 'stopped') {
          setSpeaking(false)
          ttsStatus.textContent = s === 'stopped' ? 'stopped' : 'done reading ✓'
        }
      },
    })
  }

  async function readAloud() {
    if (speaking) { stopNarration(); return }
    if (!lastBody.trim()) { ttsStatus.textContent = 'nothing to read yet — write a diary first'; return }
    narrateBtn.disabled = true
    try {
      setSpeaking(true)
      narrator = await makeReadyNarrator()
      narrator.push(lastBody)
      narrator.end()
    } catch (e) {
      setSpeaking(false)
      ttsStatus.textContent = `couldn't read aloud: ${e.message || e}`
    } finally {
      narrateBtn.disabled = false
    }
  }

  async function write() {
    if (busy) return
    busy = true; btn.disabled = true; stats.textContent = ''
    if (window.innerWidth <= 768) result.scrollIntoView({ behavior: 'smooth', block: 'start' })
    stopNarration()
    const header = `— Diary of ${(unit.value || 'a nameless hero').trim()} —\n\n`
    out.textContent = header
    lastBody = ''

    // If auto-narrate is on, prepare a live narrator before generation starts.
    let live = null
    let spokenLen = 0
    let raw = ''
    if (getAutoNarrate()) {
      try { setSpeaking(true); narrator = live = await makeReadyNarrator() }
      catch (e) { setSpeaking(false); ttsStatus.textContent = `voice unavailable: ${e.message || e}` }
    }

    try {
      status.textContent = `loading ${currentModel().label} into your browser…`
      await ensureModel((frac, label) => { status.textContent = label || `downloading ${currentModel().label}… ${Math.round(frac * 100)}% (one-time)` })
      status.textContent = `writing on your device with ${currentModel().label}…`
      await streamChat(DIARY_SYSTEM, diaryUserPrompt(unit.value, traits.value) + noThink(currentModelId()), {
        maxTokens: MAX_TOKENS, temperature: 0.9,
        onToken: (piece) => {
          raw += piece
          lastBody = stripThinkFinal(raw)
          out.textContent = header + lastBody
          if (live) { const delta = lastBody.slice(spokenLen); if (delta) { live.push(delta); spokenLen = lastBody.length } }
        },
        onStats: (s) => { stats.textContent = `● ${s.tokPerSec} tok/s · ${s.tokens} tok${s.ttftSeconds != null ? ` · first ${s.ttftSeconds}s` : ''}` },
      })
      // Final pass: keep the answer even if the model left a <think> unclosed (which the
      // live streaming strip would have emptied).
      const finalBody = stripThinkFinal(raw)
      if (finalBody && finalBody !== lastBody) { lastBody = finalBody; out.textContent = header + lastBody }
      status.textContent = 'written ✓ (generated locally)'
      lastDebug = buildDebug(lastBody.trim() ? 'written OK' : 'EMPTY OUTPUT', raw)
      dbgEl.textContent = raw
      if (live) live.end() // flush the tail sentence; onState resets the button
    } catch (e) {
      status.textContent = `couldn't run the local model: ${e.message || e} · 📋 Copy debug`
      lastDebug = buildDebug('EXCEPTION: ' + (e.message || e) + (e.stack ? '\n' + e.stack : ''), raw)
      dbgEl.textContent = raw; dbgWrap.open = true
      if (live) live.stop()
    } finally {
      busy = false; btn.disabled = false
    }
  }

  btn.addEventListener('click', write)
  narrateBtn.addEventListener('click', readAloud)
}
