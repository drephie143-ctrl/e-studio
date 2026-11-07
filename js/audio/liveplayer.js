// The chop pads: plays the screwed record and lets you chop it live -
// jump back a beat, repeat half a beat, backspin, or tape-brake to a stop.
export class LivePlayer {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.buffer = null;
    this.rev = null;
    this.srcs = new Set();
    this.offset = 0;
    this.startedAt = 0;
    this.playing = false;
    this.beat = 0.6;
    this.onstate = null;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  load(buffer, beatSec) {
    this.kill();
    this.playing = false;
    this.buffer = buffer;
    this.beat = beatSec;
    this.offset = 0;
    const r = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const s = buffer.getChannelData(c);
      const d = r.getChannelData(c);
      for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i];
    }
    this.rev = r;
    this.emit();
  }

  emit() { if (this.onstate) this.onstate(); }

  position() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + Math.max(0, this.ctx.currentTime - this.startedAt));
  }

  kill() {
    for (const s of this.srcs) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
    this.srcs.clear();
  }

  source(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.connect(this.out);
    this.srcs.add(s);
    return s;
  }

  startAt(offset, when) {
    const s = this.source(this.buffer);
    offset = Math.max(0, Math.min(this.duration - 0.001, offset));
    s.start(when, offset);
    s.onended = () => {
      this.srcs.delete(s);
      if (this.playing && this.srcs.size === 0) { this.playing = false; this.offset = 0; this.emit(); }
    };
    this.offset = offset;
    this.startedAt = when;
    this.playing = true;
  }

  play() {
    if (!this.buffer) return;
    const off = this.offset >= this.duration - 0.05 ? 0 : this.offset;
    this.kill();
    this.startAt(off, this.ctx.currentTime + 0.01);
    this.emit();
  }

  pause() {
    this.offset = this.position();
    this.playing = false;
    this.kill();
    this.emit();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  rewind() { const was = this.playing; this.kill(); this.playing = false; this.offset = 0; if (was) this.play(); else this.emit(); }

  // Jump back `beats` beats: the classic chop.
  chop(beats = 1) {
    if (!this.playing) return;
    const p = this.position();
    this.kill();
    this.startAt(p - beats * this.beat, this.ctx.currentTime);
  }

  // Run the record backwards for a beat at double speed, then drop back in.
  spin() {
    if (!this.playing) return;
    const p = this.position();
    this.kill();
    const now = this.ctx.currentTime;
    const r = this.source(this.rev);
    r.playbackRate.value = 2;
    const dur = this.beat / 2;
    r.start(now, Math.max(0, this.duration - p));
    r.stop(now + dur);
    r.onended = () => this.srcs.delete(r);
    this.startAt(p - this.beat, now + dur);
  }

  // Tape stop: the record slows to a halt.
  brake() {
    if (!this.playing) return;
    const p = this.position();
    const now = this.ctx.currentTime;
    for (const s of this.srcs) {
      s.onended = null;
      s.playbackRate.setValueAtTime(s.playbackRate.value, now);
      s.playbackRate.linearRampToValueAtTime(0.03, now + 0.9);
      s.stop(now + 0.9);
    }
    this.srcs.clear();
    this.playing = false;
    this.offset = Math.min(this.duration, p + 0.45);
    this.emit();
  }
}
