export type ReviewModel = 'gpt' | 'gemini';

export interface ReviewSource {
  type: 'text' | 'pdf' | 'url';
  data: string;
  model?: ReviewModel;
  pdfUrl?: string;
  displayPdf?: boolean;
}
