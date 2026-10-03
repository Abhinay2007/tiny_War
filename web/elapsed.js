// Show a live elapsed-seconds counter in a status while a slow call runs, so a 12s ZeroGPU
// generation reads as "working (8s)" instead of a frozen "painting…" that looks stuck. The
// counter ticks while the promise is pending and clears when it settles.
export function withElapsed(setText, prefix, promise) {
  const t0 = Date.now()
  const tick = () => { try { setText(`${prefix} ${Math.round((Date.now() - t0) / 1000)}s`) } catch { /* ignore */ } }
  tick()
  const iv = setInterval(tick, 500)
  return Promise.resolve(promise).finally(() => clearInterval(iv))
}
