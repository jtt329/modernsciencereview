import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, BookOpen, Loader2, FileText, Upload, CheckCircle2, AlertCircle, Cpu, Trash2, Link } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ReviewSource, ReviewModel } from '../services/reviewService';

interface SubmissionFormProps {
  onSubmit: (source: ReviewSource, skipSelect?: boolean) => Promise<void>;
  onClose: () => void;
}

interface QueuedFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

type PdfMode = 'upload' | 'link';

function isValidUrl(value: string) {
  try { new URL(value); return true; } catch { return false; }
}

export default function SubmissionForm({ onSubmit, onClose }: SubmissionFormProps) {
  const [submissionType, setSubmissionType] = useState<'pdf' | 'text'>('pdf');
  const [model, setModel] = useState<ReviewModel>('gpt');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [pdfMode, setPdfMode] = useState<PdfMode | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const isBatch = files.length > 1;

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    const pdfs = acceptedFiles.filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) return;
    setFiles(prev => [
      ...prev,
      ...pdfs.map(f => ({ id: `${f.name}-${Date.now()}-${Math.random()}`, file: f, status: 'pending' as const })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: isSubmitting,
  });

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    setDoneCount(0);

    try {
      if (submissionType === 'text') {
        if (!text.trim()) return;
        await onSubmit({ type: 'text', data: text.trim(), model });
        onClose();
        return;
      }

      // PDF mode
      if (pdfMode === 'link') {
        await onSubmit({ type: 'url', data: pdfUrl.trim(), model });
        onClose();
        return;
      }

      if (files.length === 0) return;

      if (files.length === 1) {
        const base64 = await readFileAsBase64(files[0].file);
        await onSubmit({ type: 'pdf', data: base64, model });
        onClose();
        return;
      }

      let done = 0;
      for (const qf of files) {
        setFiles(prev => prev.map(f => f.id === qf.id ? { ...f, status: 'processing' } : f));
        try {
          const base64 = await readFileAsBase64(qf.file);
          await onSubmit({ type: 'pdf', data: base64, model }, true);
          done++;
          setDoneCount(done);
          setFiles(prev => prev.map(f => f.id === qf.id ? { ...f, status: 'done' } : f));
        } catch (err: any) {
          setFiles(prev => prev.map(f => f.id === qf.id ? { ...f, status: 'error', error: err.message } : f));
        }
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const pdfUrlValid = isValidUrl(pdfUrl.trim());
  const isFormValid = submissionType === 'text'
    ? !!text.trim()
    : pdfMode === 'link'
      ? pdfUrlValid
      : pdfMode === 'upload' && files.length > 0;

  const toggleMode = (mode: PdfMode) => {
    setPdfMode(prev => prev === mode ? null : mode);
    if (mode === 'upload') { setPdfUrl(''); }
    if (mode === 'link') { setFiles([]); }
  };

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
                Blind AI Review · {model === 'gemini' ? 'Gemini 3.1 Pro' : 'GPT-5.4 Pro'}
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
                  { id: 'pdf', label: 'PDF / Link', icon: FileText },
                  { id: 'text', label: 'Raw Text', icon: Upload },
                ].map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => { setSubmissionType(type.id as 'pdf' | 'text'); setFiles([]); setPdfMode(null); setPdfUrl(''); }}
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
                  { id: 'gpt', label: 'GPT-5.4 Pro' },
                  { id: 'gemini', label: 'Gemini 3.1 Pro' },
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

          {/* PDF section */}
          {submissionType === 'pdf' && (
            <div className="space-y-5">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Select one option</label>

              {/* Option 1 — Upload */}
              <div className={`rounded-2xl border-2 transition-all ${pdfMode === 'upload' ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                <button
                  type="button"
                  onClick={() => toggleMode('upload')}
                  disabled={isSubmitting}
                  className="w-full flex items-center gap-3 p-4 text-left"
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                    pdfMode === 'upload' ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                  }`}>
                    {pdfMode === 'upload' && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">Upload PDF file(s)</p>
                    <p className="text-xs text-slate-500 mt-0.5">Drop one or more PDFs — text is extracted and reviewed by AI</p>
                  </div>
                </button>

                <AnimatePresence>
                  {pdfMode === 'upload' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 pb-4 space-y-3"
                    >
                      <div
                        {...getRootProps()}
                        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                          isDragActive ? 'border-indigo-500 bg-indigo-100' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                        }`}
                      >
                        <input {...getInputProps()} />
                        <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <p className="font-bold text-slate-600 text-sm">
                          {isDragActive ? 'Drop PDFs here…' : 'Drop PDFs here or click to browse'}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Drop an entire folder's worth — each reviewed sequentially</p>
                      </div>

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
                                  <p className="text-xs text-indigo-500">Reviewing with {model === 'gemini' ? 'Gemini 3.1 Pro' : 'GPT-5.4 Pro'}…</p>
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Option 2 — Web link */}
              <div className={`rounded-2xl border-2 transition-all ${pdfMode === 'link' ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                <button
                  type="button"
                  onClick={() => toggleMode('link')}
                  disabled={isSubmitting}
                  className="w-full flex items-center gap-3 p-4 text-left"
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                    pdfMode === 'link' ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                  }`}>
                    {pdfMode === 'link' && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">Provide PDF web link</p>
                    <p className="text-xs text-slate-500 mt-0.5">Paste a direct link to a PDF — it will be fetched and reviewed by AI</p>
                  </div>
                </button>

                <AnimatePresence>
                  {pdfMode === 'link' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 pb-4"
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
                        <p className="text-xs text-rose-600 font-medium mt-2">Please enter a valid URL (must start with http:// or https://)</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!pdfMode && (
                <p className="text-xs text-amber-600 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> Select one of the options above to continue
                </p>
              )}
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
                    : pdfMode === 'link'
                      ? 'Fetching PDF and generating blind peer review…'
                      : 'Generating blind peer review…'}
                </p>
                <p className="text-indigo-500 text-xs mt-1">
                  {isBatch
                    ? 'Each paper takes 60–120 seconds. Please keep this window open.'
                    : 'This runs two AI passes — metadata extraction then a full structured review. It typically takes 60–120 seconds. Please keep this window open.'}
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
                {isBatch ? `${doneCount}/${files.length} done…` : `Reviewing with ${model === 'gemini' ? 'Gemini 3.1 Pro' : 'GPT-5.4 Pro'}…`}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                {isBatch ? `Submit ${files.length} Papers` : 'Submit for AI Review'}
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
