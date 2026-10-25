import {randomUUID} from 'node:crypto';
import {pool} from '@workspace/db';
import {FormalError} from './package';
import {logger} from '../lib/logger';
import type{FormalJob}from './contract';
import {ensureCanonicalSchema} from './canonicalStore';
import {ensureLiteratureSchema} from './literatureStore';
import {ensureJobSchema} from './jobSchema';
import {ensureScientificAssessmentSchema} from './assessmentStore';
export {ensureJobSchema} from './jobSchema';
const live=new Set<string>();
type JobReferences = {sourceId?:string;submissionId?:string;model?:FormalJob['model'];revisionDigest?:string;discussionId?:string;revisionId?:string;evidenceFingerprint?:string};
async function reserveJob(owner:string,kind:FormalJob['kind'],refs:JobReferences,reuseProcess=false,assessmentKind?:'canonical'|'literature'|'assessment'):Promise<{job:FormalJob|null;created:boolean}>{
  await ensureJobSchema();if(assessmentKind==='canonical')await ensureCanonicalSchema();if(assessmentKind==='literature')await ensureLiteratureSchema();if(assessmentKind==='assessment')await ensureScientificAssessmentSchema();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('formal-lab-job-capacity',0))");
    if(reuseProcess){
      const {rows:[revision]}=await client.query('SELECT r.digest,r.approved_at,r.created_at,r.verification,r.outputs,r.publish_consent FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 ORDER BY r.revision DESC LIMIT 1 FOR UPDATE OF s',[refs.submissionId,owner]);
      if(!revision||revision.digest!==refs.revisionDigest||!revision.approved_at)throw new FormalError('Approve the exact current revision before starting its verification.',409);
      const {rows:[existing]}=await client.query(`SELECT metadata FROM formal_lab_jobs WHERE owner_id=$1 AND kind='process' AND metadata->>'submissionId'=$2 AND status IN ('queued','running') AND updated_at>now()-interval '15 minutes' AND (metadata->>'revisionDigest'=$3 OR (NOT metadata ? 'revisionDigest' AND created_at >= $4)) ORDER BY created_at DESC LIMIT 1`,[owner,refs.submissionId,refs.revisionDigest,revision.created_at]);
      if(existing){await client.query('COMMIT');return {job:existing.metadata,created:false};}
      if(revision.outputs?.packageDigest===refs.revisionDigest&&revision.verification?.packageDigest===refs.revisionDigest){
        const {rows:[last]}=await client.query(`SELECT status FROM formal_lab_jobs WHERE owner_id=$1 AND kind='process' AND metadata->>'submissionId'=$2 AND (metadata->>'revisionDigest'=$3 OR (NOT metadata ? 'revisionDigest' AND created_at >= $4)) ORDER BY created_at DESC LIMIT 1`,[owner,refs.submissionId,refs.revisionDigest,revision.created_at]);
        if(!revision.publish_consent||last?.status==='complete'){await client.query('COMMIT');return {job:null,created:false};}
      }
    }
    if(assessmentKind){
      const {rows:[revision]}=await client.query('SELECT r.digest,r.approved_at FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 AND r.id=$3 FOR UPDATE OF s',[refs.submissionId,owner,refs.revisionId]);
      if(!revision||!revision.approved_at||revision.digest!==refs.revisionDigest)throw new FormalError('This assessment requires the exact author-approved revision.',409);
      const {rows:[existing]}=await client.query(`SELECT metadata FROM formal_lab_jobs WHERE owner_id=$1 AND kind='${assessmentKind}' AND metadata->>'submissionId'=$2 AND metadata->>'revisionId'=$3 AND metadata->>'revisionDigest'=$4 AND ($5::text IS NULL OR metadata->>'evidenceFingerprint'=$5) AND status IN ('queued','running') AND updated_at>now()-interval '15 minutes' ORDER BY created_at DESC LIMIT 1`,[owner,refs.submissionId,refs.revisionId,refs.revisionDigest,refs.evidenceFingerprint||null]);
      if(existing){await client.query('COMMIT');return {job:existing.metadata,created:false};}
      const table=assessmentKind==='canonical'?'formal_lab_canonical_assessments':assessmentKind==='literature'?'formal_lab_literature_assessments':'formal_lab_scientific_assessments';
      const fingerprintClause=assessmentKind==='assessment'?' AND evidence_fingerprint=$5':'';
      const {rows:[saved]}=await client.query(`SELECT id FROM ${table} WHERE submission_id=$1 AND owner_id=$2 AND revision_id=$3 AND package_digest=$4${fingerprintClause} LIMIT 1`,[refs.submissionId,owner,refs.revisionId,refs.revisionDigest,...(assessmentKind==='assessment'?[refs.evidenceFingerprint]:[])]);
      if(saved){await client.query('COMMIT');return {job:null,created:false};}
    }
    if(kind==='discussion'){
      const {rows:[linked]}=await client.query(`SELECT d.metadata,r.id AS revision_id,r.digest FROM formal_lab_submissions s JOIN formal_lab_discussions d ON d.submission_id=s.id JOIN LATERAL (SELECT id,digest FROM formal_lab_revisions WHERE submission_id=s.id ORDER BY revision DESC LIMIT 1) r ON true WHERE s.id=$1 AND s.owner_id=$2 AND d.id=$3 AND d.owner_id=$2 FOR UPDATE OF s,d`,[refs.submissionId,owner,refs.discussionId]);
      if(!linked||linked.metadata.status!=='pending'||linked.metadata.jobId||linked.digest!==refs.revisionDigest||linked.revision_id!==linked.metadata.revisionId)throw new FormalError('The comment or current revision changed before its reply could start.',409);
    }
    const {rows:[global]}=await client.query("SELECT count(*)::int AS active FROM formal_lab_jobs WHERE status IN ('queued','running') AND updated_at>now()-interval '15 minutes'");
    if(global.active>=3)throw new FormalError('The analysis service is at its pilot capacity. Try again after a running analysis completes.',429);
    const {rows:[n]}=await client.query(`SELECT count(*) FILTER (WHERE status IN ('queued','running') AND updated_at>now()-interval '15 minutes')::int AS active,count(*) FILTER(WHERE kind=$2 AND created_at>now()-interval '1 hour')::int AS recent FROM formal_lab_jobs WHERE owner_id=$1`,[owner,kind]);
    if(n.active>0)throw new FormalError('An analysis is already running for your account. Open its saved progress before starting another.',429);
    if(n.recent>=(kind==='discussion'?30:8))throw new FormalError(kind==='discussion'?'Pilot limit: thirty discussion messages per hour.':'Pilot limit: eight analyses and eight output-generation runs per hour.',429);
    const job:FormalJob={id:randomUUID(),kind,status:'queued',stage:'queued',events:[{at:new Date().toISOString(),stage:'queued',message:kind==='discussion'?'Comment saved; preparing a source-linked model response.':'Job created; the uploaded source is saved. Completed drafts and final results are saved separately.'}],...refs,updatedAt:new Date().toISOString()};
    await client.query('INSERT INTO formal_lab_jobs(id,owner_id,kind,status,metadata) VALUES($1,$2,$3,$4,$5)',[job.id,owner,kind,job.status,JSON.stringify(job)]);
    await client.query('COMMIT');return {job,created:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function createJob(owner:string,kind:FormalJob['kind'],refs:JobReferences):Promise<FormalJob>{return (await reserveJob(owner,kind,refs)).job!;}
/** Duplicate approval requests and retries reuse the same live revision job. */
export async function createOrReuseProcessJob(owner:string,refs:JobReferences&{submissionId:string;revisionDigest:string}){return reserveJob(owner,'process',refs,true);}
export async function createOrReuseCanonicalJob(owner:string,refs:JobReferences&{submissionId:string;revisionId:string;revisionDigest:string}){return reserveJob(owner,'canonical',refs,false,'canonical');}
export async function createOrReuseLiteratureJob(owner:string,refs:JobReferences&{submissionId:string;revisionId:string;revisionDigest:string}){return reserveJob(owner,'literature',refs,false,'literature');}
export async function createOrReuseScientificAssessmentJob(owner:string,refs:JobReferences&{submissionId:string;revisionId:string;revisionDigest:string;evidenceFingerprint:string}){return reserveJob(owner,'assessment',refs,false,'assessment');}
export async function readActiveScientificAssessmentJob(owner:string,refs:{submissionId:string;revisionId:string;revisionDigest:string;evidenceFingerprint:string}):Promise<FormalJob|null>{
  await ensureJobSchema();const {rows:[row]}=await pool.query("SELECT id FROM formal_lab_jobs WHERE owner_id=$1 AND kind='assessment' AND metadata->>'submissionId'=$2 AND metadata->>'revisionId'=$3 AND metadata->>'revisionDigest'=$4 AND metadata->>'evidenceFingerprint'=$5 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",[owner,refs.submissionId,refs.revisionId,refs.revisionDigest,refs.evidenceFingerprint]);
  if(!row)return null;const job=await readJob(row.id,owner);return job.kind==='assessment'&&job.revisionId===refs.revisionId&&job.revisionDigest===refs.revisionDigest&&job.evidenceFingerprint===refs.evidenceFingerprint&&['queued','running'].includes(job.status)?job:null;
}
/** Read-only recovery of an owner's exact supplemental job; never used by public views. */
export async function readActiveAssessmentJob(owner:string,kind:'canonical'|'literature',refs:{submissionId:string;revisionId:string;revisionDigest:string}):Promise<FormalJob|null>{
  await ensureJobSchema();
  const {rows:[row]}=await pool.query("SELECT id FROM formal_lab_jobs WHERE owner_id=$1 AND kind=$2 AND metadata->>'submissionId'=$3 AND metadata->>'revisionId'=$4 AND metadata->>'revisionDigest'=$5 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",[owner,kind,refs.submissionId,refs.revisionId,refs.revisionDigest]);
  if(!row)return null;
  const job=await readJob(row.id,owner);
  return job.kind===kind&&job.submissionId===refs.submissionId&&job.revisionId===refs.revisionId&&job.revisionDigest===refs.revisionDigest&&['queued','running'].includes(job.status)?job:null;
}
export async function readJob(id:string,owner:string):Promise<FormalJob>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw new FormalError('Analysis job not found.',404);await ensureJobSchema();
  const{rows:[row]}=await pool.query('SELECT metadata,updated_at FROM formal_lab_jobs WHERE id=$1 AND owner_id=$2',[id,owner]);if(!row)throw new FormalError('Analysis job not found.',404);
  const job:FormalJob=row.metadata;
  if(['queued','running'].includes(job.status)&&!live.has(id)&&Date.now()-new Date(row.updated_at).getTime()>15*60_000){
    job.status='failed';job.stage='failed';job.error=job.kind==='discussion'?'The reply was interrupted. Your comment and existing draft are saved; submit another comment to continue.':'This analysis was interrupted by a server restart. Your uploaded source and previously saved revisions are retained. Start the stage again.';job.updatedAt=new Date().toISOString();
    const changed=await pool.query("UPDATE formal_lab_jobs SET status=$1,metadata=$2,updated_at=now() WHERE id=$3 AND owner_id=$4 AND status IN ('queued','running') AND updated_at=$5",[job.status,JSON.stringify(job),id,owner,row.updated_at]);
    if(!changed.rowCount){const {rows:[fresh]}=await pool.query('SELECT metadata FROM formal_lab_jobs WHERE id=$1 AND owner_id=$2',[id,owner]);if(!fresh)throw new FormalError('Analysis job not found.',404);return fresh.metadata;}
  }
  return job;
}
/** A route can cancel a saved reservation only before any provider work starts. */
export async function failUnstartedJob(id:string,owner:string):Promise<void>{
  await ensureJobSchema();
  await pool.query(`UPDATE formal_lab_jobs SET status='failed',metadata=jsonb_set(jsonb_set(jsonb_set(metadata,'{status}','"failed"'),'{stage}','"failed"'),'{error}',to_jsonb('The request could not be started. The source, comment and existing revisions are retained.'::text)),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='queued'`,[id,owner]);
}
async function persist(job:FormalJob){job.updatedAt=new Date().toISOString();await pool.query('UPDATE formal_lab_jobs SET status=$1,metadata=$2,updated_at=now() WHERE id=$3',[job.status,JSON.stringify(job),job.id]);}
export function launchJob(job:FormalJob,work:(progress:(stage:string,message:string)=>Promise<void>)=>Promise<{submissionId?:string;discussionId?:string}>):void{
  if(live.has(job.id))return;
  live.add(job.id);
  // Reasoning requests can legitimately run for several minutes. Keep the saved
  // job lease current without adding fabricated progress events.
  const lease=setInterval(()=>{void pool.query("UPDATE formal_lab_jobs SET updated_at=now() WHERE id=$1 AND status IN ('queued','running')",[job.id]).catch(()=>{});},30000);
  lease.unref();
  void(async()=>{
    const progress=async(stage:string,message:string)=>{job.status='running';job.stage=stage;job.events.push({at:new Date().toISOString(),stage,message:message.slice(0,2000)});await persist(job);};
    try{
      // A reservation is claimed once even if two server callers attempt to launch it.
      const claimed=await pool.query("UPDATE formal_lab_jobs SET status='running',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",[job.id]);
      if(!claimed.rowCount)return;
      await progress('started',job.kind==='discussion'?'Preparing a reply from the saved revision and complete numbered source.':'Processing this source with a real analysis pipeline.');const result=await work(progress);Object.assign(job,result);job.status='complete';job.stage='complete';job.events.push({at:new Date().toISOString(),stage:'complete',message:'Completed. Open the saved submission to inspect every source link and result.'});await persist(job);}
    catch(error){job.status='failed';job.stage='failed';job.error=error instanceof FormalError?error.message:'This stage could not complete. Your uploaded source and previously saved revisions are retained; retry the stage.';job.events.push({at:new Date().toISOString(),stage:'failed',message:job.error});await persist(job).catch(()=>{});logger.warn({jobId:job.id,errorType:error instanceof Error?error.name:'unknown'},'Formal Lab job failed');}
    finally{clearInterval(lease);live.delete(job.id);}
  })();
}
