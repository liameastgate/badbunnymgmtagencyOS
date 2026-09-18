// ── Chat analyser ────────────────────────────────────────────
var CA={tab:'runs',run:null,chatters:[],lines:[],rules:[],runs:[],busy:false,funnel:[],files:{msgs:null,sales:null}};
function caStrip(h){ return (h==null?'':String(h)).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').trim(); }
function caSecs(str){ if(!str) return null; var t=0,m,re=/(\d+)\s*([dhms])/g; while((m=re.exec(str))){ t+=parseInt(m[1])*({d:86400,h:3600,m:60,s:1})[m[2]]; } return t; }
function caTs(date,time){ var d=new Date(date+' '+(time||'00:00:00')); return isNaN(d)?null:d; }
function caNorm(t){ return caStrip(t).toLowerCase().replace(/^@?\S+[\s,:!]+/,'').replace(/\s+/g,' ').slice(0,60); }
function caMedian(a){ if(!a.length) return 0; var b=a.slice().sort(function(x,y){return x-y;}); var m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function caFmtSecs(s){ if(s==null) return '—'; s=Math.round(s); var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60; return (h?h+'h ':'')+m+'m '+x+'s'; }
function caPct(n,d){ return d?Math.round(n/d*100)+'%':'—'; }
function caRuleRegex(r){ try{ return new RegExp(r.is_regex?r.pattern:r.pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu'); }catch(e){ return null; } }


async function caLoadRun(id){
  var run=CA.runs.find(function(r){return r.id===id;}); if(!run) return;
  var c=await sb.from('chat_run_chatters').select('*').eq('run_id',id);
  var l=await sb.from('chat_run_lines').select('*').eq('run_id',id).order('uses',{ascending:false});
  var f=await sb.from('chat_run_funnel').select('*').eq('run_id',id);
  CA.run=run; CA.chatters=(c.data||[]).sort(function(a,b){return (b.metrics.sent||0)-(a.metrics.sent||0);}); CA.lines=l.data||[]; CA.funnel=f.data||[];
}

async function caDeleteRun(id){ if(!confirm('Delete this run and its results?')) return; await sb.from('chat_runs').delete().eq('id',id); if(CA.run&&CA.run.id===id) CA.run=null; renderChatAnalyser(); }


function caPick(kind,file){ CA.files[kind]=file||null; }
function caReadSheet(file,pick){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(e){ try{ var wb=XLSX.read(e.target.result,{type:'binary'}); var name=pick(wb.SheetNames)||wb.SheetNames[0]; res(XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:''})); }catch(err){ rej(err); } }; r.onerror=rej; r.readAsBinaryString(file); }); }
async function caRunUpload(){
  if(!CA.files.msgs){ alert('Pick the Message Dashboard export first.'); return; }
  CA.busy=true; caRender();
  var st=function(t){ var e=document.getElementById('ca-status'); if(e) e.textContent=t; };
  try{
    st('Reading files…');
    var rows=await caReadSheet(CA.files.msgs,function(n){return n.find(function(x){return /message/i.test(x);});});
    if(!rows.length||!('Sender' in rows[0])||!('Sent to' in rows[0])) throw new Error('First file does not look like a Message Dashboard export (need Sender / Creator / Sent to).');
    var sales=null;
    if(CA.files.sales){ sales=await caReadSheet(CA.files.sales,function(n){return n.find(function(x){return /sales/i.test(x);});}); if(!sales.length||!('Fan ID' in sales[0])||!('Type' in sales[0])) throw new Error('Second file does not look like a Sales Record export (need Fan ID / Type / Creator).'); }
    st('Analysing '+rows.length.toLocaleString()+' messages'+(sales?' + '+sales.length.toLocaleString()+' sales rows':'')+'…');
    await new Promise(function(res){setTimeout(res,30);});
    var out=caAnalyse(rows);
    var fun=sales?caAnalyseFunnel(rows,sales,out):null;
    if(fun){ out.summary.funnel=fun.summary; out.summary.unworked=fun.unworked; }
    st('Saving…');
    var run=await sb.from('chat_runs').insert({created_by:STATE.profile?.email||null,source_file:CA.files.msgs.name+(CA.files.sales?' + '+CA.files.sales.name:''),period_start:out.period_start,period_end:out.period_end,message_count:rows.length,summary:out.summary}).select().single();
    if(run.error) throw run.error;
    var rid=run.data.id;
    var r1=await sb.from('chat_run_chatters').insert(out.chatters.map(function(c){return {run_id:rid,chatter_name:c.name,metrics:c.metrics,rule_hits:c.rule_hits,by_creator:c.by_creator};})); if(r1.error) throw r1.error;
    var ln=out.lines.map(function(l){ l.run_id=rid; return l; });
    for(var i=0;i<ln.length;i+=400){ var r2=await sb.from('chat_run_lines').insert(ln.slice(i,i+400)); if(r2.error) throw r2.error; }
    if(fun&&fun.rows.length){ var r3=await sb.from('chat_run_funnel').insert(fun.rows.map(function(f){ f.run_id=rid; return f; })); if(r3.error) throw r3.error; }
    CA.busy=false; CA.run=null; CA.files={msgs:null,sales:null}; CA.tab=fun?'funnel':'chatters';
    await renderChatAnalyser();
  }catch(err){ CA.busy=false; caRender(); var e2=document.getElementById('ca-status'); if(e2) e2.textContent='Failed: '+err.message; }
}

function caFanKey(to){ var m=/\((u\d+)\)\s*$/.exec(to||''); return m?m[1]:null; }
function caFanName(to){ return (to||'').split(' (')[0].trim().toLowerCase(); }
function caAnalyseFunnel(rows,sales,out){
  // index sent messages by creator + fan id / name
  var byId={}, byName={};
  rows.forEach(function(r){ if(String(r['Status'])!=='Sent') return; var ts=caTs(r['Sent date'],r['Sent time']); if(!ts) return; var to=String(r['Sent to']||''); var m={ts:ts,fm:!!caStrip(r['Fans Message']),pr:parseFloat(r['Price'])||0,buy:String(r['Purchased']).toLowerCase()==='yes',s:r['Sender'],c:r['Creator']};
    var id=caFanKey(to); if(id){ var k1=m.c+'|'+id; (byId[k1]=byId[k1]||[]).push(m); } var k2=m.c+'|'+caFanName(to); (byName[k2]=byName[k2]||[]).push(m); });
  var money=function(v){ return parseFloat(String(v||'').replace(/[^0-9.\-]/g,''))||0; };
  var S=sales.map(function(r){ return {ts:new Date(String(r['Date & time Asia/Chongqing']||r['Date & time']||'').replace(' ','T')),c:r['Creator'],fan:String(r['Fan']||''),id:String(r['Fan ID']||''),net:money(r['Net revenue']||r['Earnings']),type:String(r['Type']||'')}; }).filter(function(x){return !isNaN(x.ts);});
  var subs=S.filter(function(x){return x.type==='Subscription';});
  var buys={}; S.forEach(function(x){ if(x.type==='Subscription') return; var k=x.c+'|'+x.id; (buys[k]=buys[k]||[]).push(x); });
  var end=out&&out.period_end?new Date(out.period_end+'T23:59:59'):new Date();
  var H=3600000;
  var agg={creator:{},chatter:{},week:{}}; var unworked=[];
  var bump=function(scope,key,fn){ var a=agg[scope][key]=agg[scope][key]||{scope:scope,key:key,subs:0,contacted_1h:0,contacted_24h:0,contacted_72h:0,replied_72h:0,ppv_72h:0,bought_7d:0,bought_30d:0,revenue_30d:0,unmatched:0}; fn(a); };
  subs.forEach(function(sb0){
    var t0=sb0.ts; var ms=byId[sb0.c+'|u'+sb0.id]||byName[sb0.c+'|'+sb0.fan.toLowerCase()]||null;
    var after=ms?ms.filter(function(m){return m.ts>=t0;}):[];
    var first=after.length?after.reduce(function(a,m){return m.ts<a.ts?m:a;}):null;
    var lag=first?(first.ts-t0)/H:null;
    var in72=after.filter(function(m){return (m.ts-t0)<=72*H;});
    var replied=in72.some(function(m){return m.fm;}); var ppv=in72.some(function(m){return m.pr>0;});
    var B=buys[sb0.c+'|'+sb0.id]||[]; var b7=B.filter(function(x){return x.ts>=t0&&(x.ts-t0)<=7*86400000;}); var b30=B.filter(function(x){return x.ts>=t0&&(x.ts-t0)<=30*86400000;});
    var rev30=b30.reduce(function(a,x){return a+x.net;},0);
    var who=null; if(in72.length){ var cnt={}; in72.forEach(function(m){cnt[m.s]=(cnt[m.s]||0)+1;}); who=Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a];})[0]; }
    var wk=new Date(t0); wk.setDate(wk.getDate()-((wk.getDay()+6)%7)); var wkKey=wk.toISOString().slice(0,10);
    var apply=function(a){ a.subs++; if(!ms) a.unmatched++; if(lag!=null&&lag<=1) a.contacted_1h++; if(lag!=null&&lag<=24) a.contacted_24h++; if(lag!=null&&lag<=72) a.contacted_72h++; if(replied) a.replied_72h++; if(ppv) a.ppv_72h++; if(b7.length) a.bought_7d++; if(b30.length) a.bought_30d++; a.revenue_30d+=rev30; };
    bump('creator',sb0.c,apply); bump('week',wkKey,apply); bump('chatter',who||'nobody',apply);
    if((end-t0)<=72*H&&!first) unworked.push({fan:sb0.fan,creator:sb0.c,subscribed:t0.toISOString(),hours:Math.round((end-t0)/H)});
  });
  var rows2=[]; ['creator','chatter','week'].forEach(function(sc){ Object.values(agg[sc]).forEach(function(a){ a.revenue_30d=Math.round(a.revenue_30d*100)/100; rows2.push(a); }); });
  var tot=Object.values(agg.creator).reduce(function(t,a){ Object.keys(a).forEach(function(k){ if(typeof a[k]==='number') t[k]=(t[k]||0)+a[k]; }); return t; },{});
  unworked.sort(function(a,b){return b.hours-a.hours;});
  return {rows:rows2,unworked:unworked.slice(0,300),summary:{subs:tot.subs||0,contacted_1h_pct:tot.subs?Math.round(tot.contacted_1h/tot.subs*100):null,contacted_72h_pct:tot.subs?Math.round(tot.contacted_72h/tot.subs*100):null,bought_7d_pct:tot.subs?Math.round(tot.bought_7d/tot.subs*100):null,bought_30d_pct:tot.subs?Math.round(tot.bought_30d/tot.subs*100):null,unmatched_pct:tot.subs?Math.round(tot.unmatched/tot.subs*100):null}};
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
  var fr=(CA.funnel||[]).find(function(f){return f.scope==='chatter'&&f.key===c.chatter_name;});
  if(fr&&fr.subs>=10) lines.push('New subs you handled first: '+fr.subs+'. Messaged within an hour '+Math.round(fr.contacted_1h/fr.subs*100)+'%, replied '+Math.round(fr.replied_72h/fr.subs*100)+'%, sent a PPV in 72h '+Math.round(fr.ppv_72h/fr.subs*100)+'%, bought within 7 days '+Math.round(fr.bought_7d/fr.subs*100)+'% (target 10%).');
  var fixes=[];
  if(m.opener_top_template_pct>50) fixes.push('Your first message is the same line '+m.opener_top_template_pct+'% of the time ("'+m.opener_top_template+'…"). Rotate at least 4 openers and put his name in the first line — the personalised ones on this team reply 2x.');
  if(m.opener_name_pct!=null&&m.opener_name_pct<50) fixes.push('Only '+m.opener_name_pct+'% of your first messages use the fan\'s name. Section 1: always the name.');
  if(m.blasts>100) fixes.push(m.blasts+' of your messages were blasts (same text to 20+ fans in minutes) and they replied '+(m.blast_reply_rate||0)+'%. Stop blasting. Bump only fans who replied in the last 30 days, max 30 per shift.');
  if(m.bump_reply_rate!=null&&m.bump_reply_rate<10&&m.bumps>=20) fixes.push('Bumps reply '+m.bump_reply_rate+'%. Never lead with his silence ("you\'ve been quiet") and never give an out ("no pressure", "when you can"). A bump needs a reason to answer.');
  var hi=(c.rule_hits||[]).filter(function(h){return h.kind==='banned'&&h.severity==='high';});
  if(hi.length) fixes.push('Banned phrases: '+hi.map(function(h){return h.label+' x'+h.count;}).join(', ')+'. Example: "'+(hi[0].examples[0]||'')+'". These are in the SOP for a reason — they get 0 replies.');
  var b=m.bands||{}; if(b.hi&&b.hi[0]>=20&&b.lo&&b.lo[0]>=10&&(b.hi[1]/b.hi[0])<(b.lo[1]/b.lo[0])/2) fixes.push('Your $40+ PPVs unlock '+Math.round(b.hi[1]/b.hi[0]*100)+'% but your $20-and-under unlock '+Math.round(b.lo[1]/b.lo[0]*100)+'%. Open with the cheaper one, then step up — you are pricing cold fans like warm ones.');
  if(m.unlock_rate!=null&&m.unlock_rate<30&&!fixes.some(function(f){return f.indexOf('$40+')>=0;})) fixes.push('Unlock rate '+m.unlock_rate+'% — ask one qualifying question (where he is, what he does) before the first PPV so the price fits the fan.');
  if(fr&&fr.subs>=10&&fr.ppv_72h/fr.subs<0.3) fixes.push('Only '+Math.round(fr.ppv_72h/fr.subs*100)+'% of the new subs you handled got a PPV in their first 72 hours. Qualify, then send the $20-and-under one by message five. No PPV, no sale.');
  if(!fixes.length) fixes.push('Nothing flagged this period. Keep doing what you are doing.');
  lines.push(''); lines.push('Fix this month:'); fixes.slice(0,3).forEach(function(f,i){ lines.push((i+1)+'. '+f); });
  var body=lines.join('\n');
  var cp=await sb.from('profiles').select('email,name').eq('role','chatter');
  var prof=(cp.data||[]).find(function(p){ return (p.name||'').toLowerCase().indexOf(c.chatter_name.toLowerCase())>=0 || (p.email||'').toLowerCase().indexOf(c.chatter_name.toLowerCase())>=0; });
  var r=await sb.from('chatter_feedback').insert({chatter_email:prof?prof.email:c.chatter_name,chatter_name:c.chatter_name,body:body,rating:null,status:'draft',created_by:STATE.profile?.email||null});
  if(r.error){ alert('Could not draft: '+r.error.message); return; }
  alert('Draft saved in Feedback → Drafts for '+c.chatter_name+(prof?'':' (no chatter login matched the name — set the email before publishing)')+'. Nothing reaches the chatter until you publish it.');
}

// ── Chat analyser · UI ───────────────────────────────────────
var CA_CSS='\
.ca-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:4px 0 14px}\
.ca-kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;position:relative;overflow:hidden}\
.ca-kpi .l{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text2)}\
.ca-kpi .v{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:2px 0 4px}\
.ca-kpi .t{font-size:11px;color:var(--text2)}\
.ca-kpi .bar{height:3px;background:var(--border);border-radius:3px;margin-top:8px;overflow:hidden}\
.ca-kpi .bar i{display:block;height:100%;border-radius:3px}\
.ca-ok{color:var(--green)} .ca-warn{color:var(--yellow)} .ca-bad{color:var(--red)}\
.ca-bg-ok{background:var(--green)} .ca-bg-warn{background:var(--yellow)} .ca-bg-bad{background:var(--red)}\
.ca-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}\
.ca-period{font-size:12px;color:var(--text2)}\
.ca-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface2)}\
.ca-chip.ok{border-color:rgba(74,158,255,.5);color:var(--green)} .ca-chip.warn{border-color:rgba(255,200,60,.5);color:var(--yellow)} .ca-chip.bad{border-color:rgba(239,68,68,.5);color:var(--red)}\
.ca-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:12px}\
.ca-card h3{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em}\
.ca-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}\
.ca-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:12px}\
.ca-stat{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:9px 11px}\
.ca-stat .l{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);white-space:nowrap}\
.ca-stat .v{font-size:17px;font-weight:800;margin-top:2px}\
.ca-stat .s{font-size:10px;color:var(--text2)}\
.ca-stat .bar{height:3px;background:var(--border);border-radius:3px;margin-top:6px;overflow:hidden}\
.ca-stat .bar i{display:block;height:100%}\
.ca-cols{display:grid;grid-template-columns:1.3fr 1fr;gap:14px}\
@media(max-width:820px){.ca-cols{grid-template-columns:1fr}}\
.ca-sub{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin:0 0 6px}\
.ca-flag{padding:8px 10px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);margin-bottom:6px}\
.ca-flag b{font-size:13px} .ca-flag .n{font-size:11px;color:var(--text2);margin-left:6px}\
.ca-flag q{display:block;font-size:12px;color:var(--text2);margin-top:3px;quotes:"“" "”"}\
.ca-flag q:before{content:open-quote} .ca-flag q:after{content:close-quote}\
.ca-flag.sev-high{border-left:3px solid var(--red)} .ca-flag.sev-medium{border-left:3px solid var(--yellow)} .ca-flag.sev-low{border-left:3px solid var(--border)} .ca-flag.good{border-left:3px solid var(--green)}\
.ca-table{width:100%;border-collapse:collapse;font-size:13px}\
.ca-table th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}\
.ca-table td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle}\
.ca-table tr:last-child td{border-bottom:none}\
.ca-table td.c{text-align:center;white-space:nowrap} .ca-table th.c{text-align:center}\
.ca-table tr:hover td{background:rgba(255,255,255,.02)}\
.ca-rate{display:inline-flex;align-items:center;gap:6px;font-weight:700;min-width:64px}\
.ca-rate i{display:inline-block;width:38px;height:4px;background:var(--border);border-radius:4px;overflow:hidden}\
.ca-rate i b{display:block;height:100%}\
.ca-msg{max-width:560px;line-height:1.4}\
.ca-mini{font-size:11px;color:var(--text2)}\
.ca-wrap{overflow-x:auto}\
.ca-drop{border:1px dashed var(--border);border-radius:12px;padding:16px;background:var(--surface2)}\
.ca-drop .l{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin-bottom:6px}\
.ca-drop input[type=file]{width:100%;font-size:12px;color:var(--text2)}\
.ca-runs .row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}\
.ca-runs .row:last-child{border-bottom:none}\
.ca-runs .row.active{background:rgba(30,79,255,.06);margin:0 -10px;padding:10px;border-radius:8px}\
.ca-rule{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}\
.ca-rule:last-child{border-bottom:none} .ca-rule.off{opacity:.45}\
.ca-rule code{font-size:12px;color:var(--text2);word-break:break-all}\
.ca-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px} @media(max-width:820px){.ca-grid2{grid-template-columns:1fr}}\
.ca-form{display:grid;grid-template-columns:130px 1fr 1fr;gap:8px;align-items:center} @media(max-width:700px){.ca-form{grid-template-columns:1fr}}\
';
function caInjectCss(){ if(document.getElementById('ca-style')) return; var st=document.createElement('style'); st.id='ca-style'; st.textContent=CA_CSS; document.head.appendChild(st); }
function caCls(v,warn,good,invert){ if(v==null) return ''; if(invert){ return v<=good?'ok':v<=warn?'warn':'bad'; } return v>=good?'ok':v>=warn?'warn':'bad'; }
function caKpi(label,val,target,cls,pct){ return '<div class="ca-kpi"><div class="l">'+label+'</div><div class="v '+(cls?'ca-'+cls:'')+'">'+val+'</div><div class="t">'+target+'</div>'+(pct!=null?'<div class="bar"><i class="'+(cls?'ca-bg-'+cls:'')+'" style="width:'+Math.max(2,Math.min(100,pct))+'%"></i></div>':'')+'</div>'; }
function caStat(label,val,sub,cls,pct){ return '<div class="ca-stat"><div class="l">'+label+'</div><div class="v '+(cls?'ca-'+cls:'')+'">'+val+'</div>'+(sub?'<div class="s">'+sub+'</div>':'')+(pct!=null?'<div class="bar"><i class="'+(cls?'ca-bg-'+cls:'')+'" style="width:'+Math.max(2,Math.min(100,pct))+'%"></i></div>':'')+'</div>'; }
function caRate(n,d,warn,good){ if(!d) return '<span class="ca-mini">—</span>'; var p=Math.round(n/d*100); var c=caCls(p,warn,good); return '<span class="ca-rate ca-'+c+'"><i><b class="ca-bg-'+c+'" style="width:'+Math.min(100,p)+'%"></b></i>'+p+'%</span>'; }
function caVerdict(m){ var bad=0,warn=0; var chk=function(v,w,g,inv){ var c=caCls(v,w,g,inv); if(c==='bad') bad++; else if(c==='warn') warn++; };
  chk(m.opener_reply_rate,15,25); chk(m.opener_name_pct,40,70); chk(m.opener_top_template_pct,50,25,true); chk(m.unlock_rate,30,45); if(m.bumps>=20) chk(m.bump_reply_rate,10,20); if(m.blasts>0) chk(m.blasts,300,50,true);
  return bad>=3?['bad','Fix now']:bad||warn>=2?['warn','Coach']:['ok','On target']; }

async function renderChatAnalyser(){
  var el=document.getElementById('chat-analyser-body'); if(!el) return;
  var rr=await sb.from('chat_rules').select('*').order('kind').order('severity');
  CA.rules=rr.data||[];
  var runs=await sb.from('chat_runs').select('*').order('created_at',{ascending:false}).limit(20);
  CA.runs=runs.data||[];
  if(!CA.run && CA.runs.length) await caLoadRun(CA.runs[0].id);
  caRender();
}
function caSetTab(t){ CA.tab=t; caRender(); }
function caRender(){
  var el=document.getElementById('chat-analyser-body'); if(!el) return; caInjectCss();
  var tabs=[['runs','📥 Upload'],['funnel','🎯 Funnel'],['unworked','⏰ Unworked'],['chatters','🧑‍💻 Chatters'],['openers','👋 First messages'],['bumps','🔔 Bumps & blasts'],['ppv','💸 Pricing'],['rules','🚫 Rules']];
  var head='<div class="tabs">'+tabs.map(function(t){return '<div class="tab '+(CA.tab===t[0]?'active':'')+'" onclick="caSetTab(\''+t[0]+'\')">'+t[1]+'</div>';}).join('')+'</div>';
  var body='';
  if(CA.tab==='runs') body=caRenderRuns();
  else if(!CA.run) body='<div class="empty" style="margin-top:24px;"><div class="empty-icon">🧪</div><p>No run yet — upload a Message Dashboard export first.</p></div>';
  else body=caRenderSummary()+(
    CA.tab==='funnel'?caRenderFunnel():
    CA.tab==='unworked'?caRenderUnworked():
    CA.tab==='chatters'?caRenderChatters():
    CA.tab==='openers'?caRenderLines('opener','👋 First messages','First message in a thread — free, not a blast. Reply = the fan answered within 7 days. Retire anything under 15% on 30+ uses; promote anything over 30%.'):
    CA.tab==='bumps'?caRenderLines('bump','🔔 Bumps','One-to-one nudges after 6h+ of silence. Reply = within 48h.')+caRenderLines('blast','📣 Blasts','Same text to 20+ fans inside ten minutes. Not openers, not bumps — mass sends, and they almost never work.'):
    CA.tab==='ppv'?caRenderPPV():caRenderRules());
  el.innerHTML=head+body;
}
function caRenderSummary(){
  var r=CA.run, s=r.summary||{}, f=s.funnel||{}; var hits=CA.chatters.reduce(function(a,c){return a+(c.rule_hits||[]).filter(function(h){return h.kind==='banned';}).reduce(function(x,h){return x+h.count;},0);},0);
  var k=[];
  if(f.subs) { k.push(caKpi('New subs',f.subs.toLocaleString(),'in period')); k.push(caKpi('Messaged ≤ 1h',f.contacted_1h_pct+'%','target 80%',caCls(f.contacted_1h_pct,50,80),f.contacted_1h_pct)); k.push(caKpi('Bought ≤ 30d',f.bought_30d_pct+'%','target 10% (1:10)',caCls(f.bought_30d_pct,7,10),f.bought_30d_pct*5)); }
  k.push(caKpi('First-msg reply',s.opener_reply_rate!=null?s.opener_reply_rate+'%':'—','target 30%',caCls(s.opener_reply_rate,15,30),s.opener_reply_rate!=null?s.opener_reply_rate*2.5:null));
  k.push(caKpi('PPV unlock',s.unlock_rate!=null?s.unlock_rate+'%':'—','target 45%',caCls(s.unlock_rate,30,45),s.unlock_rate!=null?s.unlock_rate*1.8:null));
  k.push(caKpi('Banned phrases',hits.toLocaleString(),'across '+CA.chatters.length+' chatters',hits>200?'bad':hits>50?'warn':'ok'));
  return '<div class="ca-toolbar"><div class="ca-period">'+escapeHtml(r.period_start||'')+' → '+escapeHtml(r.period_end||'')+' · '+(r.message_count||0).toLocaleString()+' messages · '+escapeHtml(r.source_file||'')+'</div><button class="btn btn-sm btn-ghost" onclick="caSetTab(\'runs\')">Change run</button></div><div class="ca-kpis">'+k.join('')+'</div>';
}
function caRenderRuns(){
  var cur=CA.run?'<div class="ca-mini" style="margin-top:8px;">Viewing: '+escapeHtml(CA.run.source_file||'run')+' · '+escapeHtml(CA.run.period_start||'')+' → '+escapeHtml(CA.run.period_end||'')+'</div>':'';
  return '<div class="ca-card"><div class="ca-head"><h3>📥 Upload exports</h3></div>'
    +'<div class="ca-mini" style="margin-bottom:12px;">Infloww → <b>Messages → Dashboard → Export</b> (required) and <b>Sales → Sales record → Export</b> (optional — unlocks the funnel and the unworked list). Same date range for both. Parsed in your browser; only the summary is saved.</div>'
    +'<div class="ca-grid2"><div class="ca-drop"><div class="l">Message Dashboard · required</div><input type="file" accept=".xlsx,.xls,.csv" onchange="caPick(\'msgs\',this.files[0])" '+(CA.busy?'disabled':'')+'></div>'
    +'<div class="ca-drop"><div class="l">Sales Record · optional</div><input type="file" accept=".xlsx,.xls,.csv" onchange="caPick(\'sales\',this.files[0])" '+(CA.busy?'disabled':'')+'></div></div>'
    +'<div style="margin-top:12px;display:flex;gap:10px;align-items:center;"><button class="btn btn-primary" onclick="caRunUpload()" '+(CA.busy?'disabled':'')+'>🧪 Analyse</button><div id="ca-status" class="ca-mini">'+(CA.busy?'Analysing…':'')+'</div></div>'+cur+'</div>'
    +'<div class="ca-card ca-runs"><div class="ca-head"><h3>🗂 Previous runs</h3></div>'+(CA.runs.length?CA.runs.map(function(r){
      var s=r.summary||{}, f=s.funnel||{}; var act=CA.run&&CA.run.id===r.id;
      return '<div class="row '+(act?'active':'')+'"><div><div style="font-weight:700;">'+escapeHtml(r.period_start||'')+' → '+escapeHtml(r.period_end||'')+'</div><div class="ca-mini">'+(r.message_count||0).toLocaleString()+' msgs · '+(s.chatters||0)+' chatters'+(f.subs?' · '+f.subs+' subs · bought 30d '+f.bought_30d_pct+'%':'')+' · first-msg reply '+(s.opener_reply_rate!=null?s.opener_reply_rate+'%':'—')+' · unlock '+(s.unlock_rate!=null?s.unlock_rate+'%':'—')+' · '+fmtDate(r.created_at)+'</div></div>'
        +'<div style="display:flex;gap:6px;"><button class="btn btn-sm '+(act?'btn-primary':'btn-ghost')+'" onclick="caLoadRun(\''+r.id+'\').then(function(){CA.tab=\'chatters\';caRender();})">'+(act?'Viewing':'View')+'</button><button class="btn btn-sm btn-danger" onclick="caDeleteRun(\''+r.id+'\')">🗑</button></div></div>';
    }).join(''):'<div class="ca-mini">Nothing analysed yet.</div>')+'</div>';
}
function caFunnelTable(scope,title,note){
  var R=CA.funnel.filter(function(f){return f.scope===scope;}).sort(function(a,b){return scope==='week'?(a.key<b.key?-1:1):b.subs-a.subs;});
  if(!R.length) return '';
  return '<div class="ca-card"><div class="ca-head"><h3>'+title+'</h3></div>'+(note?'<div class="ca-mini" style="margin-bottom:8px;">'+note+'</div>':'')
    +'<div class="ca-wrap"><table class="ca-table"><thead><tr><th>'+scope+'</th><th class="c">Subs</th><th class="c">Msg ≤1h</th><th class="c">Msg ≤24h</th><th class="c">Msg ≤72h</th><th class="c">Replied 72h</th><th class="c">PPV 72h</th><th class="c">Bought 7d</th><th class="c">Bought 30d</th><th class="c">$ / sub 30d</th></tr></thead><tbody>'
    +R.map(function(f){ return '<tr><td><b>'+escapeHtml(f.key)+'</b>'+(f.unmatched?'<div class="ca-mini">'+f.unmatched+' unmatched</div>':'')+'</td><td class="c">'+f.subs+'</td><td class="c">'+caRate(f.contacted_1h,f.subs,50,80)+'</td><td class="c">'+caRate(f.contacted_24h,f.subs,70,90)+'</td><td class="c">'+caRate(f.contacted_72h,f.subs,80,95)+'</td><td class="c">'+caRate(f.replied_72h,f.subs,20,35)+'</td><td class="c">'+caRate(f.ppv_72h,f.subs,30,50)+'</td><td class="c">'+caRate(f.bought_7d,f.subs,7,10)+'</td><td class="c">'+caRate(f.bought_30d,f.subs,10,14)+'</td><td class="c"><b>$'+(f.subs?(f.revenue_30d/f.subs).toFixed(2):'0')+'</b></td></tr>'; }).join('')
    +'</tbody></table></div></div>';
}
function caRenderFunnel(){
  if(!CA.funnel.length) return '<div class="empty" style="margin-top:24px;"><div class="empty-icon">🎯</div><p>This run had no Sales Record. Upload both files to see the new-sub funnel.</p></div>';
  var s=(CA.run.summary||{}).funnel||{};
  var head='<div class="ca-card"><div class="ca-head"><h3>🎯 Sub → sale</h3><span class="ca-chip '+caCls(s.bought_30d_pct,7,10)+'">'+(s.bought_30d_pct!=null?s.bought_30d_pct+'% bought in 30 days':'—')+'</span></div><div style="font-size:14px;line-height:1.6;">Of <b>'+(s.subs||0)+'</b> new subs: <b>'+(s.contacted_1h_pct!=null?s.contacted_1h_pct+'%':'—')+'</b> heard from a chatter within an hour, <b>'+(s.contacted_72h_pct!=null?s.contacted_72h_pct+'%':'—')+'</b> within 72 hours, <b>'+(s.bought_7d_pct!=null?s.bought_7d_pct+'%':'—')+'</b> bought within 7 days. The 1:10 target is 10% buying inside 30 days on every page, and the lever is the first hour.</div>'+(s.unmatched_pct?'<div class="ca-mini" style="margin-top:8px;">'+s.unmatched_pct+'% of subs could not be matched to a message thread (renamed or custom username) — read "never messaged" as an upper bound.</div>':'')+'</div>';
  return head+caFunnelTable('creator','By page','Where the leak is.')+caFunnelTable('chatter','By chatter who handled the first 72 hours','"nobody" = the sub got no message at all. Bought 7d is the bounty column.')+caFunnelTable('week','By week subscribed','The last few weeks are still maturing — bought 30d will rise.');
}
function caRenderUnworked(){
  var U=(CA.run.summary||{}).unworked||[];
  if(!U.length) return '<div class="empty" style="margin-top:24px;"><div class="empty-icon">⏰</div><p>'+(CA.funnel.length?'Every sub from the last 72 hours of this export has been messaged.':'Upload the Sales Record with the messages to see this.')+'</p></div>';
  return '<div class="ca-card"><div class="ca-head"><h3>⏰ Subscribed in the last 72h, never messaged</h3><span class="ca-chip bad">'+U.length+' waiting</span></div><div class="ca-mini" style="margin-bottom:8px;">Oldest first. Open these before the inbox. Names as Infloww shows them.</div>'
    +'<div class="ca-wrap"><table class="ca-table"><thead><tr><th>Fan</th><th>Page</th><th class="c">Subscribed</th><th class="c">Waiting</th></tr></thead><tbody>'
    +U.map(function(u){ return '<tr><td><b>'+escapeHtml(u.fan)+'</b></td><td>'+escapeHtml(u.creator)+'</td><td class="c">'+fmtDateTime(u.subscribed)+'</td><td class="c"><span class="ca-chip '+(u.hours>=24?'bad':'warn')+'">'+u.hours+'h</span></td></tr>'; }).join('')+'</tbody></table></div></div>';
}
function caRenderChatters(){
  return CA.chatters.map(function(c){ var m=c.metrics; var v=caVerdict(m); var hits=(c.rule_hits||[]).filter(function(h){return h.kind==='banned';}); var good=(c.rule_hits||[]).filter(function(h){return h.kind==='preferred';});
    var fr=(CA.funnel||[]).find(function(f){return f.scope==='chatter'&&f.key===c.chatter_name;});
    return '<div class="ca-card">'
      +'<div class="ca-head"><div style="display:flex;align-items:center;gap:10px;"><h3>'+escapeHtml(c.chatter_name)+'</h3><span class="ca-chip '+v[0]+'">'+v[1]+'</span></div><button class="btn btn-sm btn-primary" onclick="caDraftFeedback(\''+c.id+'\')">📝 Draft feedback</button></div>'
      +'<div class="ca-stats">'
      +caStat('First-msg reply',m.opener_reply_rate!=null?m.opener_reply_rate+'%':'—','of '+m.openers,caCls(m.opener_reply_rate,15,25),m.opener_reply_rate!=null?m.opener_reply_rate*2.5:null)
      +caStat('Name in 1st msg',m.opener_name_pct!=null?m.opener_name_pct+'%':'—','target 100%',caCls(m.opener_name_pct,40,70),m.opener_name_pct)
      +caStat('Top opener share',m.opener_top_template_pct+'%','max 25%',caCls(m.opener_top_template_pct,50,25,true),m.opener_top_template_pct)
      +caStat('Bumps',m.bumps+(m.bump_reply_rate!=null?' · '+m.bump_reply_rate+'%':''),'reply rate',m.bumps>=20?caCls(m.bump_reply_rate,10,20):'',m.bump_reply_rate)
      +caStat('Blasts',m.blasts+(m.blast_reply_rate!=null?' · '+m.blast_reply_rate+'%':''),'target 0',m.blasts>300?'bad':m.blasts>50?'warn':'ok')
      +caStat('PPV unlock',m.unlock_rate!=null?m.unlock_rate+'%':'—',m.ppv+' sent · $'+Math.round(m.median_unlocked)+' median',caCls(m.unlock_rate,30,45),m.unlock_rate!=null?m.unlock_rate*1.8:null)
      +caStat('Unlocked $','$'+m.revenue.toLocaleString(),m.fans+' fans · '+m.msgs_per_fan+' msgs each')
      +(fr&&fr.subs>=10?caStat('New subs → sale',Math.round(fr.bought_7d/fr.subs*100)+'%',fr.subs+' handled · '+fr.bought_7d+' bought in 7d',caCls(fr.bought_7d/fr.subs*100,7,10),fr.bought_7d/fr.subs*500):caStat('Reply time',caFmtSecs(m.median_reply_secs),'median',m.median_reply_secs>600?'warn':''))
      +'</div>'
      +(m.opener_top_template?'<div class="ca-mini" style="margin-bottom:10px;">Most-used first message ('+m.opener_top_template_pct+'%): <i>'+escapeHtml(m.opener_top_template)+'…</i></div>':'')
      +'<div class="ca-cols"><div><div class="ca-sub">🚫 Flagged phrases</div>'+(hits.length?hits.slice(0,6).map(function(h){return '<div class="ca-flag sev-'+h.severity+'"><b>'+escapeHtml(h.label)+'</b><span class="n">×'+h.count+'</span>'+h.examples.slice(0,2).map(function(e){return '<q>'+escapeHtml(e)+'</q>';}).join('')+'</div>';}).join(''):'<div class="ca-flag good"><b>Clean</b><span class="n">no banned phrases</span></div>')+'</div>'
      +'<div><div class="ca-sub">✅ Preferred phrases</div>'+(good.length?good.map(function(h){return '<div class="ca-flag good"><b>'+escapeHtml(h.label)+'</b><span class="n">×'+h.count+'</span></div>';}).join(''):'<div class="ca-mini" style="margin-bottom:10px;">Not using any of the preferred lines.</div>')
      +'<div class="ca-sub" style="margin-top:10px;">By page</div><table class="ca-table" style="font-size:12px;"><tbody>'+Object.keys(c.by_creator||{}).sort(function(a,b){return c.by_creator[b].sent-c.by_creator[a].sent;}).map(function(k){var b=c.by_creator[k];return '<tr><td><b>'+escapeHtml(k)+'</b></td><td class="c">'+b.sent+' msgs</td><td class="c">'+b.fans+' fans</td><td class="c">'+b.unlocked+'/'+b.ppv+' PPV</td><td class="c"><b>$'+b.revenue.toLocaleString()+'</b></td></tr>';}).join('')+'</tbody></table></div></div>'
      +'</div>';
  }).join('')||'<div class="empty" style="margin-top:24px;"><p>No chatters with 20+ messages in this run.</p></div>';
}
function caRenderLines(kind,title,sub){
  var L=CA.lines.filter(function(l){return l.kind===kind;}).sort(function(a,b){return b.uses-a.uses;}).slice(0,60);
  return '<div class="ca-card"><div class="ca-head"><h3>'+title+'</h3><span class="ca-mini">'+L.length+' shown</span></div><div class="ca-mini" style="margin-bottom:8px;">'+sub+'</div>'
    +(L.length?'<div class="ca-wrap"><table class="ca-table"><thead><tr><th>Message</th><th>Who</th><th class="c">Uses</th><th class="c">Replies</th><th class="c">Rate</th></tr></thead><tbody>'
    +L.map(function(l){ return '<tr><td class="ca-msg">'+escapeHtml(l.sample_text)+'</td><td class="ca-mini" style="white-space:nowrap;">'+escapeHtml(l.chatter_name)+' · '+escapeHtml(l.creator)+'</td><td class="c">'+l.uses+'</td><td class="c">'+l.replies+'</td><td class="c">'+caRate(l.replies,l.uses,15,30)+'</td></tr>'; }).join('')
    +'</tbody></table></div>':'<div class="ca-mini">None in this run.</div>')+'</div>';
}
function caRenderPPV(){
  return '<div class="ca-card"><div class="ca-head"><h3>💸 Price bands</h3></div><div class="ca-mini" style="margin-bottom:8px;">Section 5: the ends convert, the middle doesn\'t. A first PPV to a never-bought fan goes out at $20 or under.</div>'
    +'<div class="ca-wrap"><table class="ca-table"><thead><tr><th>Chatter</th><th class="c">≤ $20</th><th class="c">$21–39</th><th class="c">$40+</th><th class="c">Median sent</th><th class="c">Median unlocked</th><th class="c">Unlocked $</th></tr></thead><tbody>'
    +CA.chatters.map(function(c){ var b=c.metrics.bands||{}; var f=function(x){ return x&&x[0]?caRate(x[1],x[0],30,45)+' <span class="ca-mini">'+x[1]+'/'+x[0]+'</span>':'<span class="ca-mini">—</span>'; }; return '<tr><td><b>'+escapeHtml(c.chatter_name)+'</b></td><td class="c">'+f(b.lo)+'</td><td class="c">'+f(b.mid)+'</td><td class="c">'+f(b.hi)+'</td><td class="c">$'+Math.round(c.metrics.median_ppv)+'</td><td class="c">$'+Math.round(c.metrics.median_unlocked)+'</td><td class="c"><b>$'+c.metrics.revenue.toLocaleString()+'</b></td></tr>'; }).join('')
    +'</tbody></table></div></div>';
}
function caRenderRules(){
  var row=function(r){ return '<div class="ca-rule '+(r.active?'':'off')+'"><div><div style="font-weight:700;">'+escapeHtml(r.label)+' <span class="ca-chip '+({high:'bad',medium:'warn',low:''})[r.severity]+'" style="font-size:9px;padding:2px 7px;">'+r.severity+'</span></div><code>'+escapeHtml(r.pattern)+(r.is_regex?'  ·  regex':'')+'</code>'+(r.note?'<div class="ca-mini">'+escapeHtml(r.note)+'</div>':'')+'</div><div style="display:flex;gap:6px;flex:none;"><button class="btn btn-sm btn-ghost" onclick="caToggleRule(\''+r.id+'\','+(!r.active)+')">'+(r.active?'Disable':'Enable')+'</button><button class="btn btn-sm btn-danger" onclick="caDeleteRule(\''+r.id+'\')">🗑</button></div></div>'; };
  var banned=CA.rules.filter(function(r){return r.kind==='banned';}), pref=CA.rules.filter(function(r){return r.kind==='preferred';});
  return '<div class="ca-card"><div class="ca-head"><h3>➕ Add a rule</h3></div><div class="ca-form">'
    +'<select id="ca-r-kind"><option value="banned">🚫 Banned</option><option value="preferred">✅ Preferred</option></select>'
    +'<input id="ca-r-label" placeholder="Label — what you call it">'
    +'<input id="ca-r-pattern" placeholder="Phrase to match, e.g. come say hi">'
    +'<select id="ca-r-sev"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>'
    +'<input id="ca-r-note" placeholder="Why — chatters see this" style="grid-column:span 2;">'
    +'<label class="ca-mini"><input type="checkbox" id="ca-r-regex"> regex</label><div></div><button class="btn btn-sm btn-primary" onclick="caAddRule()">Save rule</button></div>'
    +'<div class="ca-mini" style="margin-top:8px;">Plain phrases match anywhere, case-insensitive. Rules apply on the next upload. Chatters can read the active rules.</div></div>'
    +'<div class="ca-grid2"><div class="ca-card"><div class="ca-head"><h3>🚫 Banned</h3><span class="ca-chip bad">'+banned.length+'</span></div>'+banned.map(row).join('')+'</div>'
    +'<div class="ca-card"><div class="ca-head"><h3>✅ Preferred</h3><span class="ca-chip ok">'+pref.length+'</span></div>'+pref.map(row).join('')+'</div></div>';
}

