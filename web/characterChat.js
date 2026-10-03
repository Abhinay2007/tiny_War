// Character chat — talk to a fighter on its character page. Streams replies from the local
// text model (runtime.js facade) using woid-style assembled context (characterContext.js), so
// the fighter answers in-voice and aware of its real game state. Each reply gets a ▶ button
// that speaks it in the fighter's voice (tts.js), caching the WAV per-message (Phase 4).
import { streamChat, ensureModel, currentModelId } from '/web/runtime.js'
import { noThink, stripThinkFinal } from '/web/personaPrompts.js'
import { buildContext } from '/web/characterContext.js'
import { getPersona, patchPersona, putChatAudio, getChatAudio, getAudio } from '/web/personaStore.js'
import {
  ensureTts, createVoiceWav, cloneVoiceWav, synthVoiceWav, speakVoiceLive, playWav,
  activeEngineIsDesign, activeEngineIsNative, currentVoiceId, getAutoNarrate,
  stopPreview, stopVoiceLive,
} from '/web/tts.js'

const msgId = () => 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const HISTORY_CAP = 50
const SPEAKER = '🔊', STOP = '⏹', LOADING = '⏳'

export function mountCharacterChat(host, personaId, { onUpdate, getLive } = {}) {
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  const thread = document.createElement('div'); thread.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px 8px'
  const form = document.createElement('div'); form.style.cssText = 'display:flex;gap:8px;align-items:flex-end;border-top:1px solid #232b36;padding-top:8px'
  const input = document.createElement('textarea'); input.rows = 1; input.placeholder = 'say something…'
  input.style.cssText = 'flex:1;resize:none;max-height:96px;background:#0d1015;border:1px solid #2a3340;border-radius:10px;color:#e8e8e8;padding:9px 11px;font:13px var(--tac-font,system-ui);box-sizing:border-box'
  const send = document.createElement('button'); send.type = 'button'; send.textContent = '➤'
  send.style.cssText = 'flex:none;width:42px;height:40px;border-radius:10px;border:1px solid #2a3340;background:#1a2230;color:#e8e8e8;font-size:16px;cursor:pointer'
  form.append(input, send); wrap.append(thread, form); host.append(wrap)

  // Voice playback with a real stop. Only one line plays at a time; tapping the speaker while it's
  // playing STOPS it (stopAudio/stopVoiceLive — same primitives the creation screen uses), and the
  // WAV is cached per message for instant replay.
  let playing = null // { id, btn }
  const stopAll = () => {
    try { stopVoiceLive() } catch { /* ignore */ }
    try { stopPreview() } catch { /* ignore */ }
    if (playing && playing.btn) playing.btn.textContent = SPEAKER
    playing = null
  }
  async function speak(id, text, p, btn) {
    if (playing && playing.id === id) { stopAll(); return } // tap the playing one → stop (toggle off)
    stopAll()                                               // stop any other line first
    playing = { id, btn }; btn.textContent = LOADING        // ⏳ while preparing/generating the voice
    const toStop = () => { if (playing && playing.id === id) btn.textContent = STOP }
    try {
      if (activeEngineIsNative()) { await ensureTts(); toStop(); await speakVoiceLive(p.voiceId || currentVoiceId(), text) }
      else {
        let bytes
        const blob = await getChatAudio(id)
        if (blob) bytes = await blob.arrayBuffer()
        else {
          await ensureTts()
          let wav
          if (activeEngineIsDesign()) {
            // Clone from the character's CREATED voice (the cached reference from the creation
            // screen) so every chat line shares one consistent voice instead of re-designing
            // (which drifts). Same path heroCreator uses; falls back to design if no reference yet.
            const ref = await getAudio(p.id)
            wav = ref ? await cloneVoiceWav(await ref.arrayBuffer(), p.voiceQuote || '', text, p.voice || '')
              : await createVoiceWav(p.voice || '', text)
          } else {
            wav = await synthVoiceWav(p.voiceId || currentVoiceId(), text)
          }
          bytes = wav instanceof Blob ? await wav.arrayBuffer() : wav
          try { await putChatAudio(id, new Blob([bytes.slice(0)])) } catch { /* cache best-effort */ }
        }
        if (playing && playing.id === id) { toStop(); await playWav(bytes.slice(0)) } // ⏹ once actually playing; skip if stopped during synth
      }
    } catch { /* voice is best-effort */ } finally { if (playing && playing.id === id) { btn.textContent = SPEAKER; playing = null } }
  }

  const bubbleCss = (role) => `padding:8px 11px;border-radius:12px;line-height:1.4;font:13px var(--tac-font,system-ui);white-space:pre-wrap;${role === 'user' ? 'background:#1f6feb;color:#fff;border-bottom-right-radius:4px' : 'background:#1a2230;color:#e8e8e8;border:1px solid #232b36;border-bottom-left-radius:4px'}`
  // Horizontal row so the speaker can sit to the RIGHT of an assistant bubble; user bubbles hug right.
  const bubble = (role, text) => {
    const row = document.createElement('div')
    row.style.cssText = `display:flex;align-items:center;gap:6px;max-width:92%;${role === 'user' ? 'align-self:flex-end;flex-direction:row-reverse' : 'align-self:flex-start;flex-direction:row'}`
    const b = document.createElement('div'); b.style.cssText = bubbleCss(role); b.textContent = text
    row.append(b); row._b = b; return row
  }

  function renderThread() {
    const p = getPersona(personaId)
    stopAll()
    thread.replaceChildren()
    const hist = (p && p.chat && p.chat.history) || []
    if (!hist.length) {
      const hint = document.createElement('div'); hint.textContent = `Ask ${p ? p.name : 'them'} about a battle, a skill, or how they feel.`
      hint.style.cssText = 'color:#6b7686;font-size:12px;text-align:center;margin:auto;padding:20px 6px'; thread.append(hint)
    }
    for (const m of hist) {
      const row = bubble(m.role, m.text)
      if (m.role === 'assistant') {
        const play = document.createElement('button'); play.type = 'button'; play.textContent = SPEAKER
        play.title = 'Hear it'; play.style.cssText = 'flex:none;background:none;border:none;color:#9aa4b2;font-size:18px;line-height:1;cursor:pointer;padding:2px;user-select:none'
        play.addEventListener('click', () => speak(m.id, m.text, getPersona(personaId), play))
        row.append(play)
      }
      thread.append(row)
    }
    thread.scrollTop = thread.scrollHeight
  }

  function persist(role, id, text) {
    const cur = getPersona(personaId); if (!cur) return
    const history = [...((cur.chat && cur.chat.history) || []), { id, role, text, ts: Date.now() }].slice(-HISTORY_CAP)
    patchPersona(personaId, { chat: { history } })
    onUpdate && onUpdate()
  }

  let busy = false
  async function submit() {
    const text = input.value.trim(); if (!text || busy) return
    const p = getPersona(personaId); if (!p) return
    busy = true; send.disabled = true; input.value = ''
    persist('user', msgId(), text); renderThread()
    // Transient streaming bubble (not yet in history) we write tokens into live.
    const row = bubble('assistant', '…'); thread.append(row); thread.scrollTop = thread.scrollHeight
    const { system, user } = buildContext(p, text, { live: getLive ? getLive() : null })
    let raw = ''
    try {
      await ensureModel(() => {})
      await streamChat(system, user + noThink(currentModelId()), {
        maxTokens: 220, temperature: 0.85,
        onToken: (t) => { raw += t; row._b.textContent = stripThinkFinal(raw) || '…'; thread.scrollTop = thread.scrollHeight },
      })
    } catch (e) { row._b.textContent = '…(couldn’t answer: ' + (e && e.message ? e.message : e) + ')' }
    const final = stripThinkFinal(raw).trim() || '…'
    const id = msgId()
    persist('assistant', id, final)
    renderThread()
    if (getAutoNarrate()) { const btns = thread.querySelectorAll('button'); speak(id, final, getPersona(personaId), btns[btns.length - 1]) }
    busy = false; send.disabled = false
  }

  send.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } })
  renderThread()
  return { refresh: renderThread, focus: () => input.focus() }
}
