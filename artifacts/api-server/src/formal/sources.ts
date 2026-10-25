import { randomUUID, createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FormalError } from './package';
import { validateSourceEdits } from './reviewProposal';
import type { IngestedSource, SourceLine } from './contract';
let ready:Promise<unknown>|undefined;
export async function ensureSourceSchema(){
  if(!ready) ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_sources(id uuid PRIMARY KEY,owner_id text NOT NULL,metadata jsonb NOT NULL,file_data bytea NOT NULL,is_public boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS formal_lab_source_owner_idx ON formal_lab_sources(owner_id);`).catch(e=>{ready=undefined;throw e;});
  await ready;
}
let activeExtractions=0;
async function extractPdf(bytes:Buffer):Promise<{pageCount:number;lines:SourceLine[]}>{
  if(activeExtractions>=2)throw new FormalError('The PDF reader is at its pilot capacity. Try again shortly.',429);
  activeExtractions++;
  try{
    const bundled=fileURLToPath(new URL('./formal-source-worker.cjs',import.meta.url));
    const source=fileURLToPath(new URL('../../formal-source-worker.cjs',import.meta.url));
    const script=existsSync(bundled)?bundled:source;
    return await new Promise((resolve,reject)=>{
      const worker=new Worker(script,{workerData:{bytes},env:{},execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
      let settled=false;
      const finish=(error?:Error,result?:{pageCount:number;lines:SourceLine[]})=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate().then(()=>error?reject(error):resolve(result!),()=>reject(error||new FormalError('The PDF reader could not shut down safely. Try its text source.',422)));};
      const timer=setTimeout(()=>finish(new FormalError('PDF extraction reached its 15-second limit. Upload a concise PDF or its matching TeX/text source; no partial source was saved.',422)),15000);
      worker.stdout?.resume();worker.stderr?.resume();
      worker.on('message',result=>{if(result?.ok&&Array.isArray(result.lines)&&Number.isInteger(result.pageCount))finish(undefined,result);else finish(new FormalError(typeof result?.message==='string'?result.message:'The PDF could not be read. Upload its matching text source.'));});
      worker.on('error',()=>finish(new FormalError('The PDF reader reached its resource limit or could not read this file. Upload its concise TeX/text source.',422)));
      worker.on('exit',()=>{if(!settled)finish(new FormalError('The PDF reader stopped before extraction completed. Upload its matching text source.',422));});
    });
  }finally{activeExtractions--;}
}
export async function extractSource(filename:string,mimeType:string,bytes:Buffer):Promise<IngestedSource>{
  if(!bytes.length||bytes.length>5*1024*1024) throw new FormalError('Upload a PDF, text or TeX file up to 5 MB.');
  const isPdf=mimeType==='application/pdf'||/\.pdf$/i.test(filename);
  const lines:SourceLine[]=[];const warnings:string[]=[];let pageCount=1;
  if(isPdf){
    if(bytes.subarray(0,5).toString()!=='%PDF-') throw new FormalError('This file is not a valid PDF.');
    const extracted=await extractPdf(bytes);pageCount=extracted.pageCount;lines.push(...extracted.lines);
    warnings.push('PDF text order, symbols, superscripts and equation layout can be imperfect. Numbered lines are an extraction index; compare the original PDF before approval. The AI also receives the original PDF for equation reading.');
  }else{
    if(!/\.(txt|tex|md)$/i.test(filename)&&!['text/plain','application/x-tex','text/x-tex','text/markdown'].includes(mimeType))throw new FormalError('Supported files are PDF, TXT, TeX and Markdown.');
    const raw=bytes.toString('utf8');if(raw.split(/\r?\n/).some(line=>line.length>4000))throw new FormalError('A source line exceeds 4,000 characters. Add line breaks to the text source; no text was truncated.');if(raw.includes('\u0000'))throw new FormalError('The text source contains binary data.');
    let index=0;for(const text of raw.replace(/\r\n?/g,'\n').split('\n')){index++;if(text.trim())lines.push({id:`p1-l${String(index).padStart(3,'0')}`,page:1,line:index,text:text.slice(0,4000)});}
    warnings.push('Text/TeX source is read as data. No TeX commands or uploaded code are executed.');
  }
  const total=lines.reduce((n,l)=>n+l.text.length,0);
  if(total>45000||lines.length>900)throw new FormalError('This pilot accepts up to 45,000 extracted characters and 900 source lines. Submit a concise summary; no lines were silently omitted.');
  const id=randomUUID();const createdAt=new Date().toISOString();
  return {id,filename:filename.replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180)||'paper.pdf',mimeType:isPdf?'application/pdf':'text/plain',sha256:createHash('sha256').update(bytes).digest('hex'),pageCount,lines,warnings,createdAt,fileUrl:`/api/formal-lab/sources/${id}/file`,events:[{at:createdAt,stage:'uploaded',message:`Received ${bytes.length.toLocaleString()} bytes; SHA-256 fingerprint recorded.`},{at:createdAt,stage:'extracted',message:`Indexed ${lines.length} source lines across ${pageCount} page(s); no content was silently truncated.`}]};
}
export async function saveSource(owner:string,filename:string,mimeType:string,base64:string){
  if(typeof base64!=='string'||base64.length>7_000_000||! /^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new FormalError('Invalid or oversized file encoding.');
  await ensureSourceSchema();const {rows:[count]}=await pool.query('SELECT count(*)::int AS n FROM formal_lab_sources WHERE owner_id=$1',[owner]);if(count.n>=60)throw new FormalError('Prototype limit: 60 uploaded sources per account.',429);
  const bytes=Buffer.from(base64,'base64');const source=await extractSource(filename,mimeType,bytes);
  await pool.query('INSERT INTO formal_lab_sources(id,owner_id,metadata,file_data) VALUES($1,$2,$3,$4)',[source.id,owner,JSON.stringify(source),bytes]);return source;
}
export async function readSource(id:string,owner?:string,includeBytes=false):Promise<{source:IngestedSource;bytes?:Buffer;isPublic:boolean}>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw new FormalError('Source not found.',404);await ensureSourceSchema();
  const {rows:[row]}=await pool.query(`SELECT metadata,is_public${includeBytes?',file_data':''} FROM formal_lab_sources WHERE id=$1 AND (owner_id=$2 OR is_public=true)`,[id,owner||'']);if(!row)throw new FormalError('Source not found.',404);
  return {source:row.metadata,bytes:row.file_data,isPublic:row.is_public};
}
export async function makeSourcePublic(id:string,owner:string){await ensureSourceSchema();await pool.query('UPDATE formal_lab_sources SET is_public=true WHERE id=$1 AND owner_id=$2',[id,owner]);}

/** Build a clearly labelled text transcription, preserving original page/line IDs.
 * The uploaded PDF and every earlier source version remain immutable. */
export function buildAmendedSource(source:IngestedSource,edits:import('./reviewContract').SourceEdit[],reason='Author accepted source clarifications'):{source:import('./reviewContract').AmendedSource;bytes:Buffer}{
  if(!/^[a-f0-9-]{36}$/.test(source.id)||!/^[a-f0-9]{64}$/.test(source.sha256)||source.fileUrl!==`/api/formal-lab/sources/${source.id}/file`)throw new FormalError('Invalid original source identity.');
  if(typeof reason!=='string'||!reason.trim()||reason.length>4000)throw new FormalError('An amendment needs a concise explanation.');
  const checked=validateSourceEdits(source,edits);if(!checked.length)throw new FormalError('An amended source needs at least one changed line.');
  const byId=new Map(checked.map(edit=>[edit.lineId,edit.after]));const lines=source.lines.map(line=>({...line,text:byId.get(line.id)??line.text}));
  if(lines.length>900||lines.reduce((sum,line)=>sum+line.text.length,0)>45000)throw new FormalError('The amended source exceeds the complete-analysis pilot bounds.');
  const id=randomUUID();const createdAt=new Date().toISOString();
  const previous=(source as import('./reviewContract').AmendedSource).amendment;
  const rootSourceId=previous?.rootSourceId||source.id;
  const header=`AMENDED TRANSCRIPTION — NOT THE ORIGINAL UPLOADED PDF\nParent source: ${source.id}\nParent SHA-256: ${source.sha256}\nOriginal source: ${rootSourceId}\nCreated: ${createdAt}\nReason: ${reason}\nStable numbered source lines follow; original PDF page/line locations are retained.\n\n`;
  const bytes=Buffer.from(header+lines.map(line=>`[${line.id}] ${line.text}`).join('\n')+'\n','utf8');
  const amended:import('./reviewContract').AmendedSource={...structuredClone(source),id,filename:(source.filename.replace(/\.[^.]+$/,'').slice(0,140)||'paper')+'-amended.txt',mimeType:'text/plain',sha256:createHash('sha256').update(bytes).digest('hex'),lines,createdAt,fileUrl:`/api/formal-lab/sources/${id}/file`,warnings:[...source.warnings,'This is an author-amended text transcription. Numbered locations refer to the original extraction; the uploaded PDF has not been changed.'],events:[...source.events,{at:createdAt,stage:'source-amended',message:`Created an immutable amended transcription from source ${source.id}; ${checked.length} numbered line(s) changed. The original upload is preserved.`}],amendment:{kind:'amended-transcription',parentSourceId:source.id,parentSha256:source.sha256,rootSourceId,createdAt,reason,edits:checked}};
  return {source:amended,bytes};
}
/** Ownership is checked directly, without the public-read fallback in readSource. */
export async function createAmendedSource(owner:string,sourceId:string,expectedSha256:string,edits:import('./reviewContract').SourceEdit[],reason?:string,transaction?:{query:(sql:string,args?:any[])=>Promise<{rows:any[]}>}):Promise<import('./reviewContract').AmendedSource>{
  if(typeof owner!=='string'||!owner||owner.length>500||!/^[a-f0-9-]{36}$/.test(sourceId)||!/^[a-f0-9]{64}$/.test(expectedSha256))throw new FormalError('Source not found.',404);
  await ensureSourceSchema();const database=transaction||pool;
  const {rows:[row]}=await database.query('SELECT metadata,file_data FROM formal_lab_sources WHERE id=$1 AND owner_id=$2',[sourceId,owner]);
  if(!row)throw new FormalError('Source not found.',404);
  const original:IngestedSource=row.metadata;
  if(original.id!==sourceId||original.sha256!==expectedSha256||!Buffer.isBuffer(row.file_data)||createHash('sha256').update(row.file_data).digest('hex')!==expectedSha256)throw new FormalError('The source identity changed. Reload before accepting an amendment.',409);
  const built=buildAmendedSource(original,edits,reason);
  const {rows:[count]}=await database.query('SELECT count(*)::int AS n FROM formal_lab_sources WHERE owner_id=$1',[owner]);
  if(count.n>=60)throw new FormalError('Prototype limit: 60 uploaded sources and amendments per account.',429);
  await database.query('INSERT INTO formal_lab_sources(id,owner_id,metadata,file_data) VALUES($1,$2,$3,$4)',[built.source.id,owner,JSON.stringify(built.source),built.bytes]);
  return built.source;
}
