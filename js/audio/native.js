// Records the mic with the phone's own recorder (MediaRecorder). On iPhone this skips
// the Web Audio capture path, which can come out choppy when the mic and the audio
// engine run at different sample rates.

function pickMime() {
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return '';
}

export function startNative(stream, ctx) {
  if (!window.MediaRecorder) return null;
  try {
    const mime = pickMime();
    const opts = { audioBitsPerSecond: 256000 };
    if (mime) opts.mimeType = mime;
    const mr = new MediaRecorder(stream, opts);
    const chunks = [];
    const job = { mr, startCtx: null };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstart = () => { job.startCtx = ctx.currentTime; };
    job.done = new Promise((res) => {
      mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || mime || 'audio/mp4' }));
      mr.onerror = () => res(null);
    });
    mr.start(1000);
    return job;
  } catch (e) {
    console.warn('MediaRecorder unavailable', e);
    return null;
  }
}

export async function stopNative(job, decode) {
  if (!job) return null;
  try {
    if (job.mr.state !== 'inactive') job.mr.stop();
    const blob = await Promise.race([job.done, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (!blob || !blob.size) return null;
    const buf = await decode(await blob.arrayBuffer());
    return { buf, startCtx: job.startCtx, mime: blob.type };
  } catch (e) {
    console.warn('Native take could not be decoded', e);
    return null;
  }
}
