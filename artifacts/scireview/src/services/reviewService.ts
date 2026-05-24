export type ReviewModel = 'gpt' | 'gemini';
export type ReviewMode = 'benchmark-ingestion' | 'normal-review';

export interface ReviewSource {
  type: 'text' | 'pdf' | 'url';
  data: string;
  model?: ReviewModel;
  reviewMode?: ReviewMode;
  fileName?: string;
  pdfUrl?: string;
  displayPdf?: boolean;
}
