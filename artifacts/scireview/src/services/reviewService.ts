export type ReviewModel = 'gpt' | 'gemini';

export interface ReviewSource {
  type: 'text' | 'pdf' | 'url';
  data: string;
  model?: ReviewModel;
  fileName?: string;
  pdfUrl?: string;
  displayPdf?: boolean;
}
