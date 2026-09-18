import re,sys,io
p=sys.argv[1]; block=open(sys.argv[2],encoding='utf-8').read()
s=open(p,encoding='utf-8').read()
assert 'renderFans' not in s, 'already patched'
# 1 nav item — before the Schedule entry
nav_anchor="  { id: 'chatters',   icon: '📅', label: 'Schedule',"
assert s.count(nav_anchor)==1
s=s.replace(nav_anchor,"  { id: 'fans',       icon: '🧑‍💼', label: 'Fans',                roles: ['admin','va','chatter'],                   section: 'Chatting' },\n"+nav_anchor)
# 2 page div — before the chat analyser page
pg_anchor='    <div class="page" id="page-chat-analyser">'
assert s.count(pg_anchor)==1
s=s.replace(pg_anchor,'''    <div class="page" id="page-fans">
      <div class="page-title">Fans</div>
      <div class="page-sub">New subs waiting for a first message, and everything we know about the ones who talk.</div>
      <div id="fans-tabs"></div>
      <div id="new-subs-body"></div>
      <div id="fan-stats-body" hidden></div>
    </div>
'''+pg_anchor)
# 3 router
rt_anchor="  if (page === 'chat-analyser') renderChatAnalyser();"
assert s.count(rt_anchor)==1
s=s.replace(rt_anchor,"  if (page === 'fans') renderFans();\n"+rt_anchor)
# 4 chatters land on Fans
old="profile.role === 'chatter' ? 'chatters'"
assert s.count(old)==1
s=s.replace(old,"profile.role === 'chatter' ? 'fans'")
# 5 code block — before the chat analyser block marker
cb_anchor='// ── Chat analyser ─'
assert s.count(cb_anchor)==1
s=s.replace(cb_anchor,block+'\n'+cb_anchor)
open(p,'w',encoding='utf-8').write(s); print('patched')
