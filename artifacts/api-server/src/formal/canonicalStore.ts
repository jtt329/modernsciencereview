import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import type { CanonicalAssessment } from './canonicalContract';
import { FormalError } from './package';
let ready:Promise<unknown>|undefined;
export async function ensureCanonicalSchema(){
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_canonical_assessments(id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES formal_lab_revisions(id),submission_id uuid NOT NULL REFERENCES formal_lab_submissions(id),owner_id text NOT NULL,package_digest text NOT NULL,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS formal_lab_canonical_revision_idx ON formal_lab_canonical_assessments(revision_id,created_at);`).catch(error=>{ready=undefined;throw error;});await ready;
}
/** Historical assessments remain associated with their exact approved snapshot. */
export async function readCanonicalAssessment(submissionId:string,owner:string,revisionId:string):Promise<CanonicalAssessment|null>{
  await ensureCanonicalSchema();
  const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_canonical_assessments a JOIN formal_lab_submissions s ON s.id=a.submission_id JOIN formal_lab_revisions r ON r.id=a.revision_id WHERE a.submission_id=$1 AND s.owner_id=$2 AND a.owner_id=$2 AND a.revision_id=$3 AND a.package_digest=r.digest ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submissionId,owner,revisionId]);return row?.report||null;
}
export async function recordCanonicalAssessment(submissionId:string,owner:string,revisionId:string,report:CanonicalAssessment):Promise<CanonicalAssessment>{
  if(report?.version!=='canonical-assessment-v1'||report.fullDerivationVerified!==false||report.status!=='assessed-with-open-obligations'||!Array.isArray(report.checks)||!Array.isArray(report.findings)||!Array.isArray(report.references))throw new FormalError('Invalid canonical assessment; no full derivation verdict may be inferred from prerequisite checks.');
  if(JSON.stringify(report).length>500000)throw new FormalError('The canonical evidence exceeds the supported size.');
  await ensureCanonicalSchema();const client=await pool.connect();
  try{await client.query('BEGIN');
    const {rows:[revision]}=await client.query(`SELECT r.digest,r.approved_at,r.package FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 AND r.id=$3 FOR UPDATE OF r`,[submissionId,owner,revisionId]);
    if(!revision||!revision.approved_at||revision.digest!==report.packageDigest||revision.package.analysis?.sourceId!==report.sourceId||revision.package.source.sha256!==report.sourceSha256)throw new FormalError('Canonical evidence must match an author-approved source and exact revision.',409);
    await client.query('INSERT INTO formal_lab_canonical_assessments(id,revision_id,submission_id,owner_id,package_digest,report) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),revisionId,submissionId,owner,report.packageDigest,JSON.stringify(report)]);
    await client.query('COMMIT');return report;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Public access is limited to an explicitly published immutable snapshot. */
export async function readPublishedCanonicalAssessment(submission:import('./contract').FormalSubmission):Promise<CanonicalAssessment|null>{
  const r=submission.currentRevision;if(!r.approvedAt||r.publishConsent!==true)return null;
  await ensureCanonicalSchema();
  const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_canonical_assessments a JOIN formal_lab_publications_v2 p ON p.revision_id=a.revision_id AND p.submission_id=a.submission_id AND p.digest=a.package_digest WHERE a.submission_id=$1 AND a.revision_id=$2 AND a.package_digest=$3 AND p.source_id=$4 AND a.report->>'sourceSha256'=$5 ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submission.id,r.id,r.digest,r.package.analysis?.sourceId,r.package.source.sha256]);return row?.report||null;
}
