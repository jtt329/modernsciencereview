import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, ArrowLeft, Heart, Clock, User, Share2, AlertCircle, Loader2, Trash2, CheckSquare, XSquare, ExternalLink, Check, Pencil, ChevronDown } from 'lucide-react';
import LatexText from './components/LatexText';
import { format, formatDistanceToNow } from 'date-fns';
import { useAuth, AuthUser } from '@workspace/auth-web';
import Navbar from './components/Navbar';
import PaperCard from './components/PaperCard';
import ReviewCard from './components/ReviewCard';
import CommentSection from './components/CommentSection';
import SubmissionForm from './components/SubmissionForm';
import PromptAnalysis from './components/PromptAnalysis';
import HowItWorksModal from './components/HowItWorksModal';
import SandboxViewer from './components/SandboxViewer';
import FieldOverviewPage from './components/FieldOverviewPage';
import { ReviewSource } from './services/reviewService';
import { StoredReviewModelFamily, storedReviewModelFamily, storedReviewModelFamilyLabel } from './lib/modelLabels';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';

const FIELDS = ['All Fields', 'Physics', 'Mathematics', 'Computer Science', 'Biology', 'Chemistry'];
const RANKINGS = ['Top Rated', 'Most Viewed', 'Most Discussed', 'Newest'];
const TIMEFRAMES = ['All Time', 'Past Year', 'Past Month', 'Past Week'];
const MODEL_FAMILY_ORDER: StoredReviewModelFamily[] = ['gemini', 'gpt', 'glm', 'other'];
const ALL_MODEL_FAMILIES = 'All Models';

interface PaperDateMetadata {
  displayedTitle?: string;
  displayedAuthors?: string[];
  arxivId?: string;
  doi?: string;
  journalName?: string;
  journalPublicationDate?: string;
  arxivFirstSubmissionDate?: string;
  manuscriptDatePrintedOnPdf?: string;
  originalPublicationDateBestGuess?: string;
  dateSource?: string;
  dateConfidence?: number;
  dateNotes?: string;
  metadataQaWarnings?: string[];
}

interface Paper {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;      // submitter
  paperAuthors?: string;   // actual paper authors
  dateMetadata?: PaperDateMetadata | null;
  field: string;
  subfields: string[] | null;
  score: number | null;
  modelName: string | null;
  pdfUrl: string | null;
  displayPdf: number;
  likesCount: number;
  viewCount: number;
  commentCount: number;
  createdAt: string;
  reviewSummary?: string | null;
  reviewCentralClaim?: string | null;
  reviewFinalJudgment?: string | null;
  promptVersion?: string | null;
}

function dateMetaText(value?: string | null) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function dateConfidenceLabel(confidence?: number) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unknown confidence';
  if (confidence >= 0.8) return 'high confidence';
  if (confidence >= 0.5) return 'medium confidence';
  if (confidence > 0) return 'low confidence';
  return 'unknown confidence';
}

function PaperDateMetadataBadges({ metadata }: { metadata?: PaperDateMetadata | null }) {
  const firstSubmitted = dateMetaText(metadata?.arxivFirstSubmissionDate);
  const published = dateMetaText(metadata?.journalPublicationDate);
  const bestDate = dateMetaText(metadata?.originalPublicationDateBestGuess);
  if (!firstSubmitted && !published && !bestDate) return null;
  const tooltip = [
    metadata?.dateSource ? `Source: ${metadata.dateSource}` : '',
    `Confidence: ${dateConfidenceLabel(metadata?.dateConfidence)}`,
    metadata?.dateNotes ? `Notes: ${metadata.dateNotes}` : '',
  ].filter(Boolean).join('\n');
  const badges = [
    firstSubmitted ? ['First submitted', firstSubmitted] : null,
    published ? ['Published', published] : null,
    bestDate ? ['Best date', bestDate] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <div className="flex flex-wrap gap-2" title={tooltip || undefined}>
      {badges.map(([label, value]) => (
        <div key={`${label}-${value}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
          <span className="text-slate-400">{label}</span>
          <span className="ml-1 text-slate-700">{value}</span>
        </div>
      ))}
    </div>
  );
}

interface AIReview {
  id: string;
  paperId: string;
  summary: string;
  correctness: string;
  novelty: string;
  overallEvaluation: string;
  score: number;
  relatedWork: string;
  modelName: string;
  systemPrompt: string;
  likesCount: number;
  createdAt: string;
}

interface Comment {
  id: string;
  paperId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(data.error || res.statusText) as Error & {
      status?: number;
      transient?: boolean;
      quotaExhausted?: boolean;
      retryAfterText?: string | null;
      attempt?: unknown;
      reviewStatus?: string | null;
      extractionCompletenessStatus?: string | null;
      extractionWarnings?: string[];
    };
    error.status = res.status;
    error.quotaExhausted = Boolean(data.quotaExhausted);
    error.retryAfterText = data.retryAfterText || null;
    error.transient = !error.quotaExhausted && (Boolean(data.transient) || [500, 502, 503, 504].includes(res.status));
    error.attempt = data.attempt;
    error.reviewStatus = data.reviewStatus || null;
    error.extractionCompletenessStatus = data.extractionCompletenessStatus || null;
    error.extractionWarnings = Array.isArray(data.extractionWarnings) ? data.extractionWarnings : [];
    throw error;
  }
  return res.json();
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REVIEW_JOB_POLL_INTERVAL_MS = 2500;
const REVIEW_JOB_POLL_TRANSIENT_WINDOW_MS = 12 * 60 * 1000;

function pollErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isTransientReviewJobPollError(err: unknown) {
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  if ((err as any)?.transient || [500, 502, 503, 504].includes(status)) return true;
  return /failed to fetch|load failed|networkerror|network request failed|application failed to respond|temporar|unavailable|timeout|\b(500|502|503|504)\b/i.test(pollErrorMessage(err));
}

function attemptFailureMessage(attempt: any) {
  const stage = attempt?.stageName ? String(attempt.stageName).replace(/_/g, ' ') : 'review job';
  const status = attempt?.reviewStatus ? String(attempt.reviewStatus).replace(/_/g, ' ') : null;
  const message = typeof attempt?.errorMessage === 'string' && attempt.errorMessage.trim()
    ? attempt.errorMessage.trim()
    : status
      ? `Stopped at ${status}.`
      : 'Review job failed.';
  return `${stage}: ${message}`;
}

function isJobComplete(attempt: any, data: any) {
  return Boolean(
    data?.paper &&
    (attempt?.failureStatus === 'completed' ||
      attempt?.reviewStatus === 'completed' ||
      attempt?.reviewStatus === 'duplicate_existing' ||
      attempt?.reviewStatus === 'completed_reused' ||
      attempt?.reviewStatus === 'completed_reused_inflight')
  );
}

function isJobFailed(attempt: any) {
  if (!attempt) return false;
  if (attempt.failureStatus === 'completed') return false;
  if (
    attempt.reviewStatus === 'interrupted_by_server_restart' ||
    attempt.failureStatus === 'interrupted_by_server_restart' ||
    attempt.stageName === 'interrupted_by_server_restart'
  ) return true;
  if (typeof attempt.errorMessage === 'string' && attempt.errorMessage.trim()) return true;
  if (attempt.failureStatus && attempt.failureStatus !== 'retryable') return true;
  return attempt.reviewStatus === 'failed_validation' ||
    attempt.reviewStatus === 'invalid_extraction_truncated' ||
    attempt.reviewStatus === 'needs_manual_repair' ||
    attempt.reviewStatus === 'failed';
}

type ReviewJobUpdateHandler = (attempt: any) => void;

async function pollReviewJob(jobId: string, onJobUpdate?: ReviewJobUpdateHandler) {
  const deadline = Date.now() + 90 * 60 * 1000;
  let firstTransientPollErrorAt: number | null = null;
  let transientPollErrorCount = 0;
  while (Date.now() < deadline) {
    try {
      const data = await apiFetch(`/api/review-jobs/${encodeURIComponent(jobId)}`);
      firstTransientPollErrorAt = null;
      transientPollErrorCount = 0;
      const attempt = data?.attempt;
      if (attempt) onJobUpdate?.(attempt);
      if (isJobComplete(attempt, data)) return data;
      if (isJobFailed(attempt)) {
        const error = new Error(attemptFailureMessage(attempt)) as Error & {
          attempt?: unknown;
          reviewStatus?: string | null;
          transient?: boolean;
          jobAttemptFailure?: boolean;
        };
        error.attempt = attempt;
        error.reviewStatus = attempt?.reviewStatus || null;
        error.transient = Boolean(attempt?.retryable);
        error.jobAttemptFailure = true;
        throw error;
      }
    } catch (err) {
      if ((err as any)?.jobAttemptFailure) throw err;
      if (!isTransientReviewJobPollError(err)) throw err;
      const now = Date.now();
      firstTransientPollErrorAt ??= now;
      transientPollErrorCount += 1;
      if (now - firstTransientPollErrorAt > REVIEW_JOB_POLL_TRANSIENT_WINDOW_MS) {
        const error = new Error(`Review job status polling could not reach the API for ${Math.round(REVIEW_JOB_POLL_TRANSIENT_WINDOW_MS / 60000)} minutes. The server job may still be running; refresh and check the batch/debug status before retrying. Last error: ${pollErrorMessage(err)}`) as Error & {
          transient?: boolean;
          status?: number;
        };
        error.transient = true;
        error.status = typeof (err as any)?.status === 'number' ? (err as any).status : undefined;
        throw error;
      }
      await sleep(Math.min(15_000, REVIEW_JOB_POLL_INTERVAL_MS + transientPollErrorCount * 1000));
      continue;
    }
    await sleep(REVIEW_JOB_POLL_INTERVAL_MS);
  }
  const error = new Error('Review job is still running after 90 minutes. It remains queued on the server; refresh and check the batch/debug status before retrying.') as Error & { transient?: boolean };
  error.transient = true;
  throw error;
}

function displayName(user: AuthUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'User';
}

function paperPath(paperId: string) {
  return `/papers/${encodeURIComponent(paperId)}`;
}

function readRoute() {
  const path = window.location.pathname;
  const paperMatch = path.match(/^\/papers\/([^/]+)\/?$/);
  const fieldMatch = path.match(/^\/fields\/([^/]+)\/?$/);
  const queryPaper = new URLSearchParams(window.location.search).get('paper');

  return {
    paperId: paperMatch ? decodeURIComponent(paperMatch[1]) : queryPaper,
    fieldSlug: fieldMatch ? decodeURIComponent(fieldMatch[1]) : null,
    showHowItWorks: path === '/how-it-works',
    showSandbox: path === '/admin/sandbox',
    usedLegacyPaperQuery: !paperMatch && !!queryPaper,
  };
}

export default function App() {
  const { user, isLoading: authLoading, login, logout } = useAuth();

  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [fieldSlug, setFieldSlug] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [selectedReview, setSelectedReview] = useState<AIReview | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showPromptAnalysis, setShowPromptAnalysis] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [papersLoading, setPapersLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!(user && ADMIN_EMAIL && user.email === ADMIN_EMAIL);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataAuthors, setMetadataAuthors] = useState('');
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedField, setSelectedField] = useState('All Fields');
  const [selectedSubfield, setSelectedSubfield] = useState('All Subfields');
  const [selectedPromptVersion, setSelectedPromptVersion] = useState('All Prompt Versions');
  const [selectedModelFamily, setSelectedModelFamily] = useState<StoredReviewModelFamily | typeof ALL_MODEL_FAMILIES>(ALL_MODEL_FAMILIES);
  const [selectedRanking, setSelectedRanking] = useState('Top Rated');
  const [selectedTimeframe, setSelectedTimeframe] = useState('All Time');

  const fetchPapers = useCallback(async () => {
    try {
      const data = await apiFetch('/api/papers');
      setPapers(data.papers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPapersLoading(false);
    }
  }, []);

  const fetchLikes = useCallback(async (targetIds: string[]) => {
    if (!user || !targetIds.length) return;
    try {
      const data = await apiFetch(`/api/likes?targetIds=${targetIds.join(',')}`);
      setUserLikes(new Set(data.likes || []));
    } catch {}
  }, [user]);

  // Keep app state in sync with shareable browser routes.
  useEffect(() => {
    const syncRoute = () => {
      const route = readRoute();
      setSelectedPaperId(route.paperId);
      setFieldSlug(route.fieldSlug);
      setShowHowItWorks(route.showHowItWorks);
      setShowSandbox(route.showSandbox);
      if (route.paperId && route.usedLegacyPaperQuery) {
        window.history.replaceState({}, '', paperPath(route.paperId));
      }
    };

    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => { fetchPapers(); }, [fetchPapers]);

  useEffect(() => {
    if (papers.length && user) {
      const ids = papers.map(p => p.id);
      fetchLikes(ids);
    }
  }, [papers, user, fetchLikes]);

  useEffect(() => {
    if (!selectedPaperId) {
      setSelectedPaper(null);
      setSelectedReview(null);
      setComments([]);
      return;
    }
    setDetailLoading(true);
    Promise.all([
      apiFetch(`/api/papers/${selectedPaperId}`),
      apiFetch(`/api/papers/${selectedPaperId}/comments`),
    ]).then(([detail, commentsData]) => {
      setSelectedPaper(detail.paper);
      setSelectedReview(detail.review);
      setComments(commentsData.comments || []);
      if (user && detail.review) {
        fetchLikes([detail.paper.id, detail.review.id]);
      }
    }).catch(err => setError(err.message))
      .finally(() => setDetailLoading(false));

    // increment view count
    apiFetch(`/api/papers/${selectedPaperId}/view`, { method: 'PATCH' }).catch(() => {});
  }, [selectedPaperId, user]);

  const handleSelectPaper = (id: string) => {
    window.history.pushState({}, '', paperPath(id));
    setSelectedPaperId(id);
    setShowHowItWorks(false);
    window.scrollTo(0, 0);
  };

  const handleBack = () => {
    window.history.pushState({}, '', '/');
    setSelectedPaperId(null);
    setShowHowItWorks(false);
    fetchPapers();
  };

  const handleSubmitPaper = async (source: ReviewSource, skipSelect = false, onJobUpdate?: ReviewJobUpdateHandler) => {
    const job = await enqueueReviewJob(source);
    const jobId = job.jobId || job.attempt?.attemptId;
    if (!jobId) throw new Error('Review job was created without a job id.');
    const data = await waitForReviewJob(jobId, onJobUpdate);
    await handleReviewJobComplete(data, skipSelect);
    return data;
  };

  const enqueueReviewJob = async (source: ReviewSource) => {
    return apiFetch('/api/review-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, model: source.model || 'gemini' }),
    });
  };

  const waitForReviewJob = async (jobId: string, onJobUpdate?: ReviewJobUpdateHandler) => {
    return pollReviewJob(jobId, onJobUpdate);
  };

  const handleReviewJobComplete = async (data: any, skipSelect = false) => {
    await fetchPapers();
    if (!skipSelect) {
      window.history.pushState({}, '', paperPath(data.paper.id));
      setSelectedPaperId(data.paper.id);
    }
  };

  const handleLikePaper = async (paperId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { login(); return; }
    try {
      const data = await apiFetch(`/api/papers/${paperId}/like`, { method: 'POST' });
      setUserLikes(prev => {
        const next = new Set(prev);
        if (data.liked) next.add(paperId); else next.delete(paperId);
        return next;
      });
      setPapers(prev => prev.map(p => p.id === paperId ? { ...p, likesCount: p.likesCount + (data.liked ? 1 : -1) } : p));
      if (selectedPaper?.id === paperId) setSelectedPaper(p => p ? { ...p, likesCount: p.likesCount + (data.liked ? 1 : -1) } : p);
    } catch {}
  };

  const handleLikeReview = async (reviewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { login(); return; }
    try {
      const data = await apiFetch(`/api/reviews/${reviewId}/like`, { method: 'POST' });
      setUserLikes(prev => {
        const next = new Set(prev);
        if (data.liked) next.add(reviewId); else next.delete(reviewId);
        return next;
      });
      setSelectedReview(r => r ? { ...r, likesCount: r.likesCount + (data.liked ? 1 : -1) } : r);
    } catch {}
  };

  const handleAddComment = async (content: string) => {
    if (!user || !selectedPaperId) return;
    const data = await apiFetch(`/api/papers/${selectedPaperId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    setComments(prev => [...prev, data.comment]);
    setSelectedPaper(p => p ? { ...p, commentCount: p.commentCount + 1 } : p);
  };

  const handleDeletePaper = async (paperId: string) => {
    if (!user) return;
    if (!window.confirm('Delete this paper and its review? This cannot be undone.')) return;
    await apiFetch(`/api/papers/${paperId}`, { method: 'DELETE' });
    window.history.pushState({}, '', '/');
    setSelectedPaperId(null);
    fetchPapers();
  };

  const toggleSelectPaper = (id: string) => {
    setSelectedPapers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPapers(new Set());
  };

  const handleBulkDelete = async () => {
    if (!user || selectedPapers.size === 0) return;
    if (!window.confirm(`Delete ${selectedPapers.size} paper(s) and their reviews? This cannot be undone.`)) return;
    setIsBulkDeleting(true);
    try {
      await Promise.all([...selectedPapers].map(id => apiFetch(`/api/papers/${id}`, { method: 'DELETE' })));
    } finally {
      exitSelectionMode();
      setIsBulkDeleting(false);
      fetchPapers();
    }
  };

  const handleShare = () => {
    if (!selectedPaperId) return;
    const url = `${window.location.origin}${paperPath(selectedPaperId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setShareMenuOpen(false);
      setTimeout(() => setShareCopied(false), 2000);
    });
  };

  const openMetadataEditor = () => {
    if (!selectedPaper) return;
    setMetadataTitle(selectedPaper.title || '');
    setMetadataAuthors(selectedPaper.paperAuthors || '');
    setMetadataEditorOpen(true);
  };

  const handleSaveMetadata = async () => {
    if (!selectedPaper) return;
    setMetadataSaving(true);
    try {
      const data = await apiFetch(`/api/papers/${selectedPaper.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: metadataTitle,
          paperAuthors: metadataAuthors,
        }),
      });
      setSelectedPaper(data.paper);
      setPapers(prev => prev.map(p => p.id === data.paper.id ? { ...p, ...data.paper } : p));
      setMetadataEditorOpen(false);
    } catch (err: any) {
      window.alert(`Could not update paper metadata: ${err.message}`);
    } finally {
      setMetadataSaving(false);
    }
  };

  const handleShowHowItWorks = () => {
    window.history.pushState({}, '', '/how-it-works');
    setShowHowItWorks(true);
  };

  const handleCloseHowItWorks = () => {
    window.history.pushState({}, '', selectedPaperId ? paperPath(selectedPaperId) : '/');
    setShowHowItWorks(false);
  };

  const fetchPapersExport = async (debugAudit = false) => {
    const params = new URLSearchParams();
    if (debugAudit) {
      params.set('debugAudit', 'true');
      params.set('includeFailedAttempts', 'true');
      try {
        const batchRunId = localStorage.getItem('scireview:lastBatchRunId');
        if (batchRunId) params.set('batchRunId', batchRunId);
      } catch {}
    }
    const query = params.toString();
    const res = await fetch(`/api/papers/export${query ? `?${query}` : ''}`, { credentials: 'include' });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Export failed with status ${res.status}`);
    }
    return res.json();
  };

  const downloadPapersExport = (data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scireview-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    try {
      const data = await fetchPapersExport();
      downloadPapersExport(data);
    } catch (err: any) {
      window.alert(`Export failed: ${err.message}`);
    }
  };

  const handleDownloadAudit = async () => {
    if (!isAdmin) return;
    try {
      const data = await fetchPapersExport(true);
      downloadPapersExport(data);
    } catch (err: any) {
      window.alert(`Audit export failed: ${err.message}`);
    }
  };

  const handleDeleteAll = async () => {
    if (!isAdmin) return;
    const count = papers.length;
    if (count === 0) { window.alert('No papers to delete.'); return; }
    if (!window.confirm(`Download a JSON export, save scores for all ${count} paper(s) to Prompt Analysis, then permanently delete them?`)) return;
    try {
      const exportData = await fetchPapersExport();
      downloadPapersExport(exportData);
      const result = await apiFetch('/api/admin/snapshot-and-delete', { method: 'POST' });
      await fetchPapers();
      window.alert(`Exported, saved ${result.paperCount} papers to Prompt Analysis, and deleted them.`);
    } catch (err: any) {
      window.alert(`Error: ${err.message}`);
    }
  };

  const getSubfields = () => {
    if (selectedField === 'All Fields') return [];
    const sf = new Set<string>();
    papers
      .filter(p => p.field.toLowerCase() === selectedField.toLowerCase())
      .forEach(p => p.subfields?.forEach(s => sf.add(s)));
    return Array.from(sf).sort();
  };

  useEffect(() => { setSelectedSubfield('All Subfields'); }, [selectedField]);

  const subfields = getSubfields();
  const promptVersions = useMemo(() => {
    const versions = new Set<string>();
    papers.forEach((paper) => {
      const version = typeof paper.promptVersion === 'string' ? paper.promptVersion.trim() : '';
      if (version) versions.add(version);
    });
    return Array.from(versions).sort((a, b) => b.localeCompare(a));
  }, [papers]);

  useEffect(() => {
    if (selectedPromptVersion !== 'All Prompt Versions' && !promptVersions.includes(selectedPromptVersion)) {
      setSelectedPromptVersion('All Prompt Versions');
    }
  }, [promptVersions, selectedPromptVersion]);

  const modelFamilies = useMemo(() => {
    const families = new Set<StoredReviewModelFamily>();
    papers.forEach((paper) => {
      const family = storedReviewModelFamily(paper.modelName);
      if (family !== 'other') families.add(family);
    });
    papers.forEach((paper) => {
      const family = storedReviewModelFamily(paper.modelName);
      if (family === 'other' && paper.modelName) families.add(family);
    });
    return MODEL_FAMILY_ORDER.filter((family) => families.has(family));
  }, [papers]);

  useEffect(() => {
    if (selectedModelFamily !== ALL_MODEL_FAMILIES && !modelFamilies.includes(selectedModelFamily)) {
      setSelectedModelFamily(ALL_MODEL_FAMILIES);
    }
  }, [modelFamilies, selectedModelFamily]);

  const filteredPapers = papers
    .filter(p => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q || [
        p.title,
        p.paperAuthors,
        p.reviewCentralClaim,
        p.reviewFinalJudgment,
        p.reviewSummary,
      ].some(f => typeof f === 'string' && f.toLowerCase().includes(q));
      const fieldLower = selectedField.toLowerCase();
      const matchesField = selectedField === 'All Fields' ||
        p.field.toLowerCase().includes(fieldLower) ||
        p.subfields?.some(s => s.toLowerCase().includes(fieldLower));
      const matchesSubfield = selectedSubfield === 'All Subfields' || p.subfields?.includes(selectedSubfield);
      const matchesPromptVersion = selectedPromptVersion === 'All Prompt Versions' || p.promptVersion === selectedPromptVersion;
      const matchesModelFamily = selectedModelFamily === ALL_MODEL_FAMILIES || storedReviewModelFamily(p.modelName) === selectedModelFamily;
      const now = Date.now();
      const ts = new Date(p.createdAt).getTime();
      let matchesTime = true;
      if (selectedTimeframe === 'Past Week') matchesTime = ts > now - 7 * 86400000;
      else if (selectedTimeframe === 'Past Month') matchesTime = ts > now - 30 * 86400000;
      else if (selectedTimeframe === 'Past Year') matchesTime = ts > now - 365 * 86400000;
      return matchesSearch && matchesField && matchesSubfield && matchesPromptVersion && matchesModelFamily && matchesTime;
    })
    .sort((a, b) => {
      if (selectedRanking === 'Most Viewed') return b.viewCount - a.viewCount;
      if (selectedRanking === 'Most Discussed') return b.commentCount - a.commentCount;
      if (selectedRanking === 'Top Rated') return (b.score ?? 0) - (a.score ?? 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-rose-100 text-center max-w-md space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-2xl font-black text-slate-900">Something went wrong</h2>
          <p className="text-slate-600 font-medium">{error}</p>
          <button onClick={() => { setError(null); fetchPapers(); }} className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-colors">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (fieldSlug) {
    return (
      <div className="min-h-screen bg-slate-50">
        <FieldOverviewPage
          slug={fieldSlug}
          isAdmin={isAdmin}
          onOpenPaper={(id) => { window.history.pushState({}, '', paperPath(id)); setFieldSlug(null); setSelectedPaperId(id); }}
          onBack={() => { window.history.pushState({}, '', '/'); setFieldSlug(null); }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar
        user={user ? { displayName: displayName(user), photoURL: user.profileImageUrl, email: user.email } : null}
        isAdmin={isAdmin}
        onLogin={login}
        onLogout={logout}
        onNewPaper={() => { if (!user) { login(); return; } setIsSubmitting(true); }}
        onHowItWorks={handleShowHowItWorks}
        onDeleteAll={handleDeleteAll}
        onPromptAnalysis={() => setShowPromptAnalysis(true)}
        onDownloadAll={handleDownloadAll}
        onDownloadAudit={handleDownloadAudit}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <AnimatePresence mode="wait">
          {!selectedPaperId ? (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              {/* Hero */}
              <div className="text-center space-y-3 max-w-2xl mx-auto mb-8">
                <p className="text-2xl text-slate-700 font-semibold leading-snug">
                  Submit your research, get an instant AI assessment, and timestamp your work on the public record.
                </p>
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest pt-1">
                  Powered by Gemini Pro x2 + Blind Adjudicator
                </p>
              </div>

              {/* Search + Filters */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search papers, authors, or topics..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-2xl focus:ring-2 focus:ring-indigo-500 text-slate-900 font-medium outline-none border-none"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {FIELDS.map(f => (
                      <button key={f} onClick={() => setSelectedField(f)}
                        className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all border ${selectedField === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                      >{f}</button>
                    ))}
                  </div>
                  <AnimatePresence>
                    {selectedField !== 'All Fields' && subfields.length > 0 && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                        <button onClick={() => setSelectedSubfield('All Subfields')} className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedSubfield === 'All Subfields' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'}`}>All Subfields</button>
                        {subfields.map(s => (
                          <button key={s} onClick={() => setSelectedSubfield(s)} className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedSubfield === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{s}</button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="inline-flex p-1 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    {RANKINGS.map(r => (
                      <button key={r} onClick={() => setSelectedRanking(r)} className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${selectedRanking === r ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}>{r}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TIMEFRAMES.map(t => (
                      <button key={t} onClick={() => setSelectedTimeframe(t)} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${selectedTimeframe === t ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{t}</button>
                    ))}
                  </div>
                  {user && promptVersions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <span className="mr-1 text-xs font-black uppercase tracking-widest text-slate-400">Prompt</span>
                      <button
                        onClick={() => setSelectedPromptVersion('All Prompt Versions')}
                        className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedPromptVersion === 'All Prompt Versions' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                      >
                        All
                      </button>
                      {promptVersions.map(version => (
                        <button
                          key={version}
                          onClick={() => setSelectedPromptVersion(version)}
                          className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedPromptVersion === version ? 'bg-violet-600 text-white border-violet-600' : 'bg-violet-50 text-violet-700 border-violet-100 hover:bg-violet-100'}`}
                        >
                          {version}
                        </button>
                      ))}
                    </div>
                  )}
                  {user && modelFamilies.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <span className="mr-1 text-xs font-black uppercase tracking-widest text-slate-400">Model</span>
                      <button
                        onClick={() => setSelectedModelFamily(ALL_MODEL_FAMILIES)}
                        className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedModelFamily === ALL_MODEL_FAMILIES ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                      >
                        All
                      </button>
                      {modelFamilies.map((family) => (
                        <button
                          key={family}
                          onClick={() => setSelectedModelFamily(family)}
                          className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all border ${selectedModelFamily === family ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                        >
                          {storedReviewModelFamilyLabel(family)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Paper Grid header row */}
              {user && filteredPapers.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-400">{filteredPapers.length} paper{filteredPapers.length !== 1 ? 's' : ''}</span>
                  {selectionMode ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedPapers(new Set(filteredPapers.map(p => p.id)))}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        Select all
                      </button>
                      <button onClick={exitSelectionMode} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">
                        <XSquare className="w-4 h-4" /> Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectionMode(true)}
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-rose-600 transition-colors"
                    >
                      <CheckSquare className="w-4 h-4" /> Select to delete
                    </button>
                  )}
                </div>
              )}

              {/* Paper Grid */}
              <div className="grid grid-cols-1 gap-6">
                {papersLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl h-64 animate-pulse border border-slate-100" />
                  ))
                ) : filteredPapers.length === 0 ? (
                  <div className="col-span-full text-center py-24">
                    <BookOpen className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold italic text-xl">
                      {papers.length === 0 ? 'No papers yet. Be the first to submit!' : 'No papers match your filters.'}
                    </p>
                  </div>
                ) : filteredPapers.map(paper => (
                  <PaperCard
                    key={paper.id}
                    paper={{
                      ...paper,
                      status: 'published',
                      score: paper.score ?? undefined,
                      modelName: paper.modelName ?? undefined,
                      subfields: paper.subfields ?? [],
                      createdAt: new Date(paper.createdAt).getTime(),
                    }}
                    onClick={handleSelectPaper}
                    onLike={handleLikePaper}
                    isLiked={userLikes.has(paper.id)}
                    isSelectable={selectionMode}
                    isSelected={selectedPapers.has(paper.id)}
                    onSelect={(id) => toggleSelectPaper(id)}
                  />
                ))}
              </div>

              {/* Floating bulk delete toolbar */}
              <AnimatePresence>
                {selectionMode && selectedPapers.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50"
                  >
                    <div className="bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border border-slate-700">
                      <span className="font-bold text-sm">{selectedPapers.size} selected</span>
                      <button
                        onClick={handleBulkDelete}
                        disabled={isBulkDeleting}
                        className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
                      >
                        {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete {selectedPapers.size} paper{selectedPapers.size !== 1 ? 's' : ''}
                      </button>
                      <button onClick={exitSelectionMode} className="text-slate-400 hover:text-white transition-colors font-bold text-sm">Cancel</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto"
            >
              <button onClick={handleBack} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold transition-colors group mb-8">
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                Back to Feed
              </button>

              {detailLoading || !selectedPaper ? (
                <div className="text-center py-24">
                  <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                  <p className="text-slate-500 font-bold">Loading paper...</p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Scientific Paper</div>
                      <div className="relative group/submission-date flex items-center gap-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest cursor-help">
                        <Clock className="w-3 h-3" />
                        Submitted {format(new Date(selectedPaper.createdAt), 'MMM d, yyyy h:mm a')} · {formatDistanceToNow(new Date(selectedPaper.createdAt))} ago
                        <div className="absolute left-0 top-full mt-2 w-max max-w-xs rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold normal-case tracking-normal text-white shadow-xl opacity-0 pointer-events-none group-hover/submission-date:opacity-100 transition-opacity z-30">
                          Submitted by {selectedPaper.authorName}
                        </div>
                      </div>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black text-slate-900 leading-tight"><LatexText>{selectedPaper.title}</LatexText></h1>
                    <PaperDateMetadataBadges metadata={selectedPaper.dateMetadata} />
                    <div className="flex items-center justify-between py-6 border-y border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
                          <User className="w-6 h-6 text-indigo-500" />
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 block leading-tight text-lg">
                            {selectedPaper.paperAuthors || 'Unknown authors'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {user && (user.id === selectedPaper.authorId || user.email === ADMIN_EMAIL) && (
                          <button
                            onClick={openMetadataEditor}
                            title="Edit title and authors"
                            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm text-sm font-bold text-slate-600"
                          >
                            <Pencil className="w-4 h-4" /> Edit
                          </button>
                        )}
                        {selectedPaper.pdfUrl && (
                          <a
                            href={selectedPaper.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm text-sm font-bold text-slate-600"
                          >
                            <ExternalLink className="w-4 h-4" /> View PDF
                          </a>
                        )}

                        <div className="relative">
                          <button
                            onClick={() => setShareMenuOpen(open => !open)}
                            title="Share this review"
                            className={`flex items-center gap-2 px-4 py-3 rounded-2xl font-bold transition-colors shadow-sm border text-sm ${shareCopied ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                          >
                            {shareCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                            {shareCopied ? 'Copied!' : 'Share'}
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          {shareMenuOpen && (
                            <div className="absolute right-0 top-full mt-2 z-40 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                              <button
                                onClick={handleShare}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
                              >
                                <Share2 className="w-4 h-4" /> Copy review link
                              </button>
                            </div>
                          )}
                        </div>
                        {user && (user.id === selectedPaper.authorId || user.email === ADMIN_EMAIL) && (
                          <button onClick={() => handleDeletePaper(selectedPaper.id)} className="p-3 bg-rose-50 border border-rose-100 rounded-2xl hover:bg-rose-100 transition-colors shadow-sm">
                            <Trash2 className="w-5 h-5 text-rose-600" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleLikePaper(selectedPaper.id, e)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-colors shadow-sm border ${userLikes.has(selectedPaper.id) ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'}`}
                        >
                          <Heart className={`w-5 h-5 ${userLikes.has(selectedPaper.id) ? 'fill-current' : ''}`} />
                          {selectedPaper.likesCount}
                        </button>
                      </div>
                    </div>
                  </div>

                  {!!selectedPaper.displayPdf && selectedPaper.pdfUrl && (
                    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Source PDF</span>
                        <a href={selectedPaper.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
                        </a>
                      </div>
                      <iframe
                        src={selectedPaper.pdfUrl}
                        className="w-full"
                        style={{ height: '800px' }}
                        title="Source PDF"
                      />
                    </div>
                  )}

                  {selectedReview && (
                    <div className="pt-12">
                      <ReviewCard
                        review={{
                          ...selectedReview,
                          createdAt: new Date(selectedReview.createdAt).getTime(),
                        }}
                        onLike={handleLikeReview}
                        isLiked={userLikes.has(selectedReview.id)}
                        isAdmin={isAdmin}
                      />
                    </div>
                  )}

                  <CommentSection
                    comments={comments.map(c => ({ ...c, targetId: c.paperId, createdAt: new Date(c.createdAt).getTime() }))}
                    onAddComment={handleAddComment}
                    user={user ? { displayName: displayName(user), photoURL: user.profileImageUrl } : null}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {isSubmitting && (
          <SubmissionForm
            onSubmit={handleSubmitPaper}
            onEnqueueReviewJob={enqueueReviewJob}
            onPollReviewJob={waitForReviewJob}
            onReviewJobComplete={handleReviewJobComplete}
            onClose={() => setIsSubmitting(false)}
            isAdmin={isAdmin}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHowItWorks && (
          <HowItWorksModal onClose={handleCloseHowItWorks} />
        )}
        {showSandbox && isAdmin && (
          <SandboxViewer
            onClose={() => {
              window.history.pushState({}, '', '/');
              setShowSandbox(false);
            }}
          />
        )}
        {showPromptAnalysis && (
          <PromptAnalysis onClose={() => setShowPromptAnalysis(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {metadataEditorOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="mb-5">
                <h2 className="text-xl font-black text-slate-900">Edit Paper Metadata</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Correct the title or author list extracted from the PDF.</p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-widest text-slate-400">Title</span>
                  <textarea
                    value={metadataTitle}
                    onChange={(e) => setMetadataTitle(e.target.value)}
                    className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-widest text-slate-400">Authors</span>
                  <textarea
                    value={metadataAuthors}
                    onChange={(e) => setMetadataAuthors(e.target.value)}
                    placeholder="Author One, Author Two"
                    className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setMetadataEditorOpen(false)}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMetadata}
                  disabled={metadataSaving || !metadataTitle.trim()}
                  className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {metadataSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="bg-white border-t border-slate-200 py-12 mt-24">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="bg-slate-900 p-1.5 rounded-lg"><BookOpen className="w-5 h-5 text-white" /></div>
            <span className="text-lg font-bold text-slate-900">Modern Science Review</span>
          </div>
          <p className="text-slate-500 text-sm font-medium">Empowering researchers with AI-driven insights and public timestamping.</p>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-8">2026 Modern Science Review — Powered by Gemini Pro x2 + Blind Adjudicator</div>
        </div>
      </footer>
    </div>
  );
}
