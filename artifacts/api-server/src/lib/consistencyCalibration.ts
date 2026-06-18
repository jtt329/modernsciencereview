// Rubric-consistency calibration (consistency-v1) — pure core.
//
// Replaces the pairwise/Bradley-Terry/anchor machinery with a consistency
// audit of the ICO scoring against the PROMPT'S OWN rubric. The reference
// scale is the rubric's rungs (F1-F4 firmness, C1-C5 centrality,
// rigor x forcedness for constructions), never paper anchors or human
// numbers. Cross-paper comparison only DETECTS inconsistent rung
// application; correction re-applies the ladder to each element
// individually (never averages toward the group).
//
// This module is pure and offline-testable: the model judgment path is an
// injected async function, so the deterministic pieces (extraction,
// rung->weight, aggregation, fast-path dominance, correction application)
// run and are tested with no network. Gated behind calibrationVersion
// "consistency-v1"; the legacy anchored path is untouched.

export const CONSISTENCY_CALIBRATION_VERSION = "consistency-v1";

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

// --- Grouping (deterministic; embeddings optional via injection) -------
function groupTokens(text: string) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export type ElementGroup = { kind: IcoElementKind; elements: IcoElement[] };

// Greedy single-pass clustering over a similarity function (>= threshold
// joins). Shared by the lexical and embedding groupers so they batch
// identically; only the similarity metric differs.
function greedyGroups(
  elements: IcoElement[],
  similar: (a: number, b: number) => boolean,
): ElementGroup[] {
  const groups: ElementGroup[] = [];
  for (const kind of ["input", "construction", "output"] as IcoElementKind[]) {
    const idx = elements.map((e, i) => [e, i] as const).filter(([e]) => e.kind === kind);
    const used = new Set<number>();
    idx.forEach(([el, i]) => {
      if (used.has(i)) return;
      const members = [el];
      used.add(i);
      idx.forEach(([other, j]) => {
        if (j <= i || used.has(j)) return;
        if (similar(i, j)) { members.push(other); used.add(j); }
      });
      if (members.length >= 2) groups.push({ kind, elements: members });
    });
  }
  return groups;
}

// Lexical (token-overlap) grouping. Deterministic, no model. Default
// threshold 0.5. Retained as the offline default and embedding fallback.
export function groupComparableElements(
  elements: IcoElement[],
  opts: { threshold?: number } = {},
): ElementGroup[] {
  const threshold = opts.threshold ?? 0.5;
  const tokens = elements.map((e) => groupTokens(e.text));
  return greedyGroups(elements, (a, b) => jaccard(tokens[a], tokens[b]) >= threshold);
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

// Semantic (embedding) grouping — the preferred path: two elements making
// substantively the same claim cluster even with different wording, which
// lexical overlap misses. Embeds each element's text via the injected
// `embed`, groups by cosine >= threshold (default 0.82). Falls back to
// lexical grouping if embedding fails or returns nothing, so a transient
// embedding error never aborts a calibration run.
export async function groupComparableElementsByEmbedding(
  elements: IcoElement[],
  embed: Embedder,
  opts: { threshold?: number; lexicalThreshold?: number } = {},
): Promise<ElementGroup[]> {
  const threshold = opts.threshold ?? 0.82;
  try {
    const vectors = await embed(elements.map((e) => e.text));
    if (!Array.isArray(vectors) || vectors.length !== elements.length || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
      return groupComparableElements(elements, { threshold: opts.lexicalThreshold });
    }
    return greedyGroups(elements, (a, b) => cosine(vectors[a], vectors[b]) >= threshold);
  } catch {
    return groupComparableElements(elements, { threshold: opts.lexicalThreshold });
  }
}

// --- Corrections (Resolution Rule: per-element, never averaged) --------
export type RungVerdict = {
  reviewId: string;
  kind: IcoElementKind;
  index: number;
  firmness?: FirmnessRung;
  centrality?: CentralityClass;
  validityLevel?: string;
  hardToVaryLevel?: string;
  reason: string;
};

export type ElementChange = {
  reviewId: string;
  kind: IcoElementKind;
  index: number;
  field: string;
  from: string | undefined;
  to: string | undefined;
  reason: string;
};

// Applies per-element rung verdicts from the judgment path. Each flagged
// element is set to the rung the DEFINITIONS prescribe for it (carried on
// the verdict); unflagged elements are untouched. There is no averaging
// toward the group — a correct minority element keeps its rung even if the
// group majority sits elsewhere.
export function applyCorrections(
  elements: IcoElement[],
  verdicts: RungVerdict[],
): { corrected: IcoElement[]; changeLog: ElementChange[] } {
  const byId = new Map(elements.map((e, i) => [`${e.reviewId}\0${e.kind}\0${e.index}`, i]));
  const corrected = elements.map((e) => ({ ...e }));
  const changeLog: ElementChange[] = [];
  for (const v of verdicts) {
    const idx = byId.get(`${v.reviewId}\0${v.kind}\0${v.index}`);
    if (idx == null) continue;
    const el = corrected[idx];
    const fields: Array<["firmness" | "centrality" | "validityLevel" | "hardToVaryLevel", string | undefined]> = [
      ["firmness", v.firmness],
      ["centrality", v.centrality],
      ["validityLevel", v.validityLevel],
      ["hardToVaryLevel", v.hardToVaryLevel],
    ];
    for (const [field, to] of fields) {
      if (to == null) continue;
      const from = el[field] as string | undefined;
      if (from === to) continue;
      changeLog.push({ reviewId: v.reviewId, kind: v.kind, index: v.index, field, from, to, reason: v.reason });
      (el as any)[field] = to;
    }
  }
  return { corrected, changeLog };
}

// --- Conjecture-ceiling rule (2a) --------------------------------------
// The prompt places a CONJECTURED central output below derived/proven results.
// Flag any paper whose central output is conjectured yet scores at or above the
// strongest derived/proven peer (Bousso's Covariant Entropy Conjecture at 100,
// level with Wald/Hawking, is the live case). Deterministic detection only; the
// re-adjudication is done against the F-ladder by the judge, never by averaging.
export type ConjectureCeilingViolation = {
  reviewId: string;
  total: number;
  topDerivedPeerReviewId: string;
  topDerivedPeerTotal: number;
  note: string;
};

// Prefix stems, no trailing \b (so "derives", "rigorously", "derivation" all
// match). A trailing \b here would (wrongly) fail to match those inflections.
const CONJECTURE_PROSE = /\bconjectur/i;
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
        note: "Conjectured central output scores at/above the strongest derived/proven peer — re-adjudicate Output Strength below derived results (conjecture rule); never average.",
      });
    }
  }
  return violations;
}

// --- Shared-input reconciliation (2b) ----------------------------------
// The same input assumption (entropy ∝ area for horizons; AdS/CFT duality; the
// LQG area spectrum) should not carry different firmness across neighboring
// papers just because each review decided independently. Group inputs by STRONG
// identity (high lexical overlap — a local comparison, NOT a global registry)
// and flag groups spanning ≥2 reviews whose firmness disagrees. The fix is to
// re-adjudicate each flagged element against the F-ladder (the judge path),
// NEVER to average toward the group (averaging is what compressed the scale).
export type SharedInputInconsistency = {
  representativeText: string;
  members: Array<{ reviewId: string; index: number; firmness?: string }>;
  distinctFirmness: string[];
  note: string;
};

export function sharedInputInconsistencies(
  elements: IcoElement[],
  opts: { strongThreshold?: number } = {},
): SharedInputInconsistency[] {
  const threshold = opts.strongThreshold ?? 0.8;
  const inputs = elements.filter((e) => e.kind === "input");
  const tokens = inputs.map((e) => groupTokens(e.text));
  const used = new Set<number>();
  const out: SharedInputInconsistency[] = [];
  inputs.forEach((el, i) => {
    if (used.has(i)) return;
    const members = [el];
    used.add(i);
    inputs.forEach((other, j) => {
      if (j <= i || used.has(j)) return;
      if (jaccard(tokens[i], tokens[j]) >= threshold) { members.push(other); used.add(j); }
    });
    const distinctReviews = new Set(members.map((m) => m.reviewId));
    const distinctFirmness = [...new Set(members.map((m) => m.firmness ?? "unspecified"))];
    if (distinctReviews.size >= 2 && distinctFirmness.length >= 2) {
      out.push({
        representativeText: el.text,
        members: members.map((m) => ({ reviewId: m.reviewId, index: m.index, firmness: m.firmness })),
        distinctFirmness,
        note: "Same input assumption assigned different firmness across neighbors — re-adjudicate each against the F-ladder (never average toward the group).",
      });
    }
  });
  return out;
}

// --- Orchestrator (judgment path injected; never called in tests) ------
export type ConsistencyJudge = (group: ElementGroup) => Promise<RungVerdict[]>;

// Stable, content-addressed key for a group: identifies the same SET of
// elements regardless of the order grouping discovered them, so a resumed
// run can match the verdicts a previous (interrupted) run already computed
// for that group and skip re-calling the model (checkpointing).
export function groupKey(group: ElementGroup): string {
  return `${group.kind}|${group.elements
    .map((e) => `${e.reviewId}:${e.kind}:${e.index}`)
    .sort()
    .join(",")}`;
}

export type ConsistencyPaperResult = {
  reviewId: string;
  paperId: string;
  adjudicatorTotal: number;
  finalTotal: number;
  calibrationAdjustment: number; // final - adjudicator
  subscores: IcoAggregate;
  changeLog: ElementChange[];
};

export async function runConsistencyCalibration(
  papers: Array<{ reviewId: string; paperId: string; ledger: Record<string, any> | null; adjudicatorTotal: number }>,
  deps: {
    judge: ConsistencyJudge;
    groupThreshold?: number;
    embed?: Embedder;
    embedThreshold?: number;
    // Execution-only knobs (do not change the computed corrections):
    // run several independent groups concurrently (bounded worker pool),
    // reuse verdicts a prior run already produced, and report each freshly
    // judged group so the caller can checkpoint progress.
    judgeConcurrency?: number;
    precomputedVerdicts?: Record<string, RungVerdict[]>;
    onGroupJudged?: (groupKey: string, verdicts: RungVerdict[]) => void | Promise<void>;
  },
): Promise<{
  results: ConsistencyPaperResult[];
  dominanceViolations: DominanceViolation[];
  conjectureCeilingViolations: ConjectureCeilingViolation[];
  sharedInputInconsistencies: SharedInputInconsistency[];
  groupingMethod: string;
}> {
  const allElements = papers.flatMap((p) => extractIcoElements(p));

  // Fast path — purely deterministic cross-paper flags (no model). These are
  // surfaced in the dry-run preview; the re-adjudication itself is the judge
  // path below (re-adjudicate against the ladder, never average).
  const dominanceFlags = supersetDominanceViolations(papers.map((p) => ({
    reviewId: p.reviewId,
    outputs: allElements.filter((e) => e.reviewId === p.reviewId && e.kind === "output"),
    total: p.adjudicatorTotal,
  })));
  const conjectureFlags = conjectureCeilingViolations(papers.map((p) => ({
    reviewId: p.reviewId,
    outputs: allElements.filter((e) => e.reviewId === p.reviewId && e.kind === "output"),
    total: p.adjudicatorTotal,
  })));
  const sharedInputFlags = sharedInputInconsistencies(allElements);

  // Judgment path — re-adjudicate only flagged groups (anti-drift; minimal
  // churn). Unflagged elements keep their adjudicator rung. Semantic
  // (embedding) grouping when an embedder is supplied; lexical otherwise.
  const groups = deps.embed
    ? await groupComparableElementsByEmbedding(allElements, deps.embed, { threshold: deps.embedThreshold, lexicalThreshold: deps.groupThreshold })
    : groupComparableElements(allElements, { threshold: deps.groupThreshold });

  // Bounded worker pool over the groups. Groups are independent and the
  // verdicts are keyed by element identity (not arrival order), so running
  // several judgments concurrently — and reusing any already computed in a
  // prior run — yields the same corrections, just faster and resumable.
  const concurrency = Math.max(1, deps.judgeConcurrency ?? 1);
  const precomputed = deps.precomputedVerdicts ?? {};
  const perGroupVerdicts: RungVerdict[][] = new Array(groups.length);
  let nextGroup = 0;
  const judgeWorker = async () => {
    for (;;) {
      const i = nextGroup;
      nextGroup += 1; // synchronous claim; no two workers take the same index
      if (i >= groups.length) return;
      const group = groups[i];
      const key = groupKey(group);
      const cached = precomputed[key];
      if (cached) { perGroupVerdicts[i] = cached; continue; }
      const judged = await deps.judge(group);
      perGroupVerdicts[i] = judged;
      if (deps.onGroupJudged) await deps.onGroupJudged(key, judged);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, groups.length)) }, () => judgeWorker()),
  );
  const verdicts: RungVerdict[] = perGroupVerdicts.flat();
  const { corrected, changeLog } = applyCorrections(allElements, verdicts);

  const results: ConsistencyPaperResult[] = papers.map((p) => {
    const subscores = aggregateFromElements(corrected.filter((e) => e.reviewId === p.reviewId));
    return {
      reviewId: p.reviewId,
      paperId: p.paperId,
      adjudicatorTotal: p.adjudicatorTotal,
      finalTotal: subscores.total,
      calibrationAdjustment: subscores.total - p.adjudicatorTotal,
      subscores,
      changeLog: changeLog.filter((c) => c.reviewId === p.reviewId),
    };
  });
  return {
    results,
    dominanceViolations: dominanceFlags,
    conjectureCeilingViolations: conjectureFlags,
    sharedInputInconsistencies: sharedInputFlags,
    groupingMethod: deps.embed ? "embedding" : "lexical",
  };
}
