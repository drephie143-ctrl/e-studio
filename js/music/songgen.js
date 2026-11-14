// Song generator: picks a key, tempo, chord progressions, a drum groove, an 808 / bass line
// and a hook melody from a style, a mood and a seed, then lays them out as sections
// (intro, verse, hook, outro). Pure data: no audio here, so it runs anywhere.
import { NOTE_NAMES } from '../dsp/autotune.js';

// --- seeded random ---------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// --- styles and moods ---------------------------------------------------------------
const S = (steps) => { const a = new Array(16).fill(false); steps.forEach((s) => (a[s] = true)); return a; };
const EVENS = [0, 2, 4, 6, 8, 10, 12, 14];
const ALL16 = [...Array(16).keys()];

// Drum grooves per style. The 808 row is the bass rhythm: the generator plays it as a
// pitched bass track that follows the chords, so the Beat tab's 808 row is left empty.
const GROOVES = {
  trap: [
    { kick: [0, 10], bass: [0, 7, 10], snare: [8], clap: [8], hat: [...EVENS, 13, 15], ohat: [], rim: [] },
    { kick: [0, 3, 10], bass: [0, 3, 10, 14], snare: [8], clap: [8], hat: ALL16.filter((s) => s % 4 !== 3), ohat: [6], rim: [] },
    { kick: [0, 6, 11], bass: [0, 6, 11], snare: [8], clap: [], hat: [...EVENS, 7, 15], ohat: [], rim: [12] },
  ],
  drill: [
    { kick: [0, 7, 13], bass: [0, 7, 13], snare: [8], clap: [8], hat: [0, 3, 6, 8, 10, 13, 15], ohat: [], rim: [11] },
    { kick: [0, 6, 10], bass: [0, 6, 10, 14], snare: [8, 15], clap: [8], hat: [0, 3, 6, 9, 12, 14], ohat: [], rim: [] },
  ],
  boombap: [
    { kick: [0, 7, 10], bass: [0, 7, 10], snare: [4, 12], clap: [], hat: EVENS, ohat: [14], rim: [] },
    { kick: [0, 3, 8, 10], bass: [0, 3, 10], snare: [4, 12], clap: [], hat: EVENS, ohat: [], rim: [7] },
  ],
  rnb: [
    { kick: [0, 7, 9], bass: [0, 7, 9], snare: [4, 12], clap: [12], hat: EVENS, ohat: [], rim: [10] },
    { kick: [0, 5, 10], bass: [0, 5, 10], snare: [4, 12], clap: [], hat: [...EVENS, 15], ohat: [6], rim: [] },
  ],
  screw: [
    { kick: [0, 6, 10], bass: [0, 10], snare: [4, 12], clap: [12], hat: EVENS, ohat: [6], rim: [15] },
    { kick: [0, 3, 10], bass: [0, 3, 10], snare: [4, 12], clap: [], hat: EVENS, ohat: [], rim: [] },
  ],
  pop: [
    { kick: [0, 8], bass: [0, 3, 8, 11], snare: [4, 12], clap: [4, 12], hat: EVENS, ohat: [14], rim: [] },
    { kick: [0, 6, 8], bass: [0, 6, 8, 14], snare: [4, 12], clap: [], hat: ALL16.filter((s) => s % 2 === 0 || s === 15), ohat: [], rim: [] },
  ],
};

// Melody rhythms: one bar of onsets in 16th steps.
const MELODY_RHYTHMS = {
  trap: [[0, 3, 6, 8, 11, 14], [0, 2, 6, 10, 12], [3, 6, 8, 10, 14]],
  drill: [[0, 3, 6, 9, 12], [0, 3, 7, 10, 13], [2, 5, 8, 11, 14]],
  boombap: [[0, 4, 7, 10], [0, 3, 6, 8, 12], [2, 6, 10, 12, 14]],
  rnb: [[0, 3, 6, 10, 12], [0, 4, 6, 9, 12, 14], [2, 4, 8, 11]],
  screw: [[0, 6, 8, 12], [0, 4, 10], [2, 8, 12]],
  pop: [[0, 2, 4, 6, 8, 12], [0, 3, 6, 8, 10, 12], [0, 4, 6, 8, 11]],
};

export const STYLES = {
  trap: { name: 'Trap', bpm: [130, 150], sevenths: false, chords: 'arp', sounds: { chords: 'bell', bass: '808', melody: 'flute' }, swing: 0 },
  drill: { name: 'Drill', bpm: [138, 146], sevenths: false, chords: 'sustain', sounds: { chords: 'pad', bass: '808', melody: 'bell' }, swing: 0 },
  boombap: { name: 'Boom bap', bpm: [84, 96], sevenths: true, chords: 'stabs', sounds: { chords: 'keys', bass: 'bass', melody: 'keys' }, swing: 0.18 },
  rnb: { name: 'R&B', bpm: [68, 88], sevenths: true, chords: 'sustain', sounds: { chords: 'keys', bass: 'bass', melody: 'flute' }, swing: 0.1 },
  screw: { name: 'Screw', bpm: [62, 72], sevenths: true, chords: 'sustain', sounds: { chords: 'pad', bass: '808', melody: 'lead' }, swing: 0.08 },
  pop: { name: 'Pop', bpm: [100, 120], sevenths: false, chords: 'stabs', sounds: { chords: 'keys', bass: 'bass', melody: 'lead' }, swing: 0 },
};

// Progressions as scale degrees (0 = the key's root chord).
export const MOODS = {
  dark: { name: 'Dark', scale: 'harmonic minor', progs: [[0, 5, 4, 0], [0, 0, 5, 4], [0, 3, 5, 4], [0, 1, 0, 4], [0, 5, 0, 4]] },
  sad: { name: 'Sad', scale: 'minor', progs: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 6, 2]] },
  chill: { name: 'Chill', scale: 'major', progs: [[1, 4, 0, 5], [3, 2, 1, 0], [0, 5, 1, 4], [3, 4, 2, 5], [0, 2, 3, 4]] },
  happy: { name: 'Happy', scale: 'major', progs: [[0, 4, 5, 3], [0, 3, 4, 3], [5, 3, 0, 4], [0, 5, 3, 4], [3, 0, 4, 5]] },
};

// Which parts play in each kind of section.
const SECTION_PARTS = {
  intro: { chords: true, bass: false, melody: false },
  verse: { chords: true, bass: true, melody: false },
  hook: { chords: true, bass: true, melody: true },
  bridge: { chords: true, bass: false, melody: true },
  outro: { chords: true, bass: false, melody: false },
};

export const LENGTHS = {
  loop: { name: 'Loop', plan: [['hook', 8]] },
  song: { name: 'Song', plan: [['intro', 4], ['verse', 8], ['hook', 8], ['verse', 8], ['hook', 8], ['outro', 4]] },
  full: { name: 'Full', plan: [['intro', 4], ['hook', 8], ['verse', 16], ['hook', 8], ['verse', 16], ['bridge', 4], ['hook', 8], ['outro', 4]] },
};

// --- theory ---------------------------------------------------------------------------
// The scale used for chords. Harmonic minor gives the dark V chord; its melody still uses it.
const SCALE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};

const degreeSemis = (scale, d) => {
  const st = SCALE_STEPS[scale];
  return st[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
};

// Chord tones (semitones above the key root) for a scale degree.
export function chordOf(scale, degree, sevenths) {
  // Harmonic minor only lends its raised 7th to the V chord; the rest stay natural minor.
  const sc = scale === 'harmonic minor' && ((degree % 7) + 7) % 7 !== 4 ? 'minor' : scale;
  const tones = [0, 2, 4].concat(sevenths ? [6] : []).map((k) => degreeSemis(sc, degree + k));
  return tones;
}

export function chordName(key, scale, degree, sevenths) {
  const t = chordOf(scale, degree, sevenths);
  const root = (key + t[0]) % 12;
  const third = t[1] - t[0];
  const fifth = t[2] - t[0];
  let q = third === 3 ? (fifth === 6 ? 'dim' : 'm') : fifth === 8 ? 'aug' : '';
  if (sevenths) {
    const sev = t[3] - t[0];
    if (q === '' && sev === 11) q = 'maj7';
    else if (q === '' && sev === 10) q = '7';
    else if (q === 'm' && sev === 10) q = 'm7';
    else if (q === 'm' && sev === 11) q = 'm(maj7)';
    else if (q === 'dim') q = sev === 10 ? 'm7b5' : 'dim7';
  }
  return NOTE_NAMES[root] + q;
}

// --- generation -------------------------------------------------------------------------
// opts: { style, mood, key ('any' or 0-11), length, seeds: { song, chords, melody, drums }, bpm? }
export function generateSong(opts) {
  const style = STYLES[opts.style] || STYLES.trap;
  const mood = MOODS[opts.mood] || MOODS.sad;
  const seeds = opts.seeds;
  const r = rng(seeds.song);
  const key = opts.key === 'any' || opts.key == null ? r.int(0, 11) : +opts.key;
  const bpm = opts.bpm || r.int(style.bpm[0], style.bpm[1]);
  const scale = mood.scale;

  // Two progressions: one for verses and intro/outro, one for hooks.
  const rc = rng(seeds.chords);
  const verseProg = rc.pick(mood.progs);
  let hookProg = rc.pick(mood.progs);
  if (hookProg === verseProg && mood.progs.length > 1) hookProg = mood.progs[(mood.progs.indexOf(verseProg) + 1) % mood.progs.length];
  const progFor = (kind) => (kind === 'hook' || kind === 'bridge' ? hookProg : verseProg);

  const rd = rng(seeds.drums);
  const grooveSrc = rd.pick(GROOVES[opts.style] || GROOVES.trap);
  const groove = {};
  for (const id of ['kick', 'snare', 'clap', 'hat', 'ohat', 'rim']) groove[id] = S(grooveSrc[id]);
  groove['808'] = S([]);
  // A little variation so two rolls with the same groove still differ.
  if (rd.chance(0.5)) groove.hat[rd.pick([5, 9, 13, 15])] = true;
  if (rd.chance(0.35)) groove.ohat[rd.pick([6, 14])] = true;
  const bassSteps = grooveSrc.bass.slice();

  // Sections with bar ranges.
  const plan = (LENGTHS[opts.length] || LENGTHS.song).plan;
  const sections = [];
  let bar = 0;
  const counts = {};
  for (const [kind, bars] of plan) {
    counts[kind] = (counts[kind] || 0) + 1;
    const prog = progFor(kind);
    sections.push({
      kind, bars, start: bar,
      label: kind.charAt(0).toUpperCase() + kind.slice(1) + (['verse', 'hook'].includes(kind) && plan.filter(([k]) => k === kind).length > 1 ? ' ' + counts[kind] : ''),
      chords: prog.map((d) => chordName(key, scale, d, style.sevenths)),
      prog,
    });
    bar += bars;
  }
  const totalBars = bar;

  const parts = { chords: [], bass: [], melody: [] };
  const rootMidi = 48 + key; // C3 area for chords
  const want = opts.parts || { chords: true, bass: true, melody: true };

  // A hook melody: a 2-bar motif, repeated with a changed ending, landing on the root.
  const rm = rng(seeds.melody);
  const rhythms = MELODY_RHYTHMS[opts.style] || MELODY_RHYTHMS.trap;
  const rhyA = rm.pick(rhythms);
  const rhyB = rm.pick(rhythms);
  const melodyScale = scale === 'harmonic minor' ? [0, 2, 3, 5, 7, 8, 11] : SCALE_STEPS[scale];
  const melBase = 72 + key - (key > 5 ? 12 : 0); // keep the lead between about F4 and E5 roots
  const toMidi = (deg) => melBase + melodyScale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
  const chordDegrees = (d) => [d, d + 2, d + 4].map((x) => ((x % 7) + 7) % 7);
  function phrase(prog, barOffset, rhyBars, endOnRoot, rr) {
    const out = [];
    let deg = rr.pick([0, 2, 4]);
    rhyBars.forEach((rhy, b) => {
      const chordDeg = prog[(barOffset + b) % prog.length];
      rhy.forEach((step, i) => {
        const strong = step % 4 === 0;
        if (strong) {
          // Move to the nearest chord tone.
          const tones = chordDegrees(chordDeg).flatMap((t) => [t - 7, t, t + 7]);
          deg = tones.reduce((best, t) => (Math.abs(t - deg) < Math.abs(best - deg) ? t : best), tones[0]);
        } else {
          deg += rr.pick([-2, -1, -1, 1, 1, 2, 0]);
        }
        deg = Math.max(-3, Math.min(9, deg));
        const last = b === rhyBars.length - 1 && i === rhy.length - 1;
        if (last && endOnRoot) deg = deg > 3 ? 7 : 0;
        const nextStep = i < rhy.length - 1 ? rhy[i + 1] : 16;
        out.push({ bar: b, step, len: Math.min(last ? 6 : 4, nextStep - step), midi: toMidi(deg), vel: strong ? 0.9 : 0.75 });
      });
    });
    return out;
  }
  const motifA = phrase(hookProg, 0, [rhyA, rhyB], false, rng(seeds.melody + 1));
  const motifA2 = phrase(hookProg, 2, [rhyA, rhyB], false, rng(seeds.melody + 2));
  const motifEnd = phrase(hookProg, 2, [rhyA, rhyB.filter((s) => s < 12)], true, rng(seeds.melody + 3));
  // Keep the first bar of the answer equal to the motif so it sounds like the same tune.
  const answer = motifA.filter((n) => n.bar === 0).concat(motifA2.filter((n) => n.bar === 1));
  const ending = motifA.filter((n) => n.bar === 0).concat(motifEnd.filter((n) => n.bar === 1));
  const hookMelody = [motifA, answer, motifA, ending]; // four 2-bar phrases per 8 bars
  // The bridge gets its own short line.
  const bridgeMelody = phrase(hookProg, 0, [rm.pick(rhythms), rm.pick(rhythms)], true, rng(seeds.melody + 4));

  for (const sec of sections) {
    const sp = SECTION_PARTS[sec.kind];
    for (let b = 0; b < sec.bars; b++) {
      const absBar = sec.start + b;
      const deg = sec.prog[b % sec.prog.length];
      const tones = chordOf(scale, deg, style.sevenths);
      // Voice chords close to the key root: fold any tone above an octave and a fifth down.
      const voiced = tones.map((t) => rootMidi + (t > 16 ? t - 12 : t));
      const fadeVel = sec.kind === 'intro' ? 0.6 + 0.4 * (b / sec.bars) : sec.kind === 'outro' ? 1 - 0.6 * (b / sec.bars) : 1;
      const chVel = (sec.kind === 'verse' ? 0.75 : 0.9) * fadeVel;

      if (want.chords && sp.chords) {
        if (style.chords === 'sustain') {
          for (const m of voiced) parts.chords.push({ bar: absBar, step: 0, len: 16, midi: m, vel: chVel * 0.8 });
        } else if (style.chords === 'stabs') {
          const hits = opts.style === 'pop' ? [0, 6, 10] : [0, 10];
          hits.forEach((st, i) => {
            const len = (hits[i + 1] ?? 16) - st;
            for (const m of voiced) parts.chords.push({ bar: absBar, step: st, len, midi: m, vel: chVel * (i ? 0.8 : 1) });
          });
        } else {
          // Arpeggio: up through the chord and back on 8th notes, an octave up.
          const arp = [0, 1, 2, 1, 0, 1, 2, 1].map((i) => voiced[i % voiced.length] + 12);
          arp.forEach((m, i) => parts.chords.push({ bar: absBar, step: i * 2, len: 3, midi: m, vel: chVel * (i % 4 === 0 ? 0.9 : 0.65) }));
        }
      }

      if (want.bass && sp.bass) {
        const root = 36 + ((key + tones[0]) % 12); // C2 to B2
        bassSteps.forEach((st, i) => {
          const len = (bassSteps[i + 1] ?? 16) - st;
          // Trap / drill 808s sometimes jump up an octave or a fifth on the last hit.
          let m = root;
          if (style.sounds.bass === '808' && i === bassSteps.length - 1 && b % 2 === 1 && rd.chance(0.5)) m = root + rd.pick([7, 12]);
          parts.bass.push({ bar: absBar, step: st, len, midi: m, vel: i === 0 ? 1 : 0.85 });
        });
      }

      if (want.melody && sp.melody) {
        const src = sec.kind === 'bridge' ? [bridgeMelody, bridgeMelody] : hookMelody;
        const phraseIdx = Math.floor(b / 2) % src.length;
        const inPhrase = b % 2;
        for (const n of src[phraseIdx]) if (n.bar === inPhrase) parts.melody.push({ ...n, bar: absBar });
      }
    }
  }

  return {
    key, scale, bpm, totalBars, sections, groove,
    swing: style.swing, sounds: style.sounds, parts,
    title: `${NOTE_NAMES[key]} ${scale === 'major' ? 'major' : 'minor'} · ${bpm} BPM · ${totalBars} bars`,
  };
}

// Writing prompts for the lyric pad, by section kind and mood.
const PROMPTS = {
  hook: ['Say the title line twice', 'Four short lines, the last one answers the first', 'One phrase everyone can sing back'],
  verse: ['Set the scene: where are you, what time is it', 'Tell what happened, then how it changed you', 'Two rhymes per line, keep the story moving'],
  intro: ['A spoken line or an ad-lib', 'Hum the hook melody'],
  bridge: ['Flip the hook: the other side of the story', 'Slow it down, one honest line'],
  outro: ['Repeat the last hook line and fade', 'Shout-outs or a closing ad-lib'],
};
export function promptFor(kind, seed) {
  const list = PROMPTS[kind] || PROMPTS.verse;
  return list[Math.abs(seed) % list.length];
}
