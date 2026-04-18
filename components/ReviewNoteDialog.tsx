'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';

interface ReviewNoteDialogProps {
  open: boolean;
  type: 'approve' | 'reject';
  submissionName: string;
  onClose: () => void;
  onSubmit: (note?: string) => Promise<void> | void;
  loading?: boolean;
}

export function ReviewNoteDialog({
  open,
  type,
  submissionName,
  onClose,
  onSubmit,
  loading = false,
}: ReviewNoteDialogProps) {
  const [note, setNote] = useState('');

  const handleSubmit = async () => {
    await onSubmit(note.trim() || undefined);
    setNote('');
  };

  const handleClose = () => {
    setNote('');
    onClose();
  };

  const isApprove = type === 'approve';
  const bgColor = isApprove ? 'bg-emerald-500/10' : 'bg-rose-500/10';
  const borderColor = isApprove ? 'border-emerald-500/30' : 'border-rose-500/30';
  const textColor = isApprove ? 'text-emerald-400' : 'text-rose-400';
  const accentColor = isApprove ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-rose-500/20 border-rose-500/40';
  const buttonBg = isApprove
    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30'
    : 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm"
            onClick={() => !loading && handleClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-6"
          >
            <div className={`glass-panel w-full max-w-sm ${bgColor} border ${borderColor} overflow-hidden`}>
              <div className="flex items-start justify-between gap-4 p-6 pb-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentColor} border`}>
                    {isApprove ? (
                      <CheckCircle2 size={20} className={textColor} />
                    ) : (
                      <AlertCircle size={20} className={textColor} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-lg tracking-tight">
                      {isApprove ? 'Teslimi Onayla' : 'Teslimi Reddet'}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--color-text-medium)] truncate">
                      {submissionName}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !loading && handleClose()}
                  disabled={loading}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] hover:bg-white/6 disabled:opacity-50"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-6 pb-6 space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--color-text-high)]">
                    {isApprove ? 'Şef Notu (İsteğe bağlı)' : 'Şef Notu / Red Sebebi (İsteğe bağlı)'}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      isApprove
                        ? 'Onay notunu yazın...'
                        : 'Red sebebini yazın...'
                    }
                    maxLength={1000}
                    disabled={loading}
                    className="w-full rounded-[4px] border border-[var(--color-border)] bg-white/5 p-3 text-sm text-[var(--color-text-high)] placeholder-[var(--color-text-medium)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50 resize-none"
                    rows={4}
                  />
                  <p className="text-[0.65rem] text-[var(--color-text-medium)]">
                    {note.length} / 1000 karakter
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => !loading && handleClose()}
                    disabled={loading}
                    className="flex-1 rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.1em] text-[var(--color-text-medium)] hover:bg-white/6 disabled:opacity-50 transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className={`flex-1 rounded-[4px] border px-4 py-2.5 text-sm font-bold uppercase tracking-[0.1em] transition-colors disabled:opacity-50 ${buttonBg}`}
                  >
                    {isApprove ? 'Onayla' : 'Reddet'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
