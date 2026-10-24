import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import type { FormalPackage, FormalRevision, FormalSubmission, VerificationReport, FormalOutputs } from './contract';
import { FormalError, packageDigest } from './package';
import { readSource } from './sources';
let schemaReady: Promise<unknown> | undefined;
export async function ensureFormalSchema() {
  if(!schemaReady) schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS formal_lab_submissions (
      id uuid PRIMARY KEY, owner_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS formal_lab_owner_idx ON formal_lab_submissions(owner_id);
    CREATE TABLE IF NOT EXISTS formal_lab_revisions (
      id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES formal_lab_submissions(id),
      revision integer NOT NULL, package jsonb NOT NULL, digest text NOT NULL,
      origin text NOT NULL, model text, approved_at timestamptz, verification jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(submission_id,revision)
    );
    ALTER TABLE formal_lab_revisions ADD COLUMN IF NOT EXISTS outputs jsonb;
    ALTER TABLE formal_lab_revisions ADD COLUMN IF NOT EXISTS publish_consent boolean NOT NULL DEFAULT false;
  `).catch(error => { schemaReady=undefined; throw error; });
  await schemaReady;
}
function revision(row:any): FormalRevision {
  return {id:row.id,submissionId:row.submission_id,revision:row.revision,package:row.package,digest:row.digest,createdAt:row.created_at.toISOString(),origin:row.origin,model:row.model,approvedAt:row.approved_at?.toISOString()||null,verification:row.verification,outputs:row.outputs||null,publishConsent:row.publish_consent===true};
}
export async function readSubmission(id: string, owner: string): Promise<FormalSubmission> {
  if(!/^[a-f0-9-]{36}$/.test(id)) throw new FormalError('Submission not found.',404);
  await ensureFormalSchema();
  const {rows}=await pool.query(`SELECT r.* FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 ORDER BY r.revision DESC LIMIT 1`,[id,owner]);
  if(!rows[0]) throw new FormalError('Submission not found.',404);
  const currentRevision=revision(rows[0]);
  const sourceId=currentRevision.package.analysis?.sourceId;
  const sourceDocument=sourceId?(await readSource(sourceId,owner)).source:undefined;
  return {id,title:currentRevision.package.title,currentRevision,...(sourceDocument?{sourceDocument}:{})};
}
export async function listSubmissions(owner:string): Promise<FormalSubmission[]> {
  await ensureFormalSchema();
  const {rows}=await pool.query(`SELECT DISTINCT ON (s.id) r.* FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.owner_id=$1 ORDER BY s.id,r.revision DESC LIMIT 100`,[owner]);
  return rows.map(row => ({id:row.submission_id,title:row.package.title,currentRevision:revision(row)})).sort((a,b)=>b.currentRevision.createdAt.localeCompare(a.currentRevision.createdAt));
}
export async function revisionHistory(id:string,owner:string) {
  await readSubmission(id,owner);
  const {rows}=await pool.query('SELECT * FROM formal_lab_revisions WHERE submission_id=$1 ORDER BY revision DESC',[id]);
  return rows.map(revision);
}
/** The ingestion trail is server evidence, not part of the author's editable
 * interpretation. A revised formulation can retain the prior trail only while
 * it still names that same immutable uploaded source. */
export function authorPackageWithServerLog(pkg:FormalPackage,previous?:FormalPackage):FormalPackage {
  const next=structuredClone(pkg);
  if(next.analysis){
    const retained=previous?.analysis?.sourceId===next.analysis.sourceId?previous.analysis.ingestionLog:undefined;
    if(retained!==undefined)next.analysis.ingestionLog=structuredClone(retained);
    else delete next.analysis.ingestionLog;
  }
  return next;
}
export async function createSubmission(owner:string,pkg:FormalPackage,origin:'prepared-example'|'author-edit'|'ai'='author-edit',model:string|null=null) {
  if(origin!=='ai')pkg=authorPackageWithServerLog(pkg);
  await ensureFormalSchema();
  const {rows:[count]}=await pool.query('SELECT count(*)::int AS n FROM formal_lab_submissions WHERE owner_id=$1',[owner]);
  if(count.n>=50) throw new FormalError('Prototype limit: 50 submissions per account.',429);
  const client=await pool.connect(); const id=randomUUID();
  try { await client.query('BEGIN');
    await client.query('INSERT INTO formal_lab_submissions(id,owner_id) VALUES ($1,$2)',[id,owner]);
    await client.query(`INSERT INTO formal_lab_revisions(id,submission_id,revision,package,digest,origin,model) VALUES ($1,$2,1,$3,$4,$5,$6)`,[randomUUID(),id,JSON.stringify(pkg),packageDigest(pkg),origin,model]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return readSubmission(id,owner);
}
export async function appendRevision(id:string,owner:string,pkg:FormalPackage,baseDigest:string,origin:'ai'|'author-edit',model:string|null=null) {
  await readSubmission(id,owner);
  const client=await pool.connect();
  try { await client.query('BEGIN');
    await client.query('SELECT id FROM formal_lab_submissions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner]);
    const {rows:[latest]}=await client.query('SELECT * FROM formal_lab_revisions WHERE submission_id=$1 ORDER BY revision DESC LIMIT 1',[id]);
    if(latest.digest!==baseDigest) throw new FormalError('The draft changed. Reload the current revision before saving.',409);
    if(latest.revision>=100) throw new FormalError('Prototype limit: 100 revisions per submission.',429);
    pkg=authorPackageWithServerLog(pkg,latest.package);
    // Model attribution is server evidence and survives an author's edit of
    // the same source. A different source needs a fresh model analysis.
    if(origin==='author-edit')model=pkg.analysis?.sourceId===latest.package.analysis?.sourceId?latest.model:null;
    await client.query('INSERT INTO formal_lab_revisions(id,submission_id,revision,package,digest,origin,model) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,latest.revision+1,JSON.stringify(pkg),packageDigest(pkg),origin,model]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return readSubmission(id,owner);
}
export async function recordApprovalOrReport(id:string,owner:string,digest:string,report?:VerificationReport,publishConsent?:boolean) {
  await readSubmission(id,owner); const client=await pool.connect();
  try { await client.query('BEGIN');
    await client.query('SELECT id FROM formal_lab_submissions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner]);
    const {rows:[latest]}=await client.query('SELECT * FROM formal_lab_revisions WHERE submission_id=$1 ORDER BY revision DESC LIMIT 1',[id]);
    if(latest.digest!==digest) throw new FormalError('This is not the current revision. Review and approve the new version.',409);
    if(report) {
      if(!latest.approved_at || report.packageDigest!==digest) throw new FormalError('Approve this exact package before verification.',409);
      await client.query('UPDATE formal_lab_revisions SET verification=$1 WHERE id=$2',[JSON.stringify(report),latest.id]);
    } else await client.query('UPDATE formal_lab_revisions SET approved_at=COALESCE(approved_at,now()),publish_consent=CASE WHEN approved_at IS NULL THEN $2 ELSE publish_consent END WHERE id=$1',[latest.id,publishConsent===true]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return readSubmission(id,owner);
}

export async function recordOutputs(id:string,owner:string,digest:string,outputs:FormalOutputs){
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT id FROM formal_lab_submissions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner]);
    const {rows:[latest]}=await client.query('SELECT * FROM formal_lab_revisions WHERE submission_id=$1 ORDER BY revision DESC LIMIT 1',[id]);
    if(!latest||latest.digest!==digest||!latest.approved_at||latest.verification?.packageDigest!==digest||outputs.packageDigest!==digest)throw new FormalError('The approved revision changed; outputs were not attached to a different version.',409);
    await client.query('UPDATE formal_lab_revisions SET outputs=$1 WHERE id=$2',[JSON.stringify(outputs),latest.id]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return readSubmission(id,owner);
}
