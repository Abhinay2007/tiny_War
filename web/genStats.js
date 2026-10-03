// Shared generation-stats tracker used by every engine so tok/s is measured the
// same way (decode rate = tokens since the FIRST token / elapsed-since-first). This
// is the benchmark metric for comparing wllama vs WebLLM vs Transformers.js.
export function statsTracker(onStats) {
  let n = 0
  const t0 = performance.now()
  let tFirst = null
  const emit = (final) => {
    if (!onStats) return
    const secs = (performance.now() - t0) / 1000
    const gen = tFirst ? (performance.now() - tFirst) / 1000 : 0
    onStats({
      tokens: n, seconds: +secs.toFixed(1),
      tokPerSec: gen > 0 ? +(n / gen).toFixed(1) : 0,
      ttftSeconds: tFirst ? +((tFirst - t0) / 1000).toFixed(1) : null,
      final: !!final,
    })
  }
  return {
    tick() { if (tFirst === null) tFirst = performance.now(); n++; emit(false) },
    finish() {
      emit(true)
      const gen = tFirst ? (performance.now() - tFirst) / 1000 : (performance.now() - t0) / 1000
      return { tokens: n, tokPerSec: gen > 0 ? +(n / gen).toFixed(1) : 0 }
    },
  }
}
