import {randomUUID} from 'node:crypto';
import {pool} from '@workspace/db';
import type {ScientificAssessment} from './assessmentContract';
import type {FormalSubmission} from './contract';
import {FormalError} from './package';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
let ready:Promise<unknown>|undefined;
export async function ensureScientificAssessmentSchema():Promise<void>{
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_scientific_assessments(id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES formal_lab_revisions(id),submission_id uuid NOT NULL REFERENCES formal_lab_submissions(id),owner_id text NOT NULL,package_digest text NOT NULL,evidence_fingerprint text NOT NULL,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS formal_lab_scientific_revision_idx ON formal_lab_scientific_assessments(revision_id,evidence_fingerprint,created_at);`).catch(error=>{ready=undefined;throw error;});await ready;
}
function identity(submissionId:string,revisionId:string,owner?:string){if(!UUID.test(submissionId)||!UUID.test(revisionId)||owner!==undefined&&(!owner||owner.length>500))throw new FormalError('Scientific assessment not found.',404);}
/** Omit expectedFingerprint only when reading an explicitly historical assessment. */
export async function readScientificAssessment(submissionId:string,owner:string,revisionId:string,expectedFingerprint?:string):Promise<ScientificAssessment|null>{
  identity(submissionId,revisionId,owner);if(expectedFingerprint!==undefined&&!DIGEST.test(expectedFingerprint))throw new FormalError('Invalid assessment evidence fingerprint.');await ensureScientificAssessmentSchema();
  const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_scientific_assessments a JOIN formal_lab_submissions s ON s.id=a.submission_id JOIN formal_lab_revisions r ON r.id=a.revision_id AND r.submission_id=a.submission_id WHERE a.submission_id=$1 AND s.owner_id=$2 AND a.owner_id=$2 AND a.revision_id=$3 AND a.package_digest=r.digest AND ($4::text IS NULL OR a.evidence_fingerprint=$4) ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submissionId,owner,revisionId,expectedFingerprint||null]);return row?.report||null;
}
export async function recordScientificAssessment(submissionId:string,owner:string,revisionId:string,report:ScientificAssessment):Promise<ScientificAssessment>{
  identity(submissionId,revisionId,owner);
  if(report?.version!=='scientific-assessment-v1'||report.status!=='scientifically-assessed'||!DIGEST.test(report.packageDigest)||!DIGEST.test(report.evidenceFingerprint)||!Array.isArray(report.issues)||!Array.isArray(report.tabSummaries)||report.readiness?.publicationConsentUnchanged!==true||!Array.isArray(report.primaryReferences)||JSON.stringify(report).length>650000)throw new FormalError('Invalid or oversized scientific assessment.');
  if(report.geometryEvidence&&(report.geometryEvidence.packageDigest!==report.packageDigest||report.geometryEvidence.sourceId!==report.sourceId||report.geometryEvidence.sourceSha256!==report.sourceSha256))throw new FormalError('Geometry evidence does not match the assessed revision.',409);
  await ensureScientificAssessmentSchema();const client=await pool.connect();
  try{await client.query('BEGIN');const {rows:[revision]}=await client.query(`SELECT r.digest,r.approved_at,r.package FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 AND r.id=$3 FOR UPDATE OF r`,[submissionId,owner,revisionId]);
    if(!revision||!revision.approved_at||revision.digest!==report.packageDigest||revision.package.analysis?.sourceId!==report.sourceId||revision.package.source.sha256!==report.sourceSha256)throw new FormalError('Scientific assessment must match an author-approved source and exact revision.',409);
    await client.query('INSERT INTO formal_lab_scientific_assessments(id,revision_id,submission_id,owner_id,package_digest,evidence_fingerprint,report) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),revisionId,submissionId,owner,report.packageDigest,report.evidenceFingerprint,JSON.stringify(report)]);await client.query('COMMIT');return report;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function readPublishedScientificAssessment(submission:FormalSubmission,expectedFingerprint?:string):Promise<ScientificAssessment|null>{
  const r=submission.currentRevision;if(!r.approvedAt||r.publishConsent!==true)return null;identity(submission.id,r.id);
  if(expectedFingerprint!==undefined&&!DIGEST.test(expectedFingerprint))throw new FormalError('Invalid assessment evidence fingerprint.');
  await ensureScientificAssessmentSchema();const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_scientific_assessments a JOIN formal_lab_publications_v2 p ON p.revision_id=a.revision_id AND p.submission_id=a.submission_id AND p.digest=a.package_digest WHERE a.submission_id=$1 AND a.revision_id=$2 AND a.package_digest=$3 AND p.source_id=$4 AND a.report->>'sourceSha256'=$5 AND ($6::text IS NULL OR a.evidence_fingerprint=$6) ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submission.id,r.id,r.digest,r.package.analysis?.sourceId,r.package.source.sha256,expectedFingerprint||null]);return row?.report||null;
}
