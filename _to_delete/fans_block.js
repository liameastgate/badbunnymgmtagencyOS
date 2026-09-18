// ── New Subs queue ───────────────────────────────────────────────────────────
// Fed by the desktop watcher (sub-queue-ingest edge function) from the Infloww
// Sales Record + Message Dashboard exports. A sub sits here until a chatter has
// actually sent it a first message. Claim/skip is live coordination between
// chatters on shift; the real truth comes from the next export, so a row the
// watcher sees as contacted drops off whether or not anyone ticked it.
var NQ = { rows: [], tab: 'waiting', creator: 'all', loading: false };

// From the 90-day audit: a sub a chatter handled inside 72h was worth $12.70,
// an unhandled one $1.47. That gap is what's on the table per fan.
var NQ_WORTH = 12.70, NQ_COLD = 1.47;

function nqCss(){
  if(document.getElementById('nq-css')) return;
  var s=document.createElement('style'); s.id='nq-css';
  s.textContent=''
    +'.nq-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px;}'
    +'.nq-kpi{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;}'
    +'.nq-kpi .n{font-size:26px;font-weight:700;line-height:1.1;}'
    +'.nq-kpi .l{font-size:12px;color:var(--text2);margin-top:3px;}'
    +'.nq-kpi.hot .n{color:var(--yellow);} .nq-kpi.bad .n{color:var(--red);} .nq-kpi.good .n{color:var(--green);}'
    +'.nq-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}'
    +'.nq-f{background:var(--surface2);border:1px solid var(--border);color:var(--text2);border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer;}'
    +'.nq-f.on{background:var(--accent);border-color:var(--accent);color:#fff;}'
    +'.nq-row{display:flex;align-items:center;gap:14px;padding:13px 16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);margin-bottom:8px;}'
    +'.nq-row.mine{border-color:var(--accent);}'
    +'.nq-row.taken{opacity:.5;}'
    +'.nq-who{flex:1;min-width:0;}'
    +'.nq-name{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    +'.nq-meta{font-size:12px;color:var(--text2);margin-top:2px;}'
    +'.nq-page{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--surface);border:1px solid var(--border);}'
    +'.nq-age{font-size:13px;font-weight:600;min-width:58px;text-align:right;}'
    +'.nq-age.fresh{color:var(--green);} .nq-age.warm{color:var(--yellow);} .nq-age.cold{color:var(--red);}'
    +'.nq-cash{font-size:11px;font-weight:600;min-width:64px;text-align:right;color:var(--green);text-transform:uppercase;letter-spacing:.03em;}'
    +'.nq-cash.gone{color:var(--text2);font-weight:500;}'
    +'.nq-acts{display:flex;gap:6px;}'
    +'@media(max-width:700px){.nq-row{flex-wrap:wrap;}.nq-who{flex-basis:100%;}}';
  document.head.appendChild(s);
}

var NQ_CLAIM_HOURS = 4;   // a claim is "I'm on it"; it lapses on its own, nobody has to release
function nqClaimLive(r){ return r.claimed_by && r.claimed_at && (Date.now() - new Date(r.claimed_at).getTime()) < NQ_CLAIM_HOURS*36e5; }
function nqMe(){ return (STATE.profile && (STATE.profile.name || STATE.profile.email)) || 'me'; }
function nqHours(r){ return (Date.now() - new Date(r.subscribed_at).getTime()) / 36e5; }
function nqAgeTxt(h){ return h < 1 ? Math.max(1, Math.round(h*60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h/24) + 'd'; }
function nqAgeCls(h){ return h < 6 ? 'fresh' : h < 72 ? 'warm' : 'cold'; }

async function nqLoad(){
  NQ.loading = true;
  var since = new Date(Date.now() - 14*864e5).toISOString();
  var r = await sb.from('sub_queue').select('*').gte('subscribed_at', since)
           .order('subscribed_at', {ascending:true}).limit(500);
  NQ.rows = r.data || [];
  NQ.loading = false;
}

async function renderNewSubs(){
  var el = document.getElementById('new-subs-body'); if(!el) return;
  nqCss();
  if(!NQ.rows.length && !NQ.loading){ el.innerHTML = '<div class="empty"><p>Loading…</p></div>'; await nqLoad(); }
  nqPaint();
}

function nqPaint(){
  var el = document.getElementById('new-subs-body'); if(!el) return;
  var me = nqMe();
  var all = NQ.rows;
  var waiting = all.filter(function(r){ return !r.contacted_at && !r.outcome; });
  var mine    = all.filter(function(r){ return nqClaimLive(r) && r.claimed_by === me && !r.contacted_at && !r.outcome; });
  var won     = all.filter(function(r){ return r.first_purchase_at; });
  var fresh   = waiting.filter(function(r){ return nqHours(r) < 72; });
  var onTable = fresh.length * (NQ_WORTH - NQ_COLD);

  var creators = [];
  all.forEach(function(r){ if(creators.indexOf(r.creator) < 0) creators.push(r.creator); });
  creators.sort();

  var list = NQ.tab === 'mine' ? mine : NQ.tab === 'won' ? won.slice().reverse() : waiting;
  if(NQ.creator !== 'all') list = list.filter(function(r){ return r.creator === NQ.creator; });

  var h = '<div class="nq-strip">'
    + '<div class="nq-kpi ' + (waiting.length > 20 ? 'bad' : waiting.length ? 'hot' : 'good') + '"><div class="n">' + waiting.length + '</div><div class="l">waiting for a first message</div></div>'
    + '<div class="nq-kpi hot"><div class="n">$' + Math.round(onTable) + '</div><div class="l">expected if these get opened today (avg $12.70 a sub worked in 72h vs $1.47 not)</div></div>'
    + '<div class="nq-kpi"><div class="n">' + mine.length + '</div><div class="l">claimed by you</div></div>'
    + '<div class="nq-kpi good"><div class="n">' + won.length + '</div><div class="l">bought since subscribing</div></div>'
    + '</div>';

  h += '<div class="nq-filters">'
    + ['waiting','mine','won'].map(function(t){
        var lab = t === 'waiting' ? '⏰ Waiting (' + waiting.length + ')' : t === 'mine' ? '🙋 Mine (' + mine.length + ')' : '💸 Bought (' + won.length + ')';
        return '<button class="nq-f' + (NQ.tab === t ? ' on' : '') + '" onclick="NQ.tab=\'' + t + '\';nqPaint();">' + lab + '</button>';
      }).join('')
    + '<span style="flex:1;"></span>'
    + '<button class="nq-f' + (NQ.creator === 'all' ? ' on' : '') + '" onclick="NQ.creator=\'all\';nqPaint();">All pages</button>'
    + creators.map(function(c){ return '<button class="nq-f' + (NQ.creator === c ? ' on' : '') + '" onclick="NQ.creator=\'' + c.replace(/'/g,"\\'") + '\';nqPaint();">' + escapeHtml(c) + '</button>'; }).join('')
    + '<button class="nq-f" onclick="nqRefresh()">↻</button>'
    + '</div>';

  if(!list.length){
    h += '<div class="empty" style="margin-top:20px;"><div class="empty-icon">' + (NQ.tab === 'won' ? '💸' : '✅') + '</div><p>'
      + (NQ.tab === 'won' ? 'No purchases from new subs in the last 14 days.'
        : NQ.tab === 'mine' ? 'Nothing claimed. Take one from the waiting list.'
        : 'Every new sub has been messaged. Go and work your inbox.') + '</p></div>';
  } else {
    h += list.map(function(r){
      var hrs = nqHours(r), live = nqClaimLive(r), taken = live && r.claimed_by !== me, isMine = live && r.claimed_by === me;
      var win = hrs < 72 ? 'in window' : 'past 72h';
      var sub = NQ.tab === 'won'
        ? 'subscribed ' + fmtDateTime(r.subscribed_at) + ' · spent $' + Number(r.spend_since || 0).toFixed(0) + (r.contacted_by ? ' · opened by ' + escapeHtml(r.contacted_by) : '')
        : 'subscribed ' + fmtDateTime(r.subscribed_at) + (live ? ' · ' + escapeHtml(r.claimed_by) + ' is on it' : '');
      return '<div class="nq-row' + (isMine ? ' mine' : taken ? ' taken' : '') + '">'
        + '<span class="nq-page">' + escapeHtml(r.creator) + '</span>'
        + '<div class="nq-who"><div class="nq-name">' + escapeHtml(r.fan_name || ('fan ' + r.fan_id)) + '</div><div class="nq-meta">' + sub + '</div></div>'
        + (NQ.tab === 'won'
            ? '<span class="nq-cash">$' + Number(r.spend_since || 0).toFixed(0) + '</span>'
            : '<span class="nq-age ' + nqAgeCls(hrs) + '">' + nqAgeTxt(hrs) + '</span>'
              + '<span class="nq-cash' + (hrs < 72 ? '' : ' gone') + '">' + win + '</span>'
              + '<span class="nq-acts">'
              + (isMine
                  ? '<button class="btn btn-sm btn-ghost" onclick="nqClaim(\'' + r.id + '\',false)">Release</button>'
                    + '<button class="btn btn-sm btn-primary" onclick="nqOutcome(\'' + r.id + '\',\'messaged\')">Messaged</button>'
                  : taken
                    ? '<button class="btn btn-sm btn-ghost" disabled>Taken</button>'
                    : '<button class="btn btn-sm btn-primary" onclick="nqClaim(\'' + r.id + '\',true)" title="Puts your name on him so nobody else on shift opens the same fan">Claim</button>')
              + '</span>')
        + '</div>';
    }).join('');
  }

  h += '<div class="ca-mini" style="margin-top:14px;">Fed by the Infloww exports the watcher picks up. <b>Claim</b> just marks a fan as "I\'m on it" so nothing gets opened twice at a handover; it lapses by itself after ' + NQ_CLAIM_HOURS + ' hours, no need to release. <b>Messaged</b> just hides him from your list; the real record comes from the next export, and a fan drops off automatically once it shows he got a first message. The dollar figure at the top is an average, not a price: over the last 90 days a new sub who got a first message inside 72h went on to spend $12.70 on average, one who didn\'t spent $1.47.</div>';
  el.innerHTML = h;
}

async function nqRefresh(){ await nqLoad(); nqPaint(); }

async function nqClaim(id, take){
  var r = NQ.rows.find(function(x){ return x.id === id; }); if(!r) return;
  var patch = take ? { claimed_by: nqMe(), claimed_at: new Date().toISOString() } : { claimed_by: null, claimed_at: null };
  Object.assign(r, patch); nqPaint();
  var res = await sb.from('sub_queue').update(patch).eq('id', id);
  if(res.error){ toast && toast('Could not claim — refreshing'); await nqRefresh(); }
}

async function nqOutcome(id, outcome){
  var r = NQ.rows.find(function(x){ return x.id === id; }); if(!r) return;
  var patch = { outcome: outcome, outcome_at: new Date().toISOString(), claimed_by: nqMe() };
  Object.assign(r, patch); nqPaint();
  var res = await sb.from('sub_queue').update(patch).eq('id', id);
  if(res.error){ toast && toast('Did not save — refreshing'); await nqRefresh(); }
}
// ── Fan Stats ────────────────────────────────────────────────────────────────
// One profile per fan per page, rebuilt from the Infloww exports the watcher
// pushes (fan_sales + fan_messages -> fan_stats). Nothing here is typed by hand
// except the notes box. Search by name or fan id; default view is top spenders.
var FS = { q: '', list: [], sel: null, msgs: [], profile: null, tab: 'top' };

function fsCss(){
  if(document.getElementById('fs-css')) return;
  var s=document.createElement('style'); s.id='fs-css';
  s.textContent=''
    +'.fs-top{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}'
    +'.fs-search{flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:10px 14px;font-size:14px;font-family:inherit;}'
    +'.fs-search:focus{outline:none;border-color:var(--accent);}'
    +'.fs-grid{display:grid;grid-template-columns:300px 1fr;gap:16px;}'
    +'@media(max-width:860px){.fs-grid{grid-template-columns:1fr;}}'
    +'.fs-list{background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden;max-height:70vh;overflow-y:auto;}'
    +'.fs-item{padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;}'
    +'.fs-item:hover{background:rgba(255,255,255,.03);} .fs-item.on{background:rgba(30,79,255,.14);}'
    +'.fs-item .nm{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    +'.fs-item .sub{font-size:11px;color:var(--text2);}'
    +'.fs-item .amt{font-weight:700;font-size:13px;color:var(--green);white-space:nowrap;}'
    +'.fs-card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:14px;}'
    +'.fs-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px;}'
    +'.fs-h h2{margin:0;font-size:22px;}'
    +'.fs-tier{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;}'
    +'.fs-tier.whale{background:rgba(255,200,60,.15);color:var(--yellow);} .fs-tier.reg{background:rgba(74,158,255,.15);color:var(--green);} .fs-tier.new{background:rgba(136,146,176,.15);color:var(--text2);}'
    +'.fs-page{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--surface);border:1px solid var(--border);}'
    +'.fs-sub{color:var(--text2);font-size:13px;}'
    +'.fs-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:14px;}'
    +'.fs-st{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;}'
    +'.fs-st .v{font-size:18px;font-weight:700;} .fs-st .k{font-size:11px;color:var(--text2);margin-top:2px;line-height:1.35;}'
    +'.fs-st .v.warn{color:var(--yellow);} .fs-st .v.bad{color:var(--red);} .fs-st .v.good{color:var(--green);}'
    +'.fs-sec{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin:0 0 8px;}'
    +'.fs-hours{display:flex;gap:2px;align-items:flex-end;height:36px;margin:6px 0 4px;}'
    +'.fs-hours i{flex:1;background:var(--accent);opacity:.75;border-radius:2px 2px 0 0;min-height:2px;}'
    +'.fs-hours i.peak{opacity:1;background:var(--yellow);}'
    +'.fs-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--text2);}'
    +'.fs-ai{border-left:3px solid var(--accent);}'
    +'.fs-fact{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;}'
    +'.fs-fact:last-child{border-bottom:0;} .fs-fact b{min-width:84px;color:var(--text2);font-weight:600;}'
    +'.fs-fact q{display:block;color:var(--text2);font-size:12px;font-style:italic;margin-top:2px;} .fs-fact q:before,.fs-fact q:after{content:"";}'
    +'.fs-loop{display:flex;gap:10px;align-items:center;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:13px;}'
    +'.fs-loop .d{font-weight:700;color:var(--yellow);min-width:60px;}'
    +'.fs-msgs{max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;}'
    +'.fs-m{max-width:78%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;}'
    +'.fs-m.in{align-self:flex-start;background:var(--surface);border:1px solid var(--border);}'
    +'.fs-m.out{align-self:flex-end;background:rgba(30,79,255,.18);border:1px solid rgba(30,79,255,.35);}'
    +'.fs-m.unsent{opacity:.55;border-style:dashed;}'
    +'.fs-m .meta{font-size:10px;color:var(--text2);margin-top:3px;}'
    +'.fs-m .ppv{font-weight:700;color:var(--yellow);}'
    +'.fs-notes{width:100%;box-sizing:border-box;min-height:80px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-family:inherit;font-size:13px;resize:vertical;}'
    +'.fs-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px;vertical-align:middle;}'
    +'.fs-badge.unsent{background:rgba(239,68,68,.15);color:var(--red);} .fs-badge.sent{background:rgba(74,158,255,.15);color:var(--green);}'
    +'.fs-flag{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;margin:0 6px 6px 0;text-transform:uppercase;letter-spacing:.04em;}'
    +'.fs-flag.burn_risk,.fs-flag.pestered{background:rgba(239,68,68,.15);color:var(--red);} .fs-flag.cooling,.fs-flag.ceiling{background:rgba(255,200,60,.15);color:var(--yellow);} .fs-flag.post_purchase{background:rgba(74,158,255,.15);color:var(--green);}'
    +'.fs-move{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--yellow);border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.5;}'
    +'.fs-rungs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}'
    +'.fs-rung{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;cursor:pointer;}'
    +'.fs-rung.done{border-color:var(--green);} .fs-rung.due{border-color:var(--yellow);}'
    +'.fs-rung b{display:block;font-size:13px;margin-bottom:2px;} .fs-rung .w{color:var(--text2);}';
  document.head.appendChild(s);
}

function fsMoney(n){ return '$' + Math.round(Number(n||0)).toLocaleString(); }
function fsAgo(ts){ if(!ts) return '—'; var h=(Date.now()-new Date(ts).getTime())/36e5; return h<1?'just now':h<48?Math.round(h)+'h ago':Math.round(h/24)+'d ago'; }
var FS_STAGE={whale:['whale','Whale'],regular:['reg','Regular'],first_buy:['reg','First buy'],talking:['new','Talking'],ghost:['new','Ghost']};
function fsTier(f){ return FS_STAGE[f.stage]||(f.total_net>=500?['whale','Whale']:f.total_net>=50?['reg','Regular']:['new','New']); }
var FS_FLAG={burn_risk:'Burn risk',pestered:'Pestered',post_purchase:'Post-purchase',ceiling:'Ceiling',cooling:'Cooling'};
var FS_RUNGS=[[1,'Lock screen','proof he set it'],[2,'The show','something you both watch'],[3,'The song','what he trains to'],[4,'Inside joke','from something he said'],[5,'First look','before anyone else'],[6,'Real milestone','a date that happened']];

async function renderFanStats(){
  var el=document.getElementById('fan-stats-body'); if(!el) return;
  fsCss();
  if(!FS.list.length){ await fsSearch(''); }
  fsPaint();
}

async function fsSearch(q){
  FS.q=q||'';
  var r;
  if(FS.q.trim()){
    var t=FS.q.trim();
    r=await sb.from('fan_stats').select('*').or('fan_name.ilike.%'+t.replace(/[%,]/g,'')+'%,fan_id.eq.'+t.replace(/\D/g,'')).order('total_net',{ascending:false}).limit(60);
  } else if(FS.tab==='quiet'){
    r=await sb.from('fan_stats').select('*').gte('total_net',50).lt('last_msg_in_at',new Date(Date.now()-7*864e5).toISOString()).order('total_net',{ascending:false}).limit(60);
  } else {
    r=await sb.from('fan_stats').select('*').order('total_net',{ascending:false}).limit(60);
  }
  FS.list=r.data||[];
  if(!FS.sel && FS.list.length) await fsOpen(FS.list[0].creator, FS.list[0].fan_id);
}

async function fsOpen(creator, fanId){
  FS.sel=FS.list.find(function(x){return x.creator===creator&&x.fan_id===fanId;})||FS.sel;
  var m=await sb.from('fan_messages').select('ts,direction,sender,text,price,purchased,status').eq('creator',creator).eq('fan_id',fanId).order('ts',{ascending:false}).limit(40);
  FS.msgs=(m.data||[]).reverse();
  var p=await sb.from('fan_profiles').select('*').eq('fan_id',fanId).maybeSingle();
  FS.profile=(p&&p.data)||null;
  var l=await sb.from('fan_ladder').select('*').eq('creator',creator).eq('fan_id',fanId).order('done_at',{ascending:false});
  FS.ladder=l.data||[];
  fsPaint();
}

function fsPaint(){
  var el=document.getElementById('fan-stats-body'); if(!el) return;
  var h='<div class="fs-top">'
    +'<input class="fs-search" placeholder="Search a fan by name or ID…" value="'+escapeHtml(FS.q)+'" onkeydown="if(event.key===\'Enter\'){fsSearch(this.value).then(fsPaint)}">'
    +'<button class="btn btn-sm '+(FS.tab==='top'?'btn-primary':'btn-ghost')+'" onclick="FS.tab=\'top\';fsSearch(\'\').then(fsPaint)">Top spenders</button>'
    +'<button class="btn btn-sm '+(FS.tab==='quiet'?'btn-primary':'btn-ghost')+'" onclick="FS.tab=\'quiet\';fsSearch(\'\').then(fsPaint)">Spenders gone quiet</button>'
    +'</div><div class="fs-grid">';
  h+='<div class="fs-list">'+(FS.list.length?FS.list.map(function(f){
    var on=FS.sel&&FS.sel.creator===f.creator&&FS.sel.fan_id===f.fan_id;
    return '<div class="fs-item'+(on?' on':'')+'" onclick="fsOpen(\''+f.creator+'\',\''+f.fan_id+'\')"><div style="min-width:0;"><div class="nm">'+escapeHtml(f.fan_name||('fan '+f.fan_id))+'</div><div class="sub">'+escapeHtml(f.creator)+' · last msg '+fsAgo(f.last_msg_in_at)+'</div></div><div class="amt">'+fsMoney(f.total_net)+'</div></div>';
  }).join(''):'<div class="empty"><p>No fans match.</p></div>')+'</div>';
  h+='<div>'+(FS.sel?fsCard(FS.sel):'<div class="empty"><p>Pick a fan.</p></div>')+'</div></div>';
  el.innerHTML=h;
}

function fsCard(f){
  var tier=fsTier(f), P=FS.profile||{};
  var quietDays=f.last_msg_in_at?Math.round((Date.now()-new Date(f.last_msg_in_at).getTime())/864e5):null;
  var hrs=(f.hours_utc||[]), off=f.tz_offset||0, local=[]; for(var i=0;i<24;i++){ local[i]=hrs[((i-off)%24+24)%24]||0; }
  var mx=Math.max.apply(null,local.concat([1]));
  var h='<div class="fs-card">'
    +'<div class="fs-h"><h2>'+escapeHtml(f.fan_name||('fan '+f.fan_id))+'</h2><span class="fs-tier '+tier[0]+'">'+tier[1]+'</span><span class="fs-page">'+escapeHtml(f.creator)+'</span><span class="fs-sub">id '+f.fan_id+'</span></div>'
    +'<div class="fs-sub">'+(f.tz_label?'Probably <b>'+escapeHtml(f.tz_label)+'</b> (from when he messages, '+f.msgs_in+' msgs)':'Timezone unknown — not enough messages yet')
    +' · subscribed '+fmtDate(f.subscribed_at)+(f.sub_count>1?' · '+f.sub_count+' subs':'')+' · first seen '+fmtDate(f.first_seen)+'</div>'
    +'<div class="fs-stats">'
    +'<div class="fs-st"><div class="v good">'+fsMoney(f.total_net)+'</div><div class="k">'+f.purchases+' purchases · net</div></div>'
    +'<div class="fs-st"><div class="v">'+(f.last_purchase_at?fsMoney(f.last_purchase_net):'—')+'</div><div class="k">last purchase · '+fsAgo(f.last_purchase_at)+'</div></div>'
    +'<div class="fs-st"><div class="v">'+(f.max_unlocked?fsMoney(f.max_unlocked):'—')+'</div><div class="k">highest PPV unlocked'+((f.ignored_prices||[]).length?' · ignored '+f.ignored_prices.slice(0,3).map(fsMoney).join(', '):'')+'</div></div>'
    +'<div class="fs-st"><div class="v">'+(f.ppv_sent?Math.round(f.ppv_unlocked/f.ppv_sent*100)+'%':'—')+'</div><div class="k">unlock rate · '+f.ppv_unlocked+'/'+f.ppv_sent+' PPV</div></div>'
    +'<div class="fs-st"><div class="v '+(quietDays==null?'':quietDays>=7&&f.total_net>=50?'bad':quietDays>=3?'warn':'')+'">'+(quietDays==null?'—':quietDays+'d')+'</div><div class="k">since he last messaged</div></div>'
    +'<div class="fs-st"><div class="v">'+f.msgs_in+' / '+f.msgs_out+'</div><div class="k">his msgs / ours · mostly '+escapeHtml(f.top_chatter||'—')+'</div></div>'
    +'</div></div>';

  // what to do with him — stage, flags, next move (Section 6)
  var flags=(f.flags||[]);
  h+='<div class="fs-card"><div class="fs-sec">What to do with him</div>'
    +(flags.length?'<div style="margin-bottom:8px;">'+flags.map(function(x){return '<span class="fs-flag '+x+'">'+(FS_FLAG[x]||x)+'</span>';}).join('')+'</div>':'')
    +'<div class="fs-move">'+escapeHtml(f.next_move||'—')+'</div>'
    +(f.unopened_ppv||f.paid_asks_7d?'<div class="fs-sub" style="margin-top:8px;">'+f.unopened_ppv+' unopened PPV in his inbox · '+f.paid_asks_7d+' paid asks this week · '+f.chatters_7d+' chatters on him this week</div>':'')
    +'</div>';

  // the ladder — only once he's a regular
  if(f.stage==='regular'||f.stage==='whale'){
    var L=FS.ladder||[], last=L[0], due=!last||(Date.now()-new Date(last.done_at).getTime())>14*864e5;
    h+='<div class="fs-card"><div class="fs-sec">Ladder · one rung every 1–2 weeks'+(due?' · <span style="color:var(--yellow)">next rung due</span>':'')+'</div><div class="fs-rungs">'
      +FS_RUNGS.map(function(r){ var d=L.find(function(x){return x.rung===r[0];}); var nextDue=due&&!d&&!FS_RUNGS.slice(0,r[0]-1).some(function(q){return !L.find(function(x){return x.rung===q[0];});});
        return '<div class="fs-rung'+(d?' done':nextDue?' due':'')+'" onclick="fsRung(\''+f.creator+'\',\''+f.fan_id+'\','+r[0]+')" title="'+(d?'Done by '+escapeHtml(d.done_by||'')+' '+fmtDate(d.done_at):'Click when done')+'"><b>'+r[0]+'. '+r[1]+'</b><span class="w">'+(d?'✓ '+escapeHtml(d.done_by||'')+' · '+fmtDate(d.done_at)+(d.note?' · '+escapeHtml(d.note):''):r[2])+'</span></div>'; }).join('')
      +'</div></div>';
  }

  // contact history — the bit that answers "when did he last get a bump"
  h+='<div class="fs-card"><div class="fs-sec">Last contact</div>'
    +'<div class="fs-fact"><b>1:1 message</b><span>'+(f.last_bump_at?fmtDateTime(f.last_bump_at)+' · '+escapeHtml(f.last_bump_by||'')+'<span class="fs-badge '+(f.last_bump_status==='Unsent'?'unsent':'sent')+'">'+escapeHtml(f.last_bump_status||'Sent')+'</span>':'never')+'</span></div>'
    +'<div class="fs-fact"><b>Mass message</b><span>'+(f.last_mass_at?fmtDateTime(f.last_mass_at)+'<span class="fs-badge '+(f.last_mass_status==='Unsent'?'unsent':'sent')+'">'+escapeHtml(f.last_mass_status||'Sent')+'</span>'+' · '+f.mass_30d+' in the last 30d':'none detected')+'</span></div>'
    +'<div class="fs-fact"><b>Unsent</b><span>'+f.unsent_30d+' messages unsent in the last 30d (he still saw the notification)</span></div>'
    +'<div class="fs-fact"><b>First opener</b><span>'+(f.first_opener?'<i>'+escapeHtml(f.first_opener.slice(0,140))+'</i> — '+escapeHtml(f.first_opener_by||'')+', '+fmtDate(f.first_opener_at):'—')+'</span></div>'
    +'</div>';

  // when he's around
  h+='<div class="fs-card"><div class="fs-sec">When he messages (his local time'+(f.tz_label?', '+escapeHtml(f.tz_label):'')+')</div>'
    +'<div class="fs-hours">'+local.map(function(v){return '<i style="height:'+Math.max(4,Math.round(v/mx*100))+'%" class="'+(v===mx&&v>0?'peak':'')+'" title="'+v+'"></i>';}).join('')+'</div>'
    +'<div class="fs-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div></div>';

  // AI layer (piece 2) — shown when a profile exists
  if(P.summary||P.facts||P.loops){
    h+='<div class="fs-card fs-ai"><div class="fs-sec">Last conversation · '+(P.summary_at?fmtDate(P.summary_at):'')+'</div><div style="font-size:14px;line-height:1.55;">'+escapeHtml(P.summary||'')+'</div></div>';
    if((P.loops||[]).length) h+='<div class="fs-card fs-ai"><div class="fs-sec">Open loops — ask him about these</div>'+P.loops.map(function(l){return '<div class="fs-loop"><span class="d">'+escapeHtml(l.when||'')+'</span><span>'+escapeHtml(l.what)+'<q style="display:block;color:var(--text2);font-size:12px;font-style:italic;">'+escapeHtml(l.quote||'')+'</q></span></div>';}).join('')+'</div>';
    if((P.facts||[]).length) h+='<div class="fs-card fs-ai"><div class="fs-sec">About him</div>'+P.facts.map(function(x){return '<div class="fs-fact"><b>'+escapeHtml(x.k)+'</b><span>'+escapeHtml(x.v)+(x.quote?'<q>'+escapeHtml(x.quote)+'</q>':'')+'</span></div>';}).join('')+'</div>';
  } else {
    h+='<div class="fs-card fs-ai"><div class="fs-sec">Profile · last conversation · open loops</div><div class="fs-sub">Built from his messages once the extraction step is on. Needs 3+ messages from him.</div></div>';
  }

  h+='<div class="fs-card"><div class="fs-sec">Notes (yours — never overwritten)</div><textarea class="fs-notes" placeholder="Anything the exports can\'t know…" onchange="fsSaveNote(\''+f.fan_id+'\',this.value)">'+escapeHtml(P.notes||'')+'</textarea></div>';

  h+='<div class="fs-card"><div class="fs-sec">Recent messages</div><div class="fs-msgs">'+(FS.msgs.length?FS.msgs.map(function(m){
    return '<div class="fs-m '+m.direction+(m.status==='Unsent'?' unsent':'')+'">'+(m.price>0?'<span class="ppv">PPV '+fsMoney(m.price)+(m.purchased?' · unlocked':' · not opened')+'</span><br>':'')+escapeHtml(m.text||'')+'<div class="meta">'+(m.direction==='out'?escapeHtml(m.sender||'')+' · ':'')+fmtDateTime(m.ts)+(m.status==='Unsent'?' · unsent':'')+'</div></div>';
  }).join(''):'<div class="fs-sub">No messages stored for this fan yet.</div>')+'</div></div>';
  return h;
}

async function fsRung(creator, fanId, rung){
  var note=prompt('Rung '+rung+' done — what did you use? (optional)'); if(note===null) return;
  var row={creator:creator, fan_id:fanId, rung:rung, note:note||null, done_by:nqMe?nqMe():((STATE.profile&&STATE.profile.name)||'')};
  var res=await sb.from('fan_ladder').insert(row);
  if(res.error){ toast && toast('Not saved'); return; }
  await fsOpen(creator, fanId);
}

async function fsSaveNote(fanId, val){
  var res=await sb.from('fan_profiles').upsert({fan_id:fanId, notes:val, notes_by:(STATE.profile&&STATE.profile.email)||null, notes_at:new Date().toISOString()},{onConflict:'fan_id'});
  if(res.error){ toast && toast('Note not saved'); }
}

// ── Fans page: one nav item, the queue + the profiles ────────────────────────
var FANS_TAB = 'new';
function renderFans(){
  var el=document.getElementById('fans-tabs'); if(!el) return;
  el.innerHTML='<div class="tabs" style="margin-bottom:14px;">'
    +'<div class="tab'+(FANS_TAB==='new'?' active':'')+'" onclick="FANS_TAB=\'new\';renderFans()">⏰ New subs</div>'
    +'<div class="tab'+(FANS_TAB==='fans'?' active':'')+'" onclick="FANS_TAB=\'fans\';renderFans()">🧑‍💼 Fan stats</div>'
    +'</div>';
  var a=document.getElementById('new-subs-body'), b=document.getElementById('fan-stats-body');
  if(FANS_TAB==='new'){ b.hidden=true; a.hidden=false; renderNewSubs(); }
  else { a.hidden=true; b.hidden=false; renderFanStats(); }
}
