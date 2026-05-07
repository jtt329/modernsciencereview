import {
  buildStoredReviewValues,
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
  const aggregate = result.aggregate;
  const representative = result.representativeReview;
  const reviewValues = buildStoredReviewValues(result);

  return {
    metadata: {
      field: aggregate.finalBroadField || representative.broadField || "Unknown",
      subfields: representative.subfields ?? [],
      modelName: result.modelName,
    },
    reviewValues,
  };
}
