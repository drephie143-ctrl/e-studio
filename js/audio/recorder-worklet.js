// Captures raw PCM with the audio clock frame of its first sample, so takes line up
// with the beat exactly.
class ERecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.size = 4096;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.batchFrame = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.on = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  flush() {
    if (this.n > 0) {
      this.port.postMessage({ frame: this.batchFrame, l: this.l.slice(0, this.n), r: this.r.slice(0, this.n) });
      this.n = 0;
    }
  }

  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0];
    const a = inp && inp[0];
    const b = inp && (inp[1] || inp[0]);
    const len = a ? a.length : 128;
    for (let i = 0; i < len; i++) {
      if (this.n === 0) this.batchFrame = currentFrame + i;
      this.l[this.n] = a ? a[i] : 0;
      this.r[this.n] = b ? b[i] : 0;
      this.n++;
      if (this.n === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor('e-recorder', ERecorder);
