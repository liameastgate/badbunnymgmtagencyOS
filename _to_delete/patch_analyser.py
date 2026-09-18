import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
assert 'renderChatAnalyser' not in s, 'already patched'

nav_anchor="  { id: 'applications', icon: '🧑‍💻', label: 'Applications',      roles: ['admin','va'],                             section: 'Chatting' },\n"
assert nav_anchor in s
s=s.replace(nav_anchor, nav_anchor+"  { id: 'chat-analyser', icon: '🧪', label: 'Chat Analyser',      roles: ['admin','va'],                             section: 'Chatting' },\n",1)

r_anchor="  if (page === 'applications') renderApplicationsPage();\n"
assert r_anchor in s
s=s.replace(r_anchor, r_anchor+"  if (page === 'chat-analyser') renderChatAnalyser();\n",1)

d_anchor='''      <div id="applications-body"></div>
    </div>
'''
assert d_anchor in s
s=s.replace(d_anchor, d_anchor+'''
    <!-- Chat analyser -->
    <div class="page" id="page-chat-analyser">
      <div class="page-title">Chat Analyser</div>
      <div class="page-sub">Drop the Infloww <b>Message Dashboard</b> export. Every chatter gets a scorecard, every opener and bump gets a reply rate, every banned phrase gets counted — then draft the feedback in one click.</div>
      <div id="chat-analyser-body"></div>
    </div>
''',1)

js_anchor="// ── Chatter applications ─────────────────────────────────────\n"
assert js_anchor in s
js=r'''// ── Chat analyser ────────────────────────────────────────────
var CA={tab:'runs',run:null,chatters:[],lines:[],rules:[],runs:[],busy:false};
function caStrip(h){ return (h==null?'':String(h)).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').trim(); }
function caSecs(str){ if(!str) return null; var t=0,m,re=/(\d+)\s*([dhms])/g; while((m=re.exec(str))){ t+=parseInt(m[1])*({d:86400,h:3600,m:60,s:1})[m[2]]; } return t; }
function caTs(date,time){ var d=new Date(date+' '+(time||'00:00:00')); return isNaN(d)?null:d; }
function caNorm(t){ return caStrip(t).toLowerCase().replace(/^@?\S+[\s,:!]+/,'').replace(/\s+/g,' ').slice(0,60); }
function caMedian(a){ if(!a.length) return 0; var b=a.slice().sort(function(x,y){return x-y;}); var m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function caFmtSecs(s){ if(s==null) return '—'; s=Math.round(s); var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60; return (h?h+'h ':'')+m+'m '+x+'s'; }
function caPct(n,d){ return d?Math.round(n/d*100)+'%':'—'; }
function caRuleRegex(r){ try{ return new RegExp(r.is_regex?r.pattern:r.pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu'); }catch(e){ return null; } }

async function renderChatAnalyser(){
  var el=document.getElementById('chat-analyser-body'); if(!el) return;
  var rr=await sb.from('chat_rules').select('*').order('kind').order('severity');
  CA.rules=rr.data||[];
  var runs=await sb.from('chat_runs').select('*').order('created_at',{ascending:false}).limit(20);
  CA.runs=runs.data||[];
  if(!CA.run && CA.runs.length) await caLoadRun(CA.runs[0].id);
  caRender();
}
async function caLoadRun(id){
  var run=CA.runs.find(function(r){return r.id===id;}); if(!run) return;
  var c=await sb.from('chat_run_chatters').select('*').eq('run_id',id);
  var l=await sb.from('chat_run_lines').select('*').eq('run_id',id).order('uses',{ascending:false});
  CA.run=run; CA.chatters=(c.data||[]).sort(function(a,b){return (b.metrics.sent||0)-(a.metrics.sent||0);}); CA.lines=l.data||[];
}
function caSetTab(t){ CA.tab=t; caRender(); }
function caRender(){
  var el=document.getElementById('chat-analyser-body'); if(!el) return;
  var tabs=[['runs','📥 Upload & runs'],['chatters','🧑‍💻 Chatters'],['openers','👋 First messages'],['bumps','🔔 Bumps & blasts'],['ppv','💸 PPV pricing'],['rules','🚫 Rules']];
  var head='<div class="tabs">'+tabs.map(function(t){return '<div class="tab '+(CA.tab===t[0]?'active':'')+'" onclick="caSetTab(\''+t[0]+'\')">'+t[1]+'</div>';}).join('')+'</div>';
  var body='';
  if(CA.tab==='runs') body=caRenderRuns();
  else if(!CA.run) body='<div class="empty" style="margin-top:24px;"><div class="empty-icon">🧪</div><p>No run yet — upload a Message Dashboard export first.</p></div>';
  else if(CA.tab==='chatters') body=caRenderChatters();
  else if(CA.tab==='openers') body=caRenderLines('opener','First message in a thread (free, not a blast). Reply = fan replied within 7 days.');
  else if(CA.tab==='bumps') body=caRenderLines('bump','Free outbound after 6h+ of fan silence. Reply = within 48h.')+caRenderLines('blast','Same text to 20+ fans inside 10 minutes. These are not openers or bumps — they are mass sends and they almost never work.');
  else if(CA.tab==='ppv') body=caRenderPPV();
  else if(CA.tab==='rules') body=caRenderRules();
  el.innerHTML=head+body;
}
function caRenderRuns(){
  var cur=CA.run?'<div style="font-size:12px;color:var(--text2);margin-top:6px;">Viewing: '+escapeHtml(CA.run.source_file||'run')+' · '+escapeHtml(CA.run.period_start||'')+' → '+escapeHtml(CA.run.period_end||'')+' · '+(CA.run.message_count||0).toLocaleString()+' messages</div>':'';
  return '<div class="card"><div class="card-title">📥 Upload Message Dashboard export</div>'
    +'<div style="font-size:13px;color:var(--text2);margin-bottom:10px;">Infloww → Messages → Dashboard → Export (xlsx). Any date range. Nothing is sent anywhere — it is parsed in your browser and only the summary is saved.</div>'
    +'<input type="file" id="ca-file" accept=".xlsx,.xls,.csv" onchange="caHandleFile(this.files[0])" '+(CA.busy?'disabled':'')+'>'
    +'<div id="ca-status" style="font-size:13px;margin-top:8px;color:var(--text2);">'+(CA.busy?'Analysing…':'')+'</div>'+cur+'</div>'
    +'<div class="card"><div class="card-title">🗂 Previous runs</div>'+(CA.runs.length?CA.runs.map(function(r){
      var s=r.summary||{}; return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">'
        +'<div><div style="font-weight:600;">'+escapeHtml(r.period_start||'')+' → '+escapeHtml(r.period_end||'')+'</div><div style="font-size:12px;color:var(--text2);">'+(r.message_count||0).toLocaleString()+' msgs · '+(s.chatters||0)+' chatters · first-msg reply '+(s.opener_reply_rate!=null?s.opener_reply_rate+'%':'—')+' · unlock '+(s.unlock_rate!=null?s.unlock_rate+'%':'—')+' · '+fmtDate(r.created_at)+'</div></div>'
        +'<div style="display:flex;gap:6px;"><button class="btn btn-sm '+(CA.run&&CA.run.id===r.id?'btn-primary':'btn-ghost')+'" onclick="caLoadRun(\''+r.id+'\').then(caRender)">View</button><button class="btn btn-sm btn-danger" onclick="caDeleteRun(\''+r.id+'\')">🗑</button></div></div>';
    }).join(''):'<div style="color:var(--text2);font-size:13px;">Nothing analysed yet.</div>')+'</div>';
}
async function caDeleteRun(id){ if(!confirm('Delete this run and its results?')) return; await sb.from('chat_runs').delete().eq('id',id); if(CA.run&&CA.run.id===id) CA.run=null; renderChatAnalyser(); }

function caHandleFile(file){
  if(!file) return; CA.busy=true; caRender();
  var st=function(t){ var e=document.getElementById('ca-status'); if(e) e.textContent=t; };
  st('Reading '+file.name+'…');
  var r=new FileReader();
  r.onload=async function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'binary'});
      var name=wb.SheetNames.find(function(n){return /message/i.test(n);})||wb.SheetNames[0];
      var rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:''});
      if(!rows.length||!('Sender' in rows[0])||!('Sent to' in rows[0])) throw new Error('This does not look like a Message Dashboard export (need Sender / Creator / Sent to columns).');
      st('Analysing '+rows.length.toLocaleString()+' messages…');
      await new Promise(function(res){setTimeout(res,30);});
      var out=caAnalyse(rows);
      st('Saving…');
      var run=await sb.from('chat_runs').insert({created_by:STATE.profile?.email||null,source_file:file.name,period_start:out.period_start,period_end:out.period_end,message_count:rows.length,summary:out.summary}).select().single();
      if(run.error) throw run.error;
      var rid=run.data.id;
      var cr=out.chatters.map(function(c){return {run_id:rid,chatter_name:c.name,metrics:c.metrics,rule_hits:c.rule_hits,by_creator:c.by_creator};});
      var r1=await sb.from('chat_run_chatters').insert(cr); if(r1.error) throw r1.error;
      var ln=out.lines.map(function(l){ l.run_id=rid; return l; });
      for(var i=0;i<ln.length;i+=400){ var r2=await sb.from('chat_run_lines').insert(ln.slice(i,i+400)); if(r2.error) throw r2.error; }
      CA.busy=false; CA.run=null; CA.tab='chatters';
      await renderChatAnalyser();
    }catch(err){ CA.busy=false; caRender(); var e2=document.getElementById('ca-status'); if(e2) e2.textContent='Failed: '+err.message; }
  };
  r.readAsBinaryString(file);
}

function caAnalyse(rows){
  var rules=CA.rules.filter(function(r){return r.active;}).map(function(r){ return {r:r,re:caRuleRegex(r)}; }).filter(function(x){return x.re;});
  var msgs=[];
  rows.forEach(function(r){
    var ts=caTs(r['Sent date'],r['Sent time']); if(!ts) return;
    msgs.push({s:r['Sender'],c:r['Creator'],fm:caStrip(r['Fans Message']),cm:caStrip(r['Creator Message']),ts:ts,rep:caSecs(r['Reply time']),pr:parseFloat(r['Price'])||0,buy:String(r['Purchased']).toLowerCase()==='yes',src:r['Source'],ok:String(r['Status'])==='Sent',to:String(r['Sent to']||'')});
  });
  msgs.sort(function(a,b){return a.ts-b.ts;});
  var t0=msgs[0].ts, t1=msgs[msgs.length-1].ts;
  var openerFloor=new Date(t0.getTime()+7*86400000);
  var sent=msgs.filter(function(m){return m.ok&&m.src!=='AI Copilot';});
  // threads
  var th={}; sent.forEach(function(m){ var k=m.c+'|'+m.to; (th[k]=th[k]||[]).push(m); });
  // blast detection: same chatter + norm text, 20+ distinct fans within 10 min
  var blastKeys={}; (function(){
    var g={}; sent.forEach(function(m){ if(m.fm||m.pr>0) return; var k=m.s+'|'+caNorm(m.cm); (g[k]=g[k]||[]).push(m); });
    Object.keys(g).forEach(function(k){ var L=g[k]; if(L.length<20) return; for(var i=0;i+19<L.length;i++){ if(L[i+19].ts-L[i].ts<=600000){ blastKeys[k]=true; break; } } });
  })();
  var isBlast=function(m){ return !!blastKeys[m.s+'|'+caNorm(m.cm)]; };
  var per={}; var P=function(n){ return per[n]=per[n]||{name:n,sent:0,unsent:0,replies:0,fans:{},ppv:0,unl:0,unlPrices:[],ppvPrices:[],lat:[],rev:0,openers:0,openerReplies:0,openerName:0,bumps:0,bumpReplies:0,blasts:0,blastReplies:0,hits:{},bands:{lo:[0,0],mid:[0,0],hi:[0,0]},byc:{},tmpl:{}}; };
  msgs.forEach(function(m){ if(!m.ok) P(m.s).unsent++; });
  var lines={};
  var L=function(kind,m,rep){ var key=kind+'|'+m.s+'|'+m.c+'|'+caNorm(m.cm); var x=lines[key]=lines[key]||{kind:kind,chatter_name:m.s,creator:m.c,text_norm:caNorm(m.cm),sample_text:m.cm.slice(0,200),uses:0,replies:0,unlocks:0,revenue:0}; x.uses++; if(rep) x.replies++; };
  Object.keys(th).forEach(function(k){
    var ms=th[k]; var f=ms[0];
    ms.forEach(function(m,i){
      var p=P(m.s); p.sent++; if(m.fm){ p.replies++; if(m.rep!=null) p.lat.push(m.rep); } p.fans[m.to]=(p.fans[m.to]||0)+1;
      var bc=p.byc[m.c]=p.byc[m.c]||{sent:0,fans:{},ppv:0,unl:0,rev:0}; bc.sent++; bc.fans[m.to]=1;
      if(m.pr>0){ p.ppv++; p.ppvPrices.push(m.pr); bc.ppv++; var band=m.pr<=20?'lo':(m.pr<40?'mid':'hi'); p.bands[band][0]++; if(m.buy){ p.unl++; p.unlPrices.push(m.pr); p.rev+=m.pr; bc.unl++; bc.rev+=m.pr; p.bands[band][1]++; } }
      // rules
      rules.forEach(function(x){ if(x.re.test(m.cm)){ var h=p.hits[x.r.id]=p.hits[x.r.id]||{id:x.r.id,label:x.r.label,kind:x.r.kind,severity:x.r.severity,count:0,examples:[]}; h.count++; if(h.examples.length<3&&h.examples.indexOf(m.cm.slice(0,140))<0) h.examples.push(m.cm.slice(0,140)); } });
    });
    // first contact
    if(!f.fm&&f.pr===0&&f.ts>=openerFloor){
      var bl=isBlast(f); var p=P(f.s);
      var rep=ms.slice(1).some(function(x){return x.fm&&(x.ts-f.ts)<=7*86400000;});
      if(bl){ p.blasts++; if(rep) p.blastReplies++; L('blast',f,rep); }
      else { p.openers++; if(rep) p.openerReplies++; var nm=f.to.split(' (')[0].trim().split(/\s+/)[0]; if(nm&&nm.length>1&&f.cm.toLowerCase().slice(0,40).indexOf(nm.toLowerCase())>=0) p.openerName++; var tk=caNorm(f.cm); p.tmpl[tk]=(p.tmpl[tk]||0)+1; L('opener',f,rep); }
    }
    // bumps
    for(var i=1;i<ms.length;i++){ var m=ms[i]; if(m.fm||m.pr>0) continue; var pv=ms[i-1]; if(pv.fm) continue; if(m.ts-pv.ts<6*3600000) continue; var p2=P(m.s); var rep2=ms.slice(i+1).some(function(x){return x.fm&&(x.ts-m.ts)<=48*3600000;}); if(isBlast(m)){ p2.blasts++; if(rep2) p2.blastReplies++; L('blast',m,rep2); } else { p2.bumps++; if(rep2) p2.bumpReplies++; L('bump',m,rep2); } }
  });
  var chatters=Object.keys(per).map(function(n){ var p=per[n]; var fans=Object.keys(p.fans).length; var tmplTop=Object.keys(p.tmpl).sort(function(a,b){return p.tmpl[b]-p.tmpl[a];})[0];
    var m={sent:p.sent,unsent:p.unsent,replies:p.replies,fans:fans,msgs_per_fan:fans?+(p.sent/fans).toFixed(1):0,fans_2plus_pct:fans?Math.round(Object.keys(p.fans).filter(function(k){return p.fans[k]>=2;}).length/fans*100):0,
      ppv:p.ppv,unlocked:p.unl,unlock_rate:p.ppv?Math.round(p.unl/p.ppv*100):null,median_unlocked:caMedian(p.unlPrices),median_ppv:caMedian(p.ppvPrices),revenue:Math.round(p.rev),median_reply_secs:p.lat.length?caMedian(p.lat):null,
      openers:p.openers,opener_reply_rate:p.openers?Math.round(p.openerReplies/p.openers*100):null,opener_name_pct:p.openers?Math.round(p.openerName/p.openers*100):null,opener_top_template_pct:p.openers&&tmplTop?Math.round(p.tmpl[tmplTop]/p.openers*100):0,opener_top_template:tmplTop||'',
      bumps:p.bumps,bump_reply_rate:p.bumps?Math.round(p.bumpReplies/p.bumps*100):null,blasts:p.blasts,blast_reply_rate:p.blasts?Math.round(p.blastReplies/p.blasts*100):null,
      bands:{lo:p.bands.lo,mid:p.bands.mid,hi:p.bands.hi}};
    var byc={}; Object.keys(p.byc).forEach(function(c){ var b=p.byc[c]; byc[c]={sent:b.sent,fans:Object.keys(b.fans).length,ppv:b.ppv,unlocked:b.unl,revenue:Math.round(b.rev)}; });
    return {name:n,metrics:m,rule_hits:Object.values(p.hits).sort(function(a,b){return b.count-a.count;}),by_creator:byc};
  }).filter(function(c){return c.metrics.sent>=20;});
  var allOp=chatters.reduce(function(a,c){return a+c.metrics.openers;},0), allOpR=Object.values(per).reduce(function(a,p){return a+p.openerReplies;},0);
  var allPPV=chatters.reduce(function(a,c){return a+c.metrics.ppv;},0), allUnl=chatters.reduce(function(a,c){return a+c.metrics.unlocked;},0);
  var lineArr=Object.values(lines).filter(function(l){return l.uses>=3||l.kind==='blast';});
  return {period_start:t0.toISOString().slice(0,10),period_end:t1.toISOString().slice(0,10),chatters:chatters,lines:lineArr,
    summary:{chatters:chatters.length,opener_reply_rate:allOp?Math.round(allOpR/allOp*100):null,unlock_rate:allPPV?Math.round(allUnl/allPPV*100):null,sent:sent.length}};
}

function caRenderChatters(){
  var team=CA.run.summary||{};
  return CA.chatters.map(function(c){ var m=c.metrics; var hits=(c.rule_hits||[]).filter(function(h){return h.kind==='banned';}); var good=(c.rule_hits||[]).filter(function(h){return h.kind==='preferred';});
    var cell=function(l,v,bad){ return '<div style="min-width:110px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);">'+l+'</div><div style="font-weight:700;font-size:16px;'+(bad?'color:var(--red,#e5484d);':'')+'">'+v+'</div></div>'; };
    return '<div class="card" style="padding:14px 16px;margin-bottom:12px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><div style="font-weight:800;font-size:17px;">'+escapeHtml(c.chatter_name)+'</div><button class="btn btn-sm btn-primary" onclick="caDraftFeedback(\''+c.id+'\')">📝 Draft feedback</button></div>'
      +'<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;">'
      +cell('Sent',m.sent.toLocaleString())+cell('Fans',m.fans)+cell('Msgs / fan',m.msgs_per_fan)+cell('First-msg reply',m.opener_reply_rate!=null?m.opener_reply_rate+'% <span style="font-size:11px;font-weight:400;color:var(--text2);">of '+m.openers+'</span>':'—',m.opener_reply_rate!=null&&m.opener_reply_rate<20)
      +cell('Name in 1st msg',m.opener_name_pct!=null?m.opener_name_pct+'%':'—',m.opener_name_pct!=null&&m.opener_name_pct<50)+cell('Top template',m.opener_top_template_pct+'%',m.opener_top_template_pct>50)
      +cell('Bumps',m.bumps+' · '+(m.bump_reply_rate!=null?m.bump_reply_rate+'%':'—'),m.bump_reply_rate!=null&&m.bump_reply_rate<10)+cell('Blasts',m.blasts+' · '+(m.blast_reply_rate!=null?m.blast_reply_rate+'%':'—'),m.blasts>100)
      +cell('PPV sent',m.ppv)+cell('Unlock',m.unlock_rate!=null?m.unlock_rate+'%':'—',m.unlock_rate!=null&&m.unlock_rate<30)+cell('Median unlocked','$'+m.median_unlocked)+cell('Unlocked $','$'+m.revenue.toLocaleString())+cell('Reply time',caFmtSecs(m.median_reply_secs),m.median_reply_secs>600)
      +'</div>'
      +(m.opener_top_template?'<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Most-used first message ('+m.opener_top_template_pct+'%): <i>'+escapeHtml(m.opener_top_template)+'…</i></div>':'')
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:4px;">🚫 Flagged phrases</div>'+(hits.length?hits.map(function(h){return '<div style="font-size:13px;margin-bottom:6px;"><b>'+escapeHtml(h.label)+'</b> ×'+h.count+'<div style="font-size:12px;color:var(--text2);">'+h.examples.map(function(e){return '“'+escapeHtml(e)+'”';}).join('<br>')+'</div></div>';}).join(''):'<div style="font-size:13px;color:var(--text2);">None. Good.</div>')+'</div>'
      +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:4px;">✅ Preferred phrases</div>'+(good.length?good.map(function(h){return '<div style="font-size:13px;margin-bottom:4px;"><b>'+escapeHtml(h.label)+'</b> ×'+h.count+'</div>';}).join(''):'<div style="font-size:13px;color:var(--text2);">Not using any of the preferred lines.</div>')
      +'<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin:10px 0 4px;">By page</div>'+Object.keys(c.by_creator||{}).sort(function(a,b){return c.by_creator[b].sent-c.by_creator[a].sent;}).map(function(k){var b=c.by_creator[k];return '<div style="font-size:12px;">'+escapeHtml(k)+': '+b.sent+' msgs · '+b.fans+' fans · '+b.ppv+' PPV · '+b.unlocked+' unlocked · $'+b.revenue.toLocaleString()+'</div>';}).join('')+'</div>'
      +'</div></div>';
  }).join('')||'<div class="empty" style="margin-top:24px;"><p>No chatters with 20+ messages in this run.</p></div>';
}
function caRenderLines(kind,sub){
  var L=CA.lines.filter(function(l){return l.kind===kind;}).map(function(l){ l.rate=l.uses?l.replies/l.uses:0; return l; }).sort(function(a,b){return b.uses-a.uses;}).slice(0,60);
  var title={opener:'👋 First messages',bump:'🔔 Bumps',blast:'📣 Blasts'}[kind];
  return '<div class="card"><div class="card-title">'+title+'</div><div style="font-size:12px;color:var(--text2);margin-bottom:8px;">'+sub+'</div>'
    +(L.length?'<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="color:var(--text2);font-size:11px;text-transform:uppercase;"><th style="text-align:left;padding:6px;">Message</th><th style="padding:6px;">Who</th><th style="padding:6px;">Uses</th><th style="padding:6px;">Replies</th><th style="padding:6px;">Rate</th></tr></thead><tbody>'
    +L.map(function(l){ var r=Math.round(l.rate*100); return '<tr style="border-top:1px solid var(--border);"><td style="padding:6px;max-width:520px;">'+escapeHtml(l.sample_text)+'</td><td style="padding:6px;white-space:nowrap;color:var(--text2);">'+escapeHtml(l.chatter_name)+' / '+escapeHtml(l.creator)+'</td><td style="padding:6px;text-align:center;">'+l.uses+'</td><td style="padding:6px;text-align:center;">'+l.replies+'</td><td style="padding:6px;text-align:center;font-weight:700;color:'+(r>=30?'var(--green,#3ecf8e)':r<10?'var(--red,#e5484d)':'inherit')+'">'+r+'%</td></tr>'; }).join('')
    +'</tbody></table></div>':'<div style="font-size:13px;color:var(--text2);">None in this run.</div>')+'</div>';
}
function caRenderPPV(){
  return '<div class="card"><div class="card-title">💸 Price bands</div><div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Section 5 says the ends convert and the middle does not. Here is whether that is true per chatter.</div>'
    +'<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="color:var(--text2);font-size:11px;text-transform:uppercase;"><th style="text-align:left;padding:6px;">Chatter</th><th style="padding:6px;">≤ $20</th><th style="padding:6px;">$21–39</th><th style="padding:6px;">$40+</th><th style="padding:6px;">Median sent</th><th style="padding:6px;">Median unlocked</th></tr></thead><tbody>'
    +CA.chatters.map(function(c){ var b=c.metrics.bands||{}; var f=function(x){ return x&&x[0]?x[1]+'/'+x[0]+' <b>('+Math.round(x[1]/x[0]*100)+'%)</b>':'—'; }; return '<tr style="border-top:1px solid var(--border);"><td style="padding:6px;font-weight:600;">'+escapeHtml(c.chatter_name)+'</td><td style="padding:6px;text-align:center;">'+f(b.lo)+'</td><td style="padding:6px;text-align:center;">'+f(b.mid)+'</td><td style="padding:6px;text-align:center;">'+f(b.hi)+'</td><td style="padding:6px;text-align:center;">$'+c.metrics.median_ppv+'</td><td style="padding:6px;text-align:center;">$'+c.metrics.median_unlocked+'</td></tr>'; }).join('')
    +'</tbody></table></div></div>';
}
function caRenderRules(){
  var row=function(r){ return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);'+(r.active?'':'opacity:.5;')+'"><div><div style="font-weight:600;">'+escapeHtml(r.label)+' <span class="cscan '+({high:'cscan-red',medium:'cscan-amber',low:'cscan-green'})[r.severity]+'" style="cursor:default;font-size:10px;">'+r.severity+'</span></div><div style="font-family:monospace;font-size:12px;color:var(--text2);">'+escapeHtml(r.pattern)+(r.is_regex?'  (regex)':'')+'</div>'+(r.note?'<div style="font-size:12px;color:var(--text2);">'+escapeHtml(r.note)+'</div>':'')+'</div><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-ghost" onclick="caToggleRule(\''+r.id+'\','+(!r.active)+')">'+(r.active?'Disable':'Enable')+'</button><button class="btn btn-sm btn-danger" onclick="caDeleteRule(\''+r.id+'\')">🗑</button></div></div>'; };
  var banned=CA.rules.filter(function(r){return r.kind==='banned';}), pref=CA.rules.filter(function(r){return r.kind==='preferred';});
  return '<div class="card"><div class="card-title">➕ Add a rule</div><div style="display:grid;grid-template-columns:140px 1fr 1fr;gap:8px;align-items:center;">'
    +'<select id="ca-r-kind"><option value="banned">🚫 Banned</option><option value="preferred">✅ Preferred</option></select>'
    +'<input id="ca-r-label" placeholder="Label (what you call it)">'
    +'<input id="ca-r-pattern" placeholder="Phrase to match, e.g. come say hi">'
    +'<select id="ca-r-sev"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>'
    +'<input id="ca-r-note" placeholder="Why (chatters see this)" style="grid-column:span 2;">'
    +'<label style="font-size:12px;color:var(--text2);"><input type="checkbox" id="ca-r-regex"> regex</label>'
    +'<div></div><button class="btn btn-sm btn-primary" onclick="caAddRule()">Save rule</button></div>'
    +'<div style="font-size:12px;color:var(--text2);margin-top:8px;">Plain phrases match anywhere, case-insensitive. Rules apply on the next upload. Chatters can read the active rules from their SOP.</div></div>'
    +'<div class="card"><div class="card-title">🚫 Banned ('+banned.length+')</div>'+banned.map(row).join('')+'</div>'
    +'<div class="card"><div class="card-title">✅ Preferred ('+pref.length+')</div>'+pref.map(row).join('')+'</div>';
}
async function caAddRule(){
  var g=function(id){ return (document.getElementById(id)||{}).value||''; };
  var pattern=g('ca-r-pattern').trim(), label=g('ca-r-label').trim();
  if(!pattern||!label){ alert('Need a label and a phrase.'); return; }
  var isre=!!(document.getElementById('ca-r-regex')||{}).checked;
  if(isre){ try{ new RegExp(pattern,'iu'); }catch(e){ alert('Bad regex: '+e.message); return; } }
  var r=await sb.from('chat_rules').insert({kind:g('ca-r-kind'),pattern:pattern,is_regex:isre,label:label,note:g('ca-r-note').trim()||null,severity:g('ca-r-sev'),created_by:STATE.profile?.email||null});
  if(r.error){ alert('Could not save: '+r.error.message); return; }
  renderChatAnalyser();
}
async function caToggleRule(id,active){ await sb.from('chat_rules').update({active:active}).eq('id',id); renderChatAnalyser(); }
async function caDeleteRule(id){ if(!confirm('Delete this rule?')) return; await sb.from('chat_rules').delete().eq('id',id); renderChatAnalyser(); }

async function caDraftFeedback(chatterRowId){
  var c=CA.chatters.find(function(x){return x.id===chatterRowId;}); if(!c) return;
  var m=c.metrics, team=CA.run.summary||{}; var lines=[];
  lines.push('Chat review '+(CA.run.period_start||'')+' to '+(CA.run.period_end||''));
  lines.push('');
  lines.push('Numbers: '+m.sent.toLocaleString()+' messages to '+m.fans+' fans ('+m.msgs_per_fan+' each). First-message reply rate '+(m.opener_reply_rate!=null?m.opener_reply_rate+'%':'n/a')+' (team '+(team.opener_reply_rate!=null?team.opener_reply_rate+'%':'n/a')+'). PPV: '+m.ppv+' sent, '+(m.unlock_rate!=null?m.unlock_rate+'%':'n/a')+' unlocked, median $'+m.median_unlocked+' (team '+(team.unlock_rate!=null?team.unlock_rate+'%':'n/a')+').');
  var fixes=[];
  if(m.opener_top_template_pct>50) fixes.push('Your first message is the same line '+m.opener_top_template_pct+'% of the time ("'+m.opener_top_template+'…"). Rotate at least 4 openers and put his name in the first line — the personalised ones on this team reply 2x.');
  if(m.opener_name_pct!=null&&m.opener_name_pct<50) fixes.push('Only '+m.opener_name_pct+'% of your first messages use the fan\'s name. Section 1: always the name.');
  if(m.blasts>100) fixes.push(m.blasts+' of your messages were blasts (same text to 20+ fans in minutes) and they replied '+(m.blast_reply_rate||0)+'%. Stop blasting. Bump only fans who replied in the last 30 days, max 30 per shift.');
  if(m.bump_reply_rate!=null&&m.bump_reply_rate<10&&m.bumps>=20) fixes.push('Bumps reply '+m.bump_reply_rate+'%. Never lead with his silence ("you\'ve been quiet") and never give an out ("no pressure", "when you can"). A bump needs a reason to answer.');
  var hi=(c.rule_hits||[]).filter(function(h){return h.kind==='banned'&&h.severity==='high';});
  if(hi.length) fixes.push('Banned phrases: '+hi.map(function(h){return h.label+' x'+h.count;}).join(', ')+'. Example: "'+(hi[0].examples[0]||'')+'". These are in the SOP for a reason — they get 0 replies.');
  var b=m.bands||{}; if(b.hi&&b.hi[0]>=20&&b.lo&&b.lo[0]>=10&&(b.hi[1]/b.hi[0])<(b.lo[1]/b.lo[0])/2) fixes.push('Your $40+ PPVs unlock '+Math.round(b.hi[1]/b.hi[0]*100)+'% but your $20-and-under unlock '+Math.round(b.lo[1]/b.lo[0]*100)+'%. Open with the cheaper one, then step up — you are pricing cold fans like warm ones.');
  if(m.unlock_rate!=null&&m.unlock_rate<30&&!fixes.some(function(f){return f.indexOf('$40+')>=0;})) fixes.push('Unlock rate '+m.unlock_rate+'% — ask one qualifying question (where he is, what he does) before the first PPV so the price fits the fan.');
  if(!fixes.length) fixes.push('Nothing flagged this period. Keep doing what you are doing.');
  lines.push(''); lines.push('Fix this month:'); fixes.slice(0,3).forEach(function(f,i){ lines.push((i+1)+'. '+f); });
  var body=lines.join('\n');
  var cp=await sb.from('profiles').select('email,name').eq('role','chatter');
  var prof=(cp.data||[]).find(function(p){ return (p.name||'').toLowerCase().indexOf(c.chatter_name.toLowerCase())>=0 || (p.email||'').toLowerCase().indexOf(c.chatter_name.toLowerCase())>=0; });
  var r=await sb.from('chatter_feedback').insert({chatter_email:prof?prof.email:c.chatter_name,chatter_name:c.chatter_name,body:body,rating:null,status:'draft',created_by:STATE.profile?.email||null});
  if(r.error){ alert('Could not draft: '+r.error.message); return; }
  alert('Draft saved in Feedback → Drafts for '+c.chatter_name+(prof?'':' (no chatter login matched the name — set the email before publishing)')+'. Nothing reaches the chatter until you publish it.');
}

'''
s=s.replace(js_anchor, js+js_anchor,1)
open(p,'w',encoding='utf-8').write(s)
print('patched ok')
