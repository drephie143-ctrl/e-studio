// Auto-Tune: find the sung pitch, snap it to the key, and re-pitch the voice.
// Pitch detection is YIN; re-pitching is TD-PSOLA (pitch-synchronous overlap-add),
// which keeps the timing and the formants of the voice. Pure functions, so they run
// in a worker or on the main thread.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

export function mixToMono(chans) {
  if (chans.length === 1) return Float32Array.from(chans[0]);
  const n = chans[0].length;
  const out = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) out[i] += c[i];
  for (let i = 0; i < n; i++) out[i] /= chans.length;
  return out;
}

// YIN pitch track. Returns f0 per frame (0 = no pitch) and the hop in samples.
export function detectPitch(x, sr, onProgress) {
  const hop = Math.round(sr * 0.01); // 10 ms frames
  const D = sr >= 32000 ? 2 : 1; // analyse at half rate: plenty for a voice
  const n = Math.floor(x.length / D);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += x[i * D + k];
    y[i] = s / D;
  }
  const dsr = sr / D;
  const tauMin = Math.max(2, Math.floor(dsr / 1100));
  const tauMax = Math.ceil(dsr / 70);
  const W = Math.max(Math.round(dsr * 0.02), tauMax);
  const frames = Math.ceil(x.length / hop);
  const f0 = new Float32Array(frames);
  const d = new Float32Array(tauMax + 2);

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(y[i]));
  const gate = Math.max(0.003, peak * 0.03);

  for (let f = 0; f < frames; f++) {
    if (onProgress && f % 500 === 0) onProgress(f / frames);
    const c = Math.floor((f * hop) / D);
    const start = c - ((W + tauMax) >> 1);
    if (start < 0 || start + W + tauMax >= n) continue;
    let e = 0;
    for (let j = 0; j < W; j++) e += y[start + j] * y[start + j];
    if (Math.sqrt(e / W) < gate) continue;

    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const df = y[start + j] - y[start + j + tau];
        s += df * df;
      }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    let found = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < 0.2) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        found = tau;
        break;
      }
    }
    if (found < 0) continue;
    let t = found;
    if (t > 1 && t < tauMax) {
      const a = d[t - 1], b = d[t], cc = d[t + 1];
      const den = a - 2 * b + cc;
      if (den !== 0) t += (0.5 * (a - cc)) / den;
    }
    f0[f] = dsr / t;
  }
  if (onProgress) onProgress(1);
  return { f0: cleanPitch(f0), hop };
}

// Median-filter the voiced frames and drop voiced blips shorter than 30 ms.
function cleanPitch(f0) {
  const n = f0.length;
  const out = new Float32Array(n);
  const win = [];
  for (let i = 0; i < n; i++) {
    if (!f0[i]) continue;
    win.length = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && f0[k]) win.push(f0[k]);
    win.sort((a, b) => a - b);
    out[i] = win[win.length >> 1];
  }
  let i = 0;
  while (i < n) {
    if (!out[i]) { i++; continue; }
    let j = i;
    while (j < n && out[j]) j++;
    if (j - i < 3) out.fill(0, i, j);
    i = j;
  }
  return out;
}

export function nearestScaleNote(m, key, scale) {
  const steps = SCALES[scale] || SCALES.chromatic;
  const allowed = new Set(steps.map((s) => (s + key) % 12));
  let best = Math.round(m);
  let bd = Infinity;
  for (let k = Math.floor(m) - 3; k <= Math.ceil(m) + 3; k++) {
    if (!allowed.has(((k % 12) + 12) % 12)) continue;
    const dd = Math.abs(k - m);
    if (dd < bd) { bd = dd; best = k; }
  }
  return best;
}

// The pitch change per frame. speed is the retune time in ms (0 = instant, the hard
// robotic sound); amount 0..1 scales the correction.
export function correctionCurve(f0, hopSec, { key = 0, scale = 'major', speed = 0, amount = 1 } = {}) {
  const ratio = new Float32Array(f0.length).fill(1);
  const target = new Float32Array(f0.length);
  const alpha = speed <= 0 ? 1 : 1 - Math.exp(-(hopSec * 1000) / speed);
  let shift = 0;
  let voicedPrev = false;
  for (let i = 0; i < f0.length; i++) {
    const f = f0[i];
    if (!f) { voicedPrev = false; continue; }
    const m = hzToMidi(f);
    const want = (nearestScaleNote(m, key, scale) - m) * amount;
    shift = voicedPrev ? shift + alpha * (want - shift) : want * alpha;
    ratio[i] = 2 ** (shift / 12);
    target[i] = m + shift;
    voicedPrev = true;
  }
  return { ratio, target };
}

// TD-PSOLA: re-pitch the voiced parts by ratio (per frame) without changing timing.
export function psola(x, sr, f0, hop, ratio) {
  const N = x.length;
  const out = new Float32Array(N);
  const wsum = new Float32Array(N);
  const last = f0.length - 1;
  const frameOf = (p) => Math.min(last, Math.max(0, Math.round(p / hop)));

  // Analysis marks: one per pitch period, on the waveform peak.
  const marks = [];
  let pos = 0;
  let prevV = false;
  while (pos < N) {
    const f = f0[frameOf(pos)];
    if (f > 0) {
      const T = sr / f;
      let lo = prevV ? pos - 0.15 * T : pos;
      let hi = prevV ? pos + 0.15 * T : pos + T;
      lo = Math.max(0, Math.floor(lo));
      hi = Math.min(N - 1, Math.ceil(hi));
      let best = lo;
      let bv = -Infinity;
      for (let i = lo; i <= hi; i++) if (x[i] > bv) { bv = x[i]; best = i; }
      const prev = marks.length ? marks[marks.length - 1] : -Infinity;
      if (prevV && best <= prev + 0.5 * T) best = Math.round(prev + T);
      marks.push(best);
      pos = best + T;
      prevV = true;
    } else {
      prevV = false;
      pos += hop * 0.5;
    }
  }

  // Synthesis: lay two-period grains at the new period spacing.
  let t = 0;
  let mi = 0;
  const uvL = Math.round(sr * 0.008);
  while (t < N) {
    const fi = frameOf(t);
    const f = f0[fi];
    if (f > 0 && marks.length) {
      const T = sr / f;
      const r = Math.min(1.5, Math.max(0.66, ratio[fi]));
      while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - t) <= Math.abs(marks[mi] - t)) mi++;
      const a = marks[mi];
      if (Math.abs(a - t) < 1.5 * T) {
        const L = Math.max(2, Math.round(T));
        const tc = Math.round(t);
        for (let k = -L; k <= L; k++) {
          const si = a + k;
          const di = tc + k;
          if (si < 0 || si >= N || di < 0 || di >= N) continue;
          const w = 0.5 * (1 + Math.cos((Math.PI * k) / L));
          out[di] += x[si] * w;
          wsum[di] += w;
        }
        t += T / r;
        continue;
      }
    }
    const tc = Math.round(t);
    for (let k = -uvL; k <= uvL; k++) {
      const di = tc + k;
      if (di < 0 || di >= N) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * k) / uvL));
      out[di] += x[di] * w;
      wsum[di] += w;
    }
    t += uvL * 0.5;
  }
  for (let i = 0; i < N; i++) {
    const w = wsum[i];
    out[i] = w >= 0.15 ? out[i] / w : (out[i] + x[i] * (0.15 - w)) / 0.15;
  }
  return out;
}

// Krumhansl-Schmuckler key finding on the sung notes.
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(f0) {
  const hist = new Array(12).fill(0);
  let count = 0;
  for (const f of f0) {
    if (!f) continue;
    const pc = ((Math.round(hzToMidi(f)) % 12) + 12) % 12;
    hist[pc]++;
    count++;
  }
  if (count < 20) return null;
  const corr = (prof, k) => {
    const mh = hist.reduce((a, b) => a + b) / 12;
    const mp = prof.reduce((a, b) => a + b) / 12;
    let num = 0, dh = 0, dp = 0;
    for (let i = 0; i < 12; i++) {
      const a = hist[i] - mh;
      const b = prof[(i - k + 12) % 12] - mp;
      num += a * b; dh += a * a; dp += b * b;
    }
    return num / Math.sqrt(dh * dp || 1);
  };
  let best = { key: 0, scale: 'major', score: -Infinity };
  for (let k = 0; k < 12; k++) {
    const a = corr(MAJ, k);
    const b = corr(MIN, k);
    if (a > best.score) best = { key: k, scale: 'major', score: a };
    if (b > best.score) best = { key: k, scale: 'minor', score: b };
  }
  return best;
}
