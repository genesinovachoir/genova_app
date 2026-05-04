'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, BarChart3 } from 'lucide-react';

const genId = () => crypto.randomUUID();

interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    question: string;
    options: { id: string; text: string }[];
    isAnonymous: boolean;
    isMultipleChoice: boolean;
  }) => void;
}

export function CreatePollModal({ isOpen, onClose, onSubmit }: CreatePollModalProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<{ id: string; text: string }[]>([
    { id: genId(), text: '' },
    { id: genId(), text: '' },
  ]);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isMultipleChoice, setIsMultipleChoice] = useState(false);

  const addOption = () => {
    if (options.length >= 10) return;
    setOptions([...options, { id: genId(), text: '' }]);
  };

  const removeOption = (id: string) => {
    if (options.length <= 2) return;
    setOptions(options.filter((o) => o.id !== id));
  };

  const updateOption = (id: string, text: string) => {
    setOptions(options.map((o) => (o.id === id ? { ...o, text } : o)));
  };

  const handleSubmit = useCallback(() => {
    const trimmedQ = question.trim();
    const validOptions = options.filter((o) => o.text.trim());
    if (!trimmedQ || validOptions.length < 2) return;

    onSubmit({
      question: trimmedQ,
      options: validOptions.map((o) => ({ id: o.id, text: o.text.trim() })),
      isAnonymous,
      isMultipleChoice,
    });

    // Reset
    setQuestion('');
    setOptions([
      { id: genId(), text: '' },
      { id: genId(), text: '' },
    ]);
    setIsAnonymous(false);
    setIsMultipleChoice(false);
    onClose();
  }, [question, options, isAnonymous, isMultipleChoice, onSubmit, onClose]);

  const isValid = question.trim() && options.filter((o) => o.text.trim()).length >= 2;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-t-3xl bg-[var(--color-background)] pb-[env(safe-area-inset-bottom,16px)]"
          style={{ maxHeight: '85dvh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-500" />
              <h2 className="text-lg font-bold text-[var(--color-text-high)]">
                Anket Oluştur
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
            >
              <X size={20} className="text-[var(--color-text-medium)]" />
            </button>
          </div>

          <div
            className="overflow-y-auto px-4 py-4"
            style={{ maxHeight: 'calc(85dvh - 60px)' }}
          >
            {/* Question */}
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Sorunuzu yazın..."
              className="mb-4 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />

            {/* Options */}
            <div className="mb-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--color-text-medium)]">
                Seçenekler (en az 2, en fazla 10)
              </p>
              {options.map((opt, idx) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-500">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    value={opt.text}
                    onChange={(e) => updateOption(opt.id, e.target.value)}
                    placeholder={`Seçenek ${idx + 1}`}
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:border-blue-500 focus:outline-none"
                  />
                  {options.length > 2 && (
                    <button
                      onClick={() => removeOption(opt.id)}
                      className="shrink-0 rounded-full p-1 text-[var(--color-text-low)] hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              {options.length < 10 && (
                <button
                  onClick={addOption}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-500 transition-colors hover:bg-blue-50"
                >
                  <Plus size={16} />
                  Seçenek Ekle
                </button>
              )}
            </div>

            {/* Settings */}
            <div className="mb-4 flex flex-col gap-2 rounded-xl bg-[var(--color-surface)] p-3">
              <ToggleRow
                label="Çoklu Seçim"
                desc="Birden fazla seçenek seçilebilir"
                value={isMultipleChoice}
                onChange={setIsMultipleChoice}
              />
              <ToggleRow
                label="Anonim Oylama"
                desc="Kimler oy verdi gösterilmez"
                value={isAnonymous}
                onChange={setIsAnonymous}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              className="w-full rounded-xl bg-blue-500 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-40"
            >
              Anketi Gönder
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ToggleRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--color-text-high)]">
          {label}
        </p>
        <p className="text-xs text-[var(--color-text-low)]">{desc}</p>
      </div>
      <div
        className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
          value ? 'bg-blue-500' : 'bg-[var(--color-border)]'
        }`}
      >
        <motion.div
          layout
          className="h-4 w-4 rounded-full bg-white shadow-sm"
          animate={{ x: value ? 16 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </div>
    </button>
  );
}
