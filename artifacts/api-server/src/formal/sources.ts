import { randomUUID, createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FormalError } from './package';
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
