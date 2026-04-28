import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, BookOpen, Loader2, FileText, CheckCircle2, AlertCircle, RotateCcw, Cpu } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ReviewSource, ReviewModel } from '../services/reviewService';

interface BulkFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

interface BulkSubmissionFormProps {
  onSubmit: (source: ReviewSource, skipSelect?: boolean) => Promise<void>;
  onClose: () => void;
}

export default function BulkSubmissionForm({ onSubmit, onClose }: BulkSubmissionFormProps) {
  const [files, setFiles] = useState<BulkFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [model, setModel] = useState<ReviewModel>('gemini');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: BulkFile[] = acceptedFiles
      .filter(f => f.type === 'application/pdf')
      .map(f => ({ id: `${f.name}-${Date.now()}`, file: f, status: 'pending' }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: isSubmitting,
  });

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const doneCount = files.filter(f => f.status === 'done').length;

  const handleBulkSubmit = async (retryErrors = false) => {
    const toProcess = files.filter(f => retryErrors ? f.status === 'error' : f.status === 'pending');
    if (toProcess.length === 0) return;
    setIsSubmitting(true);

    for (const bulkFile of toProcess) {
      setFiles(prev => prev.map(f => f.id === bulkFile.id ? { ...f, status: 'processing' } : f));
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(bulkFile.file);
        });
        await onSubmit({ type: 'pdf', data: base64, model }, true);
        setFiles(prev => prev.map(f => f.id === bulkFile.id ? { ...f, status: 'done' } : f));
      } catch (err: any) {
        setFiles(prev => prev.map(f => f.id === bulkFile.id ? { ...f, status: 'error', error: err.message } : f));
      }
    }
    setIsSubmitting(false);
  };

  const removeFile = (id: string) => {
    if (!isSubmitting) setFiles(prev => prev.filter(f => f.id !== id));
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
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Bulk Paper Upload</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin — Process Multiple PDFs</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSubmitting} className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="flex items-center gap-3">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Cpu className="w-3 h-3" /> Review Model
            </label>
            {([
              { id: 'gemini', label: 'Gemini 3.1 Pro Thinking' },
              { id: 'gpt', label: 'GPT-5.4 Pro' },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                disabled={isSubmitting}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all border ${
                  model === m.id
                    ? 'bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-100'
                    : 'bg-white/10 text-slate-300 border-white/20 hover:bg-white/20'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
              isDragActive ? 'border-slate-500 bg-slate-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/50'
            }`}
          >
            <input {...getInputProps()} />
            <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="font-bold text-slate-600">Drop multiple PDFs here, or click to select</p>
            <p className="text-sm text-slate-400 mt-1">
              Each PDF will be reviewed sequentially by {model === 'gemini' ? 'Gemini 3.1 Pro Thinking' : 'GPT-5.4 Pro'}
            </p>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Files ({files.length}) — Done: {doneCount} | Pending: {pendingCount} | Errors: {errorCount}
                </p>
              </div>
              <AnimatePresence initial={false}>
                {files.map(f => (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className={`flex items-center gap-4 p-4 rounded-2xl border ${
                      f.status === 'done' ? 'border-emerald-200 bg-emerald-50' :
                      f.status === 'error' ? 'border-rose-200 bg-rose-50' :
                      f.status === 'processing' ? 'border-indigo-200 bg-indigo-50' :
                      'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="shrink-0">
                      {f.status === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {f.status === 'error' && <AlertCircle className="w-5 h-5 text-rose-500" />}
                      {f.status === 'processing' && <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />}
                      {f.status === 'pending' && <FileText className="w-5 h-5 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{f.file.name}</p>
                      {f.status === 'error' && f.error && (
                        <p className="text-xs text-rose-600 mt-0.5 truncate">{f.error}</p>
                      )}
                      {f.status === 'processing' && (
                        <p className="text-xs text-indigo-600 mt-0.5">
                          Reviewing with {model === 'gemini' ? 'Gemini 3.1 Pro Thinking' : 'GPT-5.4 Pro'}...
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0">
                      {(f.file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                    {f.status === 'pending' && !isSubmitting && (
                      <button onClick={() => removeFile(f.id)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-4">
          <button onClick={onClose} disabled={isSubmitting} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors">
            {doneCount > 0 && pendingCount === 0 && errorCount === 0 ? 'Done' : 'Cancel'}
          </button>
          {errorCount > 0 && pendingCount === 0 && !isSubmitting ? (
            <>
              <button
                onClick={() => setFiles(prev => prev.map(f => ({ ...f, status: 'pending', error: undefined })))}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Restart All
              </button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleBulkSubmit(true)}
                className="bg-rose-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-rose-100 hover:bg-rose-700 transition-all flex items-center gap-3"
              >
                <Send className="w-5 h-5" />
                Retry Failed ({errorCount})
              </motion.button>
            </>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleBulkSubmit(false)}
              disabled={isSubmitting || files.length === 0 || pendingCount === 0}
              className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-3"
            >
              {isSubmitting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
              ) : (
                <><Send className="w-5 h-5" /> Start Bulk Review ({pendingCount})</>
              )}
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
