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

// Groups comparable elements (same kind, substantively similar claim) as
// audit batches with NO scale meaning. Deterministic token-overlap default;
// pass `embed` to upgrade to embedding similarity. Threshold is the
// grouping granularity knob (default 0.5).
export function groupComparableElements(
  elements: IcoElement[],
  opts: { threshold?: number } = {},
): ElementGroup[] {
  const threshold = opts.threshold ?? 0.5;
  const groups: ElementGroup[] = [];
  for (const kind of ["input", "construction", "output"] as IcoElementKind[]) {
    const pool = elements.filter((e) => e.kind === kind);
    const used = new Set<number>();
    pool.forEach((el, i) => {
      if (used.has(i)) return;
      const tokensI = groupTokens(el.text);
      const members = [el];
      used.add(i);
      pool.forEach((other, j) => {
        if (j <= i || used.has(j)) return;
        if (jaccard(tokensI, groupTokens(other.text)) >= threshold) {
          members.push(other);
          used.add(j);
        }
      });
      if (members.length >= 2) groups.push({ kind, elements: members });
    });
  }
  return groups;
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

// --- Orchestrator (judgment path injected; never called in tests) ------
export type ConsistencyJudge = (group: ElementGroup) => Promise<RungVerdict[]>;

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
  deps: { judge: ConsistencyJudge; groupThreshold?: number },
): Promise<{ results: ConsistencyPaperResult[]; dominanceViolations: DominanceViolation[] }> {
  const allElements = papers.flatMap((p) => extractIcoElements(p));

  // Fast path first — purely deterministic dominance detection.
  const dominanceViolations = supersetDominanceViolations(papers.map((p) => ({
    reviewId: p.reviewId,
    outputs: allElements.filter((e) => e.reviewId === p.reviewId && e.kind === "output"),
    total: p.adjudicatorTotal,
  })));

  // Judgment path — re-adjudicate only flagged groups (anti-drift; minimal
  // churn). Unflagged elements keep their adjudicator rung.
  const groups = groupComparableElements(allElements, { threshold: deps.groupThreshold });
  const verdicts: RungVerdict[] = [];
  for (const group of groups) {
    verdicts.push(...await deps.judge(group));
  }
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
  return { results, dominanceViolations };
}
