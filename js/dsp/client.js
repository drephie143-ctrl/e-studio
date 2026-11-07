// Runs a DSP job in a module worker so the UI stays smooth; falls back to the
// main thread when module workers are not available.
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, type } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') p.onProgress && p.onProgress(e.data.value);
      else {
        pending.delete(id);
        if (type === 'done') p.resolve(e.data.result);
        else p.reject(new Error(e.data.message));
      }
    };
    worker.onerror = () => {
      worker = false;
      for (const [id, p] of pending) { pending.delete(id); p.fallback(); }
    };
  } catch {
    worker = false;
  }
  return worker;
}

async function onMain(op, args, onProgress) {
  const ops = await import('./ops.js');
  await new Promise((r) => setTimeout(r, 30)); // let the UI paint the status first
  return ops[op](args, onProgress);
}

export function runDsp(op, args, onProgress) {
  const w = getWorker();
  if (!w) return onMain(op, args, onProgress);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const fallback = () => onMain(op, args, onProgress).then(resolve, reject);
    pending.set(id, { resolve, reject, onProgress, fallback });
    w.postMessage({ id, op, args });
  });
}
