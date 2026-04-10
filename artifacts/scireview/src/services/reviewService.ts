export interface ReviewResult {
  title: string;
  authorName: string;
  summary: string;
  correctness: string;
  novelty: string;
  overallEvaluation: string;
  score: number;
  field: string;
  subfields: string[];
  relatedWork: string;
  modelName: string;
  systemPrompt: string;
}

export interface ReviewSource {
  type: 'text' | 'pdf';
  data: string;
}

export async function reviewPaper(source: ReviewSource): Promise<ReviewResult> {
  const response = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = 'Failed to generate review from server';
    try {
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = text.length < 200 ? text : errorMessage;
    }
    throw new Error(errorMessage);
  }

  const resultText = await response.text();
  try {
    return JSON.parse(resultText);
  } catch {
    throw new Error('The server returned an invalid response format. Please try again.');
  }
}
