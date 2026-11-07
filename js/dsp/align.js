// Finds where take `x` sits inside reference `ref` (same mic, same sample rate):
// returns lag such that x[i] lines up with ref[i + lag], and a 0..1 confidence.
// Coarse search on 2 ms loudness envelopes (robust to dropouts in ref), then a
// sample-accurate search on the loudest second.
// `expect` (samples, optional) is a rough guess from timestamps: the search stays
// within half a second of it and favours the nearest match, so a repeating beat can't
// pull the take a whole beat off.
export function findLag(ref, x, sr, expect = null, maxSec = 2) {
  const win = Math.max(1, Math.round(sr / 500));
  const cap = Math.round(sr * 40);
  const env = (a) => {
    const m = Math.floor(Math.min(a.length, cap) / win);
    const e = new Float32Array(m);
    let mean = 0;
    for (let i = 0; i < m; i++) {
      let s = 0;
      const o = i * win;
      for (let j = 0; j < win; j++) s += Math.abs(a[o + j]);
      e[i] = s / win;
      mean += e[i];
    }
    mean /= m || 1;
    for (let i = 0; i < m; i++) e[i] -= mean;
    return e;
  };
  const R = env(ref);
  const X = env(x);
  const centre = expect == null ? 0 : Math.round(expect / win);
  const span = expect == null ? Math.round(maxSec * 500) : 250;
  let best = 0;
  let bestC = -Infinity;
  let bestScore = -Infinity;
  for (let L = centre - span; L <= centre + span; L++) {
    const i0 = Math.max(0, -L);
    const i1 = Math.min(X.length, R.length - L);
    if (i1 - i0 < 250) continue;
    let s = 0, ex = 0, er = 0;
    for (let i = i0; i < i1; i++) {
      const a = X[i], b = R[i + L];
      s += a * b; ex += a * a; er += b * b;
    }
    const c = s / Math.sqrt(ex * er || 1);
    const d = (L - centre) / span;
    const score = expect == null ? c : c * (1 - 0.3 * d * d);
    if (score > bestScore) { bestScore = score; bestC = c; best = L; }
  }
  if (bestC === -Infinity) return { lag: 0, confidence: 0 };

  // Loudest second of x, for the fine search.
  const per = 500;
  let run = 0, top = -Infinity, at = 0;
  for (let i = 0; i < X.length; i++) {
    run += Math.abs(X[i]);
    if (i >= per) run -= Math.abs(X[i - per]);
    if (i >= per - 1 && run > top) { top = run; at = i - per + 1; }
  }
  const p = at * win;
  const seg = Math.min(sr, x.length - p);
  const coarse = best * win;
  let lag = coarse;
  let bestV = -Infinity;
  for (let L = coarse - 2 * win; L <= coarse + 2 * win; L++) {
    let s = 0;
    for (let i = p; i < p + seg; i++) {
      const k = i + L;
      if (k >= 0 && k < ref.length) s += x[i] * ref[k];
    }
    if (s > bestV) { bestV = s; lag = L; }
  }
  return { lag, confidence: Math.max(0, bestC) };
}
