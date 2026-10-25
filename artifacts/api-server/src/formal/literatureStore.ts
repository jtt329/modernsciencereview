import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import type { LiteratureAssessment } from './literatureContract';
import { FormalError } from './package';
let ready:Promise<unknown>|undefined;
export async function ensureLiteratureSchema(){
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_literature_assessments(id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES formal_lab_revisions(id),submission_id uuid NOT NULL REFERENCES formal_lab_submissions(id),owner_id text NOT NULL,package_digest text NOT NULL,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS formal_lab_literature_revision_idx ON formal_lab_literature_assessments(revision_id,created_at);`).catch(error=>{ready=undefined;throw error;});await ready;
}
export async function readLiteratureAssessment(submissionId:string,owner:string,revisionId:string):Promise<LiteratureAssessment|null>{
  await ensureLiteratureSchema();const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_literature_assessments a JOIN formal_lab_submissions s ON s.id=a.submission_id JOIN formal_lab_revisions r ON r.id=a.revision_id WHERE a.submission_id=$1 AND s.owner_id=$2 AND a.owner_id=$2 AND a.revision_id=$3 AND a.package_digest=r.digest ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submissionId,owner,revisionId]);return row?.report||null;
}
export async function recordLiteratureAssessment(submissionId:string,owner:string,revisionId:string,report:LiteratureAssessment):Promise<LiteratureAssessment>{
  if(report?.version!=='literature-assessment-v1'||report.noveltyEstablished!==false||report.status!=='bounded-literature-assessment'||!Array.isArray(report.searches)||!Array.isArray(report.papers)||!Array.isArray(report.sections)||!Array.isArray(report.comparisons)||JSON.stringify(report).length>500000)throw new FormalError('Invalid literature assessment or unsupported novelty verdict.');
  await ensureLiteratureSchema();const client=await pool.connect();
  try{await client.query('BEGIN');const {rows:[revision]}=await client.query(`SELECT r.digest,r.approved_at,r.package FROM formal_lab_submissions s JOIN formal_lab_revisions r ON r.submission_id=s.id WHERE s.id=$1 AND s.owner_id=$2 AND r.id=$3 FOR UPDATE OF r`,[submissionId,owner,revisionId]);
    if(!revision||!revision.approved_at||revision.digest!==report.packageDigest||revision.package.analysis?.sourceId!==report.sourceId||revision.package.source.sha256!==report.sourceSha256)throw new FormalError('Literature evidence must match an author-approved source and exact revision.',409);
    await client.query('INSERT INTO formal_lab_literature_assessments(id,revision_id,submission_id,owner_id,package_digest,report) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),revisionId,submissionId,owner,report.packageDigest,JSON.stringify(report)]);await client.query('COMMIT');return report;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Public access is limited to an explicitly published immutable snapshot. */
export async function readPublishedLiteratureAssessment(submission:import('./contract').FormalSubmission):Promise<LiteratureAssessment|null>{
  const r=submission.currentRevision;if(!r.approvedAt||r.publishConsent!==true)return null;
  await ensureLiteratureSchema();
  const {rows:[row]}=await pool.query(`SELECT a.report FROM formal_lab_literature_assessments a JOIN formal_lab_publications_v2 p ON p.revision_id=a.revision_id AND p.submission_id=a.submission_id AND p.digest=a.package_digest WHERE a.submission_id=$1 AND a.revision_id=$2 AND a.package_digest=$3 AND p.source_id=$4 AND a.report->>'sourceSha256'=$5 ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[submission.id,r.id,r.digest,r.package.analysis?.sourceId,r.package.source.sha256]);return row?.report||null;
}
