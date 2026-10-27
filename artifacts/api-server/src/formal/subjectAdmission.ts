import type {FormalSubject,FormalSubmission,IngestedSource} from './contract';
import type {ScientificAssessment} from './assessmentContract';
import type {LiteratureAssessment} from './literatureContract';
import type {SubjectAdmission,SubjectStats} from './subjectContract';

export interface SubjectAdmissionContext {
 assessment:ScientificAssessment|null;assessmentCurrent:boolean;literature:LiteratureAssessment|null;
 chronology?:NonNullable<SubjectAdmission['chronology']>;
}
const overlap=(a:string[],b:string[])=>a.some(id=>b.includes(id));
const epoch=(date:string)=>{const n=Date.parse(date);return Number.isFinite(n)?n:null;};
/** Source-bound admission is separate from preserving an explanatory paragraph.
 * A bounded literature search can support a contribution, never global firstness. */
export function subjectSourceAdmission(ref:FormalSubject['paragraphs'][number]['sources'][number],submission:FormalSubmission,source:IngestedSource,context:SubjectAdmissionContext):SubjectAdmission{
 const revision=submission.currentRevision,report=revision.verification;
 const provisional=(reason:string,extra:Partial<SubjectAdmission>={}):SubjectAdmission=>({version:'subject-admission-v1',status:'provisional-contribution',reason,noveltyFindingIds:[],priority:'undetermined',historicalPriorityCertified:false,...extra});
 if(ref.revisionId!==revision.id||ref.submissionId!==submission.id||ref.digest!==revision.digest||ref.sourceId!==source.id||revision.package.analysis?.sourceId!==source.id||revision.package.source.sha256!==source.sha256||report?.packageDigest!==revision.digest||!revision.approvedAt||!revision.publishConsent)return {...provisional('The exact approved published source and checking record are not bound to this contribution.'),status:'withheld'};
 const lineIds=new Set(source.lines.map(line=>line.id)),known=new Map(report.claims.map(claim=>[claim.id,claim]));
 if(!ref.sourceLineIds.length||ref.sourceLineIds.some(id=>!lineIds.has(id))||!ref.claimIds.length||ref.claimIds.some(id=>{const check=known.get(id);return !check||check.status!=='checked'||check.dimensions!=='consistent';})||!ref.claimIds.some(id=>known.get(id)?.derivationKind!=='definition-restatement'))return {...provisional('No complete, source-bound non-tautological mathematical support is available for this paragraph.'),status:'withheld'};
 const assessment=context.assessment;
 if(!context.assessmentCurrent||!assessment||assessment.packageDigest!==revision.digest||assessment.sourceId!==source.id||assessment.sourceSha256!==source.sha256)return provisional('Conditional checked explanation retained; a current exact-source scientific assessment is still required.');
 const assessed={assessmentFingerprint:assessment.evidenceFingerprint};
 if(['contradicted','material-revision-needed','insufficient-evidence'].includes(assessment.overall.verdict)||assessment.issues.some(issue=>issue.status==='open'&&issue.materiality==='material'&&(overlap(issue.claimIds,ref.claimIds)||overlap(issue.sourceLineIds,ref.sourceLineIds))))return {...provisional('A current scientific concern prevents admission as a supported field result. The immutable paragraph remains available for audit.',assessed),status:'withheld'};
 const literature=context.literature;
 if(!literature||literature.packageDigest!==revision.digest||literature.sourceId!==source.id||literature.sourceSha256!==source.sha256)return provisional('Checked and scientifically assessed conditional explanation; claim-specific literature and chronology remain provisional.',assessed);
 const findings=(literature.noveltyFindings||[]).filter(finding=>ref.claimIds.every(id=>finding.claimIds.includes(id))&&overlap(finding.sourceLineIds,ref.sourceLineIds));
 const positive=findings.filter(finding=>['appears-novel','partly-novel'].includes(finding.verdict)&&['new-consequence','new-interpretation','reformulation'].includes(finding.contributionType)&&!finding.passageComparisons.some(comparison=>comparison.relationship==='same-result'));
 const chronology=context.chronology;
 const declaredYear=Number(revision.package.source.version.match(/\b(?:18|19|20)\d{2}\b/)?.[0]);
 const chronologyAllowed=chronology&&chronology.sourceSha256===source.sha256&&!(chronology.kind==='platform-publication'&&declaredYear&&declaredYear<new Date(chronology.date).getUTCFullYear()-1);
 const sourceDate=chronologyAllowed?epoch(chronology.date):null;
 const earlierPassages=(finding:typeof findings[number])=>finding.passageComparisons.filter(comparison=>{
  const paper=literature.papers.find(p=>p.id===comparison.paperId),date=paper?.publicationDate?epoch(paper.publicationDate):null;
  return !!paper&&paper.evidenceLevel==='selected-fulltext'&&date!==null&&date!==undefined&&sourceDate!==null&&date<sourceDate&&comparison.relationship!=='context'&&comparison.relationship!=='uncertain'&&comparison.passageIds.length>0&&comparison.passageIds.every(id=>literature.passages?.some(passage=>passage.id===id&&passage.paperId===paper.id));
 });
 const supported=positive.filter(finding=>finding.priority==='earliest-located'&&finding.confidence.level!=='low'&&earlierPassages(finding).length>0);
 if(!supported.length){const matched=positive.length?positive:findings;return provisional('The source-bound conditional explanation is displayed provisionally. Bounded novelty or originating-source chronology is unresolved; this is not a certified first discovery.',{...assessed,noveltyFindingIds:matched.map(finding=>finding.id),priority:matched.some(f=>f.priority==='earlier-precedent-found')?'earlier-precedent-found':'undetermined',...(chronology&&sourceDate!==null?{chronology}:{})});}
 return {version:'subject-admission-v1',status:'supported-contribution',reason:'Checked under stated premises and supported by current source review plus actual earlier-passage comparisons and dated source identity. Earliest located is a bounded attribution, not guaranteed historical priority.',...assessed,noveltyFindingIds:supported.map(finding=>finding.id),priority:'earliest-located',chronology:chronology!,historicalPriorityCertified:false};
}
/** A modern upload timestamp must never stand in for an old paper's publication
 * date when attributing an originating historical result. */
export function verifiedHistoricalChronology(source:IngestedSource,paper:{id:string;publicationDate?:string;url:string;arxivId?:string},retrievedSourceSha256:string):NonNullable<SubjectAdmission['chronology']>|null{
 if(paper.arxivId&&!/v1$/.test(paper.arxivId))return null;
 if(retrievedSourceSha256!==source.sha256||!paper.publicationDate||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paper.publicationDate)||epoch(paper.publicationDate)===null||!/^https:\/\//.test(paper.url))return null;
 return {kind:'verified-external-source',date:paper.publicationDate,evidenceUrl:paper.url,sourceSha256:source.sha256,paperId:paper.id};
}
export function aggregateSubjectAdmission(sources:FormalSubject['paragraphs'][number]['sources']):SubjectAdmission {
 sources=sources.filter(source=>source.placementStatus!=='historical');
 const admissions=sources.map(source=>source.admission).filter((value):value is SubjectAdmission=>!!value);
 const best=admissions.find(item=>item.status==='supported-contribution')||admissions.find(item=>item.status==='provisional-contribution')||admissions.find(item=>item.status==='legacy-conditional');
 if(best)return structuredClone(best);
 if(admissions.length===sources.length&&admissions.length)return {...admissions[0],status:'withheld'};
 return {version:'subject-admission-v1',status:'legacy-conditional',reason:'Historical conditional evidence retained without a current claim-specific origin/admission assessment.',noveltyFindingIds:[],priority:'undetermined',historicalPriorityCertified:false};
}
export function subjectStats(subject:Pick<FormalSubject,'paragraphs'>):SubjectStats{
 const paragraphs=subject.paragraphs.filter(p=>p.placementStatus!=='historical'&&p.admission?.status!=='withheld'),sources=new Set(paragraphs.flatMap(p=>p.sources.filter(s=>s.placementStatus!=='historical'&&s.admission?.status!=='withheld').map(s=>s.submissionId+':'+s.revisionId)));
 return {sources:sources.size,supportedContributions:paragraphs.filter(p=>p.admission?.status==='supported-contribution').length,provisionalContributions:paragraphs.filter(p=>p.admission?.status==='provisional-contribution').length,legacyContributions:paragraphs.filter(p=>!p.admission||p.admission.status==='legacy-conditional').length};
}
