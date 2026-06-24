import { ReviewModel, ReviewMode } from '../services/reviewService';

const MODEL_LABELS: Record<ReviewModel, string> = {
  gemini: 'Gemini 3.1 Pro',
  gpt: 'GPT-5.5',
  glm: 'GLM-5.2',
};

export function reviewModelDisplayName(model: ReviewModel) {
  return MODEL_LABELS[model];
}

export function reviewPipelineShortLabel(model: ReviewModel, mode: ReviewMode) {
  const calibration = mode === 'normal-review' ? ' + calibration' : '';
  return `${reviewModelDisplayName(model)} x2 + blind adjudicator${calibration}`;
}

export function reviewPipelineProcessingLabel(model: ReviewModel, mode: ReviewMode) {
  return `Reviewing with ${reviewPipelineShortLabel(model, mode)}...`;
}

export function reviewPipelineDescription(model: ReviewModel, mode: ReviewMode) {
  const base = `This runs metadata extraction, two independent blind ${reviewModelDisplayName(model)} review passes, and a blind ${reviewModelDisplayName(model)} adjudicator.`;
  return mode === 'benchmark-ingestion'
    ? `${base} Comparator calibration is skipped for benchmark ingestion.`
    : `${base} Then benchmark comparator calibration runs if available. Please keep this window open.`;
}

export function formatStoredReviewModelName(modelName: string | null | undefined) {
  const raw = String(modelName ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  // Non-Gemini stored records append the actual selected scoring model after
  // the historical Gemini pipeline label. Prefer that explicit suffix over
  // generic words like "benchmark ingestion" or "blind adjudicator".
  const selectedModel =
    lower.includes('z-ai/glm-5.2') || lower.includes('glm-5.2') ? 'GLM-5.2'
    : lower.includes('gpt-5.5') ? 'GPT-5.5'
    : lower.includes('gpt') ? 'GPT'
    : lower.includes('gemini-3.1-pro') ? 'Gemini 3.1 Pro'
    : lower.includes('gemini-3.5-flash') ? 'Gemini 3.5 Flash'
    : lower.startsWith('gemini') ? 'Gemini'
    : '';

  const modeSuffix =
    lower.includes('comparator calibration') ? ' + calibration'
    : '';

  if (selectedModel) return `${selectedModel} x2 + blind adjudicator${modeSuffix}`;
  return raw;
}
