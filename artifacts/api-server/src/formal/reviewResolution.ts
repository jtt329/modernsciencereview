import {createHash} from 'node:crypto';
import type {FormalSubmission} from './contract';
import type {ScientificAssessment} from './assessmentContract';
import type {CanonicalAssessment} from './canonicalContract';
import type {LiteratureAssessment} from './literatureContract';
import type {ReviewTarget} from './reviewContract';
import type {AcceptedReviewResolution,ReviewAssessmentCorrection,ReviewResolutionDraft,ReviewResolutionOverlay,ReviewResolutionProposal,ReviewResolutionRecord} from './reviewResolutionContract';
import {canonicalJson,FormalError} from './package';
import {validateReviewTarget} from './reviewProposal';
export interface ReviewResolutionContext {submission:FormalSubmission;canonicalAssessment?:CanonicalAssessment;literatureAssessment?:LiteratureAssessment;overlay:ReviewResolutionOverlay;scientificAssessment?:ScientificAssessment;}
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
function object(value:any,fields:string[],label:string):void{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new FormalError(`${label} contains unsupported fields.`);}
function text(value:any,label:string,max=4000):void{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\u0000'))throw new FormalError(`${label} must be nonempty bounded text.`);}
function ids(value:any,known:Set<string>,label:string,max=120):void{if(!Array.isArray(value)||value.length>max||value.some(id=>typeof id!=='string'||!known.has(id))||new Set(value).size!==value.length)throw new FormalError(`${label} must reference unique existing evidence.`);}
const reviewKeys=['summary','explanatoryContribution','correctness','physicalJustification','priorWork','strengths','openQuestions','recommendation'];
export function buildReviewResolutionOverlay(submission:FormalSubmission,records:ReviewResolutionRecord[]):ReviewResolutionOverlay{
 const r=submission.currentRevision;
 const accepted=records.filter(record=>record.status==='accepted'&&record.acceptedAt&&record.revisionId===r.id&&record.packageDigest===r.digest).map(record=>{
  const {target,disposition,summary,reason,evidence,correction}=record.proposal;
  return {id:record.id,target,disposition,summary,reason,evidence,correction,acceptedAt:record.acceptedAt!,model:record.model,verificationUnchanged:true as const};
 });
 return {version:'review-resolution-overlay-v1',submissionId:submission.id,revisionId:r.id,packageDigest:r.digest,assessmentDigest:hash({revisionId:r.id,packageDigest:r.digest,accepted}),accepted,
  reviewCorrections:accepted.filter(record=>record.correction?.kind==='review-section').map(record=>({resolutionId:record.id,sectionId:record.correction!.id,before:record.correction!.before,after:record.correction!.after})),
  assessmentCorrections:accepted.filter(record=>record.correction?.kind==='assessment-section'||record.correction?.kind==='assessment-issue').map(record=>({resolutionId:record.id,kind:record.correction!.kind as 'assessment-section'|'assessment-issue',sectionId:record.correction!.id,before:record.correction!.before as string,after:record.correction!.after as string})),
  explanationCorrections:accepted.filter(record=>record.correction?.kind==='explanation-section').map(record=>({resolutionId:record.id,sectionId:record.correction!.id,before:record.correction!.before as string,after:record.correction!.after as string}))};
}
function effectiveCorrectionValue(context:ReviewResolutionContext,kind:'review-section'|'explanation-section'|'assessment-section'|'assessment-issue',id:string):unknown{
 const outputs=context.submission.currentRevision.outputs;
 if(!outputs&&kind!=='assessment-section'&&kind!=='assessment-issue')throw new FormalError('There is no saved assessment to correct.');
 let value:unknown=kind==='review-section'?(outputs!.review as unknown as Record<string,unknown>)[id]:kind==='explanation-section'?outputs!.explanation.find(section=>section.id===id)?.text:kind==='assessment-section'?context.scientificAssessment?.sections.find(section=>section.id===id)?.text:context.scientificAssessment?.issues.find(issue=>issue.id===id)?.assessment;
 for(const accepted of context.overlay.accepted){const correction=accepted.correction;if(correction?.kind===kind&&correction.id===id)value=correction.after;}
 return value;
}
export function reviewResolutionTargetValue(context:ReviewResolutionContext,target:ReviewTarget):unknown{
 const {package:pkg,verification,outputs}=context.submission.currentRevision;const source=context.submission.sourceDocument;
 if(!source)throw new FormalError('A resolution needs the exact numbered source.');
 validateReviewTarget(pkg,source,target,{outputs:outputs||undefined,canonicalAssessment:context.canonicalAssessment,literatureAssessment:context.literatureAssessment,scientificAssessment:context.scientificAssessment});
 switch(target.kind){
  case 'main-claim':return pkg.mainClaim;
  case 'input':return pkg.selectedInputs.find(input=>input.id===target.id);
  case 'assumption':return pkg.assumptions[Number(target.id.slice('assumption-'.length))];
  case 'definition':return pkg.definitions.find(def=>def.symbol===target.id||`definition-${def.symbol}`===target.id);
  case 'claim':return {candidate:pkg.claims.find(claim=>claim.id===target.id),check:verification?.claims.find(claim=>claim.id===target.id)||null};
  case 'warning':return pkg.analysis!.extractionWarnings[Number(target.id.slice('warning-'.length))];
  case 'coverage':return {assertion:pkg.analysis!.coverage.find(item=>item.id===target.id),result:outputs?.coverage.find(item=>item.id===target.id)||null};
  case 'source-line':return source.lines.find(line=>line.id===target.id);
  case 'review-section':return effectiveCorrectionValue(context,'review-section',target.id);
  case 'explanation-section':return effectiveCorrectionValue(context,'explanation-section',target.id);
  case 'field-contribution':return outputs!.contributions.find(item=>item.id===target.id);
  case 'canonical-finding':return context.canonicalAssessment!.findings.find(item=>item.id===target.id);
  case 'literature-section':return context.literatureAssessment!.sections.find(item=>item.id===target.id);
  case 'assessment-issue':return {evidenceFingerprint:context.scientificAssessment!.evidenceFingerprint,issue:context.scientificAssessment!.issues.find(item=>item.id===target.id),effectiveAssessment:effectiveCorrectionValue(context,'assessment-issue',target.id)};
  case 'assessment-section':return {evidenceFingerprint:context.scientificAssessment!.evidenceFingerprint,section:context.scientificAssessment!.sections.find(item=>item.id===target.id),effectiveText:effectiveCorrectionValue(context,'assessment-section',target.id)};
 }
}
function validateCorrection(context:ReviewResolutionContext,value:unknown):ReviewAssessmentCorrection|null{
 if(value===null)return null;
 object(value,['kind','id','before','after'],'Assessment correction');const c=value as ReviewAssessmentCorrection;
 if(!['review-section','explanation-section','assessment-section','assessment-issue'].includes(c.kind))throw new FormalError('Only assessment prose can be corrected without a manuscript revision.');
 text(c.id,'Assessment section ID',120);
 if(c.kind==='review-section'&&!reviewKeys.includes(c.id))throw new FormalError('Unknown review section.');
 const actual=effectiveCorrectionValue(context,c.kind,c.id);
 if(actual===undefined)throw new FormalError('The assessment section does not exist.');
 const arrays=c.kind==='review-section'&&['strengths','openQuestions'].includes(c.id);
 if(arrays){if(!Array.isArray(c.after)||!Array.isArray(actual)||c.after.length!==actual.length||c.after.length>40)throw new FormalError('Review-only corrections retain the existing list entries; use precise replacements instead of suppressing a list.');for(const item of c.after)text(item,'Corrected review item',3000);}
 else text(c.after,'Corrected assessment',12000);
 if(canonicalJson(c.before)!==canonicalJson(actual))throw new FormalError('The proposed assessment correction no longer matches the current accepted view.',409);
 if(canonicalJson(c.before)===canonicalJson(c.after))throw new FormalError('An assessment correction must change its text.');
 return structuredClone(c);
}
export function validateReviewResolutionDraft(context:ReviewResolutionContext,value:unknown):ReviewResolutionProposal{
 object(value,['target','disposition','summary','reason','evidence','correction'],'Review resolution');const draft=value as ReviewResolutionDraft;
 const targetValue=reviewResolutionTargetValue(context,draft.target);
 if(!['reviewer-error','clarified-by-source','outside-checker-scope','manuscript-change-needed'].includes(draft.disposition))throw new FormalError('Choose a supported assessment disposition.');
 text(draft.summary,'Resolution summary',2000);text(draft.reason,'Evidence-grounded resolution reason',6000);
 object(draft.evidence,['sourceLineIds','claimIds','canonicalFindingIds','literatureSectionIds'],'Resolution evidence');
 const {submission,canonicalAssessment,literatureAssessment}=context;
 ids(draft.evidence.sourceLineIds,new Set(submission.sourceDocument!.lines.map(line=>line.id)),'Source evidence',900);
 ids(draft.evidence.claimIds,new Set(submission.currentRevision.verification?.claims.map(claim=>claim.id)||[]),'Checker evidence');
 ids(draft.evidence.canonicalFindingIds,new Set(canonicalAssessment?.findings.map(finding=>finding.id)||[]),'Canonical evidence');
 ids(draft.evidence.literatureSectionIds,new Set(literatureAssessment?.sections.map(section=>section.id)||[]),'Literature evidence');
 if(!Object.values(draft.evidence).some(values=>values.length))throw new FormalError('A resolution needs specific existing evidence, not only an assertion.');
 // An acknowledged concern never changes the exact mathematical result. A
 // contradicted or unresolved candidate needs a formulation change to be fixed.
 if(draft.target.kind==='claim'){
  const check=submission.currentRevision.verification?.claims.find(claim=>claim.id===draft.target.id);
  if(check?.status==='contradicted'&&['reviewer-error','clarified-by-source'].includes(draft.disposition))throw new FormalError('A contradicted check cannot be resolved by an assessment comment. Propose a formulation revision.');
 }
 if(draft.target.kind==='assessment-issue'){
  const issue=context.scientificAssessment!.issues.find(item=>item.id===draft.target.id)!;
  if(issue.claimIds.some(id=>submission.currentRevision.verification?.claims.some(check=>check.id===id&&check.status==='contradicted'))&&draft.disposition!=='manuscript-change-needed')throw new FormalError('A material issue linked to a contradicted check needs a formulation correction, not a chat resolution.');
 }
 const correction=validateCorrection(context,draft.correction);
 if(correction&&(correction.kind!==draft.target.kind||correction.id!==draft.target.id))throw new FormalError('An assessment correction must address the exact item being discussed.');
 if(draft.disposition==='reviewer-error'&&['review-section','explanation-section','assessment-section','assessment-issue'].includes(draft.target.kind)&&(!correction||correction.kind!==draft.target.kind||correction.id!==draft.target.id))throw new FormalError('A reviewer error in assessment prose needs its exact before-and-after correction.');
 if(draft.disposition==='manuscript-change-needed'&&correction)throw new FormalError('A needed manuscript change cannot be recorded as an already-corrected assessment.');
 const targetFingerprint=hash({target:draft.target,value:targetValue});
 const normalized={...structuredClone(draft),correction};
 const assessmentEvidenceFingerprint=context.scientificAssessment?.evidenceFingerprint||null;
 return {...normalized,targetFingerprint,baseAssessmentDigest:context.overlay.assessmentDigest,assessmentEvidenceFingerprint,beforeFingerprint:hash({revisionId:submission.currentRevision.id,packageDigest:submission.currentRevision.digest,targetFingerprint,baseAssessmentDigest:context.overlay.assessmentDigest,assessmentEvidenceFingerprint,correction})};
}
export function validateStoredReviewResolution(context:ReviewResolutionContext,proposal:ReviewResolutionProposal):void{
 const {target,disposition,summary,reason,evidence,correction}=proposal;
 const actual=validateReviewResolutionDraft(context,{target,disposition,summary,reason,evidence,correction});
 if(actual.beforeFingerprint!==proposal.beforeFingerprint||actual.targetFingerprint!==proposal.targetFingerprint||actual.baseAssessmentDigest!==proposal.baseAssessmentDigest||actual.assessmentEvidenceFingerprint!==proposal.assessmentEvidenceFingerprint)throw new FormalError('The accepted assessment changed. Ask the model to refresh this resolution before accepting it.',409);
}
