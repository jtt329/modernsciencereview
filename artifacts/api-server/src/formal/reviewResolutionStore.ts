import {randomUUID} from 'node:crypto';
import {pool} from '@workspace/db';
import type {FormalSubmission} from './contract';
import type {ReviewResolutionCollection,ReviewResolutionRecord,ReviewResolutionOverlay} from './reviewResolutionContract';
import type {ReviewResolutionContext} from './reviewResolution';
import {buildReviewResolutionOverlay,validateReviewResolutionDraft,validateStoredReviewResolution} from './reviewResolution';
import {FormalError} from './package';
import {ensureFormalSchema,readSubmission,readRevisionSubmission} from './store';
import {ensureJobSchema} from './jobSchema';
import {readCanonicalAssessment} from './canonicalStore';
import {readLiteratureAssessment} from './literatureStore';
import {readScientificAssessment} from './assessmentStore';
type QueryClient={query:(sql:string,args?:any[])=>Promise<{rows:any[];rowCount?:number|null}>};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let ready:Promise<unknown>|undefined;
export async function ensureReviewResolutionSchema(){
 await ensureFormalSchema();
 if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_review_resolutions (
  id uuid PRIMARY KEY,submission_id uuid NOT NULL REFERENCES formal_lab_submissions(id),revision_id uuid NOT NULL REFERENCES formal_lab_revisions(id),
  owner_id text NOT NULL,package_digest text NOT NULL,discussion_id uuid NOT NULL,message_id uuid NOT NULL,
  metadata jsonb NOT NULL,status text NOT NULL DEFAULT 'proposed',created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz,
  UNIQUE(discussion_id,message_id)
 );CREATE INDEX IF NOT EXISTS formal_lab_resolution_revision_idx ON formal_lab_review_resolutions(revision_id,created_at);CREATE INDEX IF NOT EXISTS formal_lab_resolution_owner_idx ON formal_lab_review_resolutions(owner_id,created_at);`).catch(error=>{ready=undefined;throw error;});
 await ready;
}
function record(row:any):ReviewResolutionRecord{return {...row.metadata,status:row.status,createdAt:new Date(row.created_at).toISOString(),acceptedAt:row.accepted_at?new Date(row.accepted_at).toISOString():null};}
async function recordsFor(submission:FormalSubmission,owner:string,database:QueryClient=pool):Promise<ReviewResolutionRecord[]>{
 const r=submission.currentRevision;
 const {rows}=await database.query(`SELECT a.metadata,a.status,a.created_at,a.accepted_at FROM formal_lab_review_resolutions a JOIN formal_lab_submissions s ON s.id=a.submission_id JOIN formal_lab_revisions r ON r.id=a.revision_id WHERE a.submission_id=$1 AND s.owner_id=$2 AND a.owner_id=$2 AND a.revision_id=$3 AND a.package_digest=$4 AND r.digest=a.package_digest ORDER BY a.created_at,a.id`,[submission.id,owner,r.id,r.digest]);
 return rows.map(record);
}
function collection(submission:FormalSubmission,records:ReviewResolutionRecord[]):ReviewResolutionCollection{
 const ordered=[...records].sort((a,b)=>(a.acceptedAt||a.createdAt).localeCompare(b.acceptedAt||b.createdAt)||a.id.localeCompare(b.id));
 return {proposals:records.filter(row=>row.status==='proposed'),accepted:ordered.filter(row=>row.status==='accepted'),overlay:buildReviewResolutionOverlay(submission,ordered)};
}
export async function readReviewResolutionOverlay(submission:FormalSubmission,owner:string):Promise<ReviewResolutionOverlay>{
 await ensureReviewResolutionSchema();
 // Do not accept a caller-provided snapshot as proof of ownership.
 const owned=await readRevisionSubmission(submission.id,owner,submission.currentRevision.id);
 if(owned.currentRevision.digest!==submission.currentRevision.digest)throw new FormalError('Resolution evidence does not match this exact revision.',409);
 return collection(owned,await recordsFor(owned,owner)).overlay;
}
export async function loadReviewResolutionContext(submission:FormalSubmission,owner:string,database:QueryClient=pool):Promise<ReviewResolutionContext>{
 await ensureReviewResolutionSchema();
 const [canonicalAssessment,literatureAssessment,scientificAssessment,records]=await Promise.all([
  readCanonicalAssessment(submission.id,owner,submission.currentRevision.id),readLiteratureAssessment(submission.id,owner,submission.currentRevision.id),
  readScientificAssessment(submission.id,owner,submission.currentRevision.id),recordsFor(submission,owner,database)
 ]);
 return {submission,overlay:collection(submission,records).overlay,canonicalAssessment:canonicalAssessment||undefined,literatureAssessment:literatureAssessment||undefined,scientificAssessment:scientificAssessment||undefined};
}
export async function listReviewResolutions(submissionId:string,owner:string,revisionId?:string):Promise<ReviewResolutionCollection>{
 await ensureReviewResolutionSchema();const submission=revisionId?await readRevisionSubmission(submissionId,owner,revisionId):await readSubmission(submissionId,owner);
 return collection(submission,await recordsFor(submission,owner));
}
/** Save an AI proposal with its exact original reply; it has no effect until accepted. */
export async function recordReviewResolutionProposal(submission:FormalSubmission,owner:string,discussionId:string,messageId:string,value:unknown,model:string,database:QueryClient=pool,expectedContext?:{assessmentDigest:string;scientificFingerprint:string|null}):Promise<ReviewResolutionRecord>{
 await ensureReviewResolutionSchema();
 if(!UUID.test(discussionId)||!UUID.test(messageId)||typeof model!=='string'||model.length>150)throw new FormalError('Invalid resolution provenance.');
 const {rows:[thread]}=await database.query('SELECT d.metadata FROM formal_lab_discussions d JOIN formal_lab_submissions s ON s.id=d.submission_id WHERE d.id=$1 AND d.owner_id=$2 AND s.owner_id=$2',[discussionId,owner]);
 if(!thread||thread.metadata.submissionId!==submission.id||thread.metadata.revisionId!==submission.currentRevision.id||thread.metadata.revisionDigest!==submission.currentRevision.digest)throw new FormalError('Resolution proposal does not match this discussion and revision.',409);
 const context=await loadReviewResolutionContext(submission,owner,database);
 if(expectedContext&&(expectedContext.assessmentDigest!==context.overlay.assessmentDigest||expectedContext.scientificFingerprint!==(context.scientificAssessment?.evidenceFingerprint||null)))throw new FormalError('The accepted assessment changed while this resolution was being prepared. Refresh the discussion.',409);
 const proposal=validateReviewResolutionDraft(context,value);
 if(proposal.target.kind!==thread.metadata.target.kind||proposal.target.id!==thread.metadata.target.id)throw new FormalError('A resolution must address the exact item being discussed.');
 const {rows:[count]}=await database.query('SELECT count(*)::int AS n FROM formal_lab_review_resolutions WHERE revision_id=$1 AND owner_id=$2',[submission.currentRevision.id,owner]);
 if(count.n>=500)throw new FormalError('Pilot limit: five hundred resolution proposals per revision.',429);
 const at=new Date().toISOString();const saved:ReviewResolutionRecord={id:randomUUID(),submissionId:submission.id,revisionId:submission.currentRevision.id,packageDigest:submission.currentRevision.digest,discussionId,messageId,model,status:'proposed',createdAt:at,acceptedAt:null,proposal};
 await database.query('INSERT INTO formal_lab_review_resolutions(id,submission_id,revision_id,owner_id,package_digest,discussion_id,message_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[saved.id,saved.submissionId,saved.revisionId,owner,saved.packageDigest,discussionId,messageId,JSON.stringify(saved)]);
 return saved;
}
/** Serialize with source changes and AI jobs; accepting changes assessment only. */
export async function acceptReviewResolution(submissionId:string,owner:string,resolutionId:string,value:{digest:string;beforeFingerprint:string}):Promise<ReviewResolutionCollection>{
 if(!UUID.test(resolutionId)||!value||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||typeof value.beforeFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.beforeFingerprint))throw new FormalError('Supply the exact revision digest and proposed assessment fingerprint.');
 await ensureReviewResolutionSchema();await ensureJobSchema();const initial=await readSubmission(submissionId,owner);
 if(initial.currentRevision.digest!==value.digest)throw new FormalError('The manuscript revision changed. Reload before accepting an assessment resolution.',409);
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('formal-lab-job-capacity',0))");
  const {rows:[owned]}=await client.query('SELECT id FROM formal_lab_submissions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[submissionId,owner]);if(!owned)throw new FormalError('Submission not found.',404);
  const {rows:[latest]}=await client.query('SELECT * FROM formal_lab_revisions WHERE submission_id=$1 ORDER BY revision DESC LIMIT 1',[submissionId]);
  if(!latest||latest.id!==initial.currentRevision.id||latest.digest!==value.digest)throw new FormalError('The manuscript revision changed. Reload before accepting an assessment resolution.',409);
  const {rows:[row]}=await client.query('SELECT metadata,status,created_at,accepted_at FROM formal_lab_review_resolutions WHERE id=$1 AND submission_id=$2 AND owner_id=$3 AND revision_id=$4 AND package_digest=$5 FOR UPDATE',[resolutionId,submissionId,owner,latest.id,latest.digest]);
  if(!row)throw new FormalError('Resolution not found.',404);const saved=record(row);
  if(saved.proposal.beforeFingerprint!==value.beforeFingerprint)throw new FormalError('The proposed correction changed. Review its exact before and after values.',409);
  if(saved.status!=='accepted'){
   const {rows:[active]}=await client.query("SELECT count(*)::int AS n FROM formal_lab_jobs WHERE owner_id=$1 AND status IN ('queued','running') AND updated_at>now()-interval '15 minutes'",[owner]);
   if(active.n>0)throw new FormalError('Wait for the running analysis or verification to finish before accepting assessment corrections.',409);
   const authoritative={...initial,currentRevision:{...initial.currentRevision,package:latest.package,verification:latest.verification||null,outputs:latest.outputs||null}};
   const context=await loadReviewResolutionContext(authoritative,owner,client);validateStoredReviewResolution(context,saved.proposal);
   await client.query("UPDATE formal_lab_review_resolutions SET status='accepted',accepted_at=now() WHERE id=$1 AND owner_id=$2 AND status='proposed'",[resolutionId,owner]);
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return listReviewResolutions(submissionId,owner,initial.currentRevision.id);
}
/** Hydrate acceptance status without changing the original saved reply/proposal. */
export async function reviewResolutionRecordsByIds(ids:string[],owner:string):Promise<ReviewResolutionRecord[]>{
 if(!ids.length)return [];if(ids.length>5000||ids.some(id=>!UUID.test(id)))throw new FormalError('Invalid resolution references.');await ensureReviewResolutionSchema();
 const {rows}=await pool.query('SELECT a.metadata,a.status,a.created_at,a.accepted_at FROM formal_lab_review_resolutions a JOIN formal_lab_submissions s ON s.id=a.submission_id WHERE a.id=ANY($1::uuid[]) AND a.owner_id=$2 AND s.owner_id=$2',[ids,owner]);return rows.map(record);
}
/** This helper publishes only explicitly accepted assessment content, never comments/proposals. */
export async function readPublishedReviewResolutionOverlay(submission:FormalSubmission):Promise<ReviewResolutionOverlay|null>{
 const r=submission.currentRevision;if(!r.approvedAt||r.publishConsent!==true)return null;await ensureReviewResolutionSchema();
 const {rows:[published]}=await pool.query("SELECT 1 FROM formal_lab_publications_v2 WHERE submission_id=$1 AND revision_id=$2 AND digest=$3 AND source_id=$4 AND snapshot->'currentRevision'->'package'->'source'->>'sha256'=$5",[submission.id,r.id,r.digest,r.package.analysis?.sourceId,r.package.source.sha256]);if(!published)return null;
 const {rows}=await pool.query("SELECT metadata,status,created_at,accepted_at FROM formal_lab_review_resolutions WHERE submission_id=$1 AND revision_id=$2 AND package_digest=$3 AND status='accepted' ORDER BY accepted_at,id",[submission.id,r.id,r.digest]);
 return collection(submission,rows.map(record)).overlay;
}
