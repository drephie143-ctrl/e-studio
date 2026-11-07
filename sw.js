// Offline cache for the app shell. Network first, so a new version shows up as soon
// as the phone is online; the cache is the fallback when it's offline.
// Bump VERSION when files change.
const VERSION = 'e-studio-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/icons.js', 'js/store.js',
  'js/audio/engine.js', 'js/audio/drums.js', 'js/audio/synth.js', 'js/audio/recorder.js',
  'js/audio/recorder-worklet.js', 'js/audio/liveplayer.js', 'js/audio/native.js',
  'js/dsp/autotune.js', 'js/dsp/screw.js', 'js/dsp/ops.js', 'js/dsp/worker.js', 'js/dsp/client.js', 'js/dsp/wav.js', 'js/dsp/align.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
