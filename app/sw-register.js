// Registers the service worker so the app can be installed (PWA) and opens offline.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
