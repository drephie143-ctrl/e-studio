// Transport, mixer and offline mixdown. Tracks are audio clips placed at a start time
// (seconds); the beat is a 16-step pattern that loops for the length of the song.
import { VOICES, playDrum } from './drums.js';

export const bufferOf = (t) => (t.useTuned && t.tuned ? t.tuned : t.raw);

function makeComp(ctx) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -6;
  c.knee.value = 6;
  c.ratio.value = 8;
  c.attack.value = 0.003;
  c.release.value = 0.15;
  return c;
}

export class Engine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(makeComp(ctx)).connect(ctx.destination);
    this.drumBus = ctx.createGain();
    this.drumBus.connect(this.master);
    this.nodes = new Map();
    this.project = null;
    this.playing = false;
    this.recording = false;
    this.pos = 0;
    this.sources = new Set();
    this.timer = null;
    this.onEnded = null;
  }

  setProject(p) {
    this.stop();
    for (const n of this.nodes.values()) n.out.disconnect();
    this.nodes.clear();
    this.project = p;
    this.pos = 0;
    this.updateMix();
  }

  get beatSec() { return 60 / this.project.bpm; }
  get barSec() { return 240 / this.project.bpm; }
  get stepSec() { return 15 / this.project.bpm; }

  songLength() {
    const p = this.project;
    const bar = this.barSec;
    let end = p.bars * bar;
    for (const t of p.tracks) {
      const b = bufferOf(t);
      if (b) end = Math.max(end, t.start + b.duration);
    }
    return Math.ceil(end / bar - 1e-6) * bar;
  }

  trackNode(t) {
    let n = this.nodes.get(t.id);
    if (!n) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      let out = gain;
      let pan = null;
      if (ctx.createStereoPanner) { pan = ctx.createStereoPanner(); gain.connect(pan); out = pan; }
      out.connect(this.master);
      n = { gain, pan, out };
      this.nodes.set(t.id, n);
    }
    return n;
  }

  removeTrack(id) {
    const n = this.nodes.get(id);
    if (n) { n.out.disconnect(); this.nodes.delete(id); }
  }

  gainFor(item, anySolo) { return item.mute || (anySolo && !item.solo) ? 0 : item.vol; }

  updateMix() {
    const p = this.project;
    if (!p) return;
    const now = this.ctx.currentTime;
    const anySolo = p.tracks.some((t) => t.solo) || p.drums.solo;
    for (const t of p.tracks) {
      const n = this.trackNode(t);
      n.gain.gain.setTargetAtTime(this.gainFor(t, anySolo), now, 0.015);
      if (n.pan) n.pan.pan.setTargetAtTime(t.pan, now, 0.015);
    }
    this.drumBus.gain.setTargetAtTime(this.gainFor(p.drums, anySolo), now, 0.015);
    this.master.gain.setTargetAtTime(p.master, now, 0.015);
  }

  // --- transport -----------------------------------------------------------
  play(from = this.pos, { record = false, countIn = 0 } = {}) {
    if (this.playing) this.stop();
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.08;
    this.L = this.songLength();
    if (!record && from >= this.L - 0.01) from = 0;
    this.t0 = now + countIn;
    this.from = from;
    this.playing = true;
    this.recording = record;
    this.loop = this.project.loop && !record;
    this.session = ctx.createGain();
    this.session.connect(this.drumBus);
    this.clicks = ctx.createGain();
    this.clicks.connect(ctx.destination);
    this.scheduleClips(this.t0, from);
    this.nextIter = this.t0 + (this.L - from);
    const step = this.stepSec;
    const first = Math.ceil(from / step - 1e-9);
    this.stepIdx = first;
    this.nextStepTime = this.t0 + first * step - from;
    if (countIn > 0) {
      const beats = Math.round(countIn / this.beatSec);
      for (let b = 0; b < beats; b++) this.click(now + b * this.beatSec, b === 0);
    }
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  scheduleClips(when, songPos) {
    for (const t of this.project.tracks) {
      const buf = bufferOf(t);
      if (!buf || t.start + buf.duration <= songPos) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.trackNode(t).gain);
      src.start(when + Math.max(0, t.start - songPos), Math.max(0, songPos - t.start));
      src.onended = () => this.sources.delete(src);
      this.sources.add(src);
    }
  }

  tick() {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.15;
    const step = this.stepSec;
    const total = Math.round(this.L / step);
    while (this.nextStepTime < ahead) {
      const s = this.stepIdx;
      if (!this.loop && !this.recording && s >= total) break;
      this.scheduleStep(ctx, this.session, this.loop ? s % total : s, this.nextStepTime, true);
      this.stepIdx++;
      this.nextStepTime += step;
    }
    if (this.loop) {
      while (this.nextIter < ahead) { this.scheduleClips(this.nextIter, 0); this.nextIter += this.L; }
    } else if (!this.recording && ctx.currentTime > this.nextIter + 0.05) {
      this.stop();
      this.pos = 0;
      if (this.onEnded) this.onEnded();
    }
  }

  scheduleStep(ctx, dest, songStep, time, live) {
    const d = this.project.drums;
    const i = songStep % 16;
    const t = i % 2 === 1 ? time + d.swing * this.stepSec : time;
    for (const v of VOICES) if (d.pattern[v.id][i]) playDrum(ctx, dest, v.id, t, { tune: d.tune });
    if (live && this.project.metronome && songStep % 4 === 0) this.click(time, songStep % 16 === 0);
  }

  click(time, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = accent ? 1760 : 1180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    o.connect(g).connect(this.clicks || ctx.destination);
    o.start(time);
    o.stop(time + 0.06);
  }

  position() {
    if (!this.playing) return this.pos;
    let p = this.from + (this.ctx.currentTime - this.t0);
    if (this.loop && p >= this.L) p %= this.L;
    return p;
  }

  stop() {
    if (!this.playing) return;
    this.pos = Math.max(0, this.position());
    clearInterval(this.timer);
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    const sess = this.session;
    const clk = this.clicks;
    const g = sess.gain;
    g.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    setTimeout(() => { sess.disconnect(); clk.disconnect(); }, 200);
    this.clicks = null;
    this.playing = false;
    this.recording = false;
  }

  seek(p) {
    p = Math.max(0, p);
    if (this.playing) this.play(p);
    else this.pos = p;
  }

  // --- mixdown ---------------------------------------------------------------
  async renderMix() {
    const p = this.project;
    const sr = this.ctx.sampleRate;
    const L = this.songLength();
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, Math.max(1, Math.ceil(L * sr)), sr);
    const master = off.createGain();
    master.gain.value = p.master;
    master.connect(makeComp(off)).connect(off.destination);
    const anySolo = p.tracks.some((t) => t.solo) || p.drums.solo;
    for (const t of p.tracks) {
      const buf = bufferOf(t);
      if (!buf) continue;
      const g = off.createGain();
      g.gain.value = this.gainFor(t, anySolo);
      let out = g;
      if (off.createStereoPanner) { const pan = off.createStereoPanner(); pan.pan.value = t.pan; g.connect(pan); out = pan; }
      out.connect(master);
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(t.start);
    }
    const dg = off.createGain();
    dg.gain.value = this.gainFor(p.drums, anySolo);
    dg.connect(master);
    const steps = Math.round(L / this.stepSec);
    for (let s = 0; s < steps; s++) this.scheduleStep(off, dg, s, s * this.stepSec, false);
    const r = off.startRendering();
    if (r && r.then) return r;
    return new Promise((res) => { off.oncomplete = (e) => res(e.renderedBuffer); });
  }
}
