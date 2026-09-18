import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
block=open(sys.argv[2],encoding='utf-8').read()
a=s.index('// ── Chat analyser'); b=s.index('// ── Chatter applications')
s=s[:a]+block+s[b:]
s=s.replace('<div class="page-sub">Drop the Infloww <b>Message Dashboard</b> export. Every chatter gets a scorecard, every opener and bump gets a reply rate, every banned phrase gets counted — then draft the feedback in one click.</div>',
 '<div class="page-sub">Drop the Infloww <b>Message Dashboard</b> export (and the <b>Sales Record</b> for the funnel). Every chatter gets a scorecard, every opener and bump gets a reply rate, every banned phrase gets counted — then draft the feedback in one click.</div>')
open(p,'w',encoding='utf-8').write(s)
print('ui patched')
