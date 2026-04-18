'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastRecord {
  id: string;
  title?: string;
  description: string;
  variant: ToastVariant;
  durationMs: number;
}

interface ToastInput {
  title?: string;
  description: string;
  durationMs?: number;
  variant?: ToastVariant;
}

interface ToastContextValue {
  pushToast: (input: ToastInput) => void;
  success: (description: string, title?: string) => void;
  error: (description: string, title?: string) => void;
  info: (description: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof Info; border: string; text: string }> = {
  success: {
    icon: CheckCircle2,
    border: 'border-emerald-500/30 bg-emerald-500/10',
    text: 'text-emerald-300',
  },
  error: {
    icon: AlertCircle,
    border: 'border-rose-500/30 bg-rose-500/10',
    text: 'text-rose-300',
  },
  info: {
    icon: Info,
    border: 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]',
    text: 'text-[var(--color-text-high)]',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    ({ title, description, durationMs = 3200, variant = 'info' }: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: ToastRecord = { id, title, description, durationMs, variant };
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => removeToast(id), durationMs);
    },
    [removeToast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      pushToast,
      success: (description, title) => pushToast({ description, title, variant: 'success' }),
      error: (description, title) => pushToast({ description, title, variant: 'error' }),
      info: (description, title) => pushToast({ description, title, variant: 'info' }),
    }),
    [pushToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[250] mx-auto flex max-w-lg flex-col gap-3 px-4 pb-[calc(8rem+env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {toasts.map((toast) => {
            const style = VARIANT_STYLES[toast.variant];
            const Icon = style.icon;
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                className={`pointer-events-auto rounded-[var(--radius-panel)] border p-4 shadow-2xl backdrop-blur ${style.border}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 ${style.text}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {toast.title ? (
                      <p className="text-sm font-semibold text-[var(--color-text-high)]">{toast.title}</p>
                    ) : null}
                    <p className="text-sm text-[var(--color-text-high)]/90">{toast.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeToast(toast.id)}
                    className="rounded-md p-1 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 hover:text-[var(--color-text-high)]"
                    aria-label="Bildirimi kapat"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
