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
  const selectedModel = storedReviewModelFamily(raw);

  // Non-Gemini stored records append the actual selected scoring model after
  // the historical Gemini pipeline label. Prefer that explicit suffix over
  // generic words like "benchmark ingestion" or "blind adjudicator".
  const selectedModelLabel =
    selectedModel === 'glm' ? 'GLM-5.2'
    : selectedModel === 'gpt' ? 'GPT-5.5'
    : selectedModel === 'gemini' ? (raw.toLowerCase().includes('gemini-3.5-flash') ? 'Gemini 3.5 Flash' : 'Gemini 3.1 Pro')
    : '';
  const lower = raw.toLowerCase();
  const modeSuffix =
    lower.includes('comparator calibration') ? ' + calibration'
    : '';

  if (selectedModelLabel) return `${selectedModelLabel} x2 + blind adjudicator${modeSuffix}`;
  return raw;
}

export type StoredReviewModelFamily = 'gemini' | 'gpt' | 'glm' | 'other';

export function storedReviewModelFamily(modelName: string | null | undefined): StoredReviewModelFamily {
  const lower = String(modelName ?? '').trim().toLowerCase();
  if (!lower) return 'other';
  if (lower.includes('z-ai/glm-5.2') || lower.includes('glm-5.2') || /\bglm\b/.test(lower)) return 'glm';
  if (lower.includes('gpt-5.5') || /\bgpt\b/.test(lower) || lower.includes('openai')) return 'gpt';
  if (lower.includes('gemini')) return 'gemini';
  return 'other';
}

export function storedReviewModelFamilyLabel(family: StoredReviewModelFamily) {
  if (family === 'gemini') return 'Gemini';
  if (family === 'gpt') return 'GPT';
  if (family === 'glm') return 'GLM';
  return 'Other';
}
