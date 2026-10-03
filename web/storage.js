// Ask the browser to KEEP our cached models instead of treating them as
// evictable. Every engine parks 0.5–2 GB on this origin (wllama→OPFS,
// Transformers.js/WebLLM→Cache API); running several blows past the best-effort
// quota and the browser evicts them → silent re-downloads. persist() flips that
// to durable storage. Call once before the first model download.
let _done = false
export async function ensurePersistentStorage() {
  if (_done) return
  _done = true
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch { /* ignore — best-effort caching still works, just evictable */ }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate()
    return { usage: e.usage || 0, quota: e.quota || 0 }
  } catch { return { usage: 0, quota: 0 } }
}
