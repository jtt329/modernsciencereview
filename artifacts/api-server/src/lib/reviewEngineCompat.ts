import {
  GEMINI_MODEL,
  GPT_MODEL,
  REVIEW_PASS_COUNT,
  REVIEW_SYSTEM_INSTRUCTION,
  extractMetadata,
  generateMultiPassReview,
  type ReviewModel,
} from "./reviewEngine";

export {
  GEMINI_MODEL,
  GPT_MODEL,
  REVIEW_PASS_COUNT,
  REVIEW_SYSTEM_INSTRUCTION,
  extractMetadata,
  type ReviewModel,
};

export async function generateCompatReview(
  paperContent: string,
  model: ReviewModel,
  promptOverride?: string,
) {
  const result = await generateMultiPassReview(paperContent, model, promptOverride);
  const representative = result.representativeReview;
  const aggregate = result.aggregate;
  const reviewValues = {
    summary: aggregate.finalSummary || representative.summary || representative.oneParagraphVerdict || "",
    correctness: representative.correctness || "",
    novelty: representative.novelty || "",
    overallEvaluation: aggregate.publicOneParagraphVerdict || representative.finalJudgment || "",
    score: aggregate.finalScoreBand.median,
    relatedWork: "",
    centralClaim: representative.centralClaim || null,
    establishedResults: representative.establishedResults.length > 0 ? representative.establishedResults.join("\n- ").replace(/^/, "- ") : null,
    interpretiveClaims: representative.interpretiveClaims.length > 0 ? representative.interpretiveClaims.join("\n- ").replace(/^/, "- ") : null,
    speculativeClaims: representative.speculativeClaims.length > 0 ? representative.speculativeClaims.join("\n- ").replace(/^/, "- ") : null,
    economy: representative.economy || null,
    explanatoryTargetBreadth: representative.explanatoryTargetBreadth || null,
    theorySpaceBreadth: representative.theorySpaceBreadth || null,
    scopeDepth: representative.scopeDepth || null,
    unifyingPower: representative.unifyingPower || null,
    strongestCaseForImportance: representative.strongestCaseForImportance || null,
    strongestObjection: representative.strongestObjection || null,
    decisiveCheck: representative.decisiveCheck || null,
    internalTechnicalTraction: representative.internalTechnicalTraction || null,
    noveltyConfidence: String(representative.noveltyConfidence),
    intrinsicScientificMeritScore: representative.intrinsicTechnicalScore,
    explanatoryTargetBreadthScore: representative.explanatoryTargetBreadthScore,
    theorySpaceBreadthScore: representative.theorySpaceBreadthScore,
    breadthOfImpactScore: representative.breadthOfImpactScore,
    overallIntrinsicScore: aggregate.finalScoreBand.median,
    bestClassification: aggregate.finalClassification || representative.bestClassification || null,
    finalJudgment: aggregate.publicOneParagraphVerdict || representative.finalJudgment || null,
    coverageLedgerJson: JSON.stringify({
      coverageLedger: representative.coverageLedger,
      scoreBand: aggregate.finalScoreBand,
      scoreStability: aggregate.scoreStability,
      publicVerdict: aggregate.publicOneParagraphVerdict,
      finalComparisonCohort: aggregate.finalComparisonCohort,
      finalBroadField: aggregate.finalBroadField,
      finalSpecialtyField: aggregate.finalSpecialtyField,
      passCount: REVIEW_PASS_COUNT,
      individualReviews: result.individualReviews,
      aggregate,
    }),
    thinkingText: result.thinkingText,
    modelName: result.modelName,
    systemPrompt: result.systemPrompt,
  };

  return {
    metadata: {
      field: aggregate.finalBroadField || representative.broadField || "Unknown",
      subfields: representative.subfields ?? [],
      modelName: result.modelName,
    },
    reviewValues,
  };
}
