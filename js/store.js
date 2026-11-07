// Projects and their audio live on the phone, in IndexedDB.
const DB = 'e-studio';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('audio');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(p));
export const getProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export async function listProjects() {
  const all = (await run('projects', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.updated - a.updated);
}
export async function deleteProject(id) {
  await run('projects', 'readwrite', (s) => s.delete(id));
  await run('audio', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
}

export function putAudio(key, buffer) {
  if (!buffer) return run('audio', 'readwrite', (s) => s.delete(key));
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c).slice());
  return run('audio', 'readwrite', (s) => s.put({ sr: buffer.sampleRate, chans }, key));
}

export async function getAudio(key, ctx) {
  const rec = await run('audio', 'readonly', (s) => s.get(key));
  if (!rec) return null;
  const b = ctx.createBuffer(rec.chans.length, rec.chans[0].length, rec.sr);
  rec.chans.forEach((c, i) => b.getChannelData(i).set(c));
  return b;
}

export function deleteAudio(prefix) {
  return run('audio', 'readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
}

export async function askPersistent() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* optional */ }
}
