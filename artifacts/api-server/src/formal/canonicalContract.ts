/** Canonical evidence is a separate digest-bound assessment; it cannot approve a revision. */
export interface CanonicalSourceExcerpt { id:string; locator:string; text:string; }
export interface CanonicalReference {
  id:string; title:string; url:string; status:'retrieved'|'unavailable'; retrievedAt:string;
  sha256?:string; excerpts:CanonicalSourceExcerpt[]; extractionNote:string; origin?:'cited'|'discovered';
}
export interface CanonicalExactCheck {
  id:string; title:string; status:'checked'|'contradicted'|'inconclusive';
  expression:string; residual:string; assumptions:string[]; scope:string; components?:number;
}
export interface CanonicalFinding {
  id:string; title:string; status:'source-supported'|'conditional'|'missing'|'contradicted'|'not-assessed';
  statement:string; sourceLineIds:string[];
  citations:{sourceId:string;excerptId:string;quote:string}[];
  reason:string; neededEvidence:string[];
}
export interface CanonicalAssessment {
  version:'canonical-assessment-v1'; packageDigest:string; sourceId:string; sourceSha256:string;
  createdAt:string; model:string; status:'assessed-with-open-obligations'; fullDerivationVerified:false;
  summary:string; references:CanonicalReference[]; checks:CanonicalExactCheck[];
  findings:CanonicalFinding[];
  conventions:{name:string;status:'stated'|'inferred'|'missing'|'conflicting';value:string;sourceLineIds:string[]}[];
  proposedSourceClarifications:{lineIds:string[];explanation:string;suggestedText:string}[];
  limitations:string[];
}
