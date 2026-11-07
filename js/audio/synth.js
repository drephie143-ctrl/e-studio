// Small polyphonic synth for the Keys tab.
export const SYNTH_PRESETS = {
  keys: { name: 'Keys', osc: ['triangle', 'sine'], detune: 4, attack: 0.005, decay: 0.5, sustain: 0.45, release: 0.35, cutoff: 4200, octave: 0 },
  lead: { name: 'Lead', osc: ['sawtooth', 'sawtooth'], detune: 12, attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.25, cutoff: 3200, octave: 0 },
  square: { name: 'Square', osc: ['square', 'square'], detune: 7, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 2600, octave: 0 },
  bass: { name: 'Bass', osc: ['sine', 'triangle'], detune: 2, attack: 0.005, decay: 0.4, sustain: 0.8, release: 0.2, cutoff: 900, octave: -2 },
  pad: { name: 'Pad', osc: ['sawtooth', 'sawtooth'], detune: 18, attack: 0.45, decay: 1, sustain: 0.8, release: 1.4, cutoff: 1600, octave: 0 },
};

export class Synth {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(dest);
    this.voices = new Map();
    this.preset = 'keys';
    this.tone = 1;
  }

  noteOn(midi, vel = 0.8) {
    if (this.voices.has(midi)) this.noteOff(midi);
    const ctx = this.ctx;
    const p = SYNTH_PRESETS[this.preset];
    const t = ctx.currentTime;
    const f = 440 * 2 ** ((midi - 69 + 12 * p.octave) / 12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(18000, p.cutoff * this.tone);
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.4, t + p.attack);
    g.gain.setTargetAtTime(vel * 0.4 * p.sustain, t + p.attack, p.decay / 3);
    filter.connect(g).connect(this.out);
    const oscs = p.osc.map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = i ? p.detune : -p.detune;
      o.connect(filter);
      o.start(t);
      return o;
    });
    this.voices.set(midi, { oscs, g, p });
  }

  noteOff(midi) {
    const v = this.voices.get(midi);
    if (!v) return;
    this.voices.delete(midi);
    const t = this.ctx.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(v.g.gain.value, t);
    v.g.gain.setTargetAtTime(0, t, v.p.release / 3);
    v.oscs.forEach((o) => o.stop(t + v.p.release * 2 + 0.05));
  }

  allOff() {
    for (const m of [...this.voices.keys()]) this.noteOff(m);
  }
}
