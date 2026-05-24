import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, BookOpen, Loader2, FileText, Upload, CheckCircle2, AlertCircle, Cpu, Trash2, Link, Monitor } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ReviewSource, ReviewModel, ReviewMode } from '../services/reviewService';

interface SubmissionFormProps {
  onSubmit: (source: ReviewSource, skipSelect?: boolean) => Promise<void>;
  onClose: () => void;
  isAdmin?: boolean;
}

interface QueuedFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

const MAX_QUEUED_PDFS = 50;
const BATCH_CONCURRENCY = 2;
const SUBMISSION_RETRY_DELAYS_MS: number[] = [];

const reviewModeCopy: Record<ReviewMode, { label: string; shortLabel: string; description: string; processing: string }> = {
  'benchmark-ingestion': {
    label: 'Benchmark ingestion',
    shortLabel: 'Gemini Pro x2 + blind adjudicator',
    description: 'Blind intrinsic review only. Use this for building the benchmark suite before calibration backfill.',
    processing: 'Reviewing with Gemini Pro x2 + blind adjudicator...',
  },
  'normal-review': {
    label: 'Normal calibrated review',
    shortLabel: 'Gemini Pro x2 + blind adjudicator + calibration',
    description: 'Blind review first, then calibrate against nearby benchmark papers if available.',
    processing: 'Reviewing with Gemini Pro x2 + blind adjudicator + calibration...',
  },
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDelay(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function isConnectionLoss(message: string) {
  return /failed to fetch|load failed|networkerror|network request failed|connection|timed out|aborted/i.test(message);
}

function isRetryableSubmissionError(err: unknown) {
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  if ((err as any)?.transient || [429, 500, 502, 503, 504].includes(status)) return true;
  return /failed to fetch|load failed|networkerror|network request failed|transient model error|resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|\b(429|500|502|503|504)\b/i.test(errorMessage(err));
}

async function waitForApiHealth(maxWaitMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const response = await fetch('/api/healthz', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.ok) return true;
    } catch {}
    await sleep(5_000);
  }
  return false;
}

function isValidUrl(value: string) {
  try { new URL(value); return true; } catch { return false; }
}

export default function SubmissionForm({ onSubmit, onClose, isAdmin = false }: SubmissionFormProps) {
  const [submissionType, setSubmissionType] = useState<'pdf' | 'text'>('pdf');
  const [model, setModel] = useState<ReviewModel>('gemini');
  const [reviewMode, setReviewMode] = useState<ReviewMode>(isAdmin ? 'benchmark-ingestion' : 'normal-review');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [providePdfLink, setProvidePdfLink] = useState(false);
  const [displayPdf, setDisplayPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const isBatch = files.length > 1;
  const remainingFiles = files.filter(f => f.status !== 'done');
  const failedFiles = files.filter(f => f.status === 'error');
  const effectiveReviewMode: ReviewMode = isAdmin ? reviewMode : 'normal-review';

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    const pdfs = acceptedFiles.filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) {
      setError('Please upload PDF files.');
      return;
    }
    setFiles(prev => {
      const remainingSlots = Math.max(0, MAX_QUEUED_PDFS - prev.length);
      const accepted = pdfs.slice(0, remainingSlots);
      if (accepted.length < pdfs.length) {
        setError(`You can queue up to ${MAX_QUEUED_PDFS} PDFs at a time. Extra files were not added.`);
      }
      return [
        ...prev,
        ...accepted.map(f => ({ id: `${f.name}-${Date.now()}-${Math.random()}`, file: f, status: 'pending' as const })),
      ];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: isSubmitting || files.length >= MAX_QUEUED_PDFS,
  });

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const setFileStatus = (id: string, patch: Partial<QueuedFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const submitWithRetries = async (
    qf: QueuedFile,
    source: ReviewSource,
    skipSelectAfterSubmit: boolean,
  ) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= SUBMISSION_RETRY_DELAYS_MS.length; attempt++) {
      try {
        setFileStatus(qf.id, { status: 'processing', error: attempt > 0 ? `Retry ${attempt + 1} in progress...` : undefined });
        await onSubmit(source, skipSelectAfterSubmit);
        return;
      } catch (err) {
        lastError = err;
        const message = errorMessage(err);
        const canRetry = isRetryableSubmissionError(err) && attempt < SUBMISSION_RETRY_DELAYS_MS.length;
        if (!canRetry) break;

        const delay = SUBMISSION_RETRY_DELAYS_MS[attempt];
        const waitingForApi = isConnectionLoss(message);
        setFileStatus(qf.id, {
          status: 'processing',
          error: waitingForApi
            ? `Connection dropped. Waiting for API health, then retrying in ${formatDelay(delay)}...`
            : `Temporary model/API issue. Retrying in ${formatDelay(delay)}...`,
        });

        if (waitingForApi) {
          await waitForApiHealth();
        }
        await sleep(delay);
      }
    }

    throw lastError;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    setDoneCount(0);

    const linkUrl = providePdfLink && isValidUrl(pdfUrl.trim()) ? pdfUrl.trim() : undefined;

    try {
      if (submissionType === 'text') {
        if (!text.trim()) return;
        await onSubmit({ type: 'text', data: text.trim(), model, reviewMode: effectiveReviewMode });
        onClose();
        return;
      }

      const filesToProcess = files.filter(f => f.status !== 'done');
      if (filesToProcess.length === 0) {
        onClose();
        return;
      }

      let done = files.filter(f => f.status === 'done').length;
      let failures = 0;
      const skipSelectAfterSubmit = files.length > 1;
      setDoneCount(done);
      let nextIndex = 0;

      const processOne = async (qf: QueuedFile) => {
        setFileStatus(qf.id, { status: 'processing', error: undefined });
        try {
          const base64 = await readFileAsBase64(qf.file);
          await submitWithRetries(
            qf,
            { type: 'pdf', data: base64, model, reviewMode: effectiveReviewMode, fileName: qf.file.name, pdfUrl: linkUrl, displayPdf: displayPdf && !!linkUrl },
            skipSelectAfterSubmit,
          );
          done++;
          setDoneCount(done);
          setFileStatus(qf.id, { status: 'done', error: undefined });
        } catch (err: any) {
          failures++;
          const message = err?.message ?? String(err);
          setFileStatus(qf.id, { status: 'error', error: message });
        }
      };

      const workers = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, filesToProcess.length) },
        async () => {
          while (nextIndex < filesToProcess.length) {
            const qf = filesToProcess[nextIndex++];
            await processOne(qf);
          }
        },
      );

      await Promise.all(workers);

      if (failures > 0) {
        setError(`${failures} of ${filesToProcess.length} remaining papers failed. Completed papers were saved. You can retry the failed papers.`);
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err?.message ?? String(err) ?? 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pdfUrlValid = isValidUrl(pdfUrl.trim());
  const isFormValid = submissionType === 'text'
    ? !!text.trim()
    : remainingFiles.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Submit Scientific Paper</h2>
              <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest">
                Blind AI Review · {reviewModeCopy[effectiveReviewMode].shortLabel}
                {isBatch && ` · ${files.length} papers queued`}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSubmitting} className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-40">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">

          {/* Method + Model row */}
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="space-y-4 flex-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Submission Method</label>
              <div className="flex gap-2">
                {[
                  { id: 'pdf', label: 'PDF Upload', icon: FileText },
                  { id: 'text', label: 'Raw Text', icon: Upload },
                ].map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => { setSubmissionType(type.id as 'pdf' | 'text'); setFiles([]); }}
                    disabled={isSubmitting}
                    className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all border ${
                      submissionType === type.id
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <type.icon className="w-4 h-4" />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Cpu className="w-3 h-3" /> Review Model
              </label>
              <div className="flex gap-2">
                {([
                  { id: 'gemini', label: 'Gemini Pro x2 + Calibration' },
                ] as const).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    disabled={isSubmitting}
                    className={`px-4 py-3 rounded-xl font-bold text-sm transition-all border ${
                      model === m.id
                        ? 'bg-violet-600 text-white border-violet-600 shadow-lg shadow-violet-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-3">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Review Mode</label>
              <div className="grid sm:grid-cols-2 gap-3">
                {(['benchmark-ingestion', 'normal-review'] as ReviewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReviewMode(mode)}
                    disabled={isSubmitting}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      reviewMode === mode
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-sm font-black">{reviewModeCopy[mode].label}</p>
                    <p className={`text-xs mt-1 ${reviewMode === mode ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {reviewModeCopy[mode].description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PDF section */}
          {submissionType === 'pdf' && (
            <div className="space-y-5">
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40'
                } ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input {...getInputProps()} />
                <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="font-bold text-slate-700">
                  {isDragActive ? 'Drop PDFs here…' : 'Drop PDFs here, or click to browse'}
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Queue up to {MAX_QUEUED_PDFS} PDFs. Up to {BATCH_CONCURRENCY} files are reviewed at once and saved as each review finishes.
                </p>
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map(qf => (
                    <div
                      key={qf.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-sm ${
                        qf.status === 'done' ? 'bg-emerald-50 border-emerald-200' :
                        qf.status === 'error' ? 'bg-rose-50 border-rose-200' :
                        qf.status === 'processing' ? 'bg-indigo-50 border-indigo-200' :
                        'bg-slate-50 border-slate-200'
                      }`}
                    >
                      {qf.status === 'processing' ? (
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                      ) : qf.status === 'done' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : qf.status === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 truncate">{qf.file.name}</p>
                        {qf.status === 'processing' && (
                          <p className="text-xs text-indigo-500 truncate">{qf.error || reviewModeCopy[effectiveReviewMode].processing}</p>
                        )}
                        {qf.status === 'error' && <p className="text-xs text-rose-600 truncate">{qf.error}</p>}
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold shrink-0">
                        {(qf.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      {!isSubmitting && qf.status === 'pending' && (
                        <button onClick={() => removeFile(qf.id)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors shrink-0">
                          <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Optional extras */}
              <div className="space-y-3 pt-1">
                {/* Checkbox: Provide PDF web link */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => { setProvidePdfLink(v => !v); if (providePdfLink) { setPdfUrl(''); setDisplayPdf(false); } }}
                    disabled={isSubmitting}
                    className="flex items-center gap-3 group"
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                      providePdfLink ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'
                    }`}>
                      {providePdfLink && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                        <Link className="w-3.5 h-3.5 text-slate-500" /> Provide PDF web link
                      </p>
                      <p className="text-xs text-slate-500">Adds a clickable link on the review page so visitors can read the source PDF</p>
                    </div>
                  </button>

                  <AnimatePresence>
                    {providePdfLink && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pl-8"
                      >
                        <div className="relative">
                          <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input
                            type="url"
                            value={pdfUrl}
                            onChange={e => setPdfUrl(e.target.value)}
                            disabled={isSubmitting}
                            placeholder="https://arxiv.org/pdf/..."
                            className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-medium transition-all outline-none focus:ring-2 ${
                              pdfUrl && !pdfUrlValid
                                ? 'border-rose-300 bg-rose-50 focus:ring-rose-300'
                                : pdfUrlValid
                                  ? 'border-emerald-300 bg-emerald-50 focus:ring-emerald-300'
                                  : 'border-slate-200 bg-white focus:ring-indigo-300'
                            }`}
                          />
                        </div>
                        {pdfUrl && !pdfUrlValid && (
                          <p className="text-xs text-rose-600 font-medium mt-1">Please enter a valid URL</p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Checkbox: Display PDF with review */}
                <button
                  type="button"
                  onClick={() => setDisplayPdf(v => !v)}
                  disabled={isSubmitting || (!providePdfLink || !pdfUrlValid)}
                  className={`flex items-center gap-3 group ${(!providePdfLink || !pdfUrlValid) ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                    displayPdf && providePdfLink && pdfUrlValid ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'
                  }`}>
                    {displayPdf && providePdfLink && pdfUrlValid && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-slate-500" /> Display PDF with review
                    </p>
                    <p className="text-xs text-slate-500">Embeds the PDF inline on the review page using the web link above</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Text section */}
          {submissionType === 'text' && (
            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Paper Content</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the full text of your paper here..."
                disabled={isSubmitting}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none min-h-[300px]"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-2xl p-5">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-rose-700 text-sm font-medium">{error}</p>
            </div>
          )}

          {isSubmitting && (
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-indigo-800 text-sm font-bold">
                  {isBatch
                    ? `Reviewing paper ${doneCount + 1} of ${files.length}…`
                    : 'Generating blind peer review…'}
                </p>
                <p className="text-indigo-500 text-xs mt-1">
                  {isBatch
                    ? `Up to ${BATCH_CONCURRENCY} papers are reviewed at once. Each completed paper is saved immediately, and failed papers do not block the rest of the queue.`
                    : effectiveReviewMode === 'benchmark-ingestion'
                      ? 'This runs metadata extraction, two independent blind Gemini Pro review passes, and a blind Gemini Pro adjudicator. Comparator calibration is skipped for benchmark ingestion.'
                      : 'This runs metadata extraction, two independent blind Gemini Pro review passes, a blind Gemini Pro adjudicator, then benchmark comparator calibration. Please keep this window open.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 flex justify-end gap-4">
          <button onClick={onClose} disabled={isSubmitting} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSubmit}
            disabled={isSubmitting || !isFormValid}
            className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-3"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {isBatch ? `${doneCount}/${files.length} done…` : reviewModeCopy[effectiveReviewMode].processing}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                {failedFiles.length > 0
                  ? `Retry ${remainingFiles.length} Failed/Pending`
                  : isBatch
                    ? `Submit ${files.length} Papers`
                    : 'Submit for AI Review'}
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
