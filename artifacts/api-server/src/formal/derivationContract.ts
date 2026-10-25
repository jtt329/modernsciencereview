import type { CanonicalExactCheck, CanonicalReference } from './canonicalContract';
import type { AssessmentCompanionEvidence } from './assessmentContract';
import type { FormalPackage, IngestedSource } from './contract';

export interface DerivationSourceBinding {kind:'primary'|'companion';sourceId:string;excerptId:string;locator:string;sha256:string;}
export interface CanonicalDerivationMatch {potentialSymbol:string;areaSymbol:string;lengthSymbol:string;kappaSymbol:string|null;lightSpeedSymbol:string;newtonSymbol:string;piSymbol:string;claimIds:string[];definitionSymbols:string[];}
export interface CanonicalDerivationApplicability {status:'matched'|'needs-formalization'|'unmatched';reason:string;sourceLineIds:string[];claimIds:string[];coverageIds:string[];matches:CanonicalDerivationMatch[];}
export interface CanonicalDerivationCheck extends CanonicalExactCheck {dependsOn:string[];kind:'derivation'|'negative-control';expected:'zero'|'nonzero';rawResidual:string;}
export interface CanonicalDerivationPremise {id:string;title:string;statement:string;status:'declared'|'source-supported'|'missing'|'not-machine-certified';sourceLineIds:string[];evidence:DerivationSourceBinding[];needed:string;}
export interface CanonicalDerivationStep {id:string;title:string;statement:string;kind:'cited-premise'|'computed'|'restriction'|'interpretation';status:'checked'|'conditional'|'open';dependsOn:string[];checkIds:string[];premiseIds:string[];sourceLineIds:string[];claimIds:string[];scope:string;}
export interface CanonicalDerivationObligation {id:string;title:string;status:'discharged'|'conditional'|'open'|'out-of-scope';reason:string;stepIds:string[];checkIds:string[];premiseIds:string[];needed:string;}
export interface CanonicalDerivationReport {
 version:'restricted-canonical-derivation-v1';kernelImplementation:'gaussian-null-eh-v2';packageDigest:string;sourceId:string;sourceSha256:string;createdAt:string;engine:string;evidenceFingerprint:string;
 status:'conditional-checked'|'partial'|'not-applicable';applicability:CanonicalDerivationApplicability;
 premises:CanonicalDerivationPremise[];checks:CanonicalDerivationCheck[];steps:CanonicalDerivationStep[];obligations:CanonicalDerivationObligation[];
 summary:{title:string;text:string;checked:number;negativeControls:number;conditionalPremises:number;openObligations:number;fullCovariantProof:false};limitations:string[];
}
export interface CanonicalDerivationContext {primaryReferences?:CanonicalReference[];companion?:AssessmentCompanionEvidence[];}
/** This type is exported for callers that persist a source-bound supplement. */
export type CanonicalDerivationInput={package:FormalPackage;source:IngestedSource;context?:CanonicalDerivationContext};
