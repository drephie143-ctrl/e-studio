// Records any audio node (the mic, the synth, the chop player) to raw PCM.
const loaded = new WeakMap();

function concat(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
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
        this.node = null;
        resolve({ l: concat(this.L), r: concat(this.R), startTime: this.startTime ?? this.ctx.currentTime, sr: this.ctx.sampleRate });
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
