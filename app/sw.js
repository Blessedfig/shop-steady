// Service worker for the installed app. Network first, so staff always get the latest version;
// the cached copy is used only when the device is offline. Sign-in and data calls (other origins) are never cached.
// Bump CACHE every release, and list every file the app needs offline in SHELL.
const CACHE = 'shop-steady-v10';
const SHELL = ['./', './index.html', './styles.css', './config.js', './shell.js', './data.js', './inventory.js', './setup.js', './shifts.js', './voice.js', './count.js', './people.js', './notes.js', './sw-register.js',
  './lib/pw.js', './lib/idle.js', './vendor/supabase-js-2.118.0.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./index.html')))
  );
});
