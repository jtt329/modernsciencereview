import {randomUUID} from 'node:crypto';
import {pool} from '@workspace/db';
import {FormalError} from './package';
import {logger} from '../lib/logger';
import type{FormalJob}from './contract';
let ready:Promise<unknown>|undefined;
const live=new Set<string>();
export async function ensureJobSchema(){
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_jobs(id uuid PRIMARY KEY,owner_id text NOT NULL,kind text NOT NULL,status text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS formal_lab_job_owner_idx ON formal_lab_jobs(owner_id,created_at);`).catch(e=>{ready=undefined;throw e;});await ready;
}
export async function createJob(owner:string,kind:FormalJob['kind'],refs:{sourceId?:string;submissionId?:string}):Promise<FormalJob>{
  await ensureJobSchema();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('formal-lab-job-capacity',0))");
    const {rows:[global]}=await client.query("SELECT count(*)::int AS active FROM formal_lab_jobs WHERE status IN ('queued','running') AND updated_at>now()-interval '15 minutes'");
    if(global.active>=3)throw new FormalError('The analysis service is at its pilot capacity. Try again after a running analysis completes.',429);
    const {rows:[n]}=await client.query(`SELECT count(*) FILTER (WHERE status IN ('queued','running') AND updated_at>now()-interval '15 minutes')::int AS active,count(*) FILTER(WHERE kind=$2 AND created_at>now()-interval '1 hour')::int AS recent FROM formal_lab_jobs WHERE owner_id=$1`,[owner,kind]);
    if(n.active>0)throw new FormalError('An analysis is already running for your account. Open its saved progress before starting another.',429);
    if(n.recent>=8)throw new FormalError('Pilot limit: eight analyses and eight output-generation runs per hour.',429);
    const job:FormalJob={id:randomUUID(),kind,status:'queued',stage:'queued',events:[{at:new Date().toISOString(),stage:'queued',message:'Job created; source and subsequent results are saved separately.'}],...refs,updatedAt:new Date().toISOString()};
    await client.query('INSERT INTO formal_lab_jobs(id,owner_id,kind,status,metadata) VALUES($1,$2,$3,$4,$5)',[job.id,owner,kind,job.status,JSON.stringify(job)]);
    await client.query('COMMIT');return job;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}

}
export async function readJob(id:string,owner:string):Promise<FormalJob>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw new FormalError('Analysis job not found.',404);await ensureJobSchema();
  const{rows:[row]}=await pool.query('SELECT metadata,updated_at FROM formal_lab_jobs WHERE id=$1 AND owner_id=$2',[id,owner]);if(!row)throw new FormalError('Analysis job not found.',404);
  const job:FormalJob=row.metadata;
  if(['queued','running'].includes(job.status)&&!live.has(id)&&Date.now()-new Date(row.updated_at).getTime()>15*60_000){job.status='failed';job.error='This analysis was interrupted by a server restart. Your source and completed results are retained. Start the stage again.';await persist(job);}
  return job;
}
async function persist(job:FormalJob){job.updatedAt=new Date().toISOString();await pool.query('UPDATE formal_lab_jobs SET status=$1,metadata=$2,updated_at=now() WHERE id=$3',[job.status,JSON.stringify(job),job.id]);}
export function launchJob(job:FormalJob,work:(progress:(stage:string,message:string)=>Promise<void>)=>Promise<{submissionId?:string}>):void{
  live.add(job.id);
  void(async()=>{
    const progress=async(stage:string,message:string)=>{job.status='running';job.stage=stage;job.events.push({at:new Date().toISOString(),stage,message:message.slice(0,2000)});await persist(job);};
    try{await progress('started','Processing this source with a real analysis pipeline.');const result=await work(progress);Object.assign(job,result);job.status='complete';job.stage='complete';job.events.push({at:new Date().toISOString(),stage:'complete',message:'Completed. Open the saved submission to inspect every source link and result.'});await persist(job);}
    catch(error){job.status='failed';job.stage='failed';job.error=error instanceof FormalError?error.message:'This stage could not complete. Your source and completed results are retained; retry the stage.';job.events.push({at:new Date().toISOString(),stage:'failed',message:job.error});await persist(job).catch(()=>{});logger.warn({jobId:job.id,errorType:error instanceof Error?error.name:'unknown'},'Formal Lab job failed');}
    finally{live.delete(job.id);}
  })();
}
