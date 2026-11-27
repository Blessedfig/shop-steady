// Shared data: keeps the app's records in Supabase (table app_docs, see supabase/sync.sql) so every signed-in
// device sees the same schedule, notes, customers and tax records. Each area (shifts, voice, notes...) is one row.
//   - On sign-in the app loads every area. A device that never synced takes the shared copy as it is.
//   - After a change, it saves the areas that changed. If someone else saved first, it merges the two:
//     records with an id are combined one by one (added, changed or removed on either side), anything
//     else keeps this device's version. Then it tries again.
//   - Every 30 seconds, and when the app comes back to the screen, it picks up other people's changes.
// Things that belong to one device stay local: which role you're viewing as, the store-mode sign-in, this phone's own scan tally (it is shared through 'scans').
// Also here: roles from the database (View as only offers your own level and below) and the owner's Team logins screen.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast} = A;
  const SHARED = ['inv','exp','shifts','voice','people','notes','tax','setup','mods','scans']; // 'catalog' is shared separately by count.js
  const RANK = {staff:1, lead:2, manager:3, owner:4};
  const VKEY = 'shop-steady-sync';
  let sb = null, ver = {}, base = {}, busy = false, again = false, timer = null, statusEl = null, lastErr = '';
  try { ver = JSON.parse(localStorage.getItem(VKEY)) || {}; } catch(e){ ver = {}; }

  // bases (the last copy agreed with the server) live in IndexedDB, they can be large
  const IDB = { db:null,
    open(){ return this.db || (this.db = new Promise((ok, no) => { try { const r = indexedDB.open('shop-steady-sync', 1); r.onupgradeneeded = () => r.result.createObjectStore('b'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); } })); },
    async all(){ const db = await this.open(); return new Promise(ok => { const out = {}, st = db.transaction('b').objectStore('b'), q = st.openCursor();
      q.onsuccess = () => { const c = q.result; if (c){ out[c.key] = c.value; c.continue(); } else ok(out); }; q.onerror = () => ok(out); }); },
    async put(k, v){ const db = await this.open(); return new Promise(ok => { const t = db.transaction('b','readwrite'); t.objectStore('b').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } };
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const saveVer = () => { try { localStorage.setItem(VKEY, JSON.stringify(ver)); } catch(e){} };

  // three-way merge: base = last agreed copy, l = this device, r = server
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const idList = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && x.id != null);
  function merge(b, l, r){
    if (same(l, b)) return clone(r);
    if (same(r, b) || same(l, r)) return clone(l);
    if (isObj(l) && isObj(r)){ const out = {}, bb = isObj(b) ? b : {};
      new Set([...Object.keys(r), ...Object.keys(l)]).forEach(k => { const v = merge(bb[k], l[k], r[k]); if (v !== undefined) out[k] = v; }); return out; }
    if ((idList(l) || Array.isArray(l) && !l.length) && (idList(r) || Array.isArray(r) && !r.length) && (l.length || r.length)){
      const by = a => { const m = new Map(); (Array.isArray(a) ? a : []).forEach(x => isObj(x) && x.id != null && m.set(String(x.id), x)); return m; };
      const B = by(b), L = by(l), R = by(r), out = [], seen = new Set();
      const add = id => { if (seen.has(id)) return; seen.add(id); const v = merge(B.get(id), L.get(id), R.get(id)); if (v !== undefined) out.push(v); };
      r.forEach(x => add(String(x.id))); l.forEach(x => add(String(x.id)));
      return out; }
    return clone(l === undefined ? r : l); // both changed the same thing: this device's edit wins
  }

  function status(t, err){ lastErr = err ? t : ''; if (statusEl){ statusEl.textContent = t; statusEl.className = 'syncst'+(err ? ' err' : ''); } }
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button'; };
  let rerender = false;
  function refresh(){ if (typing()){ rerender = true; return; } rerender = false; A.fillSwitchers(); A.route(); }
  document.addEventListener('focusout', () => setTimeout(() => { if (rerender && !typing()) refresh(); }, 300));

  async function pull(first){
    const {data, error} = await sb.from('app_docs').select('key,data,version').in('key', SHARED);
    if (error) throw error;
    const S = A.state(); let changed = false; const remote = {};
    (data || []).forEach(row => remote[row.key] = row);
    for (const k of SHARED){
      const row = remote[k]; if (!row) continue;
      if (ver[k] === row.version) continue;
      const merged = ver[k] == null ? clone(row.data) : merge(base[k], S[k], row.data);
      if (!same(merged, S[k])){ S[k] = merged; changed = true; }
      base[k] = clone(row.data); ver[k] = row.version; IDB.put(k, base[k]);
    }
    saveVer(); A.save(true);
    if (changed && !first) refresh();
    return changed;
  }
  async function push(){
    if (busy){ again = true; return; } busy = true;
    try {
      const S = A.state();
      for (const k of SHARED){
        if (S[k] === undefined || same(S[k], base[k])) continue;
        if ((k === 'setup' || k === 'mods') && A.myRole !== 'owner') continue;
        for (let tries = 0; tries < 4; tries++){
          status('Saving…');
          const snap = clone(S[k]);
          const {data:nv, error} = await sb.rpc('save_doc', {p_key:k, p_data:snap, p_base:ver[k] || 0});
          if (error) throw error;
          if (nv > 0){ ver[k] = nv; base[k] = snap; IDB.put(k, snap); break; }
          // someone else saved first: get theirs, merge, try again
          const {data:row, error:e2} = await sb.from('app_docs').select('data,version').eq('key', k).single();
          if (e2) throw e2;
          S[k] = merge(base[k], S[k], row.data); base[k] = clone(row.data); ver[k] = row.version; IDB.put(k, base[k]);
        }
      }
      saveVer(); A.save(true); status('Saved');
    } catch(e){ status(navigator.onLine === false ? 'Offline: changes are kept here and sync later' : 'Not synced yet: '+(e.message||'error'), true); }
    finally { busy = false; if (again){ again = false; schedule(); } }
  }
  function schedule(){ clearTimeout(timer); timer = setTimeout(push, 1200); }

  // roles
  function applyRole(){
    const S = A.state(), mine = RANK[A.myRole] || 1;
    if ((RANK[S.tier] || 1) > mine) S.tier = A.myRole;
    const ts = document.getElementById('tierSel'); if (!ts) return;
    [...ts.options].forEach(o => { o.hidden = o.disabled = (RANK[o.value] || 1) > mine; });
  }
  const fill0 = A.fillSwitchers;
  A.fillSwitchers = function(){ fill0(); if (sb) applyRole(); };

  async function start(client){
    sb = client;
    const r = await sb.rpc('my_role');
    A.myRole = r.error || !r.data ? 'staff' : r.data;
    if (r.error) toast('Roles are not set up in the database yet (run supabase/sync.sql).');
    applyRole();
    const who = document.getElementById('whoEmail');
    if (who && !statusEl){ statusEl = h('span',{class:'syncst','aria-live':'polite'},''); who.after(statusEl); }
    try { base = await IDB.all(); } catch(e){ base = {}; }
    try { status('Loading…'); await pull(true); await push(); status('Saved'); }
    catch(e){ status(/app_docs|save_doc|schema cache/.test(e.message||'') ? 'Shared saving is not set up yet' : 'Working offline for now', true); }
    A.onSave = schedule; // every later save also goes to the server (see save() in shell.js)
    setInterval(() => { if (document.visibilityState === 'visible' && !busy) pull().catch(() => {}); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull().then(() => push()).catch(() => {}); });
    window.addEventListener('online', () => push());
  }
  A.sync = {start, merge, pull:() => pull(), push};

  // ---------- owner: Team logins ----------
  const NAMES = () => ({staff:A.tierName('staff'), lead:A.tierName('lead'), manager:A.tierName('manager'), owner:A.tierName('owner')});
  function logins(v){
    v.append(head('Access · all locations', 'Team logins', 'Who can sign in, and at what level. Each person sees their own level and below. PINs for store mode are set under Team.'));
    if (A.demo || !sb){ v.append(h('div',{class:'card'}, h('p',null,'In the demo there are no real logins. Once you sign in, the owner adds people here and the app emails them an invite.'))); return; }
    if (A.myRole !== 'owner'){ v.append(h('div',{class:'card'},'Only the owner manages logins.')); return; }
    const list = h('div',{class:'list'}, h('p',{class:'muted'},'Loading…'));
    const f = h('form',{class:'card grid'}, h('h2',null,'Add someone'),
      h('label',{class:'f'},'Name', h('input',{type:'text',name:'name',maxlength:'60'})),
      h('label',{class:'f'},'Email', h('input',{type:'email',name:'email',required:true,maxlength:'120',autocomplete:'off'})),
      h('label',{class:'f'},'Level', h('select',{name:'role'}, Object.entries(NAMES()).map(([k,t]) => h('option',{value:k,selected:k==='staff'},t)))),
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'invite',checked:true}), 'Email them an invite now'),
      h('button',{class:'btn',type:'submit'},'Add'));
    f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f), email = String(d.get('email')).trim().toLowerCase();
      const {error} = await sb.rpc('set_member', {p_email:email, p_role:String(d.get('role')), p_name:String(d.get('name')||'')});
      if (error) return toast(error.message);
      if (d.get('invite')){ const r = await sb.functions.invoke('invite-member', {body:{email}});
        toast(r.error ? 'Added. The invite email could not be sent from here; send it from Supabase > Authentication > Users.' : (r.data && r.data.existed ? 'Added. They already have a login and can sign in now.' : 'Added and invited')); }
      else toast('Added'); A.route(); });
    v.append(f, h('div',{class:'card'}, h('h2',null,'People with access'), list));
    sb.rpc('list_members').then(({data, error}) => {
      if (error) return list.replaceChildren(h('p',{class:'msg err'}, error.message));
      list.replaceChildren(...(data || []).map(m => h('div',{class:'item'}, h('b',null, m.name || m.email), m.name ? h('span',{class:'small muted'}, m.email) : null,
        h('div',{class:'row'}, h('select',{'aria-label':'Level for '+m.email,onchange:async e=>{ const {error} = await sb.rpc('set_member', {p_email:m.email, p_role:e.target.value, p_name:m.name}); toast(error ? error.message : 'Level changed'); A.route(); }},
            Object.entries(NAMES()).map(([k,t]) => h('option',{value:k,selected:k===m.role},t))),
          h('button',{class:'btn quiet sm',type:'button',onclick:async()=>{ if (!confirm('Remove '+m.email+'? They will not be able to sign in.')) return; const {error} = await sb.rpc('remove_member', {p_email:m.email}); toast(error ? error.message : 'Removed'); A.route(); }},'Remove')))));
    });
  }
  A.register({id:'logins', name:'Team logins', what:'Who can sign in and at what level; invite people by email.', tiers:['owner'], views:{logins:{t:'Team logins', ic:'🔑', render:logins}}});
})();
