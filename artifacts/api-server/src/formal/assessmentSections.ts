import type { AssessmentIssue, AssessmentSection, ScientificAssessment } from './assessmentContract';

export interface AssessmentSectionPresentation {
  purpose:'scientific'|'processing-history'|'mixed';
  scientificTitle:string;scientificText:string;
  processingHistoryTitle:string;processingHistoryText:string;
  issueIds:string[];
  basis:'explicit'|'legacy-reconciliation'|'default-scientific';
}
type SectionContext=Pick<ScientificAssessment,'issues'|'actualSourceUncertainties'>&Partial<Pick<ScientificAssessment,'noveltyEvidence'|'primaryReferences'>>;
const intersects=(a:readonly string[],b:readonly string[])=>a.some(id=>b.includes(id));
const closedHistory=(issue:AssessmentIssue)=>issue.category==='historical-note'&&issue.status!=='open'&&issue.materiality==='information';
/** Pure validation used by fresh model responses and defensively by the reader.
 * Audit placement cannot remove an open scientific concern from the narrative. */
export function assessmentSectionPurposeProblem(section:AssessmentSection,issues:readonly AssessmentIssue[]):string|null {
  const ids=section.issueIds||[];
  if(new Set(ids).size!==ids.length||ids.some(id=>!issues.some(issue=>issue.id===id)))return 'Section issue links must identify actual assessment issues.';
  if(section.purpose!=='processing-history')return null;
  const linked=issues.filter(issue=>ids.includes(issue.id));
  if(!linked.length||linked.some(issue=>!closedHistory(issue)))return 'Processing-history sections must reference resolved historical processing notes, not scientific concerns or unchecked scope.';
  if(section.claimIds.some(id=>!linked.some(issue=>issue.claimIds.includes(id))))return 'Processing-history claim links must resolve to their historical issue records.';
  if(section.sourceLineIds.some(id=>!linked.some(issue=>issue.sourceLineIds.includes(id))))return 'Processing-history source links must resolve to their historical issue records.';
  if(issues.some(issue=>issue.status==='open'&&(issue.category==='scientific-concern'||issue.category==='source-uncertainty')&&(intersects(section.claimIds,issue.claimIds)||intersects(section.sourceLineIds,issue.sourceLineIds))))return 'A section linked to an open scientific concern or observed source uncertainty must stay scientific.';
  return null;
}
// Exact legacy wording is a compatibility allowlist, not a topic classifier.
// Any new sentence or changed wording remains in scientific content.
const legacyHistoryParagraphs=[
  "As of {assessment-time}, the supplied evidence supports the manuscript's restricted scientific chain without an identified sign, normalization, derivative-order, or pressure-convention mismatch. The six source-judgment targets are answered here using existing checks and source assessments; this does not rewrite the deterministic plan or create new checker results. The Schwarzschild decomposition target is interpretive rather than an additional theorem.",
  "The current reconciliation repairs the old missing link for \\(F_L=U/L\\). Its two remaining canonical entries exceed complete scalar representation, but the restricted derivation supplies additional conditional support. They should not be counted as two unresolved mathematical failures. Likewise, obsolete statements that references were unread, companions unavailable, or checks merely proposed no longer describe the current record.",
  "The supporting companion is separate from the one-page submission, and the referenced full manuscript has not been assumed. The accepted-correction overlay is empty. No actual manuscript source uncertainty is recorded. The literature record's identified abstract/title mismatch for 2201.12141 is a retrieval-quality caution about that external record; it is not evidence against this manuscript and is not used decisively here."
];
const scientific=(section:AssessmentSection):AssessmentSectionPresentation=>({purpose:'scientific',scientificTitle:section.title,scientificText:section.text,processingHistoryTitle:'Review processing history',processingHistoryText:'',issueIds:section.issueIds||[],basis:section.purpose==='scientific'?'explicit':'default-scientific'});
/** Browser-safe presentation only. Source text, report identity, original IDs and
 * discussion targets are never changed. Unknown legacy prose stays scientific. */
export function assessmentSectionPresentation(section:AssessmentSection,assessment:SectionContext):AssessmentSectionPresentation {
  const base=scientific(section);
  if(section.purpose==='scientific')return base;
  if(section.purpose==='processing-history')return assessmentSectionPurposeProblem(section,assessment.issues)?base:{...base,purpose:'processing-history',scientificText:'',processingHistoryText:section.text,issueIds:section.issueIds||[],basis:'explicit'};
  // A known literature paragraph contains one routine retry-history sentence.
  // Keep its contribution judgment, confidence and bounded-priority caveats intact.
  const retrievalHistory='The search audit includes focused queries and bounded citation neighborhoods, with earlier failed seed lookups subsequently resolved.';
  const paperIds=new Set([...(assessment.noveltyEvidence?.papers.map(paper=>paper.id)||[]),...(assessment.primaryReferences||[]).filter(reference=>reference.status==='retrieved').map(reference=>reference.id)]);
  if(section.id==='prior-work-and-contribution'&&section.title==='The supported advance is the length-work identification'&&section.paperIds.length>0&&section.paperIds.every(id=>paperIds.has(id))&&section.text.includes(retrievalHistory)&&section.text.indexOf(retrievalHistory)===section.text.lastIndexOf(retrievalHistory)){
    const scientificText=section.text.replace(retrievalHistory+' ','').replace(retrievalHistory,'');
    return {...base,purpose:'mixed',scientificText,processingHistoryTitle:'Literature retrieval history',processingHistoryText:retrievalHistory,issueIds:[],basis:'legacy-reconciliation'};
  }
  // One known legacy reconciliation section mixed three audit paragraphs with a
  // real domain paragraph. Require both its identity and the saved repair record;
  // matching general words such as "earlier concerns" is deliberately insufficient.
  if(section.id!=='current-evidence-and-boundaries'||section.title!=='Current evidence resolves the earlier narrow concerns'||assessment.actualSourceUncertainties?.length)return base;
  const repair=assessment.issues.find(issue=>issue.id==='issue-coverage-repair');
  if(!repair||!closedHistory(repair)||!section.claimIds.length||section.claimIds.some(id=>!repair.claimIds.includes(id))||!intersects(section.sourceLineIds,repair.sourceLineIds))return base;
  if(assessment.issues.some(issue=>issue.status==='open'&&(issue.materiality==='material'||issue.category==='source-uncertainty')&&(intersects(section.claimIds,issue.claimIds)||intersects(section.sourceLineIds,issue.sourceLineIds))))return base;
  const citationHistory=assessment.issues.find(issue=>issue.id==='issue-citations-and-companion-history'&&closedHistory(issue)&&intersects(section.sourceLineIds,issue.sourceLineIds));
  const paragraphs=section.text.split(/\n\s*\n/);
  const history:string[]=[],narrative:string[]=[];
  for(const paragraph of paragraphs){
    const p=paragraph.trim();
    const normalized=p.replace(/^As of \d{4}-\d\d-\d\dT[\d:.]+Z, /,'As of {assessment-time}, ');
    const legacyIndex=legacyHistoryParagraphs.indexOf(normalized);
    const historyOnly=legacyIndex===0||legacyIndex===1||legacyIndex===2&&!!citationHistory;
    // Any unfamiliar or newly added scientific wording is retained in the main
    // narrative. In particular, the explicit action/domain paragraph is untouched.
    (historyOnly?history:narrative).push(paragraph);
  }
  if(!history.length)return base;
  if(!narrative.length&&assessment.issues.some(issue=>issue.status==='open'&&(issue.category==='scientific-concern'||issue.category==='source-uncertainty')&&(intersects(section.claimIds,issue.claimIds)||intersects(section.sourceLineIds,issue.sourceLineIds))))return base;
  return {...base,purpose:narrative.length?'mixed':'processing-history',scientificTitle:narrative.length?'Scope and remaining limits':section.title,scientificText:narrative.join('\n\n'),processingHistoryText:history.join('\n\n'),issueIds:[repair.id,...(citationHistory?[citationHistory.id]:[])],basis:'legacy-reconciliation'};
}
export function processingHistorySectionIds(assessment:SectionContext&Pick<ScientificAssessment,'sections'>):string[]{
  return assessment.sections.filter(section=>assessmentSectionPresentation(section,assessment).processingHistoryText).map(section=>section.id);
}
