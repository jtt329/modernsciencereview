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
export type Dimensions = [number, number, number]; // SI mass, length, time
export interface FormalSymbol { name: string; label: string; domain: 'real' | 'positive' | 'nonzero'; dimensions: Dimensions; }
export interface FormalDefinition { symbol: string; expression: Expr; description: string; }
export interface FormalClaim { id: string; title: string; lhs: Expr; rhs: Expr; explanation: string; }
export interface FormalInput { id: string; version: string; title: string; statement: string; sourceUrl?: string; }
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
}
export type ClaimStatus = 'checked' | 'contradicted' | 'unsupported' | 'inconclusive';
export interface VerificationReport {
  checker: string;
  engine: string;
  checkedAt: string;
  packageDigest: string;
  status: 'checked' | 'partial' | 'failed';
  claims: { id: string; status: ClaimStatus; title: string; residual: string; dimensions: 'consistent' | 'mismatch' | 'unsupported'; domainRestrictions: string[]; message: string }[];
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
}
export interface FormalSubmission { id: string; title: string; currentRevision: FormalRevision; }
