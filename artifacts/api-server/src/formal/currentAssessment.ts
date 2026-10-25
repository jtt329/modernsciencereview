import type {FormalSubmission} from './contract';
import type {ScientificAssessmentEvidence} from './assessmentContract';
import type {PublishedFormalPaper} from './publishedContract';
import {readCanonicalAssessment,readPublishedCanonicalAssessment} from './canonicalStore';
import {readLiteratureAssessment,readPublishedLiteratureAssessment} from './literatureStore';
import {readScientificAssessment,readPublishedScientificAssessment} from './assessmentStore';
import {readReviewResolutionOverlay,readPublishedReviewResolutionOverlay} from './reviewResolutionStore';
import {buildReviewResolutionOverlay} from './reviewResolution';
import {assessmentEvidenceFingerprint} from './assessment';

/** Reading a summary never starts inference, redoes a proof, or changes the original report. */
export async function currentScientificAssessment(submission:FormalSubmission,owner?:string){
  const r=submission.currentRevision;
  const [canonical,literature,assessment,resolutionOverlay]=await Promise.all([
    owner?readCanonicalAssessment(submission.id,owner,r.id):readPublishedCanonicalAssessment(submission),
    owner?readLiteratureAssessment(submission.id,owner,r.id):readPublishedLiteratureAssessment(submission),
    owner?readScientificAssessment(submission.id,owner,r.id):readPublishedScientificAssessment(submission),
    owner?readReviewResolutionOverlay(submission,owner):readPublishedReviewResolutionOverlay(submission),
  ]);
  const overlay=resolutionOverlay||buildReviewResolutionOverlay(submission,[]);
  const evidence:ScientificAssessmentEvidence|null=r.verification&&submission.sourceDocument?{
    verification:r.verification,outputs:r.outputs||undefined,canonical,literature,
    geometry:assessment?.geometryEvidence||null,primaryReferences:assessment?.primaryReferences||[],companion:assessment?.companionEvidence||[],actualSourceUncertainties:assessment?.actualSourceUncertainties||[],resolutionOverlay:overlay,
  }:null;
  const evidenceFingerprint=evidence?assessmentEvidenceFingerprint(r.package,submission.sourceDocument!,evidence):null;
  return {assessment,current:Boolean(assessment&&assessment.evidenceFingerprint===evidenceFingerprint),geometry:assessment?.geometryEvidence||null,resolutionOverlay:overlay,evidenceFingerprint,evidence};
}
export async function publishedAssessmentCard(submission:FormalSubmission):Promise<PublishedFormalPaper['assessment']|undefined>{
  const view=await currentScientificAssessment(submission);
  if(!view.current||!view.assessment)return undefined;
  const a=view.assessment;
  const label={'ready-for-public-reading':'Ready for public reading','author-clarification-needed':'Specific author clarification requested','mathematical-correction-needed':'Mathematical correction required'}[a.readiness.status];
  return {id:a.evidenceFingerprint,summary:a.metaSummary.text,readiness:a.readiness.status,label,verifiedAt:a.createdAt,model:a.model,exactSupplementChecks:a.rigor.canonical.total+a.rigor.geometry.total,exactSupplementChecksPassed:a.rigor.canonical.checked+a.rigor.geometry.checked};
}
