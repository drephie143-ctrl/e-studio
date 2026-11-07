// Chopped & Screwed: slow the record down (tape style, so the pitch drops with it),
// chop it on the beat (repeats, stutters, backspins), then a dark echo and a
// low-pass "muffle". Pure functions over arrays of Float32Array channels.

export function resample(chans, rate) {
  const n = chans[0].length;
  const m = Math.max(1, Math.floor((n - 1) / rate));
  return chans.map((c) => {
    const o = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const p = i * rate;
      const j = p | 0;
      const fr = p - j;
      o[i] = c[j] + (c[j + 1] - c[j]) * fr;
    }
    return o;
  });
}

// Build a list of segments from the bar grid and assemble them.
export function chop(chans, sr, beatSec, { style = 'repeat', every = 2, beats = 1 } = {}) {
  if (!style || style === 'none') return chans;
  const n = chans[0].length;
  const beat = Math.round(beatSec * sr);
  const bar = beat * 4;
  const segs = [];
  let mixI = 0;
  for (let b = 0; b * bar < n; b++) {
    const s = b * bar;
    const e = Math.min(n, s + bar);
    segs.push({ s, e });
    if ((b + 1) % every !== 0 || e >= n) continue;
    let st = style;
    if (st === 'mix') st = ['repeat', 'stutter', 'repeat', 'backspin'][mixI++ % 4];
    if (st === 'repeat') {
      const L = Math.min(e, Math.round(beat * beats));
      segs.push({ s: e - L, e });
    } else if (st === 'stutter') {
      const L = Math.round(beat / 4);
      for (let k = 0; k < 3; k++) segs.push({ s: e, e: Math.min(n, e + L) });
    } else if (st === 'backspin') {
      const L = Math.min(e, Math.round(beat * beats));
      segs.push({ s: e - L, e, rev: true, rate: 2 });
    }
  }
  return assemble(chans, segs, sr);
}

function assemble(chans, segs, sr) {
  const fade = Math.round(sr * 0.004);
  const lens = segs.map((g) => Math.floor((g.e - g.s) / (g.rate || 1)));
  const total = lens.reduce((a, b) => a + b, 0);
  const out = chans.map(() => new Float32Array(total));
  let o = 0;
  segs.forEach((g, idx) => {
    const len = lens[idx];
    const rate = g.rate || 1;
    const prev = segs[idx - 1];
    const next = segs[idx + 1];
    const joinIn = prev && !prev.rev && !g.rev && prev.e === g.s;
    const joinOut = next && !next.rev && !g.rev && next.s === g.e;
    chans.forEach((c, ch) => {
      const dst = out[ch];
      for (let i = 0; i < len; i++) {
        const p = g.rev ? g.e - 1 - i * rate : g.s + i * rate;
        const j = Math.max(0, Math.min(c.length - 2, Math.floor(p)));
        const fr = p - Math.floor(p);
        let v = c[j] + (c[j + 1] - c[j]) * fr;
        if (!joinIn && i < fade) v *= i / fade;
        if (!joinOut && len - i < fade) v *= (len - i) / fade;
        dst[o + i] = v;
      }
    });
    o += len;
  });
  return out;
}

export function lowpass(chans, sr, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  return chans.map((c) => {
    const o = new Float32Array(c.length);
    let y = 0;
    for (let i = 0; i < c.length; i++) { y += a * (c[i] - y); o[i] = y; }
    return o;
  });
}

// Feedback echo with a dark (low-passed) repeat.
export function echo(chans, sr, delaySec, feedback, mix) {
  const d = Math.max(1, Math.round(delaySec * sr));
  return chans.map((c) => {
    const n = c.length;
    const o = new Float32Array(n);
    const w = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const back = i >= d ? c[i - d] + feedback * w[i - d] : 0;
      lp += 0.3 * (back - lp);
      w[i] = lp;
      o[i] = c[i] + mix * lp;
    }
    return o;
  });
}

function limit(chans) {
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g;
  }
  return chans;
}

// opts: rate (0.5..1), style, every, beats, echo (0..1), muffle (0..1)
export function screwProcess(chans, sr, bpm, opts) {
  const rate = opts.rate || 0.75;
  let out = resample(chans, rate);
  const beatSec = 60 / (bpm * rate);
  out = chop(out, sr, beatSec, opts);
  if (opts.muffle > 0) out = lowpass(out, sr, 16000 - opts.muffle * 13500);
  if (opts.echo > 0) out = echo(out, sr, beatSec / 2, 0.25 + opts.echo * 0.35, opts.echo * 0.6);
  return limit(out);
}
