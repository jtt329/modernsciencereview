import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { createHash } from "crypto";
import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import {
  BENCHMARK_SET_VERSION,
  GEMINI_META_MODEL,
  REVIEW_FULL_PROMPT_SYSTEM,
  REVIEW_PROMPT_HASH,
  REVIEW_PROMPT_NAME,
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM_INSTRUCTION as LATEST_REVIEW_SYSTEM_INSTRUCTION,
  buildPdfFallbackText,
  compactAggregateForStorage,
  expectedReviewModelName,
  extractMetadata as extractLatestMetadata,
  generateCompatReview,
  normalizeReviewPipelineMode,
  recalibrateStoredAggregateWithComparators,
  v15ComparatorCalibrationForStorage,
  type ComparatorContextSelector,
  type ReviewPipelineMode,
  type ReviewComparatorContextItem,
  type ReviewInput,
  type ReviewModel,
} from "../lib/reviewEngineCompat";
import { BENCHMARK_PROFILE_CLUSTERING_V9_PROMPT } from "../lib/prompts/benchmarkCalibratedV9";

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI-powered chat replies.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

const GPT_MODEL = "gpt-5.4-pro";

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

const router = Router();
const recentSubmissions = new Map<string, Promise<{ paper: typeof papersTable.$inferSelect; review: typeof reviewsTable.$inferSelect | null }>>();

function parseJsonObject(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string | null): any[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonValue(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return JSON.parse(text.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  }
  throw new Error("Model response did not contain valid JSON.");
}

function sourceHashFor(source: any): string | null {
  if (!source?.type || typeof source.data !== "string") return null;
  const normalized = source.type === "url" ? source.data.trim() : source.data;
  if (!normalized) return null;
  return createHash("sha256")
    .update(source.type)
    .update("\0")
    .update(normalized)
    .digest("hex");
}

function duplicateKey(paper: typeof papersTable.$inferSelect) {
  const sourceHash = (paper as any).sourceHash;
  if (sourceHash) return `source:${paper.authorId}:${sourceHash}:${paper.modelName ?? ""}`;
  return [
    "meta",
    paper.authorId,
    paper.title,
    paper.paperAuthors ?? "",
    paper.modelName ?? "",
  ].join("\0").toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupePapers<T extends typeof papersTable.$inferSelect>(papers: T[]): T[] {
  const seen = new Set<string>();
  return papers.filter((paper) => {
    const key = duplicateKey(paper);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitAuthorNamesForMetadata(value: string) {
  return value
    .split(/\s*(?:;|\band\b|,(?=\s*[A-Z][A-Za-z.'-]+(?:\s|$)))\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);
}

function requireAdmin(req: any, res: any): boolean {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (!ADMIN_EMAIL || req.user.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function existingLogicalSubmission(
  authorId: string,
  title: string,
  paperAuthors: string,
  modelName: string,
) {
  const [paper] = await db.select().from(papersTable).where(
    and(
      eq(papersTable.authorId, authorId),
      eq(papersTable.title, title),
      eq(papersTable.paperAuthors, paperAuthors),
      eq(papersTable.modelName, modelName),
    ),
  ).orderBy(desc(papersTable.createdAt));
  if (!paper) return null;
  const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
  return { paper, review: review || null };
}

async function existingSourceSubmission(authorId: string, sourceHash: string, modelName: string) {
  const userPapers = await db.select().from(papersTable).where(
    and(
      eq(papersTable.authorId, authorId),
      eq(papersTable.modelName, modelName),
    ),
  ).orderBy(desc(papersTable.createdAt));
  if (userPapers.length === 0) return null;

  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.modelName, modelName));
  const reviewByPaper = new Map(reviews.map((review) => [review.paperId, review]));
  for (const paper of userPapers) {
    const review = reviewByPaper.get(paper.id);
    const ledger = parseJsonObject(review?.coverageLedgerJson ?? null);
    if (ledger?.submissionSourceHash === sourceHash) {
      return { paper, review: review || null };
    }
  }
  return null;
}

function addSubmissionCostControls(reviewValues: Record<string, any>, sourceHash: string | null) {
  const ledger = parseJsonObject(reviewValues.coverageLedgerJson ?? null) ?? {};
  reviewValues.coverageLedgerJson = JSON.stringify({
    ...ledger,
    submissionSourceHash: sourceHash,
    retryPolicy: {
      modelCallAttempts: Number(process.env.SCIREVIEW_MODEL_CALL_ATTEMPTS || 2),
      passGenerationAttempts: Number(process.env.SCIREVIEW_PASS_GENERATION_ATTEMPTS || 1),
      replacementPassAttempts: Number(process.env.SCIREVIEW_REPLACEMENT_PASS_ATTEMPTS || 1),
      automaticWholePaperBrowserRetries: 0,
      saveFallbackWhenAtLeastOnePassSucceeds: true,
    },
  });
  return reviewValues;
}

function submissionErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message && message !== "Error" && message !== "[object Object]") return message;
  const cause = err instanceof Error ? err.cause : null;
  if (cause instanceof Error && cause.message && cause.message !== "Error") return cause.message;
  return "Unknown server error while creating this review. The API logged the full error; retry after the current deploy, or check Railway logs if it repeats.";
}

const COMPARATOR_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "over", "the", "to", "via", "with", "within", "without", "paper", "review",
  "study", "using", "through", "toward", "towards",
]);

function normalizeComparatorTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparatorTokens(value: string) {
  return new Set(
    normalizeComparatorTitle(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !COMPARATOR_STOP_WORDS.has(token))
      .slice(0, 2000),
  );
}

function tokenOverlapScore(sourceTokens: Set<string>, candidateText: string) {
  if (sourceTokens.size === 0) return 0;
  const candidateTokens = comparatorTokens(candidateText);
  if (candidateTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(sourceTokens.size * candidateTokens.size);
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const source = item as Record<string, unknown>;
        return String(source.input ?? source.construction ?? source.output ?? source.name ?? "").trim();
      }).filter(Boolean)
    : [];
}

function compactLedger(value: any) {
  if (!value || typeof value !== "object") return null;
  const canonicalInput = value.input && typeof value.input === "object" ? value.input : null;
  const canonicalConstruction = value.construction && typeof value.construction === "object" ? value.construction : null;
  const canonicalOutput = value.output && typeof value.output === "object" ? value.output : null;
  const outputsSource = canonicalOutput?.outputs ?? value.outputs;
  const outputs = Array.isArray(outputsSource)
    ? outputsSource
        .map((item: any) => {
          if (typeof item === "string") return { output: item.slice(0, 700) };
          if (!item || typeof item !== "object") return null;
          return {
            output: typeof item.output === "string" ? item.output.slice(0, 700) : "",
            inputsUsed: safeStringArray(item.inputsUsed ?? item.dependsOnInputs).slice(0, 5),
            constructionsUsed: safeStringArray(item.constructionsUsed ?? item.dependsOnConstructions).slice(0, 5),
            dependsOnInputs: safeStringArray(item.inputsUsed ?? item.dependsOnInputs).slice(0, 5),
            dependsOnConstructions: safeStringArray(item.constructionsUsed ?? item.dependsOnConstructions).slice(0, 5),
            externalContextIfAny: typeof item.externalContextIfAny === "string" ? item.externalContextIfAny.slice(0, 500) : "",
            support: typeof item.support === "string" ? item.support.slice(0, 500) : "",
            validity: typeof item.validity === "string" ? item.validity.slice(0, 500) : "",
            centrality: typeof item.centrality === "string" ? item.centrality : "",
          };
        })
        .filter((item: any) => item?.output)
        .slice(0, 6)
    : [];
  return {
    primitiveInputs: safeStringArray(canonicalInput?.primitiveInputs ?? value.primitiveInputs).slice(0, 5),
    introducedConstructions: safeStringArray(canonicalConstruction?.introducedConstructions ?? value.introducedConstructions).slice(0, 5),
    outputs,
    whyOutputsMatter: typeof canonicalOutput?.whyOutputsMatter === "string" ? canonicalOutput.whyOutputsMatter.slice(0, 700) : typeof value.whyOutputsMatter === "string" ? value.whyOutputsMatter.slice(0, 700) : "",
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : [canonicalInput?.assessment, canonicalConstruction?.assessment, canonicalOutput?.assessment].filter(Boolean).join("\n\n").slice(0, 700),
  };
}

function compactCentralOutputDependency(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    centralOutput: typeof value.centralOutput === "string" ? value.centralOutput.slice(0, 700) : "",
    dependsOnPrimitiveInputs: safeStringArray(value.dependsOnPrimitiveInputs).slice(0, 6),
    dependsOnIntroducedConstructions: safeStringArray(value.dependsOnIntroducedConstructions).slice(0, 6),
    weakestDependency: typeof value.weakestDependency === "string" ? value.weakestDependency.slice(0, 500) : "",
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : "",
  };
}

function compactOutputValidityAssessment(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    knownResultRecoveries: safeStringArray(value.knownResultRecoveries).slice(0, 6),
    novelPredictionsOrConstraints: safeStringArray(value.novelPredictionsOrConstraints).slice(0, 6),
    failedOutputsOrConstraints: safeStringArray(value.failedOutputsOrConstraints).slice(0, 6),
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : "",
  };
}

function comparatorMetadata(review: typeof reviewsTable.$inferSelect | null) {
  const parsed = review ? parseJsonObject(review.coverageLedgerJson) : null;
  const aggregateFromField = review ? parseJsonObject((review as any).aggregateMetaJson ?? null) : null;
  const aggregate = parsed?.aggregate && typeof parsed.aggregate === "object" ? parsed.aggregate : null;
  const comparatorCalibration = parsed?.comparatorCalibration ?? aggregate?.comparatorCalibration ?? null;
  const contributionArchetype = parsed?.contributionArchetype ?? aggregate?.contributionArchetype ?? null;
  const comparatorProfile =
    parsed?.organicCohortProfile ??
    parsed?.comparatorProfile ??
    aggregate?.comparatorProfile ??
    aggregateFromField?.organicCohortProfile ??
    aggregateFromField?.comparatorProfile ??
    null;
  const inputConstructionOutputLedger =
    compactLedger(
      parsed?.inputConstructionOutputAssessment ??
        parsed?.inputConstructionOutputLedger ??
        aggregate?.inputConstructionOutputAssessment ??
        aggregate?.inputConstructionOutputLedger ??
        aggregateFromField?.inputConstructionOutputAssessment ??
        aggregateFromField?.inputConstructionOutputLedger,
    );
  const centralOutputDependency =
    compactCentralOutputDependency(parsed?.centralOutputDependency ?? aggregate?.centralOutputDependency ?? comparatorProfile?.centralOutputDependency);
  const outputValidityAssessment =
    compactOutputValidityAssessment(parsed?.outputValidityAssessment ?? aggregate?.outputValidityAssessment ?? comparatorProfile?.outputValidityAssessment);

  return {
    contributionArchetype,
    inputConstructionOutputLedger,
    centralOutputDependency,
    outputValidityAssessment,
    centralClaim: review?.centralClaim || parsed?.centralClaim || aggregate?.finalCentralClaim || null,
    summary: parsed?.scientificReview || review?.summary || aggregate?.finalSummary || null,
    classification: review?.bestClassification || aggregate?.finalClassification || null,
    localCohort: parsed?.localCohort || parsed?.finalLocalCohort || aggregate?.finalLocalCohort || aggregateFromField?.localCohort || aggregateFromField?.finalLocalCohort || comparatorProfile?.localCohort || null,
    comparisonCohort: parsed?.comparisonCohort || parsed?.finalComparisonCohort || aggregate?.finalComparisonCohort || null,
    score: parsed?.intrinsicScore ?? parsed?.finalScore ?? comparatorCalibration?.finalPublicScoreBand?.median ?? review?.overallIntrinsicScore ?? review?.score ?? null,
    frameworkConditionality: parsed?.technicalAssessment?.frameworkDependence?.level || parsed?.frameworkConditionalityLevel || comparatorProfile?.frameworkConditionality || null,
    comparatorSearchSummary: comparatorProfile?.comparatorSearchSummary || null,
    canonicalClusterLabel: parsed?.canonicalClusterLabel || parsed?.benchmarkCluster?.canonicalClusterLabel || aggregate?.canonicalClusterLabel || aggregateFromField?.canonicalClusterLabel || null,
    clusterVersion: parsed?.clusterVersion || aggregate?.clusterVersion || aggregateFromField?.clusterVersion || null,
    clusterFeatureTags: safeStringArray(comparatorProfile?.clusterFeatureTags),
    benchmarkSetCandidate: Boolean(parsed?.benchmarkSetCandidate),
    benchmarkSetVersion: parsed?.benchmarkSetVersion || comparatorCalibration?.benchmarkSetVersion || null,
    comparatorCalibrationStatus: parsed?.comparatorCalibrationStatus || comparatorCalibration?.comparatorCalibrationStatus || null,
    calibratedScoreBand: comparatorCalibration?.finalPublicScoreBand ?? aggregate?.finalScoreBand ?? aggregateFromField?.finalScoreBand ?? null,
    explanatoryDeltaAssessment: parsed?.explanatoryDeltaAssessment || comparatorCalibration?.explanatoryDeltaAssessment || null,
  };
}

async function selectComparatorContextForProfile(
  profile: Parameters<ComparatorContextSelector>[0],
  excludePaperId?: string,
) {
  const sourceText = [
    profile.localCohort,
    profile.primaryCohort,
    profile.adjacentBroadCohort,
    profile.contributionArchetype?.primary,
    profile.contributionArchetype?.secondary,
    ...(Array.isArray(profile.primitiveInputs) ? profile.primitiveInputs : []),
    ...(Array.isArray(profile.introducedConstructions) ? profile.introducedConstructions : []),
    ...(Array.isArray(profile.outputs) ? profile.outputs : []),
    ...(Array.isArray(profile.clusterFeatureTags) ? profile.clusterFeatureTags : []),
    profile.comparatorSearchSummary,
  ].filter(Boolean).join("\n");
  const sourceTokens = comparatorTokens(sourceText);
  if (sourceTokens.size === 0) return [];

  const existingPapers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
  if (existingPapers.length <= 4) return [];
  const reviews = await db.select().from(reviewsTable);
  const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));

  const candidates = existingPapers
    .map((paper) => {
      if (paper.id === excludePaperId) return null;
      const review = reviewMap.get(paper.id) ?? null;
      if (!review) return null;
      const paperTitle = paper.title || "";
      const candidateTitle = normalizeComparatorTitle(paperTitle);
      if (!candidateTitle) return null;

      const metadata = comparatorMetadata(review);
      const subfields = safeStringArray(paper.subfields);
      const candidateText = [
        paperTitle,
        paper.field,
        subfields.join(" "),
        metadata.comparisonCohort,
        metadata.classification,
        metadata.centralClaim,
        metadata.summary,
        metadata.localCohort,
        metadata.canonicalClusterLabel,
        metadata.clusterFeatureTags.join(" "),
        metadata.inputConstructionOutputLedger?.primitiveInputs.join(" "),
        metadata.inputConstructionOutputLedger?.introducedConstructions.join(" "),
        metadata.inputConstructionOutputLedger?.outputs.map((item: any) => item.output).join(" "),
      ].filter(Boolean).join("\n");

      const overlap = tokenOverlapScore(sourceTokens, candidateText);
      const sparseDatabase = existingPapers.length <= 15;
      if (overlap <= (sparseDatabase ? 0.08 : 0.02)) return null;

      return {
        rankScore: overlap,
        isBenchmarkCandidate: metadata.benchmarkSetCandidate,
        item: {
          comparatorId: "",
          sitePaperId: paper.id,
          title: paperTitle,
          field: paper.field || null,
          subfields,
          score: typeof metadata.score === "number" ? metadata.score : null,
          classification: metadata.classification,
          localCohort: metadata.localCohort,
          comparisonCohort: metadata.comparisonCohort,
          canonicalClusterLabel: metadata.canonicalClusterLabel,
          clusterVersion: metadata.clusterVersion,
          clusterFeatureTags: metadata.clusterFeatureTags,
          contributionArchetype: metadata.contributionArchetype ?? undefined,
          centralClaim: metadata.centralClaim ? String(metadata.centralClaim).slice(0, 900) : null,
          summary: metadata.summary ? String(metadata.summary).slice(0, 900) : null,
          inputConstructionOutputLedger: metadata.inputConstructionOutputLedger as any,
          frameworkConditionality: metadata.frameworkConditionality,
          comparatorSearchSummary: metadata.comparatorSearchSummary,
          benchmarkSetVersion: metadata.benchmarkSetVersion,
          comparatorCalibrationStatus: metadata.comparatorCalibrationStatus,
          calibratedScoreBand: metadata.calibratedScoreBand,
          explanatoryDeltaAssessment: metadata.explanatoryDeltaAssessment,
        } satisfies ReviewComparatorContextItem,
      };
    })
    .filter(Boolean) as { rankScore: number; isBenchmarkCandidate: boolean; item: ReviewComparatorContextItem }[];

  const benchmarkCandidates = candidates.filter(
    (candidate) => candidate.isBenchmarkCandidate && candidate.item.benchmarkSetVersion === BENCHMARK_SET_VERSION,
  );
  const candidatePool = benchmarkCandidates.length > 0 ? benchmarkCandidates : [];

  return candidatePool
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 8)
    .map((candidate, index) => ({
      ...candidate.item,
      comparatorId: `C${index + 1}`,
    }));
}

const selectComparatorContext: ComparatorContextSelector = async (profile) => selectComparatorContextForProfile(profile);

function benchmarkProfileForClustering(
  paper: typeof papersTable.$inferSelect,
  review: typeof reviewsTable.$inferSelect,
  coverageLedger: Record<string, any>,
) {
  const aggregate = coverageLedger.aggregate && typeof coverageLedger.aggregate === "object"
    ? coverageLedger.aggregate
    : null;
  const comparatorProfile = coverageLedger.organicCohortProfile ?? coverageLedger.comparatorProfile ?? aggregate?.comparatorProfile ?? null;
  const ico = compactLedger(
    coverageLedger.inputConstructionOutputAssessment ??
      coverageLedger.inputConstructionOutputLedger ??
      aggregate?.inputConstructionOutputAssessment ??
      aggregate?.inputConstructionOutputLedger,
  );
  return {
    paperId: paper.id,
    title: paper.title,
    localCohort: coverageLedger.localCohort ?? coverageLedger.finalLocalCohort ?? aggregate?.finalLocalCohort ?? comparatorProfile?.localCohort ?? "",
    broadField: paper.field ?? coverageLedger.broadField ?? "",
    subfields: safeStringArray(paper.subfields),
    contributionArchetype: coverageLedger.contributionArchetype ?? aggregate?.contributionArchetype ?? comparatorProfile?.contributionArchetype ?? null,
    inputConstructionOutputLedger: ico,
    frameworkConditionality: coverageLedger.technicalAssessment?.frameworkDependence?.level ?? comparatorProfile?.frameworkConditionality ?? coverageLedger.frameworkConditionalityLevel ?? null,
    score: review.overallIntrinsicScore ?? review.score ?? null,
    classification: review.bestClassification ?? aggregate?.finalClassification ?? null,
    strongestObjection: review.strongestObjection ?? aggregate?.strongestObjection ?? "",
    comparatorSearchSummary: comparatorProfile?.comparatorSearchSummary ?? "",
    clusterFeatureTags: safeStringArray(comparatorProfile?.clusterFeatureTags),
  };
}

// GET /api/papers/system-prompt — return the review system prompt
router.get("/papers/system-prompt", (_req, res) => {
  res.json({
    prompt: LATEST_REVIEW_SYSTEM_INSTRUCTION,
    fullPromptSystem: REVIEW_FULL_PROMPT_SYSTEM,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptName: REVIEW_PROMPT_NAME,
    promptHash: REVIEW_PROMPT_HASH,
    defaultReviewMode: "benchmark-ingestion",
    benchmarkSetVersion: BENCHMARK_SET_VERSION,
  });
});

// POST /api/papers/benchmark-clusters — admin-only organic clustering before comparator backfill
router.post("/papers/benchmark-clusters", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const includeAll = req.body?.includeAll === true;
    const benchmarkSetVersion =
      typeof req.body?.benchmarkSetVersion === "string" && req.body.benchmarkSetVersion.trim()
        ? req.body.benchmarkSetVersion.trim()
        : BENCHMARK_SET_VERSION;
    const clusterVersion =
      typeof req.body?.clusterVersion === "string" && req.body.clusterVersion.trim()
        ? req.body.clusterVersion.trim()
        : `v11-central-output-profile-${benchmarkSetVersion}`;

    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));
    const profiles: ReturnType<typeof benchmarkProfileForClustering>[] = [];

    for (const paper of papers) {
      const review = reviewMap.get(paper.id);
      if (!review) continue;
      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      if (!coverageLedger) continue;
      if (coverageLedger.promptVersion !== REVIEW_PROMPT_VERSION) continue;
      if (!includeAll && !coverageLedger.benchmarkSetCandidate) continue;
      profiles.push(benchmarkProfileForClustering(paper, review, coverageLedger));
    }

    if (profiles.length < 2) {
      res.status(400).json({ error: "Need at least two v11 benchmark profiles to cluster.", profileCount: profiles.length });
      return;
    }

    const response = await (geminiAI.models.generateContent as any)({
      model: GEMINI_META_MODEL,
      contents: [{
        role: "user",
        parts: [{ text: JSON.stringify({ benchmarkSetVersion, clusterVersion, profiles }, null, 2) }],
      }],
      config: {
        systemInstruction: BENCHMARK_PROFILE_CLUSTERING_V9_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
      },
    });
    const parsed = extractJsonValue(response.text ?? "");
    const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
    const clusterByPaperId = new Map<string, any>();

    clusters.forEach((cluster: any, index: number) => {
      const clusterId = cluster.benchmarkClusterId || cluster.clusterId || `cluster-${index + 1}`;
      const includedIds = Array.isArray(cluster.includedPaperIds) ? cluster.includedPaperIds : [];
      for (const paperId of includedIds) {
        if (typeof paperId === "string") {
          clusterByPaperId.set(paperId, { ...cluster, benchmarkClusterId: clusterId });
        }
      }
    });

    let updated = 0;
    for (const paper of papers) {
      const cluster = clusterByPaperId.get(paper.id);
      if (!cluster) continue;
      const review = reviewMap.get(paper.id);
      if (!review) continue;
      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      if (!coverageLedger) continue;
      const updatedLedger = {
        ...coverageLedger,
        benchmarkSetCandidate: true,
        benchmarkSetVersion,
        clusterVersion,
        benchmarkClusterId: cluster.benchmarkClusterId,
        canonicalClusterLabel: cluster.canonicalClusterLabel ?? null,
        localCohortAliases: cluster.localCohortAliases ?? [],
        benchmarkCluster: {
          benchmarkClusterId: cluster.benchmarkClusterId,
          canonicalClusterLabel: cluster.canonicalClusterLabel ?? null,
          clusterDescription: cluster.clusterDescription ?? "",
          localCohortAliases: cluster.localCohortAliases ?? [],
          centralComparatorPapers: cluster.centralComparatorPapers ?? [],
          boundaryCases: cluster.boundaryCases ?? [],
          nearbyClusters: cluster.nearbyClusters ?? [],
          rationale: cluster.whyTheseBelongTogether ?? cluster.rationale ?? "",
        },
        clusteredAt: new Date().toISOString(),
      };
      await db.update(reviewsTable)
        .set({ coverageLedgerJson: JSON.stringify(updatedLedger) })
        .where(eq(reviewsTable.id, review.id));
      updated += 1;
    }

    res.json({
      benchmarkSetVersion,
      clusterVersion,
      profileCount: profiles.length,
      clusterCount: clusters.length,
      updated,
      clusters,
      singletonOrOutlierPapers: parsed?.singletonOrOutlierPapers ?? [],
      globalNotes: parsed?.globalNotes ?? "",
    });
  } catch (err: any) {
    logger.error({ err }, "Benchmark clustering failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/comparator-backfill — admin-only recalibration after a batch has populated the database
router.post("/papers/comparator-backfill", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const includeAll = req.body?.includeAll === true;
    const benchmarkSetVersion =
      typeof req.body?.benchmarkSetVersion === "string" && req.body.benchmarkSetVersion.trim()
        ? req.body.benchmarkSetVersion.trim()
        : BENCHMARK_SET_VERSION;
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));
    let updated = 0;
    let skipped = 0;
    const errors: { paperId: string; title: string; error: string }[] = [];

    for (const paper of papers) {
      const review = reviewMap.get(paper.id);
      if (!review) { skipped += 1; continue; }

      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      const aggregateMeta = parseJsonObject((review as any).aggregateMetaJson ?? null);
      const aggregate = aggregateMeta ?? coverageLedger?.aggregate ?? null;
      const promptVersion = coverageLedger?.promptVersion ?? "";
      const benchmarkSetCandidate = Boolean(coverageLedger?.benchmarkSetCandidate);
      if (promptVersion !== REVIEW_PROMPT_VERSION || !aggregate?.comparatorProfile || (!includeAll && !benchmarkSetCandidate)) {
        skipped += 1;
        continue;
      }

      try {
        const profileForSelection = {
          ...aggregate.comparatorProfile,
          localCohort: coverageLedger?.finalLocalCohort || coverageLedger?.localCohort || aggregate.comparatorProfile.localCohort,
          clusterFeatureTags: [
            ...safeStringArray(aggregate.comparatorProfile.clusterFeatureTags),
            coverageLedger?.canonicalClusterLabel,
          ].filter(Boolean),
        };
        const comparatorContext = await selectComparatorContextForProfile(profileForSelection, paper.id);
        const { aggregate: updatedAggregate, thinkingText } = await recalibrateStoredAggregateWithComparators(
          aggregate,
          comparatorContext,
        );
        const versionedAggregate = {
          ...updatedAggregate,
          comparatorCalibration: {
            ...updatedAggregate.comparatorCalibration,
            benchmarkSetVersion,
          },
        };
        const storedVersionedAggregate = compactAggregateForStorage(versionedAggregate);
        const storedComparatorCalibration = v15ComparatorCalibrationForStorage(versionedAggregate.comparatorCalibration);
        const updatedCoverageLedger = {
          ...coverageLedger,
          nearestComparators: storedVersionedAggregate.nearestComparators,
          externalComparatorSuggestions: storedVersionedAggregate.externalComparatorSuggestions,
          publicComparatorSummary: storedVersionedAggregate.publicComparatorSummary,
          adminComparatorNotes: storedVersionedAggregate.adminComparatorNotes,
          comparatorProfile: storedVersionedAggregate.comparatorProfile,
          comparatorCalibration: storedComparatorCalibration,
          comparatorCalibrationStatus: storedComparatorCalibration.comparatorCalibrationStatus,
          explanatoryDeltaAssessment: storedComparatorCalibration.explanatoryDeltaAssessment,
          comparatorsNeedingRecalibration: storedComparatorCalibration.comparatorsNeedingRecalibration,
          blindIntrinsicScoreBand: storedVersionedAggregate.blindIntrinsicScoreBand,
          comparatorCalibratedFinalScoreBand: storedVersionedAggregate.finalScoreBand,
          aggregate: storedVersionedAggregate,
          finalComparisonCohort: storedVersionedAggregate.finalComparisonCohort,
          scoreStability: storedVersionedAggregate.scoreStability,
          benchmarkSetCandidate: true,
          benchmarkSetVersion,
          backfilledAt: new Date().toISOString(),
        };
        const finalScore = versionedAggregate.finalScoreBand.median;
        await db.update(reviewsTable)
          .set({
            score: finalScore,
            overallIntrinsicScore: finalScore,
            bestClassification: versionedAggregate.finalClassification,
            finalJudgment: versionedAggregate.publicOneParagraphVerdict,
            coverageLedgerJson: JSON.stringify(updatedCoverageLedger),
            thinkingText: [review.thinkingText, thinkingText].filter(Boolean).join("\n\n---\n\n") || review.thinkingText,
          })
          .where(eq(reviewsTable.id, review.id));
        await db.update(papersTable)
          .set({ score: finalScore })
          .where(eq(papersTable.id, paper.id));
        updated += 1;
      } catch (err: any) {
        errors.push({ paperId: paper.id, title: paper.title, error: err?.message ?? String(err) });
      }
    }

    res.json({ updated, skipped, errors });
  } catch (err: any) {
    logger.error({ err }, "Comparator backfill failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/export — download all reviews as structured JSON (model output only)
router.get("/papers/export", async (req, res) => {
  try {
    const includeSystemPrompt = req.query.includeSystemPrompt === "true";
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));

    const exported = papers.map(p => {
      const r = reviewMap.get(p.id);
      const coverageLedger = r ? parseJsonObject(r.coverageLedgerJson) : null;
      if (r && coverageLedger?.reviewObjectVersion === "v16.7-canonical") {
        const blindPassReviewsFromField = parseJsonArray((r as any).individualReviewsJson ?? null);
        const blindPassReviews = Array.isArray(coverageLedger.blindPassReviews)
          ? coverageLedger.blindPassReviews
          : Array.isArray(blindPassReviewsFromField)
            ? blindPassReviewsFromField
            : [];
        const comparatorCalibrationRan =
          coverageLedger.comparatorCalibrationStatus === "applied" ||
          coverageLedger.comparatorCalibrationStatus === "weak" ||
          (typeof coverageLedger.calibrationAdjustment === "number" && coverageLedger.calibrationAdjustment !== 0);
        const canonicalReview: Record<string, any> = {
          reviewObjectVersion: coverageLedger.reviewObjectVersion,
          promptVersion: coverageLedger.promptVersion ?? REVIEW_PROMPT_VERSION,
          promptName: coverageLedger.promptName ?? REVIEW_PROMPT_NAME,
          promptHash: coverageLedger.promptHash ?? REVIEW_PROMPT_HASH,
          pipelineMode: coverageLedger.pipelineMode ?? null,
          benchmarkSetCandidate: coverageLedger.benchmarkSetCandidate ?? false,
          benchmarkSetVersion: coverageLedger.benchmarkSetVersion ?? null,
          extractionMethod: coverageLedger.extractionMethod ?? null,
          pdfVisibleFallbackUsed: coverageLedger.pdfVisibleFallbackUsed ?? false,
          blindingStrength: coverageLedger.blindingStrength ?? "strong",
          comparisonCohort: coverageLedger.comparisonCohort ?? null,
          localCohort: coverageLedger.localCohort ?? null,
          broadField: coverageLedger.broadField ?? null,
          specialtyField: coverageLedger.specialtyField ?? null,
          subfields: coverageLedger.subfields ?? [],
          paperType: coverageLedger.paperType ?? null,
          centralClaim: coverageLedger.centralClaim ?? r.centralClaim ?? null,
          scientificReview: coverageLedger.scientificReview ?? null,
          contributionArchetype: coverageLedger.contributionArchetype ?? null,
          inputStrengthScore: coverageLedger.inputStrengthScore ?? null,
          constructionStrengthScore: coverageLedger.constructionStrengthScore ?? null,
          outputStrengthScore: coverageLedger.outputStrengthScore ?? null,
          subscoreRationale: coverageLedger.subscoreRationale ?? null,
          inputConstructionOutputAssessment: coverageLedger.inputConstructionOutputAssessment ?? null,
          technicalAssessment: coverageLedger.technicalAssessment ?? null,
          failureAnalysis: coverageLedger.failureAnalysis ?? null,
          organicCohortProfile: coverageLedger.organicCohortProfile ?? null,
          intrinsicScore: coverageLedger.intrinsicScore ?? coverageLedger.finalScore ?? r.overallIntrinsicScore ?? r.score ?? null,
          scoreConfidence: coverageLedger.scoreConfidence ?? null,
          scoreCappingReason: coverageLedger.scoreCappingReason ?? "",
          scoreAdjustmentReason: coverageLedger.scoreAdjustmentReason ?? "",
          bestClassification: coverageLedger.bestClassification ?? r.bestClassification ?? null,
          promptMetadata: {
            modelName: coverageLedger.modelName ?? r.modelName,
            passModel: coverageLedger.passModel ?? null,
            adjudicatorModel: coverageLedger.adjudicatorModel ?? null,
            passCount: coverageLedger.passCount ?? null,
            validPassCount: coverageLedger.validPassCount ?? null,
            blindPassScores: coverageLedger.blindPassScores ?? [],
            blindPassSpread: coverageLedger.blindPassSpread ?? coverageLedger.passDisagreement ?? null,
            passDisagreement: coverageLedger.passDisagreement ?? coverageLedger.blindPassSpread ?? null,
            scoreStability: coverageLedger.scoreStability ?? null,
            adjudicatorStatus: coverageLedger.adjudicatorStatus ?? null,
            diagnosticBaselineScore: coverageLedger.diagnosticBaselineScore ?? null,
            diagnosticBaselineDelta: coverageLedger.diagnosticBaselineDelta ?? null,
            comparatorCalibrationStatus: coverageLedger.comparatorCalibrationStatus ?? null,
            ...(comparatorCalibrationRan ? { calibrationAdjustment: coverageLedger.calibrationAdjustment ?? 0 } : {}),
          },
          blindPassReviews,
        };
        return {
          paper: {
            id: p.id,
            title: p.title,
            paperAuthors: p.paperAuthors,
            dateMetadata: p.dateMetadata,
            field: p.field,
            subfields: p.subfields,
            createdAt: p.createdAt,
            pdfUrl: p.pdfUrl,
          },
          review: canonicalReview,
        };
      }
      const aggregateFromField = r ? parseJsonObject((r as any).aggregateMetaJson ?? null) : null;
      const aggregate = coverageLedger?.aggregate && typeof coverageLedger.aggregate === "object"
        ? coverageLedger.aggregate
        : aggregateFromField;
      const comparatorCalibration =
        coverageLedger?.comparatorCalibration ??
        aggregate?.comparatorCalibration ??
        null;
      const adjudication =
        coverageLedger?.adjudication ??
        aggregate?.adjudication ??
        coverageLedger?.reviewPassComparison ??
        null;
      const comparatorProfile =
        coverageLedger?.comparatorProfile ??
        aggregate?.comparatorProfile ??
        null;
      const finalScoreBand =
        coverageLedger?.comparatorCalibratedFinalScoreBand ??
        aggregate?.finalScoreBand ??
        null;
      const inputConstructionOutputLedger =
        coverageLedger?.inputConstructionOutputAssessment ??
        coverageLedger?.inputConstructionOutputLedger ??
        aggregate?.inputConstructionOutputAssessment ??
        aggregate?.inputConstructionOutputLedger ??
        null;
      const isV15Review =
        coverageLedger?.schemaVersion === "v15" ||
        String(coverageLedger?.promptVersion ?? "").startsWith("v15");
      const isCanonicalIcoReview =
        /^v16(?:\.|\b|-)/.test(String(coverageLedger?.schemaVersion ?? "")) ||
        /^v16(?:\.|\b|-)/.test(String(coverageLedger?.promptVersion ?? ""));
      const comparatorCalibrationStatus =
        coverageLedger?.comparatorCalibrationStatus ??
        comparatorCalibration?.comparatorCalibrationStatus ??
        null;
      const calibrationAdjustment = Number(comparatorCalibration?.calibrationAdjustment ?? 0);
      const comparatorCalibrationApplied = Boolean(
        comparatorCalibration &&
          (comparatorCalibrationStatus === "applied" ||
            comparatorCalibrationStatus === "weak" ||
            (Number.isFinite(calibrationAdjustment) && Math.abs(calibrationAdjustment) > 0)),
      );
      const visibleComparatorCalibration = comparatorCalibrationApplied ? comparatorCalibration : null;
      const centralOutputDependency =
        isV15Review || isCanonicalIcoReview
          ? undefined
          : coverageLedger?.centralOutputDependency ??
            aggregate?.centralOutputDependency ??
            comparatorProfile?.centralOutputDependency ??
            null;
      const outputValidityAssessment =
        isV15Review || isCanonicalIcoReview
          ? undefined
          : coverageLedger?.outputValidityAssessment ??
            aggregate?.outputValidityAssessment ??
            comparatorProfile?.outputValidityAssessment ??
            null;
      return {
        paper: {
          id: p.id,
          title: p.title,
          paperAuthors: p.paperAuthors,
          dateMetadata: p.dateMetadata,
          field: p.field,
          subfields: p.subfields,
          createdAt: p.createdAt,
          pdfUrl: p.pdfUrl,
        },
        review: r ? {
          promptVersion: coverageLedger?.promptVersion ?? REVIEW_PROMPT_VERSION,
          pipelineMode: coverageLedger?.pipelineMode ?? null,
          benchmarkSetCandidate: coverageLedger?.benchmarkSetCandidate ?? false,
          benchmarkSetVersion: coverageLedger?.benchmarkSetVersion ?? null,
          clusterVersion: coverageLedger?.clusterVersion ?? aggregate?.clusterVersion ?? null,
          canonicalClusterLabel: coverageLedger?.canonicalClusterLabel ?? coverageLedger?.benchmarkCluster?.canonicalClusterLabel ?? aggregate?.canonicalClusterLabel ?? null,
          extractionMethod: coverageLedger?.extractionMethod ?? null,
          pdfVisibleFallbackUsed: coverageLedger?.pdfVisibleFallbackUsed ?? false,
          blindingStrength: coverageLedger?.blindingStrength ?? "strong",
          blindPassScores: adjudication?.individualScores ?? aggregate?.individualScores ?? [],
          passDisagreement: adjudication?.passDisagreement ?? adjudication?.scoreRange ?? aggregate?.passDisagreement ?? null,
          scoreStability: adjudication?.scoreStability ?? aggregate?.scoreStability ?? coverageLedger?.scoreStability ?? null,
          adjudicatorRating: aggregate?.adjudicatorRating ?? coverageLedger?.adjudicatorRating ?? coverageLedger?.blindIntrinsicScoreBand?.median ?? null,
          comparatorCalibrationStatus,
          calibrationAdjustment: comparatorCalibrationApplied ? comparatorCalibration?.calibrationAdjustment ?? null : null,
          finalCalibratedScore: finalScoreBand?.median ?? r.overallIntrinsicScore ?? r.score ?? null,
          localCohort: coverageLedger?.finalLocalCohort ?? coverageLedger?.localCohort ?? aggregate?.finalLocalCohort ?? comparatorProfile?.localCohort ?? null,
          inputStrengthScore: coverageLedger?.inputStrengthScore ?? aggregate?.inputStrengthScore ?? null,
          constructionStrengthScore: coverageLedger?.constructionStrengthScore ?? aggregate?.constructionStrengthScore ?? null,
          outputStrengthScore: coverageLedger?.outputStrengthScore ?? aggregate?.outputStrengthScore ?? null,
          outputReachScore: isV15Review || isCanonicalIcoReview ? undefined : coverageLedger?.outputReachScore ?? aggregate?.outputReachScore ?? null,
          generalizationBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : coverageLedger?.generalizationBreadthScore ?? aggregate?.generalizationBreadthScore ?? null,
          subscoreRationale: coverageLedger?.subscoreRationale ?? aggregate?.subscoreRationale ?? null,
          adjudicatorStatus: coverageLedger?.adjudicatorStatus ?? adjudication?.adjudicatorStatus ?? aggregate?.adjudicatorStatus ?? null,
          diagnosticBaselineScore: coverageLedger?.diagnosticBaselineScore ?? adjudication?.diagnosticBaselineScore ?? aggregate?.diagnosticBaselineScore ?? null,
          diagnosticBaselineDelta: coverageLedger?.diagnosticBaselineDelta ?? adjudication?.diagnosticBaselineDelta ?? aggregate?.diagnosticBaselineDelta ?? null,
          scoreAdjustmentReason: coverageLedger?.scoreAdjustmentReason ?? adjudication?.scoreAdjustmentReason ?? aggregate?.scoreAdjustmentReason ?? null,
          scoringAnomaly: coverageLedger?.scoringAnomaly ?? adjudication?.scoringAnomaly ?? aggregate?.scoringAnomaly ?? null,
          fatalObjectionPresent: adjudication?.fatalObjectionPresent ?? aggregate?.fatalObjectionPresent ?? false,
          fatalObjectionAssessment: adjudication?.fatalObjectionAssessment ?? aggregate?.fatalObjectionAssessment ?? null,
          fatalToSpecificClaimOnly: adjudication?.fatalToSpecificClaimOnly ?? aggregate?.fatalToSpecificClaimOnly ?? false,
          paperFatalError: adjudication?.paperFatalError ?? aggregate?.paperFatalError ?? false,
          contributionInventory: coverageLedger?.contributionInventory ?? adjudication?.contributionInventory ?? aggregate?.contributionInventory ?? [],
          survivingHighValueContributions: coverageLedger?.survivingHighValueContributions ?? adjudication?.survivingHighValueContributions ?? aggregate?.survivingHighValueContributions ?? [],
          failedClaimsExcludedFromScore: coverageLedger?.failedClaimsExcludedFromScore ?? adjudication?.failedClaimsExcludedFromScore ?? aggregate?.failedClaimsExcludedFromScore ?? [],
          survivingContributionScoreBasis: coverageLedger?.survivingContributionScoreBasis ?? adjudication?.survivingContributionScoreBasis ?? aggregate?.survivingContributionScoreBasis ?? null,
          scoreCappingReason: coverageLedger?.scoreCappingReason ?? aggregate?.scoreCappingReason ?? comparatorCalibration?.scoreCappingReason ?? null,
          validationWarnings: {
            subscoreConsistencyWarning: coverageLedger?.subscoreConsistencyWarning ?? aggregate?.subscoreConsistencyWarning ?? adjudication?.subscoreConsistencyWarning ?? null,
            subscoreSaturationWarning: coverageLedger?.subscoreSaturationWarning ?? aggregate?.subscoreSaturationWarning ?? adjudication?.subscoreSaturationWarning ?? false,
          },
          ...(includeSystemPrompt ? { systemPrompt: r.systemPrompt } : {}),
          modelName: r.modelName,
          overallIntrinsicScore: r.overallIntrinsicScore,
          intrinsicScientificMeritScore: isV15Review || isCanonicalIcoReview ? undefined : r.intrinsicScientificMeritScore,
          explanatoryTargetBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : r.explanatoryTargetBreadthScore,
          theorySpaceBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : r.theorySpaceBreadthScore,
          breadthOfImpactScore: isV15Review || isCanonicalIcoReview ? undefined : r.breadthOfImpactScore,
          bestClassification: r.bestClassification,
          centralClaim: r.centralClaim,
          scientificReview: coverageLedger?.scientificReview ?? aggregate?.scientificReview ?? coverageLedger?.finalIntrinsicReview?.scientificReview ?? null,
          summary: isCanonicalIcoReview ? undefined : r.summary,
          correctness: r.correctness,
          novelty: r.novelty,
          noveltyConfidence: r.noveltyConfidence,
          internalTechnicalTraction: r.internalTechnicalTraction,
          economy: r.economy,
          scopeDepth: r.scopeDepth,
          unifyingPower: r.unifyingPower,
          explanatoryTargetBreadth: r.explanatoryTargetBreadth,
          theorySpaceBreadth: r.theorySpaceBreadth,
          establishedResults: r.establishedResults,
          interpretiveClaims: r.interpretiveClaims,
          speculativeClaims: r.speculativeClaims,
          strongestCaseForImportance: r.strongestCaseForImportance,
          strongestObjection: r.strongestObjection,
          assessmentSensitivity: coverageLedger?.assessmentSensitivity ?? aggregate?.assessmentSensitivity ?? null,
          legacyDecisiveCheck: isV15Review || isCanonicalIcoReview ? undefined : r.decisiveCheck,
          finalJudgment: isCanonicalIcoReview ? undefined : r.finalJudgment,
          relatedWork: r.relatedWork,
          coverageLedger: isCanonicalIcoReview ? undefined : coverageLedger,
          contributionArchetype: coverageLedger?.contributionArchetype ?? aggregate?.contributionArchetype ?? null,
          inputConstructionOutputLedger,
          inputConstructionOutputAssessment: inputConstructionOutputLedger,
          centralOutputDependency,
          outputValidityAssessment,
          nearestComparators: comparatorCalibrationApplied ? coverageLedger?.nearestComparators ?? aggregate?.nearestComparators ?? [] : [],
          blindIntrinsicScoreBand: coverageLedger?.blindIntrinsicScoreBand ?? coverageLedger?.aggregate?.blindIntrinsicScoreBand ?? null,
          comparatorCalibration: visibleComparatorCalibration,
          explanatoryDeltaAssessment: comparatorCalibrationApplied
            ? coverageLedger?.explanatoryDeltaAssessment ?? comparatorCalibration?.explanatoryDeltaAssessment ?? null
            : null,
          comparatorsNeedingRecalibration: comparatorCalibrationApplied ? coverageLedger?.comparatorsNeedingRecalibration ?? comparatorCalibration?.comparatorsNeedingRecalibration ?? [] : [],
          comparatorCalibratedFinalScoreBand: comparatorCalibrationApplied ? finalScoreBand : null,
          comparatorProfile: comparatorCalibrationApplied ? comparatorProfile : null,
          externalComparatorSuggestions: coverageLedger?.externalComparatorSuggestions ?? aggregate?.externalComparatorSuggestions ?? [],
          publicComparatorSummary: coverageLedger?.publicComparatorSummary ?? aggregate?.publicComparatorSummary ?? null,
          adminComparatorNotes: coverageLedger?.adminComparatorNotes ?? aggregate?.adminComparatorNotes ?? null,
          reviewPassComparison: adjudication,
          finalIntrinsicReview: isCanonicalIcoReview ? undefined : coverageLedger?.finalIntrinsicReview ?? null,
          adjudication,
          inputGrounding: coverageLedger?.inputGrounding ?? aggregate?.inputGroundingAssessment ?? null,
          inputFundamentality: coverageLedger?.inputFundamentality ?? aggregate?.inputFundamentalityAssessment ?? null,
          frameworkIndependence: coverageLedger?.frameworkIndependence ?? aggregate?.frameworkIndependenceAssessment ?? null,
          hardToVaryAssessment: coverageLedger?.hardToVaryAssessment ?? aggregate?.hardToVaryAssessment ?? null,
          manuscriptOriginalContribution: coverageLedger?.manuscriptOriginalContribution ?? aggregate?.originalContributionAssessment ?? null,
          whatWouldRaiseScore: coverageLedger?.whatWouldRaiseScore ?? aggregate?.whatWouldRaiseScore ?? null,
          whatWouldLowerScore: coverageLedger?.whatWouldLowerScore ?? aggregate?.whatWouldLowerScore ?? null,
          createdAt: r.createdAt,
        } : null,
      };
    });

    res.json({
      exportedAt: new Date().toISOString(),
      promptVersion: REVIEW_PROMPT_VERSION,
      promptName: REVIEW_PROMPT_NAME,
      promptHash: REVIEW_PROMPT_HASH,
      ...(includeSystemPrompt ? { systemPrompt: LATEST_REVIEW_SYSTEM_INSTRUCTION } : {}),
      count: exported.length,
      papers: exported,
    });
  } catch (err: any) {
    logger.error({ err }, "Error exporting papers");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers — list all papers
router.get("/papers", async (req, res) => {
  try {
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select({
      paperId: reviewsTable.paperId,
      summary: reviewsTable.summary,
      centralClaim: reviewsTable.centralClaim,
      finalJudgment: reviewsTable.finalJudgment,
      coverageLedgerJson: reviewsTable.coverageLedgerJson,
    }).from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));
    const papersWithSummary = papers.map(p => {
      const review = reviewMap.get(p.id);
      const ledger = parseJsonObject(review?.coverageLedgerJson ?? null);
      const scientificReview = ledger?.scientificReview ?? null;
      return {
        ...p,
        reviewSummary: scientificReview || review?.summary || null,
        reviewCentralClaim: ledger?.centralClaim || review?.centralClaim || null,
        reviewFinalJudgment: scientificReview || review?.finalJudgment || null,
      };
    });
    res.json({ papers: papersWithSummary });
  } catch (err: any) {
    logger.error({ err }, "Error listing papers");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id — get paper with review
router.get("/papers/:id", async (req, res) => {
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
    res.json({ paper, review: review || null });
  } catch (err: any) {
    logger.error({ err }, "Error getting paper");
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/papers/:id — owner or admin can correct extracted paper metadata
router.patch("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

    const isAdmin = ADMIN_EMAIL && req.user.email === ADMIN_EMAIL;
    if (!isAdmin && paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }

    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const paperAuthors = typeof req.body.paperAuthors === "string" ? req.body.paperAuthors.trim() : "";

    if (!title) { res.status(400).json({ error: "Title is required" }); return; }
    if (title.length > 500) { res.status(400).json({ error: "Title is too long" }); return; }
    if (paperAuthors.length > 1000) { res.status(400).json({ error: "Authors field is too long" }); return; }

    const existingDateMetadata =
      paper.dateMetadata && typeof paper.dateMetadata === "object"
        ? paper.dateMetadata
        : null;

    const [updated] = await db.update(papersTable)
      .set({
        title,
        paperAuthors: paperAuthors || null,
        dateMetadata: existingDateMetadata
          ? {
              ...existingDateMetadata,
              displayedTitle: title,
              displayedAuthors: splitAuthorNamesForMetadata(paperAuthors),
            }
          : null,
      })
      .where(eq(papersTable.id, req.params.id))
      .returning();

    res.json({ paper: updated });
  } catch (err: any) {
    logger.error({ err }, "Error updating paper metadata");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers — submit paper (extracts metadata, generates AI review, stores all)
router.post("/papers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  let submissionKey: string | null = null;
  let resolveSubmission: ((value: { paper: typeof papersTable.$inferSelect; review: typeof reviewsTable.$inferSelect | null }) => void) | undefined;
  let rejectSubmission: ((reason?: unknown) => void) | undefined;
  try {
    const { source } = req.body;
    if (!source?.type || !source?.data) { res.status(400).json({ error: "source.type and source.data are required" }); return; }
    const isAdmin = Boolean(ADMIN_EMAIL && req.user.email === ADMIN_EMAIL);
    const requestedReviewMode: ReviewPipelineMode = normalizeReviewPipelineMode(source.reviewMode);
    const reviewMode: ReviewPipelineMode = isAdmin ? requestedReviewMode : "normal-review";
    const sourceHash = sourceHashFor(source);
    const expectedModelName = expectedReviewModelName(reviewMode);
    submissionKey = sourceHash ? `${req.user.id}:${expectedModelName}:${sourceHash}` : null;
    if (submissionKey && recentSubmissions.has(submissionKey)) {
      res.json(await recentSubmissions.get(submissionKey));
      return;
    }
    if (submissionKey) {
      recentSubmissions.set(submissionKey, new Promise((resolve, reject) => {
        resolveSubmission = resolve;
        rejectSubmission = reject;
      }));
    }

    let paperContent: string;
    let reviewInput: ReviewInput | null = null;
    let submittedPdfUrl: string | null = source.pdfUrl?.trim() || null;
    const submittedDisplayPdf: boolean = !!(source.displayPdf && submittedPdfUrl);
    const selectedModel: ReviewModel = "gemini";
    const metadataHints: { fileName?: string; pdfTitle?: string; pdfAuthor?: string; pdfBase64?: string; mimeType?: string } = {
      fileName: typeof source.fileName === "string" ? source.fileName.trim() : undefined,
    };

    if (source.type === "pdf") {
      const buffer = Buffer.from(source.data, "base64");
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      metadataHints.pdfTitle = typeof parsed.info?.Title === "string" ? parsed.info.Title : undefined;
      metadataHints.pdfAuthor = typeof parsed.info?.Author === "string" ? parsed.info.Author : undefined;
      metadataHints.pdfBase64 = source.data;
      metadataHints.mimeType = "application/pdf";
      paperContent = parsed.text;
      if (!paperContent || paperContent.trim().length < 50) {
        if (selectedModel !== "gemini") {
          res.status(400).json({ error: "Could not extract readable text from PDF. Try submitting as raw text instead." });
          return;
        }
        paperContent = buildPdfFallbackText(metadataHints);
        reviewInput = {
          text: paperContent,
          pdfBase64: source.data,
          mimeType: "application/pdf",
        };
      }
    } else if (source.type === "url") {
      const url = source.data?.trim();
      if (!url) { res.status(400).json({ error: "A valid URL is required." }); return; }
      try { new URL(url); } catch { res.status(400).json({ error: "Invalid URL." }); return; }
      const fetchResp = await fetch(url);
      if (!fetchResp.ok) {
        res.status(400).json({ error: `Could not fetch PDF from URL (${fetchResp.status}). Make sure it is a direct link to a publicly accessible PDF.` });
        return;
      }
      const arrayBuf = await fetchResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      metadataHints.fileName ||= url.split("/").pop()?.split("?")[0];
      metadataHints.pdfTitle = typeof parsed.info?.Title === "string" ? parsed.info.Title : undefined;
      metadataHints.pdfAuthor = typeof parsed.info?.Author === "string" ? parsed.info.Author : undefined;
      metadataHints.pdfBase64 = buffer.toString("base64");
      metadataHints.mimeType = "application/pdf";
      paperContent = parsed.text;
      if (!paperContent || paperContent.trim().length < 50) {
        if (selectedModel !== "gemini") {
          res.status(400).json({ error: "Could not extract readable text from the linked PDF. Try submitting as raw text instead." });
          return;
        }
        paperContent = buildPdfFallbackText(metadataHints);
        reviewInput = {
          text: paperContent,
          pdfBase64: buffer.toString("base64"),
          mimeType: "application/pdf",
        };
      }
      submittedPdfUrl = url;
    } else {
      paperContent = source.data;
    }
    // Strip null bytes and non-printable control characters that break JSON serialisation
    paperContent = paperContent.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

    // Step 1: extract real title and authors (before anonymous review)
    const metadata = await extractLatestMetadata(paperContent, metadataHints);

    const existingBySource = sourceHash
      ? await existingSourceSubmission(req.user.id, sourceHash, expectedModelName)
      : null;
    if (existingBySource?.review) {
      if (resolveSubmission) resolveSubmission(existingBySource);
      if (submissionKey) {
        const key = submissionKey;
        setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
      }
      res.json(existingBySource);
      return;
    }

    const existingByMetadata = await existingLogicalSubmission(
      req.user.id,
      metadata.title,
      metadata.authors,
      expectedModelName,
    );
    if (existingByMetadata?.review) {
      if (resolveSubmission) resolveSubmission(existingByMetadata);
      if (submissionKey) {
        const key = submissionKey;
        setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
      }
      res.json(existingByMetadata);
      return;
    }

    // Step 2: run blind review/adjudication first, then retrieve comparators for calibration
    const { reviewValues, metadata: reviewMetadata } = await generateCompatReview(
      reviewInput ?? paperContent,
      selectedModel,
      undefined,
      { selectComparatorContext, reviewMode },
    );
    addSubmissionCostControls(reviewValues, sourceHash);

    const submitterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    let paper: typeof papersTable.$inferSelect;
    try {
      [paper] = await db.insert(papersTable).values({
        title: metadata.title,
        content: (source.type === "pdf" || source.type === "url") ? `[PDF] ${metadata.title}` : paperContent,
        authorId: req.user.id,
        authorName: submitterName,
        paperAuthors: metadata.authors,
        dateMetadata: metadata.dateMetadata,
        field: reviewMetadata.field,
        subfields: reviewMetadata.subfields,
        score: reviewValues.score,
        modelName: reviewMetadata.modelName,
        pdfUrl: submittedPdfUrl,
        displayPdf: submittedDisplayPdf ? 1 : 0,
      }).returning();
    } catch (insertErr: any) {
      throw insertErr;
    }

    const [review] = await db.insert(reviewsTable).values({
      paperId: paper.id,
      ...reviewValues,
    }).returning();

    const payload = { paper, review };
    if (resolveSubmission) resolveSubmission(payload);
    if (submissionKey) {
      const key = submissionKey;
      setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
    }
    res.json(payload);
  } catch (err: any) {
    if (rejectSubmission) rejectSubmission(err);
    if (submissionKey) {
      recentSubmissions.delete(submissionKey);
    }
    logger.error({ err }, "Error creating paper");
    const message = submissionErrorMessage(err);
    const quotaExhausted =
      /daily request quota reached|generate_requests_per_model_per_day|per_model_per_day|please retry in|exceeded your current quota/i.test(message);
    const transient =
      !quotaExhausted &&
      /transient model error|resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|\b(429|500|502|503|504)\b/i.test(message);
    const retryAfterText = message.match(/retry in\s*([^.;]+)/i)?.[1]?.trim() ?? null;
    res.status(quotaExhausted ? 429 : transient ? 503 : 500).json({
      error: message,
      transient,
      quotaExhausted,
      retryAfterText,
    });
  }
});

// DELETE /api/papers/:id — owner or admin can delete
router.delete("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Not found" }); return; }
    const isAdmin = ADMIN_EMAIL && req.user.email === ADMIN_EMAIL;
    if (!isAdmin && paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.delete(papersTable).where(eq(papersTable.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/papers/:id/view
router.patch("/papers/:id/view", async (req, res) => {
  try {
    await db.execute(`UPDATE papers SET view_count = view_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// GET /api/papers/:id/comments
router.get("/papers/:id/comments", async (req, res) => {
  try {
    const comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.paperId, req.params.id))
      .orderBy(commentsTable.createdAt);
    res.json({ comments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/:id/comments
router.post("/papers/:id/comments", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

    const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [comment] = await db.insert(commentsTable).values({
      paperId: req.params.id,
      authorId: req.user.id,
      authorName: displayName,
      content: content.trim(),
    }).returning();

    await db.execute(`UPDATE papers SET comment_count = comment_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ comment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: format a review into readable text for chat context
function buildReviewContext(review: any, paper: any): string {
  const parts: string[] = [];
  if (paper?.title) parts.push(`PAPER TITLE: ${paper.title}`);
  if (review.centralClaim) parts.push(`CENTRAL CLAIM:\n${review.centralClaim}`);
  if (review.establishedResults) parts.push(`ESTABLISHED RESULTS:\n${review.establishedResults}`);
  if (review.interpretiveClaims) parts.push(`INTERPRETIVE CLAIMS:\n${review.interpretiveClaims}`);
  if (review.speculativeClaims) parts.push(`SPECULATIVE CLAIMS:\n${review.speculativeClaims}`);
  if (review.economy) parts.push(`EXPLANATORY ECONOMY:\n${review.economy}`);
  if (review.explanatoryTargetBreadth) parts.push(`EXPLANATORY TARGET BREADTH:\n${review.explanatoryTargetBreadth}`);
  if (review.theorySpaceBreadth) parts.push(`THEORY SPACE BREADTH:\n${review.theorySpaceBreadth}`);
  if (review.scopeDepth) parts.push(`SCOPE AND DEPTH:\n${review.scopeDepth}`);
  if (review.unifyingPower) parts.push(`UNIFYING POWER:\n${review.unifyingPower}`);
  if (review.strongestCaseForImportance) parts.push(`STRONGEST CASE FOR IMPORTANCE:\n${review.strongestCaseForImportance}`);
  if (review.strongestObjection) parts.push(`STRONGEST OBJECTION:\n${review.strongestObjection}`);
  if (review.assessmentSensitivity) parts.push(`ASSESSMENT SENSITIVITY:\n${review.assessmentSensitivity}`);
  if (review.internalTechnicalTraction) parts.push(`INTERNAL TECHNICAL TRACTION:\n${review.internalTechnicalTraction}`);
  if (review.finalJudgment) parts.push(`FINAL JUDGMENT:\n${review.finalJudgment}`);
  const scores: string[] = [];
  if (review.inputStrengthScore != null) scores.push(`  Input Strength: ${review.inputStrengthScore}/10`);
  if (review.constructionStrengthScore != null) scores.push(`  Construction Strength: ${review.constructionStrengthScore}/10`);
  if (review.outputStrengthScore != null) scores.push(`  Output Strength: ${review.outputStrengthScore}/10`);
  if (review.overallIntrinsicScore != null) scores.push(`  OVERALL INTRINSIC SCORE: ${review.overallIntrinsicScore}/100`);
  if (scores.length > 0) parts.push(`SCORES:\n${scores.join('\n')}`);
  // Legacy fields
  if (!review.centralClaim) {
    if (review.summary) parts.push(`SUMMARY:\n${review.summary}`);
    if (review.correctness) parts.push(`CORRECTNESS:\n${review.correctness}`);
    if (review.novelty) parts.push(`NOVELTY:\n${review.novelty}`);
    if (review.overallEvaluation) parts.push(`OVERALL EVALUATION:\n${review.overallEvaluation}`);
  }
  return parts.join('\n\n');
}

// POST /api/reviews/:reviewId/chat
router.post("/reviews/:reviewId/chat", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" }); return;
    }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId));
    if (!review) { res.status(404).json({ error: "Review not found" }); return; }

    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, review.paperId));

    const reviewContext = buildReviewContext(review, paper);

    const systemMessage = `You are a scientific manuscript reviewer who produced a detailed review and is now discussing it with a reader.

You evaluated this manuscript using the following framework:
---
${review.systemPrompt}
---

Here is the complete review you produced:
---
${reviewContext}
---${review.thinkingText ? `\n\nHere was your internal reasoning during this review:\n---\n${review.thinkingText}\n---` : ''}

You are now in a conversational mode. Help the user understand your review by:
- Explaining any part of your analysis in more depth
- Clarifying why you scored specific dimensions the way you did
- Discussing the paper's strengths and weaknesses in more detail
- Being honest about uncertainty and the limits of your assessment
- Speculating about implications or related work when asked

Maintain the same anonymous evaluation perspective: you assessed this manuscript without knowing author identity, institution, publication history, or historical significance.

Be concise, intellectually honest, and use markdown where helpful.`;

    const isGemini = (review.modelName ?? "").includes("gemini");

    if (isGemini) {
      const response = await (geminiAI.models.generateContent as any)({
        model: GEMINI_META_MODEL,
        config: { systemInstruction: systemMessage },
        contents: messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      });
      res.json({ reply: response.text ?? "" });
    } else {
      const completion = await getOpenAI().chat.completions.create({
        model: review.modelName || GPT_MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          ...messages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      });
      res.json({ reply: completion.choices[0]?.message?.content ?? "" });
    }
  } catch (err: any) {
    logger.error({ err }, "Chat error");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/likes
router.get("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.json({ likes: [] }); return; }
  try {
    const likes = await db.select().from(likesTable).where(eq(likesTable.userId, req.user.id));
    res.json({ likes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/likes
router.post("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { targetId, targetType } = req.body;
    if (!targetId || !targetType) { res.status(400).json({ error: "targetId and targetType required" }); return; }

    const existing = await db.select().from(likesTable).where(
      and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
    );

    if (existing.length > 0) {
      await db.delete(likesTable).where(
        and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
      );
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      }
      res.json({ liked: false });
    } else {
      await db.insert(likesTable).values({ userId: req.user.id, targetId, targetType });
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      }
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
