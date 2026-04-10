export interface Paper {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  status: 'draft' | 'published';
  aiReviewId?: string;
  likesCount: number;
  viewCount: number;
  commentCount: number;
  field: string;
  subfields?: string[];
  score?: number;
  modelName?: string;
}

export interface AIReview {
  id: string;
  paperId: string;
  summary: string;
  correctness: string;
  novelty: string;
  overallEvaluation: string;
  score: number;
  relatedWork: string;
  createdAt: number;
  likesCount: number;
  modelName: string;
  systemPrompt: string;
}

export interface Comment {
  id: string;
  targetId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

export interface Like {
  id: string;
  targetId: string;
  userId: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: number;
}
