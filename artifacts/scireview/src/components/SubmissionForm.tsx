import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, X, BookOpen, Loader2, FileText, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ReviewSource } from '../services/reviewService';

interface SubmissionFormProps {
  onSubmit: (source: ReviewSource) => Promise<void>;
  onClose: () => void;
}

export default function SubmissionForm({ onSubmit, onClose }: SubmissionFormProps) {
  const [submissionType, setSubmissionType] = useState<'pdf' | 'text'>('pdf');
  const [text, setText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    const file = acceptedFiles[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPdfBase64(base64);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    disabled: isSubmitting,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let source: ReviewSource | null = null;
    if (submissionType === 'pdf' && pdfBase64) {
      source = { type: 'pdf', data: pdfBase64 };
    } else if (submissionType === 'text' && text.trim()) {
      source = { type: 'text', data: text.trim() };
    }

    if (source) {
      setIsSubmitting(true);
      try {
        await onSubmit(source);
        onClose();
      } catch (err: any) {
        setError(err.message || 'Submission failed. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const isFormValid = (submissionType === 'pdf' && pdfBase64) || (submissionType === 'text' && text.trim());

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
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Submit Scientific Paper</h2>
              <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest">AI Review via GPT-4.5 Pro</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="space-y-4">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Submission Method</label>
            <div className="flex gap-2">
              {[
                { id: 'pdf', label: 'PDF File', icon: FileText },
                { id: 'text', label: 'Raw Text', icon: Upload },
              ].map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSubmissionType(type.id as 'pdf' | 'text')}
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

          {submissionType === 'pdf' ? (
            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Upload PDF</label>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  isDragActive ? 'border-indigo-500 bg-indigo-50' : pdfFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                }`}
              >
                <input {...getInputProps()} />
                {pdfFile ? (
                  <div className="space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                    <p className="font-bold text-emerald-700">{pdfFile.name}</p>
                    <p className="text-sm text-emerald-600">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB — ready to submit</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FileText className="w-10 h-10 text-slate-400 mx-auto" />
                    <p className="font-bold text-slate-600">Drop your PDF here, or click to browse</p>
                    <p className="text-sm text-slate-400">Text will be extracted automatically for AI review</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
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
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-4">
          <button onClick={onClose} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:text-slate-700 transition-colors">
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
                Reviewing with GPT-4.5 Pro...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit for AI Review
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
