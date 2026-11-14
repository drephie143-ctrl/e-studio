// Renders the song generator's parts to audio clips. Plain JavaScript synthesis straight
// into a sample array: far faster than scheduling hundreds of Web Audio nodes offline,
// which matters on a phone. Notes are { bar, step (16ths), len (16ths), midi, vel }.
import { SYNTH_PRESETS } from './synth.js';

const TAU = Math.PI * 2;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Band-limited saw / square (polyBLEP) so the leads don't alias.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function wave(type, ph, dt) {
  switch (type) {
    case 'sine': return Math.sin(TAU * ph);
    case 'triangle': return 1 - 4 * Math.abs(ph - 0.5);
    case 'sawtooth': return 2 * ph - 1 - blep(ph, dt);
    case 'square': {
      let v = ph < 0.5 ? 1 : -1;
      v += blep(ph, dt);
      v -= blep((ph + 0.5) % 1, dt);
      return v;
    }
    default: return Math.sin(TAU * ph);
  }
}

// RBJ low-pass biquad.
function lowpass(sr, f, q) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + a;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - a) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// Adds one note into `out` starting at sample i0. `dur` is the held time in seconds.
function voice(out, sr, sound, n, i0, dur) {
  const f = hz(n.midi);
  const vel = n.vel ?? 0.8;
  const N = out.length;

  if (sound === 'bell') {
    // Two-operator FM: a bright strike that rings out.
    const ring = Math.max(0.6, dur + 0.6);
    const len = Math.min(N - i0, Math.ceil(ring * sr));
    const fm = f * 3.5;
    const decay = Math.log(0.001) / ring;
    const kI = Math.exp(-1 / (0.18 * sr)), kE = Math.exp(decay / sr);
    let iE = 1.6, amp = 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const att = t < 0.004 ? t / 0.004 : 1;
      out[i0 + i] += 0.28 * vel * att * amp * Math.sin(TAU * f * t + (0.05 + iE) * Math.sin(TAU * fm * t));
      iE *= kI; amp *= kE;
    }
    return;
  }

  if (sound === 'flute') {
    const rel = 0.12;
    const len = Math.min(N - i0, Math.ceil((dur + rel) * sr));
    const lp = lowpass(sr, 3800, 0.7);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const vib = 1 + 0.006 * Math.min(1, t / 0.25) * Math.sin(TAU * 5.2 * t);
      ph = (ph + (f * vib) / sr) % 1;
      ph2 = (ph2 + (2 * f * vib) / sr) % 1;
      const env = t < 0.05 ? t / 0.05 : t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel);
      out[i0 + i] += 0.3 * vel * env * lp(wave('triangle', ph) + 0.18 * Math.sin(TAU * ph2));
    }
    return;
  }

  if (sound === '808') {
    const len = Math.min(N - i0, Math.ceil((dur + 0.03) * sr));
    const tail = Math.max(0.05, Math.min(1.6, dur));
    const k = Math.log(0.35 / 0.9) / tail;
    const norm = Math.tanh(2.5);
    let ph = 0, e = 0.9;
    const ke = Math.exp(k / sr), kg = Math.pow(1 / 1.9, 1 / (0.05 * sr));
    let fr = f * 1.9;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < 0.05) fr *= kg; else fr = f;
      ph += fr / sr; if (ph >= 1) ph -= 1;
      let env = t < tail ? e : 0.35;
      e *= ke;
      if (t > dur) env *= Math.max(0, 1 - (t - dur) / 0.03);
      out[i0 + i] += vel * env * (Math.tanh(2.5 * Math.sin(TAU * ph)) / norm);
    }
    return;
  }

  // Keys, Lead, Square, Bass and Pad: the same recipes as the live Keys synth.
  const p = SYNTH_PRESETS[sound] || SYNTH_PRESETS.keys;
  const fr = f * 2 ** p.octave;
  const len = Math.min(N - i0, Math.ceil((dur + p.release * 2) * sr));
  const lp = lowpass(sr, p.cutoff, 0.8);
  const fa = fr * 2 ** (-p.detune / 1200), fb = fr * 2 ** (p.detune / 1200);
  const da = fa / sr, db = fb / sr;
  const peak = 0.34 * vel;
  const dTau = p.decay / 3, rTau = p.release / 3;
  const relStart = Math.max(dur, p.attack);
  let pa = 0, pb = 0.31;
  let atRelease = null;
  // Running multipliers instead of Math.exp per sample.
  const kd = Math.exp(-1 / (dTau * sr)), kr = Math.exp(-1 / (rTau * sr));
  let dec = 1, rel = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    pa += da; if (pa >= 1) pa -= 1;
    pb += db; if (pb >= 1) pb -= 1;
    let env;
    if (t < p.attack) env = (peak * t) / p.attack;
    else { env = peak * (p.sustain + (1 - p.sustain) * dec); dec *= kd; }
    if (t >= relStart) {
      if (atRelease == null) atRelease = env;
      env = atRelease * rel;
      rel *= kr;
    }
    out[i0 + i] += env * 0.5 * lp(wave(p.osc[0], pa, da) + wave(p.osc[1], pb, db));
  }
}

const ECHO = { bell: 0.32, flute: 0.28, '808': 0, keys: 0.12, lead: 0.25, square: 0.18, bass: 0, pad: 0.22 };

// Returns a mono AudioBuffer exactly `bars` bars long.
export async function renderPart(notes, { ctx, sound, bpm, bars, swing = 0 }) {
  const sr = ctx.sampleRate;
  const stepSec = 15 / bpm;
  // Round down: a clip one sample past the last bar would add a whole extra bar to the song.
  const N = Math.max(1, Math.floor(bars * 16 * stepSec * sr));
  const out = new Float32Array(N);
  let count = 0;
  for (const n of notes) {
    let t = (n.bar * 16 + n.step) * stepSec;
    if (n.step % 2 === 1) t += swing * stepSec;
    const i0 = Math.round(t * sr);
    if (i0 >= N) continue;
    voice(out, sr, sound, n, i0, n.len * stepSec * 0.95);
    // Let the page breathe on long renders.
    if (++count % 64 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const wet = ECHO[sound] || 0;
  if (wet > 0) {
    // A dotted-8th echo, darkened so it sits behind the dry sound.
    const D = Math.round(stepSec * 3 * sr);
    const line = new Float32Array(D);
    const a = 1 - Math.exp((-TAU * 2400) / sr);
    let lp = 0, w = 0;
    for (let i = 0; i < N; i++) {
      const delayed = line[w];
      lp += a * (delayed - lp);
      line[w] = out[i] + 0.35 * lp;
      w = (w + 1) % D;
      out[i] += wet * lp;
    }
  }

  // Even out the level so every part lands at the same peak; the track volume sets the mix.
  let peak = 0;
  for (let i = 0; i < N; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; }
  if (peak > 0.001) { const k = 0.85 / peak; for (let i = 0; i < N; i++) out[i] *= k; }
  const buf = ctx.createBuffer(1, N, sr);
  buf.getChannelData(0).set(out);
  return buf;
}
