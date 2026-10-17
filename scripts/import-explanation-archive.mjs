import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
const archive=JSON.parse(gunzipSync(await readFile(new URL('./data/explanation-graph-archive.json.gz',import.meta.url))));
const mapping=JSON.parse(await readFile(new URL('./data/explanation-paper-map.json',import.meta.url)));
const corrections=JSON.parse(await readFile(new URL('./data/explanation-review-corrections.json',import.meta.url)));
const tables=archive.tables;
const order=['review_versions','field_pages','field_page_versions','page_sections','page_blocks','page_version_blocks','page_references','page_spans','page_links','proposed_overview_edits','consistency_findings','attribution_checks','block_expansions','divergence_flags','ingestion_queue'];
const pool=new pg.Pool({connectionString:process.env.SEED_DATABASE_URL??process.env.DATABASE_URL});
const c=await pool.connect();
const q=s=>'"'+s.replaceAll('"','""')+'"';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const remaps=new Map(Object.entries(mapping));
const remap=x=>typeof x==='string'?[...remaps].reduce((s,[a,b])=>s.replaceAll(a,b),x):Array.isArray(x)?x.map(remap):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,remap(v)])):x;
const protectedState=async()=>Object.fromEntries(await Promise.all(['papers','reviews','users'].map(async t=>[t,(await c.query(`SELECT count(*)::int count, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY id),'')) hash FROM ${q(t)} t`)).rows[0]])));
const columns=new Map();
let pending=null;
async function flush(table){if(!pending?.length)return;const keys=Object.keys(pending[0]);await c.query(`INSERT INTO ${q(table)} (${keys.map(q)}) SELECT ${keys.map(q)} FROM jsonb_populate_recordset(NULL::${q(table)}, $1::jsonb) ON CONFLICT (id) DO NOTHING`,[JSON.stringify(pending)]);pending=[];}
async function insert(table,row){if(pending){pending.push(row);return;}if(!columns.has(table))columns.set(table,(await c.query('select column_name,data_type from information_schema.columns where table_schema=\'public\' and table_name=$1',[table])).rows);const types=new Map(columns.get(table).map(x=>[x.column_name,x.data_type]));const keys=Object.keys(row).filter(k=>types.has(k));const vals=keys.map(k=>types.get(k)==='jsonb'&&row[k]!=null?JSON.stringify(row[k]):row[k]);await c.query(`INSERT INTO ${q(table)} (${keys.map(q)}) VALUES (${keys.map((_,i)=>'$'+(i+1))}) ON CONFLICT (id) DO NOTHING`,vals);}
try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query('SELECT pg_advisory_xact_lock(2026101701)');
 const before=await protectedState();
 const originalPaperIds=(await c.query('select id from papers')).rows.map(x=>x.id);
 const existing=(await c.query('select * from field_pages')).rows;
 const backup={format:'explanation-backup',createdAt:new Date().toISOString(),tables:{}};
 for(const t of order)backup.tables[t]=(await c.query(`SELECT * FROM ${q(t)} ORDER BY id`)).rows;
 const archiveIds=new Set(backup.tables.field_page_versions.map(x=>x.id));
 for(const p of tables.field_pages){const target=existing.find(e=>e.slug===p.slug);if(target)remaps.set(p.id,target.id);}
 const missing=tables.papers.filter(p=>!mapping[p.id]);
 for(const p of missing){
  if(p.title!=='33_Dey_Liberati_Pranzetti_Th')throw Error('Unmapped archived paper '+p.title);
  const correction=corrections.results.find(x=>x.paper===p.title);if(!correction)throw Error('Missing saved correction');
  const owner=(await c.query('select author_id,author_name from papers order by created_at limit 1')).rows[0];
  await insert('papers',{id:p.id,title:'The Black Hole Quantum Atmosphere',content:'Archived paper: https://arxiv.org/abs/1701.06161',author_id:owner.author_id,author_name:owner.author_name,paper_authors:'Ramit Dey, Stefano Liberati, Daniele Pranzetti',field:'Physics',subfields:['Black hole thermodynamics'],pdf_url:'https://arxiv.org/pdf/1701.06161',model_name:'Restored B2.1 review with saved re-verification',created_at:p.created_at});
  mapping[p.id]=p.id;remaps.set(p.id,p.id);
 }
 const livePapers=new Set((await c.query('select id from papers')).rows.map(p=>p.id));for(const id of Object.values(mapping))if(!livePapers.has(id))throw Error('Mapped paper is absent: '+id);
 for(const t of order){pending=[];for(const original of tables[t]){
  const row=remap(original);
  if(t==='field_pages'){
   row.current_version_id=null;
   if(!row.parent_page_id)row.parent_page_id=existing.find(x=>x.slug==='horizon-thermodynamics')?.id??null;
   await insert(t,row);continue;
  }
  if(t==='field_page_versions'){
   row.created_by_user_id=null;
   if(!archiveIds.has(row.id)){const prior=backup.tables.field_page_versions.filter(v=>v.page_id===row.page_id);row.version_number+=Math.max(0,...prior.map(v=>v.version_number));}
  }
  if(t==='review_versions'){
   const source=tables.papers.find(p=>p.id===original.paper_id);const correction=corrections.results.find(x=>x.paper===source?.title);
   row.correctness_public='hidden';
   if(correction){row.correctness_internal=correction.newVerdict;row.contribution_passage='Saved re-verification supersedes the original fatal-flaw allegation. '+correction.packets.map(p=>p.whatSurvives).filter(Boolean).join('\n\n');row.evidence_packets=correction.packets;row.claims=row.claims.map(cl=>({...cl,status:cl.status==='failed'?'contested':cl.status}));row.adjudicated_json={...row.adjudicated_json,restorationCorrection:correction};}
  }
  await insert(t,row);
 }await flush(t);pending=null;}
 // Keep historical drafts immutable; publish a separate snapshot of each restored current version.
 for(const p of tables.field_pages){
  const pageId=remaps.get(p.id)??p.id;const version=tables.field_page_versions.find(v=>v.id===p.current_version_id);if(!version)throw Error('Missing current version '+p.slug);
  const marker='archive-published:'+version.id;
  let published=(await c.query('select id from field_page_versions where page_id=$1 and change_log::text like $2',[pageId,'%'+marker+'%'])).rows[0];
  if(!published){const id=randomUUID();const max=(await c.query('select max(version_number)::int n from field_page_versions where page_id=$1',[pageId])).rows[0].n;
   const row={...remap(version),id,version_number:max+1,visibility:'published',created_at:new Date().toISOString(),created_by_user_id:null,change_log:[{at:new Date().toISOString(),action:marker,note:'Restored saved explanation graph; original draft revisions retained.'}]};
   await insert('field_page_versions',row);
   for(const j of tables.page_version_blocks.filter(j=>j.version_id===version.id))await insert('page_version_blocks',{...remap(j),id:randomUUID(),version_id:id});
   // Frozen provenance without blocks must be copied to the published version.
   for(const t of ['page_sections','page_references','page_spans','page_links'])for(const r of tables[t].filter(r=>r.version_id===version.id&&!r.block_id))await insert(t,{...remap(r),id:randomUUID(),version_id:id});
   published={id};
  }
  await c.query('update field_pages set current_version_id=$2,title=$3,scope_statement=$4,summary=$5,parent_page_id=$6,updated_at=now() where id=$1',[pageId,published.id,p.title,p.scope_statement,p.summary,p.parent_page_id?(remaps.get(p.parent_page_id)??p.parent_page_id):existing.find(x=>x.slug==='horizon-thermodynamics')?.id??null]);
 }
 const after=await protectedState();
 const preservedPapers=(await c.query(`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash FROM papers t WHERE id=ANY($1::varchar[])`,[originalPaperIds])).rows[0];
 if(hash(before.papers)!==hash(preservedPapers)||hash(before.reviews)!==hash(after.reviews)||hash(before.users)!==hash(after.users))throw Error('Protected paper/review/account records changed; aborting');
 const counts={};for(const t of order)counts[t]=(await c.query(`select count(*)::int n from ${q(t)}`)).rows[0].n;
 const report={mode:process.env.APPLY==='1'?'apply':'dry-run',protected:after,archivePages:tables.field_pages.length,counts};
 if(process.env.APPLY==='1'){
  if(!process.env.BACKUP_PATH)throw Error('BACKUP_PATH required for apply');await writeFile(process.env.BACKUP_PATH,JSON.stringify(backup),{mode:0o600});await c.query('COMMIT');
 }else await c.query('ROLLBACK');
 console.log(JSON.stringify(report,null,2));
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
