// Rubric-consistency calibration (consistency-v2) — pure core.
//
// v2 REMOVES the broad element-by-element rung-recompute (it re-graded every
// element from scratch and re-summed, compressing the scale — SD 17.6→13.7,
// floor 5→30). Calibration must leave almost every score untouched. What v2
// keeps and does instead:
//   1. Dominance check — flags only impossible orderings (B ⊇ A yet scores
//      lower). No score rewriting.
//   2. Conjecture-ceiling check — flags a conjectured central output at/above
//      the strongest derived/proven peer and caps ONLY that output one firmness
//      tier below the proven/derived top (absolute, rubric-grounded — never
//      pinned to a neighbor's score).
//   3. Reason-grouped deduction consistency — operate on the deductions that
//      ALREADY exist (each below-10 dimension's cause + 10−subscore). Embedding
//      pre-cluster candidate same-cause deductions, then the model verifies one
//      cluster at a time (same cause AND comparable load-bearing role?) and
//      flags only unjustified divergences; the outlier's rung is re-adjudicated
//      to the rubric-prescribed value (NEVER averaged), points recomputed in
//      code. Everything else is untouched — no corpus-wide re-sum.
//
// Pure + offline-testable: the model judgment path is injected. Anti-anchoring:
// the model emits rungs/subscores + the grouping judgment; code computes points.
// Gated behind calibrationVersion "consistency-v2"; legacy anchored path intact.

export const CONSISTENCY_CALIBRATION_VERSION = "consistency-v2";

// A conjectured central output cannot occupy the top firmness tier (F1 = 10)
// reserved for proven/derived results; it is capped one tier down (F2 = 8).
export const CONJECTURE_OUTPUT_CEILING = 8;

export type FirmnessRung = "F1" | "F2" | "F3" | "F4";
export type CentralityClass = "C1" | "C2" | "C3" | "C4" | "C5";
export type IcoElementKind = "input" | "construction" | "output";

export type IcoElement = {
  reviewId: string;
  paperId: string;
  kind: IcoElementKind;
  index: number;
  text: string;
  // Parsed rungs (from structured fields where present, else the rationale
  // prose). Any may be absent; contribution falls back to ordinal fields.
  firmness?: FirmnessRung;
  centrality?: CentralityClass;
  validityLevel?: string; // construction/output: invalid|conditional|valid|strong
  hardToVaryLevel?: string; // construction: low|medium|high
  groundingQuality?: string; // input: weak|moderate|strong
  fundamentalityLevel?: string; // input: low|medium|high
};

// --- Rung -> weight tables (DEFAULT; operator-ratifiable) --------------
// These set the per-element 0-10 contribution from its rung. The exact
// numbers are a scoring-philosophy call for the operator to ratify; what
// the engine guarantees is that EQUAL rungs yield EQUAL contributions and
// better rungs yield higher ones (monotonic), which is what consistency
// requires. Tune the constants, not the mechanism.
const FIRMNESS_WEIGHT: Record<FirmnessRung, number> = { F1: 10, F2: 8, F3: 6, F4: 4 };
const CENTRALITY_WEIGHT: Record<CentralityClass, number> = { C1: 10, C2: 9, C3: 8, C4: 7, C5: 6 };
const VALIDITY_WEIGHT: Record<string, number> = { invalid: 0, conditional: 4, valid: 7, strong: 10 };
const HARD_TO_VARY_WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 10 };
const GROUNDING_WEIGHT: Record<string, number> = { weak: 4, moderate: 7, strong: 10 };
const FUNDAMENTALITY_WEIGHT: Record<string, number> = { low: 5, medium: 7, high: 10 };

function clamp10(n: number) {
  return Math.max(0, Math.min(10, n));
}

function mean(values: number[]) {
  const present = values.filter((v) => Number.isFinite(v));
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
}

// Per-element 0-10 contribution from its rungs.
export function elementContribution(el: IcoElement): number {
  if (el.kind === "output") {
    const parts = [
      el.firmness ? FIRMNESS_WEIGHT[el.firmness] : NaN,
      el.centrality ? CENTRALITY_WEIGHT[el.centrality] : NaN,
      el.validityLevel ? VALIDITY_WEIGHT[el.validityLevel.toLowerCase()] : NaN,
    ];
    const v = mean(parts);
    return v || (el.validityLevel ? VALIDITY_WEIGHT[el.validityLevel.toLowerCase()] ?? 5 : 5);
  }
  if (el.kind === "construction") {
    return clamp10(mean([
      el.validityLevel ? VALIDITY_WEIGHT[el.validityLevel.toLowerCase()] : NaN,
      el.hardToVaryLevel ? HARD_TO_VARY_WEIGHT[el.hardToVaryLevel.toLowerCase()] : NaN,
    ]) || 5);
  }
  // input
  return clamp10(mean([
    el.firmness ? FIRMNESS_WEIGHT[el.firmness] : NaN,
    el.groundingQuality ? GROUNDING_WEIGHT[el.groundingQuality.toLowerCase()] : NaN,
    el.fundamentalityLevel ? FUNDAMENTALITY_WEIGHT[el.fundamentalityLevel.toLowerCase()] : NaN,
  ]) || 5);
}

export type IcoAggregate = {
  inputStrengthScore: number;
  constructionStrengthScore: number;
  outputStrengthScore: number;
  total: number; // 0-100
};

// Aggregate elements -> I/C/O subscores (mean of per-element contributions
// per kind), total via the existing computed-ICO formula 10*avg(I,C,O).
export function aggregateFromElements(elements: IcoElement[]): IcoAggregate {
  const byKind = (kind: IcoElementKind) =>
    elements.filter((e) => e.kind === kind).map(elementContribution);
  const round05 = (n: number) => Math.round(n * 2) / 2;
  const input = round05(mean(byKind("input")));
  const construction = round05(mean(byKind("construction")));
  const output = round05(mean(byKind("output")));
  return {
    inputStrengthScore: input,
    constructionStrengthScore: construction,
    outputStrengthScore: output,
    total: Math.round(10 * ((input + construction + output) / 3)),
  };
}

// --- Extraction --------------------------------------------------------
const FIRMNESS_IN_PROSE = /\bF([1-4])\b/;
const CENTRALITY_IN_PROSE = /\bC([1-5])\b/;

function parseFirmness(text: string | undefined): FirmnessRung | undefined {
  const m = (text || "").match(FIRMNESS_IN_PROSE);
  return m ? (`F${m[1]}` as FirmnessRung) : undefined;
}
function parseCentrality(text: string | undefined): CentralityClass | undefined {
  const m = (text || "").match(CENTRALITY_IN_PROSE);
  return m ? (`C${m[1]}` as CentralityClass) : undefined;
}

// Extracts ICO elements from a stored v19 review ledger. Firmness/centrality
// rungs are stated in v19 rationale prose, so they are parsed from the
// element's assessment text; ordinal fields come from the structured ledger.
export function extractIcoElements(input: {
  reviewId: string;
  paperId: string;
  ledger: Record<string, any> | null | undefined;
}): IcoElement[] {
  const ico = input.ledger?.inputConstructionOutputAssessment ?? input.ledger?.inputConstructionOutputLedger ?? {};
  const out: IcoElement[] = [];
  const primitiveInputs = ico?.input?.primitiveInputs ?? input.ledger?.primitiveInputs ?? [];
  const constructions = ico?.construction?.introducedConstructions ?? input.ledger?.introducedConstructions ?? [];
  const outputs = ico?.output?.outputs ?? input.ledger?.outputs ?? [];

  (Array.isArray(primitiveInputs) ? primitiveInputs : []).forEach((item: any, index: number) => {
    const text = [item?.input, item?.assessment, item?.fundamentality, item?.grounding].filter(Boolean).join(" ");
    out.push({
      reviewId: input.reviewId, paperId: input.paperId, kind: "input", index,
      text: item?.input || text,
      firmness: parseFirmness(text),
      groundingQuality: typeof item?.groundingQuality === "string" ? item.groundingQuality : undefined,
      fundamentalityLevel: typeof item?.fundamentalityLevel === "string" ? item.fundamentalityLevel : undefined,
    });
  });
  (Array.isArray(constructions) ? constructions : []).forEach((item: any, index: number) => {
    const text = [item?.construction, item?.assessment, item?.validity, item?.hardToVary].filter(Boolean).join(" ");
    out.push({
      reviewId: input.reviewId, paperId: input.paperId, kind: "construction", index,
      text: item?.construction || text,
      validityLevel: typeof item?.validityLevel === "string" ? item.validityLevel : undefined,
      hardToVaryLevel: typeof item?.hardToVaryLevel === "string" ? item.hardToVaryLevel : undefined,
    });
  });
  (Array.isArray(outputs) ? outputs : []).forEach((item: any, index: number) => {
    const text = [item?.output, item?.assessment, item?.support, item?.validity].filter(Boolean).join(" ");
    out.push({
      reviewId: input.reviewId, paperId: input.paperId, kind: "output", index,
      text: item?.output || text,
      firmness: parseFirmness(text),
      centrality: parseCentrality(text),
      validityLevel: typeof item?.validityLevel === "string" ? item.validityLevel : undefined,
    });
  });
  return out;
}

// --- Fast path: deterministic superset dominance -----------------------
export type DominanceViolation = {
  supersetReviewId: string;
  subsetReviewId: string;
  supersetTotal: number;
  subsetTotal: number;
  sharedOutputCount: number;
  note: string;
};

function outputKey(el: IcoElement) {
  return el.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// If paper Y's outputs are a superset of paper X's, the shared outputs sit
// on equal-or-better rungs, and Y's extra outputs are not weaker, then
// total(Y) >= total(X) must hold. Where the provided (adjudicator) totals
// violate it, flag for re-adjudication — NO model call.
export function supersetDominanceViolations(papers: Array<{
  reviewId: string;
  outputs: IcoElement[];
  total: number;
}>): DominanceViolation[] {
  const violations: DominanceViolation[] = [];
  const rung = (el: IcoElement) => elementContribution(el);
  for (const y of papers) {
    for (const x of papers) {
      if (y.reviewId === x.reviewId) continue;
      const yKeys = new Map(y.outputs.map((o) => [outputKey(o), o]));
      const xKeys = x.outputs.map((o) => [outputKey(o), o] as const);
      if (xKeys.length === 0) continue;
      const isSuperset = xKeys.every(([k]) => yKeys.has(k));
      if (!isSuperset || y.outputs.length <= x.outputs.length) continue;
      const sharedEqualOrBetter = xKeys.every(([k, xo]) => rung(yKeys.get(k)!) >= rung(xo) - 1e-9);
      if (!sharedEqualOrBetter) continue;
      const sharedRungMin = Math.min(...xKeys.map(([k]) => rung(yKeys.get(k)!)));
      const extras = [...yKeys.entries()].filter(([k]) => !xKeys.some(([xk]) => xk === k)).map(([, o]) => o);
      const extrasNotWeaker = extras.every((o) => rung(o) >= sharedRungMin - 1e-9);
      if (!extrasNotWeaker) continue;
      if (y.total < x.total) {
        violations.push({
          supersetReviewId: y.reviewId,
          subsetReviewId: x.reviewId,
          supersetTotal: y.total,
          subsetTotal: x.total,
          sharedOutputCount: xKeys.length,
          note: "Superset paper scored below its subset at equal-or-better output rungs — re-adjudicate.",
        });
      }
    }
  }
  return violations;
}

// --- Conjecture-ceiling rule -------------------------------------------
// The prompt places a CONJECTURED central output below derived/proven results.
// Flag any paper whose central output is conjectured yet scores at or above the
// strongest derived/proven peer (Bousso's Covariant Entropy Conjecture at 100,
// level with Wald/Hawking). The correction is an ABSOLUTE rung cap (one firmness
// tier below the proven/derived top), applied in the orchestrator — never a
// peer-relative nudge.
export type ConjectureCeilingViolation = {
  reviewId: string;
  total: number;
  topDerivedPeerReviewId: string;
  topDerivedPeerTotal: number;
  note: string;
};

const CONJECTURE_PROSE = /\bconjectur/i;
// Prefix stems, no trailing \b (so "derives", "rigorously", "derivation" match).
const DERIVED_PROSE = /\b(?:deriv|proven|proved|proof|rigorous|theorem|first[-\s]principle|exact(?:ly)?\s+(?:deriv|comput|solv|result))/i;

// Classify a paper's central result epistemically from its output prose. A
// "mixed" paper that BOTH conjectures and derives — e.g. Firewalls, which
// rigorously derives a constraint FROM established foundations — is "other" and
// left alone (not a bare conjecture).
export function paperEpistemicStatus(outputs: IcoElement[]): "conjecture" | "derived" | "other" {
  const text = outputs.map((o) => o.text).join(" \n ");
  const conjecture = CONJECTURE_PROSE.test(text);
  const derived = DERIVED_PROSE.test(text);
  if (conjecture && !derived) return "conjecture";
  if (derived && !conjecture) return "derived";
  return "other";
}

export function conjectureCeilingViolations(
  papers: Array<{ reviewId: string; outputs: IcoElement[]; total: number }>,
): ConjectureCeilingViolation[] {
  const derivedPeers = papers.filter((p) => paperEpistemicStatus(p.outputs) === "derived");
  if (derivedPeers.length === 0) return [];
  const topDerived = derivedPeers.reduce((a, b) => (b.total > a.total ? b : a));
  const violations: ConjectureCeilingViolation[] = [];
  for (const p of papers) {
    if (paperEpistemicStatus(p.outputs) !== "conjecture") continue;
    if (p.total >= topDerived.total) {
      violations.push({
        reviewId: p.reviewId,
        total: p.total,
        topDerivedPeerReviewId: topDerived.reviewId,
        topDerivedPeerTotal: topDerived.total,
        note: "Conjectured central output scores at/above the strongest derived/proven peer — cap Output Strength one firmness tier below the proven/derived top (conjecture rule).",
      });
    }
  }
  return violations;
}

// --- Reason-grouped deduction consistency ------------------------------
// Operate on the deductions that ALREADY exist; never re-grade rungs from
// scratch. Each below-10 I/C/O dimension carries a stated cause (its rationale)
// and a deduction (10 − subscore).
export type Deduction = {
  reviewId: string;
  paperId: string;
  dimension: IcoElementKind;
  cause: string;
  subscore: number;
  points: number; // 10 − subscore
};

// Read a dimension's stored subscore + cause from the v19 ledger. Same
// precedence the UI/point-deduction display uses.
function dimensionSubscore(ledger: Record<string, any> | null | undefined, dim: IcoElementKind): number | null {
  const key = `${dim}StrengthScore`;
  const raw = ledger?.[key] ?? ledger?.aggregate?.[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function dimensionCause(ledger: Record<string, any> | null | undefined, dim: IcoElementKind): string {
  const subRat = ledger?.subscoreRationale ?? ledger?.aggregate?.subscoreRationale ?? {};
  const v = subRat?.[`${dim}StrengthScore`];
  return typeof v === "string" ? v.trim() : "";
}

export function collectDeductions(
  papers: Array<{ reviewId: string; paperId: string; ledger: Record<string, any> | null }>,
): Deduction[] {
  const out: Deduction[] = [];
  for (const p of papers) {
    for (const dim of ["input", "construction", "output"] as IcoElementKind[]) {
      const subscore = dimensionSubscore(p.ledger, dim);
      if (subscore == null || subscore >= 10) continue;
      out.push({
        reviewId: p.reviewId,
        paperId: p.paperId,
        dimension: dim,
        cause: dimensionCause(p.ledger, dim),
        subscore,
        points: Math.round((10 - subscore) * 10) / 10,
      });
    }
  }
  return out;
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
function causeTokens(text: string) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

// Greedy single-pass clustering of deductions by CAUSE similarity. Embedding
// (semantic) when an embedder is supplied — this is what the lexical matcher
// could not do (e.g. "rests on the entropy-area relation" worded differently);
// lexical fallback otherwise / on embedding failure. Only the candidate
// clusters (≥2 members spanning ≥2 distinct reviews) are returned for judging.
export async function clusterDeductionsByCause(
  deductions: Deduction[],
  embed?: Embedder,
  opts: { threshold?: number; lexicalThreshold?: number } = {},
): Promise<Deduction[][]> {
  const n = deductions.length;
  if (n < 2) return [];
  let similar: (a: number, b: number) => boolean;
  let method: "embedding" | "lexical" = "lexical";
  if (embed) {
    try {
      const vectors = await embed(deductions.map((d) => d.cause));
      if (Array.isArray(vectors) && vectors.length === n && vectors.every((v) => Array.isArray(v) && v.length > 0)) {
        const threshold = opts.threshold ?? 0.82;
        similar = (a, b) => cosine(vectors[a], vectors[b]) >= threshold;
        method = "embedding";
      } else {
        const t = opts.lexicalThreshold ?? 0.5;
        const toks = deductions.map((d) => causeTokens(d.cause));
        similar = (a, b) => jaccard(toks[a], toks[b]) >= t;
      }
    } catch {
      const t = opts.lexicalThreshold ?? 0.5;
      const toks = deductions.map((d) => causeTokens(d.cause));
      similar = (a, b) => jaccard(toks[a], toks[b]) >= t;
    }
  } else {
    const t = opts.lexicalThreshold ?? 0.5;
    const toks = deductions.map((d) => causeTokens(d.cause));
    similar = (a, b) => jaccard(toks[a], toks[b]) >= t;
  }
  void method;
  const used = new Set<number>();
  const clusters: Deduction[][] = [];
  for (let i = 0; i < n; i += 1) {
    if (used.has(i)) continue;
    const members = [i];
    used.add(i);
    for (let j = i + 1; j < n; j += 1) {
      if (used.has(j)) continue;
      if (similar(i, j)) { members.push(j); used.add(j); }
    }
    const reviews = new Set(members.map((m) => deductions[m].reviewId));
    if (members.length >= 2 && reviews.size >= 2) clusters.push(members.map((m) => deductions[m]));
  }
  return clusters;
}

// Per-cluster model verdict: confirm the cluster is genuinely one cause in a
// COMPARABLE load-bearing role, and flag only the outliers — the model emits
// the rubric-prescribed subscore (a 0-10 rung; code computes points). A
// legitimate weight difference (same cause, different load-bearing role) yields
// NO flag.
export type DeductionFlag = {
  reviewId: string;
  dimension: IcoElementKind;
  prescribedSubscore: number;
  reason: string;
};
export type DeductionClusterVerdict = { sameCauseAndRole: boolean; flags: DeductionFlag[] };
export type DeductionClusterJudge = (cluster: Deduction[]) => Promise<DeductionClusterVerdict>;

export function clusterKey(cluster: Deduction[]): string {
  return cluster.map((d) => `${d.reviewId}:${d.dimension}`).sort().join(",");
}

export type ConsistencyPaperResult = {
  reviewId: string;
  paperId: string;
  adjudicatorTotal: number;
  finalTotal: number;
  calibrationAdjustment: number; // final − adjudicator
  changeLog: Array<{ dimension: IcoElementKind; from: number; to: number; reason: string }>;
};

export type DeductionConsistencyGroup = {
  cause: string;
  members: Array<{ reviewId: string; dimension: IcoElementKind; points: number }>;
};

// Recompute a paper's total as a DELTA from its adjudicator total (anchored, so
// the stored score vs the I/C/O formula never disagree): each moved dimension
// shifts the total by (to − from) * 10/3.
function totalWithDelta(adjudicatorTotal: number, moves: Array<{ from: number; to: number }>): number {
  const delta = moves.reduce((s, m) => s + (m.to - m.from) * (10 / 3), 0);
  return Math.max(0, Math.min(100, Math.round(adjudicatorTotal + delta)));
}

export async function runConsistencyCalibration(
  papers: Array<{ reviewId: string; paperId: string; ledger: Record<string, any> | null; adjudicatorTotal: number }>,
  deps: {
    deductionJudge: DeductionClusterJudge;
    embed?: Embedder;
    embedThreshold?: number;
    groupThreshold?: number;
    // Execution-only knobs (do not change which dimensions move): bounded
    // concurrency over clusters + resume from prior cluster verdicts.
    judgeConcurrency?: number;
    precomputedVerdicts?: Record<string, DeductionClusterVerdict>;
    onClusterJudged?: (clusterKey: string, verdict: DeductionClusterVerdict) => void | Promise<void>;
  },
): Promise<{
  results: ConsistencyPaperResult[];
  dominanceViolations: DominanceViolation[];
  conjectureCeilingViolations: ConjectureCeilingViolation[];
  deductionConsistency: { groupingMethod: string; groups: DeductionConsistencyGroup[]; flags: DeductionFlag[] };
}> {
  const allElements = papers.flatMap((p) => extractIcoElements(p));
  const outputsByReview = (reviewId: string) => allElements.filter((e) => e.reviewId === reviewId && e.kind === "output");

  // (1) + (2): deterministic cross-paper flags (no re-sum).
  const dominanceFlags = supersetDominanceViolations(papers.map((p) => ({
    reviewId: p.reviewId,
    outputs: outputsByReview(p.reviewId),
    total: p.adjudicatorTotal,
  })));
  const conjectureFlags = conjectureCeilingViolations(papers.map((p) => ({
    reviewId: p.reviewId,
    outputs: outputsByReview(p.reviewId),
    total: p.adjudicatorTotal,
  })));

  // (3) reason-grouped deduction consistency. Embedding pre-cluster, then the
  // model verifies + flags one cluster at a time (bounded concurrency + resume).
  const deductions = collectDeductions(papers);
  const clusters = await clusterDeductionsByCause(deductions, deps.embed, {
    threshold: deps.embedThreshold,
    lexicalThreshold: deps.groupThreshold,
  });
  const concurrency = Math.max(1, deps.judgeConcurrency ?? 1);
  const precomputed = deps.precomputedVerdicts ?? {};
  const perCluster: DeductionClusterVerdict[] = new Array(clusters.length);
  let nextCluster = 0;
  const worker = async () => {
    for (;;) {
      const i = nextCluster;
      nextCluster += 1;
      if (i >= clusters.length) return;
      const key = clusterKey(clusters[i]);
      const cached = precomputed[key];
      if (cached) { perCluster[i] = cached; continue; }
      const verdict = await deps.deductionJudge(clusters[i]);
      perCluster[i] = verdict;
      if (deps.onClusterJudged) await deps.onClusterJudged(key, verdict);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, clusters.length)) }, () => worker()));

  // Collect flags only from clusters the model confirmed as one cause + role.
  const flags: DeductionFlag[] = [];
  for (let i = 0; i < clusters.length; i += 1) {
    const verdict = perCluster[i];
    if (!verdict || !verdict.sameCauseAndRole) continue;
    for (const f of verdict.flags) {
      // a flag must correspond to a real member of this cluster
      if (clusters[i].some((d) => d.reviewId === f.reviewId && d.dimension === f.dimension)) flags.push(f);
    }
  }

  // Apply ONLY the targeted moves (conjecture cap + flagged outliers). Every
  // other paper is untouched: finalTotal === adjudicatorTotal.
  type Move = { dimension: IcoElementKind; from: number; to: number; reason: string };
  const movesByReview = new Map<string, Move[]>();
  const addMove = (reviewId: string, move: Move) => {
    const list = movesByReview.get(reviewId) ?? [];
    list.push(move);
    movesByReview.set(reviewId, list);
  };
  const subscoreOf = (reviewId: string, dim: IcoElementKind): number | null => {
    const p = papers.find((x) => x.reviewId === reviewId);
    return p ? dimensionSubscore(p.ledger, dim) : null;
  };
  // Conjecture-ceiling: cap the flagged paper's output one firmness tier down.
  for (const cv of conjectureFlags) {
    const cur = subscoreOf(cv.reviewId, "output");
    if (cur != null && cur > CONJECTURE_OUTPUT_CEILING) {
      addMove(cv.reviewId, { dimension: "output", from: cur, to: CONJECTURE_OUTPUT_CEILING, reason: "conjecture-ceiling: capped one firmness tier below the proven/derived top" });
    }
  }
  // Deduction-consistency outliers: move to the rubric-prescribed subscore.
  for (const f of flags) {
    const cur = subscoreOf(f.reviewId, f.dimension);
    const to = Math.max(0, Math.min(10, Number(f.prescribedSubscore)));
    if (cur == null || !Number.isFinite(to) || to === cur) continue;
    addMove(f.reviewId, { dimension: f.dimension, from: cur, to, reason: f.reason || "deduction-consistency: re-adjudicated to the rubric-prescribed rung" });
  }

  const results: ConsistencyPaperResult[] = papers.map((p) => {
    const moves = movesByReview.get(p.reviewId) ?? [];
    const finalTotal = moves.length ? totalWithDelta(p.adjudicatorTotal, moves) : p.adjudicatorTotal;
    return {
      reviewId: p.reviewId,
      paperId: p.paperId,
      adjudicatorTotal: p.adjudicatorTotal,
      finalTotal,
      calibrationAdjustment: finalTotal - p.adjudicatorTotal,
      changeLog: moves.map((m) => ({ dimension: m.dimension, from: m.from, to: m.to, reason: m.reason })),
    };
  });

  // Surface the candidate cause groups (for the dry-run preview).
  const groups: DeductionConsistencyGroup[] = clusters.map((c) => ({
    cause: c[0]?.cause ?? "",
    members: c.map((d) => ({ reviewId: d.reviewId, dimension: d.dimension, points: d.points })),
  }));

  return {
    results,
    dominanceViolations: dominanceFlags,
    conjectureCeilingViolations: conjectureFlags,
    deductionConsistency: { groupingMethod: deps.embed ? "embedding" : "lexical", groups, flags },
  };
}
