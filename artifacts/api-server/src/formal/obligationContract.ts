import type { Expr, FormalOutputs, VerificationReport } from './contract';
import type { CanonicalAssessment } from './canonicalContract';
import type { GeometryAssessment, ScientificAssessment } from './assessmentContract';
import type { LiteratureAssessment } from './literatureContract';

/** A source-bound dependency ledger. Dispositions describe the listed target and
 * scope; they are never a probability that the paper or its physical premises are true. */
export type ClaimObligationDisposition = 'proved-under-premises' | 'conditionally-supported' | 'declared-input' | 'definition' | 'context' | 'open' | 'contradicted';
export type ClaimRequirementStatus = 'checked' | 'source-supported' | 'accepted-premise' | 'open' | 'contradicted' | 'not-required';
export type ClaimEvidenceKind = 'scalar-check' | 'canonical-check' | 'canonical-finding' | 'geometry-check' | 'derivation-check' | 'derivation-obligation' | 'literature-paper' | 'source-line' | 'declared-input' | 'assessment-standard';
export interface ClaimEvidenceReference { kind: ClaimEvidenceKind; id: string; status: string; summary?: string; }
export interface ClaimVerificationRequirement {
  id: string; title: string;
  kind: 'mathematical' | 'premise' | 'source-fidelity' | 'canonical-structure' | 'domain' | 'citation' | 'empirical';
  status: ClaimRequirementStatus; detail: string; evidence: ClaimEvidenceReference[];
  dependsOn: string[]; supportedAdapterIds: string[];
}
export interface ClaimVerificationObligation {
  id: string; title: string; statement: string;
  kind: 'mathematical' | 'physical-input' | 'canonical' | 'definition' | 'interpretation' | 'empirical' | 'citation' | 'scope' | 'unassessed';
  target: { claimIds: string[]; coverageIds: string[]; inputIds: string[]; sourceLineIds: string[] };
  equation?: { lhs: Expr; rhs: Expr };
  disposition: ClaimObligationDisposition;
  materiality: 'material' | 'clarification' | 'information';
  requirements: ClaimVerificationRequirement[];
  premises: { inputIds: string[]; definitionSymbols: string[]; assumptionIndexes: number[]; conditions: string[] };
  evidence: ClaimEvidenceReference[];
  counterexampleStrategy: { method: string; scope: string; performed: boolean; outcome: 'not-run' | 'counterexample-found' | 'no-counterexample-in-checked-expression' };
  conclusion: string; nextActions: string[];
}
export interface ClaimVerificationAdapter {
  id: string; title: string; status: 'available' | 'bounded' | 'not-applicable';
  scope: string; limitations: string[];
}
export interface ClaimVerificationPlan {
  version: 'claim-verification-plan-v1'; packageDigest: string; sourceId: string; sourceSha256: string;
  method: 'deterministic-evidence-mapping';
  headline: string; summary: string;
  mainClaim: string;
  summaryCounts: {
    formalCandidates: number; checkedIdentities: number; definitionRestatements: number;
    sourceAssertions: number; scientificSourceAssertions: number;
    obligations: number; provedUnderPremises: number; conditionallySupported: number;
    declaredInputs: number; definitions: number; contextual: number; open: number; contradicted: number;
    openMaterial: number; openClarifications: number;
    distinctEvidence: { scalarChecks: number; canonicalChecks: number; geometryChecks: number; derivationChecks: number; citedPapers: number };
  };
  adapters: ClaimVerificationAdapter[];
  /** Deduplicated evidence labels. Local references retain kind, ID and status. */
  evidence: ClaimEvidenceReference[];
  obligations: ClaimVerificationObligation[];
  assumptions: { index: number; statement: string }[];
  limits: string[];
}

/** Existing evidence only. The current assessment may supply a source-supported
 * interpretation, but cannot change an exact mathematical result. */
export interface ClaimVerificationPlanEvidence {
  verification: VerificationReport;
  outputs?: FormalOutputs | null;
  canonical?: CanonicalAssessment | null;
  literature?: LiteratureAssessment | null;
  geometry?: GeometryAssessment | null;
  assessment?: ScientificAssessment | null;
  /** Set to a validated engine report, never author-supplied executable code. */
  derivation?: import('./derivationContract').CanonicalDerivationReport | null;
}

/** A source-aware scientific interpretation, stored separately from the exact
 * proof plan. It cannot change the mathematical check or its premises. */
export interface ClaimSourceJudgment {
  obligationId: string;
  outcome: 'source-supported' | 'contextual' | 'needs-input' | 'contradicted';
  reason: string;
  sourceLineIds: string[];
  evidenceRefs: {kind:ClaimEvidenceKind;id:string}[];
}
