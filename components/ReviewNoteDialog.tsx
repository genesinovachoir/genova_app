'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle, Mic, Paperclip, Square, Loader2 } from 'lucide-react';
import fixWebmDuration from 'fix-webm-duration';

interface ReviewNoteSubmitPayload {
  note?: string;
  audioFile?: File | null;
}

interface ReviewNoteDialogProps {
  open: boolean;
  type: 'approve' | 'reject';
  submissionName: string;
  onClose: () => void;
  onSubmit: (payload: ReviewNoteSubmitPayload) => Promise<void> | void;
  loading?: boolean;
}

const MAX_REVIEW_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_RECORD_SECONDS = 180;
const MEDIA_RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function fileExtensionForMimeType(mimeType: string) {
  if (mimeType.includes('audio/mp4')) return 'm4a';
  if (mimeType.includes('audio/mpeg')) return 'mp3';
  if (mimeType.includes('audio/aac')) return 'aac';
  if (mimeType.includes('audio/ogg')) return 'ogg';
  if (mimeType.includes('audio/wav')) return 'wav';
  if (mimeType.includes('audio/flac')) return 'flac';
  return 'webm';
}

function validateReviewAudioFile(file: File): string | null {
  if (!file.type.startsWith('audio/')) {
    return 'Yalnızca ses dosyası yükleyebilirsiniz.';
  }
  if (file.size > MAX_REVIEW_AUDIO_BYTES) {
    return 'Ses dosyası 20MB sınırını aşıyor.';
  }
  return null;
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
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRecording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingErrorRef = useRef(false);
  const ignoreNextRecordingRef = useRef(false);
  const isUnmountingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioPreviewUrl]);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
      if (recorderTimerRef.current) {
        clearInterval(recorderTimerRef.current);
        recorderTimerRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
    };
  }, []);

  function clearAudioSelection(options?: { clearInput?: boolean }) {
    setAudioPreviewUrl(null);
    setAudioFile(null);
    setAudioError(null);
    if (options?.clearInput !== false && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function resetDialogState() {
    setNote('');
    clearAudioSelection();
    setRecordingSeconds(0);
  }

  function setSelectedAudioFile(nextFile: File) {
    const validationError = validateReviewAudioFile(nextFile);
    if (validationError) {
      setAudioError(validationError);
      return;
    }

    setAudioError(null);
    setAudioFile(nextFile);
    setAudioPreviewUrl(URL.createObjectURL(nextFile));
  }

  function stopRecordingResources() {
    if (recorderTimerRef.current) {
      clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }

  function cancelRecording() {
    ignoreNextRecordingRef.current = true;
    const current = recorderRef.current;
    if (current && current.state === 'recording') {
      setRecording(false);
      current.stop();
    } else {
      stopRecordingResources();
      recorderRef.current = null;
      recorderChunksRef.current = [];
      setRecording(false);
    }
  }

  async function startRecording() {
    if (isRecording || loading) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAudioError('Bu cihazda ses kaydı desteklenmiyor.');
      return;
    }

    setAudioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedMimeType = MEDIA_RECORDER_MIME_CANDIDATES.find((candidate) =>
        typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);

      recorderChunksRef.current = [];
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingErrorRef.current = false;
      ignoreNextRecordingRef.current = false;
      setRecordingSeconds(0);
      setRecording(true);
      const recordingStartedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        recordingErrorRef.current = true;
        const current = recorderRef.current;
        if (current && current.state === 'recording') {
          current.stop();
        }
      };

      recorder.onstop = async () => {
        const chunks = recorderChunksRef.current;
        const recordedType = recorder.mimeType || 'audio/webm';
        const rawBlob = new Blob(chunks, { type: recordedType });
        const elapsedMs = Math.max(1, Date.now() - recordingStartedAt);
        recorderChunksRef.current = [];
        recorderRef.current = null;
        stopRecordingResources();

        if (isUnmountingRef.current || ignoreNextRecordingRef.current) {
          ignoreNextRecordingRef.current = false;
          return;
        }
        setRecording(false);
        if (recordingErrorRef.current) {
          recordingErrorRef.current = false;
          setAudioError('Ses kaydı sırasında bir hata oluştu.');
          return;
        }
        if (!rawBlob.size) {
          setAudioError('Ses kaydı boş olduğu için kaydedilemedi.');
          return;
        }

        try {
          const normalizedBlob = recordedType.includes('webm')
            ? await fixWebmDuration(rawBlob, elapsedMs, { logger: false })
            : rawBlob;
          const finalMimeType = normalizedBlob.type || recordedType;
          if (normalizedBlob.size > MAX_REVIEW_AUDIO_BYTES) {
            setAudioError('Ses kaydı 20MB sınırını aşıyor.');
            return;
          }

          const fileName = `degerlendirme-sesi-${Date.now()}.${fileExtensionForMimeType(finalMimeType)}`;
          const recordedFile = new File([normalizedBlob], fileName, { type: finalMimeType });
          setSelectedAudioFile(recordedFile);
        } catch {
          setAudioError('Kayıt dosyası hazırlanırken hata oluştu.');
        }
      };

      recorder.start(250);
      recorderTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORD_SECONDS) {
            const current = recorderRef.current;
            if (current && current.state === 'recording') {
              current.stop();
            }
            return MAX_RECORD_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch {
      recordingErrorRef.current = false;
      stopRecordingResources();
      recorderRef.current = null;
      recorderChunksRef.current = [];
      setRecording(false);
      setAudioError('Mikrofon izni alınamadı.');
    }
  }

  function stopRecording() {
    const current = recorderRef.current;
    if (!current || current.state !== 'recording') {
      return;
    }
    current.stop();
  }

  function handleAudioFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) {
      return;
    }
    if (isRecording) {
      stopRecording();
    }
    setSelectedAudioFile(selected);
  }

  const handleSubmit = async () => {
    if (isRecording) {
      setAudioError('Göndermeden önce ses kaydını durdurun.');
      return;
    }
    await onSubmit({ note: note.trim() || undefined, audioFile });
    resetDialogState();
  };

  const handleClose = () => {
    cancelRecording();
    resetDialogState();
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
  const recordingProgressPercent = Math.min(100, Math.round((recordingSeconds / MAX_RECORD_SECONDS) * 100));

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
            <div className={`glass-panel max-h-[90vh] w-full max-w-md overflow-y-auto ${bgColor} border ${borderColor}`}>
              <div className="flex items-start justify-between gap-4 p-6 pb-4">
                <div className="flex flex-1 items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentColor} border`}>
                    {isApprove ? (
                      <CheckCircle2 size={20} className={textColor} />
                    ) : (
                      <AlertCircle size={20} className={textColor} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-lg tracking-tight">
                      {isApprove ? 'Teslimi Onayla' : 'Teslimi Reddet'}
                    </h3>
                    <p className="mt-1 max-w-[220px] truncate text-sm text-[var(--color-text-medium)]">
                      {submissionName.length > 35 ? submissionName.slice(0, 32) + '...' : submissionName}
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

              <div className="space-y-4 px-6 pb-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--color-text-high)]">
                    {isApprove ? 'Şef Notu (İsteğe bağlı)' : 'Şef Notu / Red Sebebi (İsteğe bağlı)'}
                  </label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={isApprove ? 'Onay notunu yazın...' : 'Red sebebini yazın...'}
                    maxLength={1000}
                    disabled={loading}
                    className="w-full resize-none rounded-[4px] border border-[var(--color-border)] bg-white/5 p-3 text-sm text-[var(--color-text-high)] outline-none placeholder:text-[var(--color-text-medium)] focus:border-[var(--color-accent)] disabled:opacity-50"
                    rows={4}
                  />
                  <p className="text-[0.65rem] text-[var(--color-text-medium)]">
                    {note.length} / 1000 karakter
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isRecording) {
                          stopRecording();
                        } else {
                          void startRecording();
                        }
                      }}
                      disabled={loading}
                      className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                        isRecording
                          ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                          : 'border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10'
                      } disabled:opacity-50`}
                      title={isRecording ? 'Kaydı durdur' : 'Mikrofonla kaydet'}
                    >
                      {isRecording ? <Square size={14} strokeWidth={2.4} /> : <Mic size={14} strokeWidth={2.4} />}
                      {isRecording ? (
                        <span className="absolute -right-1 -top-1 flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-80" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 disabled:opacity-50"
                      title="Cihazdan ses dosyası seç"
                    >
                      <Paperclip size={14} strokeWidth={2.4} />
                    </button>

                    {audioFile ? (
                      <button
                        type="button"
                        onClick={() => clearAudioSelection()}
                        disabled={loading}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 disabled:opacity-50"
                        title="Ses kaydını kaldır"
                      >
                        <X size={14} strokeWidth={2.4} />
                      </button>
                    ) : null}

                    <div className="min-w-0 text-xs text-[var(--color-text-medium)]">
                      {isRecording ? (
                        <span>Kayıt: {formatDuration(recordingSeconds)} / {formatDuration(MAX_RECORD_SECONDS)}</span>
                      ) : audioFile ? (
                        <span className="block truncate">{audioFile.name}</span>
                      ) : (
                        <span>Ses kaydı ekleyebilirsin (max 20MB)</span>
                      )}
                    </div>
                  </div>

                  {isRecording ? (
                    <div className="h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-rose-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${recordingProgressPercent}%` }}
                      />
                    </div>
                  ) : null}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleAudioFileChange}
                  />

                  {audioPreviewUrl ? (
                    <div className="rounded-[10px] border border-[var(--color-border)] bg-white/5 p-2">
                      <audio controls preload="none" className="w-full" src={audioPreviewUrl} />
                    </div>
                  ) : null}

                  {audioError ? (
                    <div className="flex items-center gap-2 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <p className="text-xs text-rose-300">{audioError}</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => !loading && handleClose()}
                    disabled={loading}
                    className="flex-1 rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.1em] text-[var(--color-text-medium)] transition-colors hover:bg-white/6 disabled:opacity-50"
                  >
                    İptal
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={loading || isRecording}
                    className={`flex flex-1 items-center justify-center rounded-[4px] border px-4 py-2.5 text-sm font-bold uppercase tracking-[0.1em] transition-colors disabled:opacity-50 ${buttonBg}`}
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : isApprove ? 'Onayla' : 'Reddet'}
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
