export type ReviewModel = 'gpt' | 'gemini';

export interface ReviewSource {
  type: 'text' | 'pdf';
  data: string;
  model?: ReviewModel;
}
