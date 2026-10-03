// Shared SSE reader for the server text-generation endpoint (/text/generate/stream).
// Parses the `event:`/`data:` wire format and dispatches each event to onEvent.
// Used by both engineServer.js (the model-bar "Server / ZeroGPU" engine) and
// codingModel.js (the Skill Forge coding-model picker) so the parser lives once.
//
// Hardened with a CONNECT timeout (no response headers) + an IDLE timeout (stream stalls with
// no new chunk), so a hung/unresponsive backend FAILS LOUDLY instead of spinning forever, and
// every call is logged (see diag.js / `tinyDiag()`).
import { diagStream } from '/web/diag.js'

export async function streamSse(url, body, { onEvent, signal, kind = 'text', label, connectMs = 30000, idleMs = 60000 } = {}) {
  const ctrl = new AbortController()
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', () => ctrl.abort(), { once: true }) }
  let timedOut = false
  let timer = setTimeout(() => { timedOut = true; ctrl.abort() }, connectMs)
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort() }, ms) }
  const log = diagStream(kind, url, label)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok || !res.body) { const txt = res.body ? await res.text().catch(() => '') : ''; throw new Error(`HTTP ${res.status}${txt ? ': ' + txt.slice(0, 140) : ''}`) }
    arm(idleMs) // connected → switch to the idle (stall) timeout, reset on every chunk
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      arm(idleMs)
      buf += decoder.decode(value, { stream: true })
      const events = buf.split(/\n\n/)
      buf = events.pop() ?? ''
      for (const evChunk of events) {
        const lines = evChunk.split('\n')
        let evt = 'message'
        const dataLines = []
        for (const line of lines) {
          if (line.startsWith('event:')) evt = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        }
        const data = dataLines.join('\n')
        if (!data) continue
        let parsed = null
        try { parsed = JSON.parse(data) } catch { /* ignore */ }
        if (evt === 'error') throw new Error(parsed?.error || data)
        if (evt === 'delta') log.firstToken()
        onEvent?.(evt, parsed, data)
      }
    }
    clearTimeout(timer); log.done()
  } catch (e) {
    clearTimeout(timer)
    log.fail(e, timedOut)
    if (timedOut) throw new Error(`${kind} timed out — the generation backend is slow or unresponsive`)
    throw e
  }
}
