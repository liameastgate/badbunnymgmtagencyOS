"""
add_content_factory.py -- add the Content Factory tab to AgencyOS.

Run it once, from anywhere:

    python add_content_factory.py "C:\\Users\\Liam\\Desktop\\CLAUDE\\badbunnymgmtagencyOS\\index.html"

It writes index.html.backup first, and it refuses to run twice.
"""

import io
import os
import sys
import shutil

MARK = "<!-- CONTENT FACTORY -->"

# ---------------------------------------------------------------- 1. NAV ----
NAV_ANCHOR = ("  { id: 'content-schedule', icon: '🗓️', label: 'Content Scheduling', "
              "roles: ['admin','va'],                     section: 'Models' },")
NAV_NEW = NAV_ANCHOR + ("\n  { id: 'content-factory', icon: '🏭', label: 'Content Factory', "
                        "roles: ['admin','va'],                     section: 'Models' },")

# ------------------------------------------------------------- 2. ROUTING ---
ROUTE_ANCHOR = "  if (page === 'content-schedule') loadContentSchedule();"
ROUTE_NEW = ROUTE_ANCHOR + "\n  if (page === 'content-factory') renderContentFactory();"

# ---------------------------------------------------------------- 3. PAGE ---
PAGE_ANCHOR = '    <div class="page" id="page-content-schedule">'
PAGE_HTML = MARK + '''
    <div class="page" id="page-content-factory">
      <div class="page-title">Content Factory</div>
      <div class="page-sub">Upload photos, get posting-ready reels back. The rendering runs on a server, so nothing needs to be open on anyone's computer.</div>

      <div class="card">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;min-width:170px;">
            <label>Model</label>
            <select id="cf-model" onchange="cfModelChanged()"></select>
          </div>
          <div class="form-group" style="margin:0;min-width:130px;">
            <label>How many</label>
            <select id="cf-qty">
              <option value="0">Everything</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label>Add photos</label>
            <input type="file" id="cf-up-raw" multiple accept="image/*" onchange="cfUpload('content-raw', this)">
          </div>
          <div class="form-group" style="margin:0;">
            <label>Add sounds</label>
            <input type="file" id="cf-up-audio" multiple accept="audio/*" onchange="cfUpload('content-audio', this)">
          </div>
        </div>
        <div id="cf-alert" class="alert"></div>
      </div>

      <div class="card">
        <div class="card-title">What this model has</div>
        <div class="stats-grid" id="cf-counts"></div>
      </div>

      <div class="card">
        <div class="card-title">Make something</div>
        <div class="page-sub" style="margin-top:-4px;">Source clips are a library — each button makes a <b>new</b> version from them, it never replaces what you already made.</div>
        <div class="btn-row" style="flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="cfSubmit('photo2video')">1 · Photos &rarr; source clips</button>
          <button class="btn btn-primary" onclick="cfSubmit('captionaudio')">2 · Add caption + sound</button>
          <button class="btn btn-ghost"   onclick="cfSubmit('caption')">Caption only</button>
          <button class="btn btn-ghost"   onclick="cfSubmit('audioonly')">Sound only</button>
          <button class="btn btn-primary" onclick="cfSubmit('prep')">3 · Prep for posting</button>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="card-title" style="margin:0;">Ready to post</div>
          <button class="btn btn-sm btn-ghost" onclick="cfLoadReady()">Refresh</button>
        </div>
        <div id="cf-ready"></div>
        <div id="cf-ready-empty" class="empty" style="display:none;"><div class="empty-icon">🎬</div><p>Nothing finished yet — run the three steps above</p></div>
      </div>

      <div class="card">
        <div class="card-title">Jobs</div>
        <div id="cf-jobs"></div>
        <div id="cf-jobs-empty" class="empty" style="display:none;"><div class="empty-icon">⏳</div><p>No jobs yet</p></div>
      </div>

      <div class="card" id="cf-log-card" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
          <div class="card-title" style="margin:0;">Job output</div>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('cf-log-card').style.display='none'">Close</button>
        </div>
        <pre id="cf-log" style="max-height:320px;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.5;margin:0;"></pre>
      </div>
    </div>

'''

# ------------------------------------------------------------------ 4. JS ---
JS_ANCHOR = "function navigate(page) {"
JS = '''
/* ---------------------------------------------------------------------------
   CONTENT FACTORY
   Photos in, posting-ready reels out. The browser only ever moves files and
   writes a job row -- the actual ffmpeg work happens on the render worker,
   because a render takes minutes and a page can't hold that open.
--------------------------------------------------------------------------- */
const CF_RAW='content-raw', CF_SOURCE='content-source',
      CF_AUDIO='content-audio', CF_OUT='content-output';
let CF_TIMER=null, CF_JOBS=[];

function cfAlert(msg, kind){
  const el=document.getElementById('cf-alert');
  if(!el) return;
  if(!msg){ el.style.display='none'; el.textContent=''; return; }
  el.className='alert alert-'+(kind||'info');
  el.textContent=msg;
  el.style.display='block';
}

function cfModelId(){ return document.getElementById('cf-model')?.value || ''; }

function renderContentFactory(){
  const sel=document.getElementById('cf-model');
  if(sel && !sel.options.length){
    const models=(STATE.models||[]).filter(m=>!m.hidden||STATE.profile?.role==='admin');
    sel.innerHTML=models.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
    try{
      const saved=localStorage.getItem('cf_model');
      if(saved && models.some(m=>m.id===saved)) sel.value=saved;
    }catch(e){}
  }
  cfModelChanged();
  // Poll while the tab is open; a render is minutes long so there is no point
  // hammering it, and the interval is cleared as soon as you navigate away.
  if(CF_TIMER) clearInterval(CF_TIMER);
  CF_TIMER=setInterval(()=>{
    if(!document.getElementById('page-content-factory')?.classList.contains('active')){
      clearInterval(CF_TIMER); CF_TIMER=null; return;
    }
    cfLoadJobs();
  }, 4000);
}

function cfModelChanged(){
  try{ localStorage.setItem('cf_model', cfModelId()); }catch(e){}
  cfAlert('');
  cfLoadCounts(); cfLoadJobs(); cfLoadReady();
}

async function cfCount(bucket, prefix){
  try{
    const {data,error}=await sb.storage.from(bucket).list(prefix,{limit:1000});
    if(error) return 0;
    return (data||[]).filter(f=>f.id).length;
  }catch(e){ return 0; }
}

async function cfLoadCounts(){
  const id=cfModelId(); const box=document.getElementById('cf-counts');
  if(!id||!box) return;
  const [photos,clips,sounds,staged,ready]=await Promise.all([
    cfCount(CF_RAW,id), cfCount(CF_SOURCE,id), cfCount(CF_AUDIO,id),
    cfCount(CF_OUT,id+'/staged'), cfCount(CF_OUT,id+'/ready')
  ]);
  const tile=(n,l)=>`<div class="stat-card"><div class="stat-value">${n}</div><div class="stat-label">${l}</div></div>`;
  box.innerHTML=tile(photos,'Photos')+tile(clips,'Source clips')+tile(sounds,'Sounds')
               +tile(staged,'Made')+tile(ready,'Ready to post');
}

async function cfUpload(bucket, input){
  const id=cfModelId();
  if(!id){ cfAlert('Pick a model first.','error'); input.value=''; return; }
  const files=[...(input.files||[])];
  if(!files.length) return;
  cfAlert(`Uploading ${files.length} file(s)...`);
  let ok=0, failed=[];
  for(const f of files){
    // Spaces and odd characters in filenames break storage paths, so flatten
    // them here rather than discovering it halfway through a render.
    const safe=f.name.replace(/[^A-Za-z0-9._-]/g,'_');
    const {error}=await sb.storage.from(bucket).upload(`${id}/${safe}`, f, {upsert:true});
    if(error) failed.push(f.name+': '+error.message); else ok++;
  }
  input.value='';
  cfAlert(failed.length ? `${ok} uploaded, ${failed.length} failed — ${failed[0]}`
                        : `${ok} file(s) uploaded.`, failed.length?'error':'success');
  cfLoadCounts();
}

async function cfSubmit(jobType){
  const id=cfModelId();
  if(!id){ cfAlert('Pick a model first.','error'); return; }
  const qty=parseInt(document.getElementById('cf-qty').value||'0',10);
  const {error}=await sb.from('render_jobs').insert({
    model_id:id, job_type:jobType, quantity:qty,
    created_by:STATE.profile?.id || null
  });
  if(error){ cfAlert('Could not queue that: '+error.message,'error'); return; }
  cfAlert('Queued. It starts within a few seconds — watch the Jobs list below.','success');
  cfLoadJobs();
}

const CF_LABEL={photo2video:'Photos → source clips', caption:'Caption only',
                captionaudio:'Caption + sound', audioonly:'Sound only',
                prep:'Prep for posting'};
const CF_DOT={queued:'#9aa3ad', running:'#2f7fe0', done:'#1f9d55',
              failed:'#c0392b', cancelled:'#9aa3ad'};

async function cfLoadJobs(){
  const id=cfModelId(); const box=document.getElementById('cf-jobs');
  if(!id||!box) return;
  const {data,error}=await sb.from('render_jobs').select('*')
    .eq('model_id',id).order('created_at',{ascending:false}).limit(12);
  if(error) return;
  CF_JOBS=data||[];
  document.getElementById('cf-jobs-empty').style.display=CF_JOBS.length?'none':'block';
  box.innerHTML=CF_JOBS.map(j=>{
    const when=new Date(j.created_at).toLocaleString();
    const extra = j.status==='done' ? `${j.outputs_count} file(s)`
                : j.status==='failed' ? (j.error||'failed')
                : j.status==='running' ? 'working...' : 'waiting';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(128,128,128,.18);">
      <span style="width:9px;height:9px;border-radius:50%;background:${CF_DOT[j.status]||'#888'};flex:none;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${CF_LABEL[j.job_type]||j.job_type}</div>
        <div class="stat-label" style="font-size:11.5px;">${when} · ${extra}</div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="cfShowLog('${j.id}')">Output</button>
    </div>`;
  }).join('');
  // A finished render means new files, so refresh what's downloadable.
  if(CF_JOBS.some(j=>j.status==='done' && !j._seen)){
    CF_JOBS.forEach(j=>j._seen=true);
    cfLoadCounts(); cfLoadReady();
  }
}

function cfShowLog(jobId){
  const j=CF_JOBS.find(x=>x.id===jobId); if(!j) return;
  document.getElementById('cf-log').textContent=(j.log||'(nothing yet)')+(j.error?('\\n\\n'+j.error):'');
  document.getElementById('cf-log-card').style.display='block';
  document.getElementById('cf-log-card').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function cfLoadReady(){
  const id=cfModelId(); const box=document.getElementById('cf-ready');
  if(!id||!box) return;
  const {data,error}=await sb.storage.from(CF_OUT).list(id+'/ready',
    {limit:200, sortBy:{column:'created_at',order:'desc'}});
  const files=(data||[]).filter(f=>f.id);
  document.getElementById('cf-ready-empty').style.display=files.length?'none':'block';
  if(error||!files.length){ box.innerHTML=''; return; }
  box.innerHTML=files.map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,.18);">
      <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div>
      <button class="btn btn-sm btn-ghost" onclick="cfDownload('${id}/ready/${f.name}')">Download</button>
    </div>`).join('');
}

async function cfDownload(path){
  // Signed URL rather than a public bucket: the link works for a minute and
  // then stops, so a forwarded link is not a permanent hole.
  const {data,error}=await sb.storage.from(CF_OUT).createSignedUrl(path,60,{download:true});
  if(error||!data){ cfAlert('Could not get that file: '+(error?.message||'unknown'),'error'); return; }
  window.open(data.signedUrl,'_blank');
}

'''


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    if not os.path.isfile(path):
        sys.exit(f"Not found: {path}")

    src = io.open(path, encoding="utf-8").read()

    if MARK in src:
        sys.exit("Content Factory is already in this file. Nothing to do.")

    missing = [n for n, a in (("NAV entry", NAV_ANCHOR),
                              ("route", ROUTE_ANCHOR),
                              ("page anchor", PAGE_ANCHOR),
                              ("navigate()", JS_ANCHOR)) if a not in src]
    if missing:
        sys.exit("Could not find: " + ", ".join(missing) +
                 "\nThe file has changed shape -- stopping rather than "
                 "guessing where to put things.")

    shutil.copy2(path, path + ".backup")

    out = src
    out = out.replace(NAV_ANCHOR, NAV_NEW, 1)
    out = out.replace(ROUTE_ANCHOR, ROUTE_NEW, 1)
    out = out.replace(PAGE_ANCHOR, PAGE_HTML + PAGE_ANCHOR, 1)
    out = out.replace(JS_ANCHOR, JS + JS_ANCHOR, 1)

    io.open(path, "w", encoding="utf-8", newline="").write(out)

    print(f"Added Content Factory.")
    print(f"  backup:  {os.path.basename(path)}.backup")
    print(f"  size:    {len(src):,} -> {len(out):,} bytes")
    print("\nOpen it locally and click Content Factory under Models to check "
          "it renders, then push when you're happy.")


if __name__ == "__main__":
    main()
