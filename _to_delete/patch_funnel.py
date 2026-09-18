import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
assert 'caAnalyseFunnel' not in s, 'already patched'
def rep(old,new,count=1):
    global s
    assert old in s, 'anchor missing: '+old[:60]
    s=s.replace(old,new,count)

# 1. state
rep("var CA={tab:'runs',run:null,chatters:[],lines:[],rules:[],runs:[],busy:false};",
    "var CA={tab:'runs',run:null,chatters:[],lines:[],rules:[],runs:[],busy:false,funnel:[],files:{msgs:null,sales:null}};")

# 2. load funnel with run
rep("  CA.run=run; CA.chatters=(c.data||[]).sort(function(a,b){return (b.metrics.sent||0)-(a.metrics.sent||0);}); CA.lines=l.data||[];",
    "  var f=await sb.from('chat_run_funnel').select('*').eq('run_id',id);\n  CA.run=run; CA.chatters=(c.data||[]).sort(function(a,b){return (b.metrics.sent||0)-(a.metrics.sent||0);}); CA.lines=l.data||[]; CA.funnel=f.data||[];")

# 3. tabs
rep("var tabs=[['runs','📥 Upload & runs'],['chatters','🧑‍💻 Chatters'],",
    "var tabs=[['runs','📥 Upload & runs'],['funnel','🎯 New-sub funnel'],['unworked','⏰ Unworked subs'],['chatters','🧑‍💻 Chatters'],")
rep("  else if(CA.tab==='chatters') body=caRenderChatters();",
    "  else if(CA.tab==='funnel') body=caRenderFunnel();\n  else if(CA.tab==='unworked') body=caRenderUnworked();\n  else if(CA.tab==='chatters') body=caRenderChatters();")

# 4. upload card: two files + analyse button
old_card=s[s.index("  return '<div class=\"card\"><div class=\"card-title\">📥 Upload Message Dashboard export</div>'"):s.index("    +'<div class=\"card\"><div class=\"card-title\">🗂 Previous runs</div>'")]
new_card='''  return '<div class="card"><div class="card-title">📥 Upload exports</div>'
    +'<div style="font-size:13px;color:var(--text2);margin-bottom:10px;">Infloww → <b>Messages → Dashboard → Export</b> (required) and <b>Sales → Sales record → Export</b> (optional but unlocks the new-sub funnel and the unworked-subs list). Same date range for both. Parsed in your browser; only the summary is saved.</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:4px;">Message Dashboard *</div><input type="file" accept=".xlsx,.xls,.csv" onchange="caPick(\\'msgs\\',this.files[0])" '+(CA.busy?'disabled':'')+'></div>'
    +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:4px;">Sales Record</div><input type="file" accept=".xlsx,.xls,.csv" onchange="caPick(\\'sales\\',this.files[0])" '+(CA.busy?'disabled':'')+'></div></div>'
    +'<div style="margin-top:10px;display:flex;gap:8px;align-items:center;"><button class="btn btn-sm btn-primary" onclick="caRunUpload()" '+(CA.busy?'disabled':'')+'>🧪 Analyse</button><div id="ca-status" style="font-size:13px;color:var(--text2);">'+(CA.busy?'Analysing…':'')+'</div></div>'+cur+'</div>'
'''
s=s.replace(old_card,new_card,1)

# 5. replace caHandleFile with two-file flow
start=s.index("function caHandleFile(file){"); end=s.index("function caAnalyse(rows){")
new_handle=r'''function caPick(kind,file){ CA.files[kind]=file||null; }
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
function caFunnelTable(scope,title,note){
  var R=CA.funnel.filter(function(f){return f.scope===scope;}).sort(function(a,b){return scope==='week'?(a.key<b.key?-1:1):b.subs-a.subs;});
  if(!R.length) return '';
  var pc=function(n,d,warnBelow,goodAbove){ if(!d) return '<td style="padding:6px;text-align:center;">—</td>'; var p=Math.round(n/d*100); var col=(goodAbove!=null&&p>=goodAbove)?'var(--green,#3ecf8e)':(warnBelow!=null&&p<warnBelow)?'var(--red,#e5484d)':'inherit'; return '<td style="padding:6px;text-align:center;color:'+col+';font-weight:'+(col!=='inherit'?'700':'400')+'">'+p+'%<div style="font-size:10px;color:var(--text2);font-weight:400;">'+n+'</div></td>'; };
  return '<div class="card"><div class="card-title">'+title+'</div>'+(note?'<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">'+note+'</div>':'')
    +'<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="color:var(--text2);font-size:11px;text-transform:uppercase;"><th style="text-align:left;padding:6px;">'+scope+'</th><th style="padding:6px;">Subs</th><th style="padding:6px;">Msg ≤1h</th><th style="padding:6px;">Msg ≤24h</th><th style="padding:6px;">Msg ≤72h</th><th style="padding:6px;">Replied 72h</th><th style="padding:6px;">PPV 72h</th><th style="padding:6px;">Bought 7d</th><th style="padding:6px;">Bought 30d</th><th style="padding:6px;">$ / sub 30d</th></tr></thead><tbody>'
    +R.map(function(f){ return '<tr style="border-top:1px solid var(--border);"><td style="padding:6px;font-weight:600;">'+escapeHtml(f.key)+(f.unmatched?'<div style="font-size:10px;color:var(--text2);font-weight:400;">'+f.unmatched+' unmatched</div>':'')+'</td><td style="padding:6px;text-align:center;">'+f.subs+'</td>'+pc(f.contacted_1h,f.subs,50,80)+pc(f.contacted_24h,f.subs,70,90)+pc(f.contacted_72h,f.subs,80,95)+pc(f.replied_72h,f.subs,20,35)+pc(f.ppv_72h,f.subs,30,50)+pc(f.bought_7d,f.subs,7,10)+pc(f.bought_30d,f.subs,10,14)+'<td style="padding:6px;text-align:center;">$'+(f.subs?(f.revenue_30d/f.subs).toFixed(2):'0')+'</td></tr>'; }).join('')
    +'</tbody></table></div></div>';
}
function caRenderFunnel(){
  if(!CA.funnel.length) return '<div class="empty" style="margin-top:24px;"><div class="empty-icon">🎯</div><p>This run had no Sales Record. Upload both files to see the new-sub funnel.</p></div>';
  var s=(CA.run.summary||{}).funnel||{};
  var head='<div class="card"><div class="card-title">🎯 The 1:10 target</div><div style="font-size:13px;line-height:1.6;">'+(s.subs||0)+' new subs in this period. <b>'+(s.contacted_1h_pct!=null?s.contacted_1h_pct+'%':'—')+'</b> got a message within an hour, <b>'+(s.contacted_72h_pct!=null?s.contacted_72h_pct+'%':'—')+'</b> within 72 hours, <b>'+(s.bought_7d_pct!=null?s.bought_7d_pct+'%':'—')+'</b> bought within 7 days, <b>'+(s.bought_30d_pct!=null?s.bought_30d_pct+'%':'—')+'</b> within 30 days. Target: 80% inside the hour, 10%+ buying inside 30 days on every page.'+(s.unmatched_pct?'<div style="font-size:12px;color:var(--text2);margin-top:6px;">'+s.unmatched_pct+'% of subs could not be matched to a message thread (name changed or custom username) — treat "never messaged" as an upper bound.</div>':'')+'</div></div>';
  return head+caFunnelTable('creator','By page','Where the leak is.')+caFunnelTable('chatter','By chatter who handled the first 72 hours','"nobody" = the sub got no message at all. The bounty column is Bought 7d.')+caFunnelTable('week','By week subscribed','Last 1–4 weeks are still maturing — bought 30d will rise.');
}
function caRenderUnworked(){
  var U=(CA.run.summary||{}).unworked||[];
  if(!U.length) return '<div class="empty" style="margin-top:24px;"><div class="empty-icon">⏰</div><p>'+(CA.funnel.length?'Every sub from the last 72 hours of this export has been messaged.':'Upload the Sales Record with the messages to see this.')+'</p></div>';
  return '<div class="card"><div class="card-title">⏰ Subscribed in the last 72h of the export, never messaged ('+U.length+')</div><div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Oldest first. These are the ones to open before the inbox. Names are as Infloww shows them.</div>'
    +'<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="color:var(--text2);font-size:11px;text-transform:uppercase;"><th style="text-align:left;padding:6px;">Fan</th><th style="text-align:left;padding:6px;">Page</th><th style="padding:6px;">Subscribed</th><th style="padding:6px;">Waiting</th></tr></thead><tbody>'
    +U.map(function(u){ return '<tr style="border-top:1px solid var(--border);"><td style="padding:6px;font-weight:600;">'+escapeHtml(u.fan)+'</td><td style="padding:6px;">'+escapeHtml(u.creator)+'</td><td style="padding:6px;text-align:center;">'+fmtDateTime(u.subscribed)+'</td><td style="padding:6px;text-align:center;color:'+(u.hours>=24?'var(--red,#e5484d)':'inherit')+';font-weight:700;">'+u.hours+'h</td></tr>'; }).join('')+'</tbody></table></div>';
}

'''
s=s[:start]+new_handle+s[end:]

# 6. draft feedback: add funnel line if chatter has funnel row
rep("  var fixes=[];",
    "  var fr=(CA.funnel||[]).find(function(f){return f.scope==='chatter'&&f.key===c.chatter_name;});\n  if(fr&&fr.subs>=10) lines.push('New subs you handled first: '+fr.subs+'. Messaged within an hour '+Math.round(fr.contacted_1h/fr.subs*100)+'%, replied '+Math.round(fr.replied_72h/fr.subs*100)+'%, sent a PPV in 72h '+Math.round(fr.ppv_72h/fr.subs*100)+'%, bought within 7 days '+Math.round(fr.bought_7d/fr.subs*100)+'% (target 10%).');\n  var fixes=[];")
rep("  if(!fixes.length) fixes.push('Nothing flagged this period. Keep doing what you are doing.');",
    "  if(fr&&fr.subs>=10&&fr.ppv_72h/fr.subs<0.3) fixes.push('Only '+Math.round(fr.ppv_72h/fr.subs*100)+'% of the new subs you handled got a PPV in their first 72 hours. Qualify, then send the $20-and-under one by message five. No PPV, no sale.');\n  if(!fixes.length) fixes.push('Nothing flagged this period. Keep doing what you are doing.');")

open(p,'w',encoding='utf-8').write(s)
print('patched ok')
