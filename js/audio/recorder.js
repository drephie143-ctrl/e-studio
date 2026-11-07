// Records any audio node (the mic, the synth, the chop player) to raw PCM.
const loaded = new WeakMap();

function concat(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Place each chunk at its audio-clock frame, so a dropped block leaves a gap in the
// right place instead of pulling everything after it early. Counts the gaps.
function placeByFrame(frames, L, R) {
  const first = frames[0];
  const end = frames[frames.length - 1] + L[L.length - 1].length;
  const n = Math.max(0, Math.min(end - first, 48000 * 60 * 15));
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let gaps = 0;
  let expect = first;
  frames.forEach((f, i) => {
    if (f !== expect) gaps++;
    const o = f - first;
    if (o >= 0 && o + L[i].length <= n) { l.set(L[i], o); r.set(R[i], o); }
    expect = f + L[i].length;
  });
  return { l, r, gaps };
}

// Runs of exact digital silence inside the take: the signature of a capture dropout
// (a live mic always has some noise).
export function countDropouts(x) {
  let start = 0;
  while (start < x.length && x[start] === 0) start++;
  let end = x.length - 1;
  while (end > start && x[end] === 0) end--;
  let runs = 0;
  let run = 0;
  for (let i = start; i <= end; i++) {
    if (x[i] === 0) run++;
    else { if (run >= 32) runs++; run = 0; }
  }
  return runs;
}

export class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    this.node = null;
  }

  get active() { return !!this.node; }

  async start(source) {
    const ctx = this.ctx;
    this.L = [];
    this.R = [];
    this.F = [];
    this.startTime = null;
    this.source = source;
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url)));
      try {
        await loaded.get(ctx);
        const node = new AudioWorkletNode(ctx, 'e-recorder', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        node.port.onmessage = (e) => {
          const d = e.data;
          if (d.l) {
            if (this.startTime === null) this.startTime = d.frame / ctx.sampleRate;
            this.F.push(d.frame);
            this.L.push(d.l);
            this.R.push(d.r);
          }
          if (d.done && this._done) this._done();
        };
        source.connect(node);
        node.connect(this.sink);
        this.node = node;
        return;
      } catch (err) {
        console.warn('AudioWorklet recorder failed, using ScriptProcessor', err);
      }
    }
    const size = 4096;
    const sp = ctx.createScriptProcessor(size, 2, 2);
    sp.onaudioprocess = (e) => {
      if (this.startTime === null) this.startTime = ctx.currentTime - size / ctx.sampleRate;
      const ib = e.inputBuffer;
      this.L.push(new Float32Array(ib.getChannelData(0)));
      this.R.push(new Float32Array(ib.getChannelData(ib.numberOfChannels > 1 ? 1 : 0)));
    };
    source.connect(sp);
    sp.connect(this.sink);
    this.node = sp;
  }

  stop() {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this._done = null;
        try { this.source.disconnect(this.node); } catch { /* already gone */ }
        try { this.node.disconnect(); } catch { /* already gone */ }
        const worklet = this.F.length === this.L.length && this.F.length > 0;
        const placed = worklet ? placeByFrame(this.F, this.L, this.R) : { l: concat(this.L), r: concat(this.R), gaps: 0 };
        resolve({ ...placed, method: worklet ? 'worklet' : 'script', startTime: this.startTime ?? this.ctx.currentTime, sr: this.ctx.sampleRate });
        this.node = null;
      };
      if (!this.node) return resolve(null);
      if (this.node.port) {
        this._done = finish;
        this.node.port.postMessage('stop');
        setTimeout(finish, 400);
      } else finish();
    });
  }
}
