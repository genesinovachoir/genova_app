'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Loader2, TriangleAlert, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  tone = 'default',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmClassName =
    tone === 'danger'
      ? 'bg-rose-500 text-white hover:bg-rose-600'
      : 'bg-[var(--color-accent)] text-[var(--color-background)] hover:opacity-90';

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm"
            onClick={() => !loading && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
            className="fixed inset-x-4 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-[221] mx-auto max-w-md rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface-solid)] p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full border border-[var(--color-border)] bg-white/5 p-2 text-[var(--color-accent)]">
                <TriangleAlert size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-serif text-lg tracking-[-0.03em] text-[var(--color-text-high)]">{title}</h3>
                  <button
                    type="button"
                    onClick={() => !loading && onClose()}
                    className="rounded-md p-1 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 hover:text-[var(--color-text-high)]"
                    aria-label="Kapat"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-medium)]">{description}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-[var(--radius-panel)] border border-[var(--color-border)] py-3 text-xs font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`rounded-[var(--radius-panel)] py-3 text-xs font-bold uppercase tracking-[0.15em] transition-colors disabled:opacity-50 ${confirmClassName}`}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    İşleniyor
                  </span>
                ) : (
                  confirmLabel
                )}
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
