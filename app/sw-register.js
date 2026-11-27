// Registers the service worker so the app can be installed (PWA) and opens offline.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

// A tab left open for hours keeps running the version it loaded. Every few minutes, and when the app comes back to
// the screen, check whether a new release is out (sw.js names it) and offer a one-tap reload.
(function(){
  const rel = () => fetch('sw.js', {cache:'no-store'}).then(r => r.ok ? r.text() : '').then(t => (t.match(/CACHE = '([^']+)'/) || [])[1] || '').catch(() => '');
  let mine = null, shown = false;
  async function check(){
    const r = await rel(); if (!r) return;
    if (mine === null){ mine = r; return; }
    if (r === mine || shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.setAttribute('role','status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;background:#1c3d2e;color:#fff;padding:.7rem 1rem;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.25);display:flex;gap:.8rem;align-items:center;max-width:calc(100% - 32px);font:600 .95rem/1.3 system-ui,sans-serif';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Reload'; b.style.cssText = 'background:#e8b84a;color:#1c3d2e;border:0;border-radius:99px;padding:.5rem 1rem;font:inherit;cursor:pointer';
    b.addEventListener('click', () => location.reload());
    bar.append('A new version of the app is ready.', b); document.body.append(bar);
  }
  window.addEventListener('load', check);
  setInterval(check, 5*60*1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
