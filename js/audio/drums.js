// Synthesized drum kit (no samples to download). Every voice takes a context, so the
// same code plays live and renders offline for export.

export const VOICES = [
  { id: 'kick', name: 'Kick' },
  { id: '808', name: '808' },
  { id: 'snare', name: 'Snare' },
  { id: 'clap', name: 'Clap' },
  { id: 'hat', name: 'Hat' },
  { id: 'ohat', name: 'Open' },
  { id: 'rim', name: 'Rim' },
];

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

let driveCurve = null;
function drive() {
  if (!driveCurve) {
    driveCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      driveCurve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
  }
  return driveCurve;
}

function env(ctx, t, peak, decay, out) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  g.connect(out);
  return g;
}

function noise(ctx, t, dur, filterType, freq, q, gainNode) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  if (q) f.Q.value = q;
  s.connect(f).connect(gainNode);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur);
}

export function playDrum(ctx, out, id, t, { vel = 1, tune = 0 } = {}) {
  switch (id) {
    case 'kick': {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      o.connect(env(ctx, t, vel, 0.45, out));
      o.start(t); o.stop(t + 0.5);
      const c = ctx.createOscillator();
      c.frequency.value = 1200;
      c.connect(env(ctx, t, 0.15 * vel, 0.012, out));
      c.start(t); c.stop(t + 0.02);
      break;
    }
    case '808': {
      const base = 49 * 2 ** (tune / 12);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * 2.2, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.06);
      const sh = ctx.createWaveShaper();
      sh.curve = drive();
      const g = env(ctx, t, 0.85 * vel, 1.5, out);
      o.connect(sh).connect(g);
      o.start(t); o.stop(t + 1.55);
      break;
    }
    case 'snare': {
      noise(ctx, t, 0.22, 'highpass', 1500, 0, env(ctx, t, 0.55 * vel, 0.2, out));
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(170, t + 0.1);
      o.connect(env(ctx, t, 0.45 * vel, 0.11, out));
      o.start(t); o.stop(t + 0.15);
      break;
    }
    case 'clap': {
      const g = ctx.createGain();
      g.connect(out);
      g.gain.setValueAtTime(0, t);
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.011;
        g.gain.setValueAtTime(0.8 * vel, tk);
        g.gain.exponentialRampToValueAtTime(0.08, tk + 0.009);
      }
      g.gain.setValueAtTime(0.7 * vel, t + 0.033);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      noise(ctx, t, 0.3, 'bandpass', 1100, 0.8, g);
      break;
    }
    case 'hat':
      noise(ctx, t, 0.06, 'highpass', 7000, 0, env(ctx, t, 0.32 * vel, 0.05, out));
      break;
    case 'ohat':
      noise(ctx, t, 0.4, 'highpass', 6500, 0, env(ctx, t, 0.28 * vel, 0.35, out));
      break;
    case 'rim': {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 820;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1600;
      o.connect(f).connect(env(ctx, t, 0.35 * vel, 0.045, out));
      o.start(t); o.stop(t + 0.06);
      break;
    }
  }
}

const P = (steps) => { const a = new Array(16).fill(false); steps.forEach((s) => (a[s] = true)); return a; };

export function emptyPattern() {
  const p = {};
  for (const v of VOICES) p[v.id] = new Array(16).fill(false);
  return p;
}

const EVENS = [0, 2, 4, 6, 8, 10, 12, 14];

export const PRESETS = {
  Trap: { kick: P([0, 10]), '808': P([0, 7, 10]), snare: P([8]), clap: P([8]), hat: P([...EVENS, 13, 15]), ohat: P([]), rim: P([]) },
  'Boom bap': { kick: P([0, 7, 10]), '808': P([]), snare: P([4, 12]), clap: P([]), hat: P(EVENS), ohat: P([14]), rim: P([]) },
  Screw: { kick: P([0, 6, 10]), '808': P([0, 10]), snare: P([4, 12]), clap: P([12]), hat: P(EVENS), ohat: P([6]), rim: P([15]) },
};
