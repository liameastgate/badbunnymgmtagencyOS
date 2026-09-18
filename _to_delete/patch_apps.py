import re, sys, io
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert 'renderApplicationsPage' not in s, 'already patched'

# 1. nav item
nav_anchor = "  { id: 'feedback',   icon: '📝', label: 'Feedback',            roles: ['admin','chatter'],                        section: 'Chatting' },\n"
assert nav_anchor in s
s = s.replace(nav_anchor, nav_anchor + "  { id: 'applications', icon: '🧑‍💻', label: 'Applications',      roles: ['admin','va'],                             section: 'Chatting' },\n", 1)

# 2. router
r_anchor = "  if (page === 'feedback') renderFeedbackPage();\n"
assert r_anchor in s
s = s.replace(r_anchor, r_anchor + "  if (page === 'applications') renderApplicationsPage();\n", 1)

# 3. page div
d_anchor = """    <div class="page" id="page-feedback">
      <div class="page-title" id="feedback-title">Chatter Feedback</div>
      <div class="page-sub" id="feedback-sub">Draft feedback privately, then publish it to the chatter</div>
      <div id="feedback-body"></div>
    </div>
"""
assert d_anchor in s
s = s.replace(d_anchor, d_anchor + """
    <!-- Chatter applications -->
    <div class="page" id="page-applications">
      <div class="page-title">Chatter Applications</div>
      <div class="page-sub">Assessment submissions from the public test page. Score, shortlist, or reject — nothing here is visible to candidates.</div>
      <div id="applications-body"></div>
    </div>
""", 1)

# 4. JS
js_anchor = "async function renderFeedbackPage(){\n"
assert js_anchor in s
js = r"""// ── Chatter applications ─────────────────────────────────────
var APP_TAB='new';
var APP_HINTS={
 q1_1:'Good: one low-pressure open, names the change, then waits. Bad: double texting, guilt, "you there?"',
 q1_2:'Good: one human check-in that references something specific to him, no pitch. Bad: generic "everything ok?"',
 q1_3:'Good: waits, then picks the thread up where it dropped. Bad: chases, apologises, restarts from hello',
 q2_1:'Good: acknowledges first, follows his lead back to flirting. Bad: forces a sale inside the vent, or goes therapist',
 q2_2:'Good: warm but with reply windows, redirects to paid time without shaming. Bad: "set clear boundaries" with no how',
 q3_1:'Good: reads it as a test / insecurity, answers with a specific memory of HIM. Bad: "no I don\'t" with nothing behind it',
 q3_2:'Good: mirrors energy, asks before escalating with the shy one. Bad: "I would match their style" with no example',
 q4_1:'Good: no argument, asks what he expected, offers a make-good, keeps him. Bad: defends the content, or over-apologises',
 q4_2:'Good: playful challenge back plus a question that hands him control. Bad: apologising, asking what he wants to talk about',
 q4_3:'Good: does not discount first, reframes value, offers a cheaper entry point. Bad: "let me know your budget"',
 q4_4:'Good: holds the line lightly AND offers a path (small extra, bundle, next time). Bad: caves, or slams the door',
 q4_5:'Good: asks why once, gives a real reason to stay (what is coming). Bad: begging, "why are you leaving me"',
 q5_1:'Good: closed to open, adds a hook or curiosity, moves the topic to him. Bad: "ask open-ended questions" only',
 q5_2:'Good: owns it once, no over-apology, turns it into a hook. Bad: excuses about being busy',
 q5_3:'Good: deflects with charm, redirects to him, no clumsy lie. Bad: refuses flatly, or overshares',
 q6_1:'Good: a concrete story, calm, a clear outcome. Bad: vague, or the story is about being right',
 q7_1:'Good: uses the name, a curiosity or assumption hook, one question, sounds like a person. RED FLAG: "thanks for subscribing", emoji spam, "how do you like my content"'
};
async function renderApplicationsPage(){
  var el=document.getElementById('applications-body'); if(!el) return;
  el.innerHTML='<div class="empty" style="margin-top:24px;">Loading…</div>';
  var r=await sb.from('chatter_applications').select('*').order('created_at',{ascending:false});
  if(r.error){ el.innerHTML='<div class="empty" style="margin-top:24px;">Could not load: '+escapeHtml(r.error.message)+'</div>'; return; }
  STATE.applications=r.data||[];
  renderApplicationsList(el);
}
function setAppTab(t){ APP_TAB=t; var el=document.getElementById('applications-body'); if(el) renderApplicationsList(el); }
function appLink(){ return location.origin+'/chatter-test.html'; }
function copyAppLink(){ navigator.clipboard.writeText(appLink()).then(function(){ alert('Link copied:\n'+appLink()); }); }
function renderApplicationsList(el){
  var all=STATE.applications||[];
  var counts={new:0,shortlist:0,trial:0,rejected:0};
  all.forEach(function(a){ if(counts[a.status]!=null) counts[a.status]++; });
  var list=APP_TAB==='all'?all:all.filter(function(a){return a.status===APP_TAB;});
  var tabs=[['new','🆕 New'],['shortlist','⭐ Shortlist'],['trial','🧪 On trial'],['rejected','✖ Rejected'],['all','All']];
  el.innerHTML=
    '<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;"><div><div class="card-title" style="margin:0;">🔗 Assessment link</div><div style="font-size:12px;color:var(--text2);word-break:break-all;">'+escapeHtml(appLink())+'</div></div><button class="btn btn-sm btn-primary" onclick="copyAppLink()">Copy link</button></div>'
    +'<div class="tabs">'+tabs.map(function(t){return '<div class="tab '+(APP_TAB===t[0]?'active':'')+'" onclick="setAppTab(\''+t[0]+'\')">'+t[1]+(t[0]!=='all'?' ('+counts[t[0]]+')':' ('+all.length+')')+'</div>';}).join('')+'</div>'
    +'<div id="app-list">'+(list.length?list.map(appCard).join(''):'<div class="empty" style="margin-top:16px;"><div class="empty-icon">🧑‍💻</div><p>Nothing here yet.</p></div>')+'</div>';
}
function appCard(a){
  var ans=a.answers||{};
  var keys=Object.keys(APP_HINTS);
  var pill={new:'cscan-amber',shortlist:'cscan-green',trial:'cscan-green',rejected:'cscan-red'}[a.status]||'cscan-amber';
  var stars=a.score?'⭐'.repeat(Math.max(0,Math.min(5,a.score))):'';
  var meta=[a.email,a.telegram,a.timezone,a.shift,a.experience,ans.crm?('CRM: '+ans.crm):''].filter(Boolean).map(escapeHtml).join(' · ');
  return '<div class="card" style="padding:12px 14px;margin-bottom:10px;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><div><div style="font-weight:700;font-size:15px;">'+escapeHtml(a.name||'—')+' <span style="font-weight:400;color:var(--text2);">'+stars+'</span></div><div style="font-size:12px;color:var(--text2);">'+meta+'</div><div style="font-size:11px;color:var(--text2);">'+fmtDateTime(a.created_at)+'</div></div>'
    +'<div style="display:flex;gap:6px;align-items:center;"><span class="cscan '+pill+'" style="cursor:default;">'+escapeHtml(a.status)+'</span><button class="btn btn-sm btn-ghost" onclick="toggleApp(\''+a.id+'\')">Open</button></div></div>'
    +'<div id="app-'+a.id+'" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">'
    +keys.map(function(k){ var x=ans[k]||{}; return '<div style="margin-bottom:12px;"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);">'+escapeHtml(x.q||k)+'</div><div style="font-size:14px;white-space:pre-wrap;line-height:1.5;margin:4px 0;">'+escapeHtml(x.a||'—')+'</div><div style="font-size:11px;color:var(--text2);opacity:.8;">'+escapeHtml(APP_HINTS[k])+'</div></div>'; }).join('')
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">'
    +'<select id="app-score-'+a.id+'" style="width:160px;"><option value="">No score</option>'+[5,4,3,2,1].map(function(n){return '<option value="'+n+'" '+(a.score===n?'selected':'')+'>'+n+' — '+({5:'Hire',4:'Strong',3:'Maybe',2:'Weak',1:'No'})[n]+'</option>';}).join('')+'</select>'
    +'<select id="app-status-'+a.id+'" style="width:160px;">'+['new','shortlist','trial','rejected'].map(function(st){return '<option value="'+st+'" '+(a.status===st?'selected':'')+'>'+st+'</option>';}).join('')+'</select>'
    +'<button class="btn btn-sm btn-primary" onclick="saveApp(\''+a.id+'\')">💾 Save</button>'
    +'<button class="btn btn-sm btn-danger" onclick="deleteApp(\''+a.id+'\')">🗑 Delete</button></div>'
    +'<textarea id="app-notes-'+a.id+'" rows="2" placeholder="Notes (private)" style="margin-top:8px;">'+escapeHtml(a.notes||'')+'</textarea>'
    +'</div></div>';
}
function toggleApp(id){ var d=document.getElementById('app-'+id); if(d) d.style.display=d.style.display==='none'?'block':'none'; }
async function saveApp(id){
  var score=(document.getElementById('app-score-'+id)||{}).value||'';
  var status=(document.getElementById('app-status-'+id)||{}).value||'new';
  var notes=((document.getElementById('app-notes-'+id)||{}).value||'').trim();
  var r=await sb.from('chatter_applications').update({score:score?parseInt(score):null,status:status,notes:notes||null,reviewed_by:STATE.profile?.email||null,reviewed_at:new Date().toISOString()}).eq('id',id);
  if(r.error){ alert('Could not save: '+r.error.message); return; }
  renderApplicationsPage();
}
async function deleteApp(id){
  if(!confirm('Delete this application permanently?')) return;
  var r=await sb.from('chatter_applications').delete().eq('id',id);
  if(r.error){ alert('Could not delete: '+r.error.message); return; }
  renderApplicationsPage();
}

"""
s = s.replace(js_anchor, js + js_anchor, 1)
open(p, 'w', encoding='utf-8').write(s)
print('patched ok')
