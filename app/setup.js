// Setup: the owner names each location, picks its business type (bookstore, retail, café, services...)
// and can rename the role tiers. The business type sets the default words and which modules start on.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, D, toast} = A;
  const S = () => A.state();

  function setup(v){
    const here = A.site();
    v.append(head('Owner · '+here.name, 'Set up this location', 'Pick what kind of business this is and the names your team uses. You can change these any time.'));
    if (A.tier().id !== 'owner'){ v.append(h('div',{class:'card'},'Only the owner can change setup.')); return; }

    const form = h('form',{class:'card grid'});
    form.append(h('h2',null,'The basics'),
      h('label',{class:'f'},'Location name', h('input',{type:'text',name:'name',value:here.name,maxlength:'60',required:true})),
      h('label',{class:'f'},'Business type',
        h('select',{name:'type'}, Object.entries(D.BUSINESS_TYPES).map(([id,t]) => h('option',{value:id,selected:id===here.type},t.name)))),
      h('p',{class:'small muted'},'The business type sets the role names below and which modules start switched on. Changing it keeps your data.'));

    const typeDefaults = D.BUSINESS_TYPES[here.type].tiers || {};
    form.append(h('h2',null,'What you call each role'),
      h('p',{class:'small muted'},'Leave a box empty to use the usual name for this business type.'));
    D.TIERS.forEach(t => form.append(h('label',{class:'f'}, 'Role '+(D.TIERS.indexOf(t)+1)+' (usual name: '+(typeDefaults[t.id]||t.name)+')',
      h('input',{type:'text',name:'tier-'+t.id,value:here.tiers[t.id]||'',maxlength:'30',placeholder:typeDefaults[t.id]||t.name}))));
    form.append(h('button',{class:'btn',type:'submit'},'Save setup'));
    form.addEventListener('submit', e => {
      e.preventDefault(); const f = new FormData(form), tiers = {};
      D.TIERS.forEach(t => { const val = String(f.get('tier-'+t.id)||'').trim(); if (val) tiers[t.id] = val; });
      const changedType = f.get('type') !== here.type;
      S().setup[here.id] = {name:String(f.get('name')).trim() || here.name, type:f.get('type'), tiers};
      if (changedType && S().mods[here.id]) delete S().mods[here.id]; // modules follow the new type's defaults
      A.save(); A.fillSwitchers(); toast('Setup saved'); A.route();
    });
    v.append(form);

    // Your data is yours: one file with everything this device holds for every location (a backup you control,
    // and the way to leave at any time). Settings for this device only (which role you're viewing as) are left out.
    const LOCAL_ONLY = ['tier','site','kioskWho','schedWeek','tsWeek','impactRange','cover','lastExport'];
    v.append(h('div',{class:'card grid'}, h('h2',null,'Download all your data'),
      h('p',{class:'small muted'},'One file with your schedules, time clock, checklists, customers, special orders, vendors, receiving, cash logs, expenses, events and notes. Keep it with your backups. It is yours if you ever stop using Downtown Stube.'),
      h('p',{class:'small muted'},'It holds staff and customer details, so store it somewhere private, like an encrypted drive or your password manager\'s file vault.'),
      h('div',{class:'row'}, h('button',{class:'btn ghost',type:'button',onclick:()=>{
        const out = {}; Object.keys(S()).filter(k => !LOCAL_ONLY.includes(k)).forEach(k => out[k] = S()[k]);
        A.download('downtown-stube-data-'+A.isoDay(new Date())+'.json','application/json', JSON.stringify({app:'Downtown Stube', exported:new Date().toISOString(), by:A.me(), data:out}, null, 1));
        S().lastExport = new Date().toISOString(); A.save(true); A.route();
      }},'Download all data (.json)')),
      S().lastExport ? h('p',{class:'small'},'Last downloaded on this device: '+A.fmtTime(S().lastExport)) : h('p',{class:'small'},'Not downloaded on this device yet. Once a month is a good habit.')));

    // Demo only. Signed in, this would replace the shop's shared records (customers, schedule, expenses) for everyone.
    if (A.demo) v.append(h('div',{class:'card'}, h('h2',null,'Sample data'),
      h('p',{class:'small muted'},'This test version keeps everything in this browser only. Starting over puts the made-up sample data back.'),
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>{
        const keep = {site:S().site};
        Object.keys(S()).forEach(k => delete S()[k]); Object.assign(S(), A.fresh(), keep);
        A.save(); A.fillSwitchers(); toast('Sample data restored'); A.route();
      }},'Start over with sample data'))));
  }

  A.ownerHooks.push(v => { const last = A.state().lastExport, days = last ? (Date.now() - new Date(last)) / 864e5 : 999;
    if (A.demo || days < 31) return;
    v.append(h('div',{class:'card'}, h('h2',null,'Back up your data'), h('p',null, last ? 'Your last download from this device was '+Math.floor(days)+' days ago. ' : 'You haven\'t downloaded a copy of your data on this device yet. '),
      h('a',{href:'#/setup'},'Download it under Setup'))); });

  A.register({id:'setup', name:'Setup', what:'Location name, business type and role names.', tiers:['owner'],
    views:{setup:{t:'Setup', ic:'⚙️', render:setup}}});
})();
