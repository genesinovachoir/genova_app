'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, Music2, FileText, Mic, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { ALLOWED_SHEET_TYPES, ALLOWED_MIDI_TYPES, ALLOWED_AUDIO_TYPES, ALLOWED_SUBMISSION_TYPES, formatFileSize } from '@/lib/drive';

type UploadMode = 'sheet' | 'midi' | 'audio' | 'submission';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: UploadMode;
  title: string;
  description?: string;
  /** Partisyon label seçimi için (midi modunda) */
  showPartitionLabel?: boolean;
  onUpload: (file: File, partitionLabel?: string) => Promise<void>;
}

const MODE_CONFIG: Record<UploadMode, {
  icon: React.ElementType;
  acceptedTypes: string[];
  accept: string;
  hint: string;
  color: string;
}> = {
  sheet: {
    icon: FileText,
    acceptedTypes: ALLOWED_SHEET_TYPES,
    accept: '.pdf',
    hint: 'PDF dosyası',
    color: 'text-[#C0B283]',
  },
  midi: {
    icon: Music2,
    acceptedTypes: ALLOWED_MIDI_TYPES,
    accept: '.mid,.midi',
    hint: 'MIDI dosyası (.mid veya .midi)',
    color: 'text-sky-400',
  },
  audio: {
    icon: Mic,
    acceptedTypes: ALLOWED_AUDIO_TYPES,
    accept: '.mp3',
    hint: 'MP3 dosyası',
    color: 'text-purple-400',
  },
  submission: {
    icon: Upload,
    acceptedTypes: ALLOWED_SUBMISSION_TYPES,
    accept: '.mp3,.mp4,.m4a,.wav,.ogg,.mid,.midi,.pdf',
    hint: 'Ses kaydı, MIDI veya PDF (max 100MB)',
    color: 'text-[#C0B283]',
  },
};

const PARTITION_LABELS = [
  'Tutti', 'Soprano', 'Soprano 1', 'Soprano 2',
  'Alto', 'Alto 1', 'Alto 2',
  'Tenor', 'Tenor 1', 'Tenor 2',
  'Bass', 'Bass 1', 'Bass 2',
  'Voix de Tête', 'Baritone',
];

export function FileUploadModal({
  isOpen,
  onClose,
  mode,
  title,
  description,
  showPartitionLabel = false,
  onUpload,
}: FileUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [partitionLabel, setPartitionLabel] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = MODE_CONFIG[mode];
  const Icon = config.icon;

  const reset = useCallback(() => {
    setSelectedFile(null);
    setPartitionLabel('');
    setError(null);
    setSuccess(false);
    setUploading(false);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [isOpen]);

  const handleClose = () => {
    if (!uploading) {
      reset();
      onClose();
    }
  };

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!config.acceptedTypes.includes(ext)) {
      return `Geçersiz dosya tipi. Kabul edilenler: ${config.acceptedTypes.join(', ')}`;
    }
    if (file.size > 100 * 1024 * 1024) {
      return 'Dosya boyutu 100MB\'ı aşamaz';
    }
    return null;
  };

  const handleFile = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (showPartitionLabel && mode === 'midi' && !partitionLabel) {
      setError('Lütfen partisyon etiketini seçin');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      await onUpload(selectedFile, showPartitionLabel ? partitionLabel : undefined);
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', bounce: 0.12, duration: 0.45 }}
            className="fixed inset-0 z-[60] flex flex-col bg-[var(--color-surface-solid)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-4 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-2">
                <Icon size={16} className={config.color} />
                <h2 className="font-serif text-[1.1rem] tracking-[-0.02em] font-medium">{title}</h2>
              </div>
              <button
                onClick={handleClose}
                disabled={uploading}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Partition Label (MIDI modu için) */}
              {showPartitionLabel && mode === 'midi' && (
                <div>
                  <label className="block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] mb-2">
                    Partisyon Etiketi
                  </label>
                  <select
                    value={partitionLabel}
                    onChange={e => setPartitionLabel(e.target.value)}
                    className="editorial-input"
                  >
                    <option value="">Seçin...</option>
                    {PARTITION_LABELS.map(label => (
                      <option key={label} value={label}>{label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Drop Zone */}
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !selectedFile && inputRef.current?.click()}
                className={`
                  relative rounded-[4px] border-2 border-dashed p-8 text-center transition-all cursor-pointer
                  ${isDragging
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : selectedFile
                    ? 'border-[var(--color-border-strong)] bg-white/4 cursor-default'
                    : 'border-[var(--color-border)] bg-white/2 hover:border-[var(--color-border-strong)] hover:bg-white/4'
                  }
                `}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={config.accept}
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <AnimatePresence mode="wait">
                  {success ? (
                    <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3">
                      <CheckCircle2 size={36} className="text-emerald-400" />
                      <p className="font-medium text-emerald-400">Yüklendi!</p>
                    </motion.div>
                  ) : uploading ? (
                    <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
                      <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
                      <p className="text-sm text-[var(--color-text-medium)]">Google Drive üzerine yükleniyor...</p>
                    </motion.div>
                  ) : selectedFile ? (
                    <motion.div key="selected" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                      <Icon size={32} className={config.color} />
                      <div>
                        <p className="font-medium text-[var(--color-text-high)] truncate max-w-[280px]">{selectedFile.name}</p>
                        <p className="text-xs text-[var(--color-text-medium)] mt-1">{formatFileSize(selectedFile.size)}</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setSelectedFile(null); }} className="text-xs text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] underline underline-offset-2">
                        Değiştir
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4">
                        <Icon size={24} className={config.color} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text-high)]">Dosyayı buraya sürükle veya tıkla</p>
                        <p className="mt-1 text-xs text-[var(--color-text-medium)]">{config.hint}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                  >
                    <AlertCircle size={14} className="shrink-0 text-red-400" />
                    <p className="text-xs text-red-400">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sticky Footer */}
            <div className="shrink-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-[var(--color-border)]">
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading || success}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-4 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {uploading ? <><Loader2 size={16} className="animate-spin" /> Yükleniyor...</> : 'Yükle'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
