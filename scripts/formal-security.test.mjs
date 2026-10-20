import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const dir=await mkdtemp(path.join(tmpdir(),'formal-security-'));
after(()=>rm(dir,{recursive:true,force:true}));
const stateKey=Symbol.for('msr.formal-security.tests');
const sourceId='11111111-1111-4111-8111-111111111111';
const serverLog=[{at:'2026-10-19T01:00:00Z',stage:'inventory',message:'Server completed the original source inventory.'}];
const forgedLog=[{at:'2026-10-19T01:00:00Z',stage:'fake-verification',message:'FAKE: all physical claims proved by the server.'}];
const source={id:sourceId,filename:'source.txt',sha256:'a'.repeat(64),mimeType:'text/plain',pageCount:1,lines:[{id:'p1-l001',page:1,line:1,text:'Original source statement.'}],events:[],fileUrl:`/api/formal-lab/sources/${sourceId}/file`,warnings:[],createdAt:'2026-10-19T00:00:00Z'};
const fakeDb=`const key=Symbol.for('msr.formal-security.tests');export const pool={async query(sql,args=[]){return globalThis[key].query(sql,args)},async connect(){return {query:this.query,release(){}}}};`;
await build({stdin:{contents:`export {createSubmission,appendRevision} from './store.ts';export {extractSource} from './sources.ts';export {packageDigest} from './package.ts';`,resolveDir:path.join(root,'artifacts/api-server/src/formal'),loader:'ts'},outfile:path.join(dir,'security.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent',plugins:[{name:'isolated-database',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:'db',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:fakeDb,loader:'ts'}));}}]});
await build({entryPoints:[path.join(root,'artifacts/api-server/formal-source-worker.cjs')],outfile:path.join(dir,'formal-source-worker.cjs'),platform:'node',bundle:true,format:'cjs',logLevel:'silent'});
const {createSubmission,appendRevision,extractSource,packageDigest}=await import(pathToFileURL(path.join(dir,'security.mjs')).href);
const original=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));
function packet(){return {...structuredClone(original),analysis:{version:'source-analysis-v2',sourceId,subjectSlug:'test',subjectTitle:'Test',coverage:[],inputReferences:[],claimReferences:[],extractionWarnings:[],ingestionLog:structuredClone(forgedLog)}};}
function reset(){
 const state={owner:'test-owner',id:null,rows:[]};
 state.query=async(sql,args)=>{
  sql=sql.trim();
  if(sql.startsWith('CREATE')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes('SELECT count(*)'))return {rows:[{n:0}]};
  if(sql.startsWith('INSERT INTO formal_lab_submissions')){state.id=args[0];return {rows:[]};}
  if(sql.startsWith('INSERT INTO formal_lab_revisions')){const [id,submission_id,revision,pkg,digest,origin,model]=args.length===6?[args[0],args[1],1,...args.slice(2)]:args;state.rows.push({id,submission_id,revision,package:JSON.parse(pkg),digest,origin,model,created_at:new Date(),approved_at:null,verification:null,outputs:null,publish_consent:false});return {rows:[]};}
  if(sql.startsWith('SELECT r.* FROM formal_lab_submissions'))return {rows:state.rows.slice(-1)};
  if(sql.startsWith('SELECT id FROM formal_lab_submissions'))return {rows:[{id:state.id}]};
  if(sql.startsWith('SELECT * FROM formal_lab_revisions'))return {rows:state.rows.slice(-1)};
  if(sql.startsWith('SELECT metadata,is_public'))return {rows:[{metadata:{...source,id:args[0]},is_public:false}]};
  throw new Error('Unexpected SQL in offline test: '+sql);
 };
 globalThis[stateKey]=state;return state;
}
test('author-created packages cannot forge a server ingestion trail',async()=>{
 const state=reset();const submitted=packet();const result=await createSubmission(state.owner,submitted);
 assert.equal(result.currentRevision.package.analysis.ingestionLog,undefined);
 assert(!JSON.stringify(state.rows[0]).includes('FAKE'));
 assert.deepEqual(submitted.analysis.ingestionLog,forgedLog,'caller data is not silently mutated');
});
test('editing a formulation preserves the real server log and removes forged replacement events',async()=>{
 const state=reset();const initial=packet();initial.analysis.ingestionLog=structuredClone(serverLog);
 const created=await createSubmission(state.owner,initial,'ai','test-model');
 const edited=structuredClone(created.currentRevision.package);edited.mainClaim+=' Clarified.';edited.analysis.ingestionLog=structuredClone(forgedLog);
 const result=await appendRevision(created.id,state.owner,edited,created.currentRevision.digest,'author-edit');
 assert.deepEqual(result.currentRevision.package.analysis.ingestionLog,serverLog);
 assert(!JSON.stringify(result).includes('FAKE'));
 assert.equal(result.currentRevision.digest,packageDigest(result.currentRevision.package));
 assert.notEqual(result.currentRevision.digest,packageDigest(edited));
});
test('changing the uploaded source clears the former source ingestion trail',async()=>{
 const state=reset();const initial=packet();initial.analysis.ingestionLog=structuredClone(serverLog);
 const created=await createSubmission(state.owner,initial,'ai','test-model');
 const edited=structuredClone(created.currentRevision.package);edited.analysis.sourceId='22222222-2222-4222-8222-222222222222';edited.analysis.ingestionLog=structuredClone(forgedLog);
 const result=await appendRevision(created.id,state.owner,edited,created.currentRevision.digest,'author-edit');
 assert.equal(result.currentRevision.package.analysis.ingestionLog,undefined);
 assert.deepEqual(created.currentRevision.package.analysis.ingestionLog,serverLog);
});
test('isolated bundled parser reads the actual one-page manuscript completely',async()=>{
 const bytes=await readFile(path.join(root,'artifacts/scireview/public/formal-lab/horizon-boundary-summary.pdf'));
 const result=await extractSource('horizon-boundary-summary.pdf','application/pdf',bytes);
 assert.equal(result.pageCount,1);assert.equal(result.lines.length,80);
 assert.equal(result.lines[0].text,'Horizon boundary mechanics');
 assert.equal(result.sha256,'7566aed2baa71088aed6f512189b8bc4c5068243f8509ad1ea95c25925874389');
 assert.equal(new Set(result.lines.map(line=>line.id)).size,80);
});
test('isolated parser rejects malformed PDF and complete documents beyond its page limit',async()=>{
 await assert.rejects(()=>extractSource('bad.pdf','application/pdf',Buffer.from('%PDF-not-a-document')),/could not be read/);
 const doc=await PDFDocument.create();for(let i=0;i<13;i++)doc.addPage();
 await assert.rejects(async()=>extractSource('long.pdf','application/pdf',Buffer.from(await doc.save())),/up to 12 pages/);
});
test('overlong extracted PDF source rows fail explicitly instead of being truncated',async()=>{
 const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);doc.addPage([60000,500]).drawText('x'.repeat(4200),{x:10,y:300,size:10,font});
 await assert.rejects(async()=>extractSource('long-row.pdf','application/pdf',Buffer.from(await doc.save())),/4,000 characters/);
});

test('PDF capacity rejects a third concurrent reader and releases slots after completion',async()=>{
 const bytes=await readFile(path.join(root,'artifacts/scireview/public/formal-lab/horizon-boundary-summary.pdf'));
 const first=extractSource('first.pdf','application/pdf',bytes);const second=extractSource('second.pdf','application/pdf',bytes);
 await assert.rejects(()=>extractSource('third.pdf','application/pdf',bytes),error=>error.statusCode===429&&/capacity/.test(error.message));
 assert.equal((await first).lines.length,80);assert.equal((await second).lines.length,80);
 assert.equal((await extractSource('next.pdf','application/pdf',bytes)).pageCount,1);
});
