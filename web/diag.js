// Call diagnostics for the model/media backends (image, voice, skill/text generation).
// Every call gets: a timeout (so a hung backend FAILS LOUDLY instead of spinning forever),
// timing, and a structured console log + a ring buffer you can dump with `tinyDiag()` in the
// devtools console. This is the troubleshooting surface for "stuck at loading" / silent failures.

const RING = []
const MAX = 80
const listeners = new Set()
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms')

export function onDiag(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function recentCalls() { return RING.slice() }

function record(e) {
  RING.push(e); if (RING.length > MAX) RING.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

const tagOf = (kind) => `[tinyarmy:${kind}]`

// Wrap a non-streaming fetch (image / voice) with a timeout + logging. Returns the Response.
// Throws a clear, timing-stamped error on failure/timeout so callers can surface it.
export async function diagFetch(kind, url, opts = {}, { timeoutMs = 90000, label } = {}) {
  const ctrl = new AbortController()
  if (opts.signal) { if (opts.signal.aborted) ctrl.abort(); else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true }) }
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  const t0 = nowMs(); const tag = tagOf(kind); const what = `${opts.method || 'GET'} ${url}${label ? ` · ${label}` : ''}`
  console.info(`${tag} → ${what}`)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    const ms = nowMs() - t0
    if (!res.ok) {
      console.warn(`${tag} ✗ ${res.status} in ${fmt(ms)} · ${url}`)
      record({ kind, url, label, ok: false, status: res.status, ms, ts: Date.now() })
    } else {
      console.info(`${tag} ✓ ${res.status} in ${fmt(ms)} · ${url}`)
      record({ kind, url, label, ok: true, status: res.status, ms, ts: Date.now() })
    }
    return res
  } catch (e) {
    const ms = nowMs() - t0
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    const msg = timedOut ? `TIMEOUT after ${fmt(ms)}` : (e && e.message ? e.message : String(e))
    console.error(`${tag} ✗ ${msg} · ${url}`)
    record({ kind, url, label, ok: false, error: msg, timedOut, ms, ts: Date.now() })
    if (timedOut) throw new Error(`${kind} timed out after ${fmt(ms)} — the backend (${url}) is slow or unresponsive`)
    throw e
  } finally { clearTimeout(timer) }
}

// Lifecycle logging for a streaming call (SSE). Returns handles the streamer calls as it goes.
// Logs start / first-token latency / done / error with timing, and records the outcome.
export function diagStream(kind, url, label) {
  const t0 = nowMs(); const tag = tagOf(kind); const what = `${url}${label ? ` · ${label}` : ''}`
  let first = null
  console.info(`${tag} ⇢ stream ${what}`)
  return {
    firstToken() { if (first == null) { first = nowMs() - t0; console.info(`${tag} · first token in ${fmt(first)} · ${url}`) } },
    done(extra) { const ms = nowMs() - t0; console.info(`${tag} ✓ stream done in ${fmt(ms)}${extra ? ' · ' + extra : ''} · ${url}`); record({ kind, url, label, ok: true, ms, firstMs: first, ts: Date.now() }) },
    fail(e, timedOut) { const ms = nowMs() - t0; const msg = timedOut ? `TIMEOUT after ${fmt(ms)}` : (e && e.message ? e.message : String(e)); console.error(`${tag} ✗ stream ${msg} · ${url}`); record({ kind, url, label, ok: false, error: msg, timedOut, ms, firstMs: first, ts: Date.now() }) },
  }
}

// Dump recent calls to the console (call `tinyDiag()` in devtools to troubleshoot).
function dump() {
  const rows = RING.map((e) => ({ when: new Date(e.ts).toLocaleTimeString(), kind: e.kind, ok: e.ok ? '✓' : '✗', status: e.status || (e.timedOut ? 'TIMEOUT' : (e.error ? 'ERR' : '')), ms: fmt(e.ms || 0), detail: e.label || e.error || e.url }))
  try { console.table(rows) } catch { console.log(rows) }
  return RING.slice()
}
try { if (typeof window !== 'undefined') window.tinyDiag = dump } catch { /* ignore */ }
