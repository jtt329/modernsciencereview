import type {SubjectNodeRef,SubjectStats,SubjectAdmission,SubjectParentDecision} from './subjectContract';
export type {SubjectNodeRef,SubjectStats,SubjectAdmission,SubjectParentDecision,SubjectIntegrationResult} from './subjectContract';
/** Formal Lab v1: a bounded declarative language, never executable submission code. */
export type Expr =
  | { op: 'symbol'; name: string }
  | { op: 'integer'; value: number }
  | { op: 'rational'; numerator: number; denominator: number }
  | { op: 'add' | 'mul'; args: Expr[] }
  | { op: 'div'; numerator: Expr; denominator: Expr }
  | { op: 'pow'; base: Expr; exponent: number }
  | { op: 'diff'; expr: Expr; variable: string }
  | { op: 'substitute'; expr: Expr; values: Record<string, Expr> };
export type Dimensions = [number, number, number] | [number, number, number, number, number, number, number]; // SI M,L,T or M,L,T,I,K,N,J
export interface FormalSymbol { name: string; label: string; domain: 'real' | 'positive' | 'nonzero'; dimensions: Dimensions; }
export interface FormalDefinition { symbol: string; expression: Expr; description: string; }
export interface FormalClaim { id: string; title: string; lhs: Expr; rhs: Expr; explanation: string; }
export interface FormalInput { id: string; version: string; title: string; statement: string; sourceUrl?: string; }
/** Optional author pointers, kept separate from manuscript evidence and approval. */
export type AuthorGuidanceField = 'mainClaims' | 'inputs' | 'construction' | 'outputs' | 'novelty' | 'predictions' | 'empiricalClaims' | 'scope' | 'priorWork';
export type AuthorEmpiricalStatus = 'unspecified' | 'none' | 'present';
export interface AuthorSubmissionGuidance {
  mainClaims?:string;inputs?:string;construction?:string;outputs?:string;novelty?:string;
  predictions?:string;empiricalClaims?:string;scope?:string;priorWork?:string;
  empiricalStatus?:AuthorEmpiricalStatus;
}
export interface AuthorSubmissionBriefSection {
  id:AuthorGuidanceField;title:string;text:string;
  basis:'source-linked-draft'|'package-proposal'|'author-guidance'|'not-stated';
  sourceLineIds:string[];inputIds:string[];claimIds:string[];note:string;authorText?:string;
}
export interface AuthorSubmissionBrief {
  version:'author-submission-brief-v1';sections:AuthorSubmissionBriefSection[];
  empirical:{status:AuthorEmpiricalStatus;sourceStatus:AuthorEmpiricalStatus;authorStatus:AuthorEmpiricalStatus;basis:'source-linked-draft'|'author-guidance'|'not-stated';sourceLineIds:string[];conflict:boolean;notes:string[]};
  limitations:string[];
}
export interface FormalPackage {
  schemaVersion: 'formal-lab-v1';
  title: string;
  authors: string;
  source: { title: string; url: string; version: string; sha256?: string; excerpt: string };
  selectedInputs: FormalInput[];
  mainClaim: string;
  assumptions: string[];
  symbols: FormalSymbol[];
  definitions: FormalDefinition[];
  claims: FormalClaim[];
  consequences: { title: string; text: string; claimIds: string[] }[];
  limitations: string[];
  analysis?: FormalAnalysis;
  authorGuidance?:AuthorSubmissionGuidance;
}
export type ClaimStatus = 'checked' | 'contradicted' | 'unsupported' | 'inconclusive';
export interface VerificationReport {
  checker: string;
  engine: string;
  checkedAt: string;
  packageDigest: string;
  status: 'checked' | 'partial' | 'failed';
  claims: { id: string; status: ClaimStatus; title: string; residual: string; dimensions: 'consistent' | 'mismatch' | 'unsupported'; domainRestrictions: string[]; message: string; steps?: string[]; derivationKind?: 'identity' | 'definition-restatement' }[];
  limitations: string[];
}
export interface FormalRevision {
  id: string;
  submissionId: string;
  revision: number;
  package: FormalPackage;
  digest: string;
  createdAt: string;
  origin: 'prepared-example' | 'ai' | 'author-edit';
  model: string | null;
  approvedAt: string | null;
  verification: VerificationReport | null;
  outputs?: FormalOutputs | null;
  publishConsent?: boolean;
}
export interface FormalSubmission { id: string; title: string; currentRevision: FormalRevision; sourceDocument?: IngestedSource; coverageAssessment?: CoverageAssessment; }

/** Source-linked ingestion and reporting, v2. A numbered line is extracted text,
 * not a claim that PDF reading order or mathematical transcription is perfect. */
export interface SourceLine { id: string; page: number; line: number; text: string; }
export interface IngestedSource {
  id: string; filename: string; mimeType: string; sha256: string; pageCount: number;
  lines: SourceLine[]; warnings: string[]; createdAt: string; fileUrl: string;
  events: { at: string; stage: string; message: string }[];
}
export type CoverageRole = 'mathematical' | 'physical-input' | 'definition' | 'interpretation' | 'empirical' | 'citation' | 'scope' | 'metadata' | 'unassessed';
export interface CoverageItem {
  id: string; statement: string; role: CoverageRole; sourceLineIds: string[];
  claimIds: string[]; inputIds: string[]; reason: string;
}
export interface FormalAnalysis {
  version: 'source-analysis-v2'; sourceId: string;
  subjectSlug: string; subjectTitle: string; coverage: CoverageItem[];
  inputReferences: { inputId: string; sourceLineIds: string[]; basis: 'stated' | 'cited' | 'inferred'; justification: string }[];
  claimReferences: { claimId: string; sourceLineIds: string[] }[];
  extractionWarnings: string[];
  ingestionLog?: { at:string; stage:string; message:string }[];
}
export interface CoverageResult extends CoverageItem {
  status: 'checked' | 'contradicted' | 'partial' | 'unsupported' | 'adopted-input' | 'definition' | 'interpretive' | 'not-assessed' | 'context';
  checkedClaimIds: string[]; unresolvedClaimIds: string[];
}
export interface ExplanationSection {
  id: string; title: string; text: string; claimIds: string[];
  coverageIds: string[]; sourceLineIds: string[]; inputIds: string[];
  status: 'conditional-checked' | 'unverified-context';
}
export interface FormalReview {
  summary: string; explanatoryContribution: string; correctness: string;
  physicalJustification: string; priorWork: string; strengths: string[];
  openQuestions: string[]; recommendation: string; claimIds: string[];
}
export interface FieldContribution {
  id: string; sectionId: string; title: string; text: string;
  disposition: 'included' | 'already-represented' | 'conditional' | 'unsupported';
  reason: string; subjectSlug: string; subjectUrl: string;
  paragraphId: string | null; claimIds: string[]; sourceLineIds: string[];
}
export interface FormalOutputs {
  packageDigest: string; generatedAt: string; model: string;
  explanation: ExplanationSection[]; review: FormalReview;
  coverage: CoverageResult[]; contributions: FieldContribution[];
  summary: { total: number; checked: number; conditionalInputs: number; unresolved: number };
  warnings: string[];
  processingLog?: { at:string; stage:string; message:string }[];
}
export interface FormalJob {
  id: string; kind: 'analyze' | 'process' | 'discussion' | 'canonical' | 'literature' | 'assessment' | 'compilation'; status: 'queued' | 'running' | 'complete' | 'failed';
  stage: string; events: { at: string; stage: string; message: string }[];
  sourceId?: string; submissionId?: string; revisionDigest?: string; revisionId?: string; evidenceFingerprint?: string; discussionId?: string; error?: string; updatedAt: string;
  model?: {id: 'current' | 'sol' | 'argon'; label: string; model: string; provider: 'google' | 'openai'};
}
export interface FormalSubjectDirectoryEntry {
  slug:string;title:string;version:number;updatedAt:string;
  parentSlug?:string|null;parent?:SubjectNodeRef|null;children?:SubjectNodeRef[];
  nodeKind?:'evidence-account'|'navigation-parent';hierarchyVersion?:number;scope?:string;
  stats?:SubjectStats;
}
export interface FormalSubject extends FormalSubjectDirectoryEntry {
  parentDecision?:SubjectParentDecision|null;
  overview?: { introduction:string; sections:{id:string;title:string;text:string;paragraphIds:string[];evidenceStatus?:'supported'|'provisional'|'legacy-context'|'mixed'}[]; model:string;generatedAt:string;sourceVersion:number;evidencePolicy?:'reviewed-subject-evidence-v1';admissionFingerprint?:string };
  paragraphs: { id: string; title: string; text: string; status: 'conditional-checked'; conditions?: string[];admission?:SubjectAdmission;originSubjectSlug?:string;placementStatus?:'current'|'historical';
    sources: { submissionId: string; title: string; revisionId: string; digest: string;
      claimIds: string[]; sourceLineIds: string[]; sourceId: string; sourceUrl: string;reviewUrl?:string;admission?:SubjectAdmission;rollupFromSubjectSlugs?:string[];placementStatus?:'current'|'historical' }[];
  }[];
}

export interface CoverageAssessment {
  version:'coverage-reconciliation-v1';packageDigest:string;computedAt:string;coverage:CoverageResult[];
  summary:{total:number;checked:number;conditionalInputs:number;unresolved:number};
  originalSummary:{total:number;checked:number;conditionalInputs:number;unresolved:number};
  corrections:{coverageId:string;previousStatus:CoverageResult['status'];status:CoverageResult['status'];claimIds:string[];reason:string}[];
}
