/** A hierarchy edge is navigation, not an independently evidenced scientific claim. */
export interface SubjectNodeRef {slug:string;title:string;}
export interface SubjectStats {sources:number;supportedContributions:number;provisionalContributions:number;legacyContributions:number;}
export interface SubjectAdmission {
 version:'subject-admission-v1';status:'supported-contribution'|'provisional-contribution'|'legacy-conditional'|'withheld';
 reason:string;assessmentFingerprint?:string;noveltyFindingIds:string[];
 priority:'earliest-located'|'earlier-precedent-found'|'undetermined';
 chronology?:{kind:'platform-publication'|'verified-external-source';date:string;evidenceUrl:string;sourceSha256:string;paperId?:string};
 /** Even an earliest-located finding is bounded; it never certifies global firstness. */
 historicalPriorityCertified:false;
}
export interface SubjectParentDecision {
 version:'subject-parent-decision-v1';action:'reuse'|'create'|'root';parentSlug:string|null;
 parentTitle:string;parentScope:string;reason:string;model:string;childVersion:number;childBreadthFingerprint?:string;selectedAt:string;
}
export interface SubjectIntegrationResult {
 subjectSlugs:string[];changed:boolean;revisionId:string;packageDigest:string;
 assessmentFingerprint:string|null;sourceBound:boolean;
 admissions:{supported:number;provisional:number;withheld:number;legacy:number};
 parentCreated?:string;pendingNarrativeSlugs?:string[];notes:string[];
}
