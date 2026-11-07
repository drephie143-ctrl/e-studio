// The heavy jobs, callable from the worker or (fallback) the main thread.
import { detectPitch, correctionCurve, psola } from './autotune.js';
import { screwProcess } from './screw.js';
import { findLag } from './align.js';

export function align({ ref, x, sr, expect }) {
  return findLag(ref, x, sr, expect);
}

export function analyzePitch({ mono, sr }, onProgress) {
  return detectPitch(mono, sr, onProgress);
}

export function applyTune({ mono, sr, f0, hop, opts }) {
  const { ratio, target } = correctionCurve(f0, hop / sr, opts);
  const out = psola(mono, sr, f0, hop, ratio);
  return { out, target };
}

export function screw({ chans, sr, bpm, opts }) {
  return { chans: screwProcess(chans, sr, bpm, opts) };
}
