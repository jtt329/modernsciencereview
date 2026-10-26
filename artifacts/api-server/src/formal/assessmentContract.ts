import type { CanonicalDerivationReport } from './derivationContract';
import type { ClaimVerificationPlan, ClaimSourceJudgment } from './obligationContract';
import type { FormalOutputs, VerificationReport } from './contract';
import type { CanonicalAssessment, CanonicalExactCheck, CanonicalReference } from './canonicalContract';
import type { LiteratureAssessment, LiteratureNoveltyFinding, LiteraturePassage, LiteraturePaper } from './literatureContract';
import type { ReviewResolutionOverlay } from './reviewResolutionContract';

export interface GeometryAssessment {
  version:'fixed-geometry-v1';packageDigest:string;sourceId:string;sourceSha256:string;checkedAt:string;engine:string;
  geometry:'uniformly-accelerated-rindler';status:'checked'|'partial'|'not-applicable';
  sourceLineIds:string[];checks:CanonicalExactCheck[];conclusion:string;limitations:string[];
}
export interface AssessmentResolution {
  id:string;target:{kind:string;id:string};statement:string;rationale:string;acceptedAt:string;
  effect:'clarification'|'review-correction';evidenceNote:string;
}
export interface AssessmentCompanionEvidence {title:string;sha256:string;sourceUrl?:string;purpose:'context-only';excerpts:{id:string;locator:string;text:string}[];}
export interface ScientificAssessmentEvidence {
  verification:VerificationReport;
  outputs?:FormalOutputs;
  canonical?:CanonicalAssessment|null;
  literature?:LiteratureAssessment|null;
  geometry?:GeometryAssessment|null;
  resolutionOverlay?:ReviewResolutionOverlay;
  actualSourceUncertainties?:{id:string;sourceLineIds:string[];detail:string}[];
  companion?:AssessmentCompanionEvidence[];
  primaryReferences?:CanonicalReference[];
  restrictedCanonicalDerivation?:CanonicalDerivationReport|null;
  claimVerificationPlan?:ClaimVerificationPlan|null;
}
export interface AssessmentRigor {
  core:{total:number;checked:number;identities:number;definitionRestatements:number;contradicted:number;inconclusive:number;unsupported:number};
  canonical:{total:number;checked:number;matrixChecks:number;tensorChecks:number;staticVariationalChecks:number;scalarChecks:number};
  geometry:{total:number;checked:number;componentIdentities:number;status:'checked'|'partial'|'not-applicable'|'not-run'};
  source:{lines:number;coverageUnits:number;adoptedInputs:number;actualUncertainties:number};
  literature:{records:number;selectedFullText:number;abstract:number;metadata:number;successfulSearches:number;unavailableSearches:number};
  notes:{raw:number;unique:number;materialConcerns:number;clarifications:number;acceptedStandards:number;historical:number;checkerLimits:number;sourceUncertainties:number};
  interpretation:string;
}
export interface AssessmentIssue {
  id:string;title:string;category:'scientific-concern'|'accepted-standard'|'checker-limit'|'historical-note'|'source-uncertainty';
  materiality:'material'|'clarification'|'information';status:'open'|'accepted'|'resolved';
  assessment:string;action:string;
  sourceLineIds:string[];claimIds:string[];canonicalFindingIds:string[];literaturePaperIds:string[];geometryCheckIds:string[];
  legacyNoteIds:string[];resolutionIds:string[];
}
export interface EmpiricalAssessment {
  status:'none-claimed'|'predictions-only'|'empirical-claims'|'unclear';summary:string;sourceLineIds:string[];
  claims:{id:string;statement:string;type:'prediction'|'observation'|'experiment';sourceLineIds:string[]}[];
  evidenceNeeded:string[];authorDeclaration:'unspecified'|'none'|'present';declarationStatus:'not-provided'|'consistent'|'needs-review';
}
export interface ReviewAdditions {
 summary:string;manuscriptChanged:false;
 items:{id:string;title:string;kind:'calculation'|'derivation'|'literature-comparison'|'clarification'|'proposed-manuscript-edit';description:string;manuscriptBasis:'stated'|'cited'|'not-explicit'|'unclear';sourceLineIds:string[];checkRefs:{kind:'scalar-check'|'canonical-check'|'geometry-check'|'derivation-check';id:string}[];paperIds:string[];status:'checked-under-premises'|'source-assessed'|'interpretive'|'proposal'}[];
}
export interface AssessmentMethod {
  derivationOrigin:'developer-provided-trusted-kernel'|'not-applied';kernelImplementation:string|null;
  manuscriptChanged:false;sourceScope:string;aiRole:string;method:string;
}
export interface ScientificAssessment {
  version:'scientific-assessment-v1';packageDigest:string;sourceId:string;sourceSha256:string;evidenceFingerprint:string;
  createdAt:string;assessmentTimestampUTC:string;model:string;
  status:'scientifically-assessed';
  empiricalAssessment?:EmpiricalAssessment;
  reviewAdditions?:ReviewAdditions;
  noveltyEvidence?:{findings:LiteratureNoveltyFinding[];passages:LiteraturePassage[];papers:LiteraturePaper[];scope:string;unavailableRequests:number};
  assessmentMethod?:AssessmentMethod;
  overall:{verdict:'supported-in-stated-domain'|'coherent-with-specific-open-questions'|'material-revision-needed'|'contradicted'|'insufficient-evidence';headline:string;judgment:string;decisiveReasons:string[]};
  metaSummary:{title:string;text:string;established:string[];proposedContribution:string;openQuestions:string[]};
  tabSummaries:{tab:'verification'|'explanation'|'review'|'source';title:string;text:string;keyPoints:string[]}[];
  rigor:AssessmentRigor;
  geometryEvidence:GeometryAssessment|null;
  restrictedCanonicalDerivation?:CanonicalDerivationReport|null;
  claimVerificationPlan?:ClaimVerificationPlan|null;
  claimSourceJudgments?:ClaimSourceJudgment[];
  primaryReferences:CanonicalReference[];
  companionEvidence:AssessmentCompanionEvidence[];
  actualSourceUncertainties:{id:string;sourceLineIds:string[];detail:string}[];
  acceptedStandards:{id:string;statement:string;scope:string;basis:'declared-established-input'|'accepted-translation'|'checked-consequence'|'accepted-clarification';sourceLineIds:string[];claimIds:string[];paperIds:string[]}[];
  issues:AssessmentIssue[];
  novelty:{claimed:string;assessment:'supported-distinction'|'plausible-distinction'|'already-known'|'not-established'|'contradicted';judgment:string;insight:string;predictions:string;fieldContribution:string;established:string[];conditional:string[];speculative:string[];paperIds:string[]};
  readiness:{status:'ready-for-public-reading'|'author-clarification-needed'|'mathematical-correction-needed';reason:string;nextActions:string[];publicationConsentUnchanged:true};
  sections:{id:string;title:string;text:string;sourceLineIds:string[];claimIds:string[];paperIds:string[]}[];
  resolvedIssueIds:string[];
  limitations:string[];
}
