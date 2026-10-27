import {pool} from '@workspace/db';
import type {FormalSubmission} from './contract';
import type {PublishedFormalPaper} from './publishedContract';
import {ensureFormalSubjectSchema} from './subjects';
import {deriveCoverageAssessment} from './coverageAssessment';

export function publishedPaperCard(snapshot:FormalSubmission,publishedAt:string,assessment?:PublishedFormalPaper['assessment']):PublishedFormalPaper|null {
  const revision=snapshot.currentRevision,pkg=revision.package,report=revision.verification;
  if(!revision.approvedAt||revision.publishConsent!==true||!report||report.packageDigest!==revision.digest||revision.outputs?.packageDigest!==revision.digest||!pkg.analysis||!snapshot.sourceDocument||pkg.analysis.sourceId!==snapshot.sourceDocument.id||pkg.source.sha256!==snapshot.sourceDocument.sha256)return null;
  const view=deriveCoverageAssessment(snapshot),coverage=view.coverageAssessment?.coverage||revision.outputs.coverage;
  const source=snapshot.sourceDocument;
  const summary=assessment?.summary||pkg.mainClaim;
  return {id:snapshot.id,revisionId:revision.id,revision:revision.revision,title:pkg.title,authors:pkg.authors,summary,mainClaim:pkg.mainClaim,
    source:{url:source.fileUrl,filename:source.filename,pageCount:source.pageCount,sha256:source.sha256,version:pkg.source.version},
    subject:{slug:pkg.analysis.subjectSlug,title:pkg.analysis.subjectTitle,url:`/formal-lab/subjects/${encodeURIComponent(pkg.analysis.subjectSlug)}`},
    publishedAt,updatedAt:assessment?.verifiedAt||revision.outputs.generatedAt,reviewUrl:snapshot.id==='1a74fdf4-4e69-4e94-945e-811f742b6c86'?'/boundary-mechanics':`/formal-lab?submission=${encodeURIComponent(snapshot.id)}&tab=review`,
    rigor:{equations:report.claims.length,checkedEquations:report.claims.filter(c=>c.status==='checked').length,identities:report.claims.filter(c=>c.derivationKind==='identity'&&c.status==='checked').length,definitionRestatements:report.claims.filter(c=>c.derivationKind==='definition-restatement'&&c.status==='checked').length,sourceStatements:coverage.length,checkedSourceStatements:coverage.filter(c=>c.status==='checked').length,declaredInputs:pkg.selectedInputs.length,openStatements:coverage.filter(c=>['contradicted','partial','unsupported','not-assessed'].includes(c.status)).length},
    ...(assessment?{assessment}:{}),concepts:[...new Set([pkg.analysis.subjectTitle,...pkg.consequences.map(c=>c.title)])].slice(0,6)};
}
/** Never join the current private draft or return author sessions, discussions, or uploads. */
export async function listPublishedFormalPapers(resolveAssessment?:(snapshot:FormalSubmission)=>Promise<PublishedFormalPaper['assessment']|undefined>):Promise<PublishedFormalPaper[]> {
  await ensureFormalSubjectSchema();
  const {rows}=await pool.query(`SELECT snapshot,created_at FROM (SELECT DISTINCT ON(submission_id) submission_id,snapshot,created_at FROM formal_lab_publications_v2 ORDER BY submission_id,created_at DESC,revision_id DESC) published ORDER BY created_at DESC LIMIT 100`);
  const cards:PublishedFormalPaper[]=[];
  for(const row of rows){
    const snapshot=row.snapshot as FormalSubmission;
    if(!publishedPaperCard(snapshot,new Date(row.created_at).toISOString()))continue;
    const assessment=resolveAssessment?await resolveAssessment(snapshot):undefined;
    const card=publishedPaperCard(snapshot,new Date(row.created_at).toISOString(),assessment);if(card)cards.push(card);
  }
  return cards;
}
