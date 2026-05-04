'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, Check, Loader2, Mic, Paperclip, Pencil, Send, Square, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useAuth } from '@/components/AuthProvider';
import { createSongComment, deleteSongComment } from '@/lib/drive';
import { sanitizeRichText, isRichTextMeaningful } from '@/lib/richText';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ToastProvider';
import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';
import type { PreviewVoiceGroup, VoiceGroup } from '@/lib/repertuvar/annotation-types';

interface ChefCommentSectionProps {
  songId: string;
  memberId: string | null;
  canComment: boolean;
  selectedVoiceGroup: PreviewVoiceGroup;
  composerTargetVoiceGroup: VoiceGroup | null;
}

interface CommentAuthor {
  first_name: string;
  last_name: string;
  photo_url: string | null;
}

interface SongChefComment {
  id: string;
  song_id: string;
  content_html: string;
  target_voice_group: VoiceGroup | null;
  audio_drive_file_id: string | null;
  audio_file_name: string | null;
  audio_mime_type: string | null;
  audio_file_size_bytes: number | null;
  created_at: string;
  created_by: string;
  choir_members: CommentAuthor | null;
}

interface RawSongChefComment extends Omit<SongChefComment, 'choir_members'> {
  choir_members?: CommentAuthor | CommentAuthor[] | null;
}

const COMMENTS_QUERY_KEY = (songId: string, selectedVoiceGroup: PreviewVoiceGroup) =>
  ['repertoire-song-comments', songId, selectedVoiceGroup] as const;

const MAX_COMMENT_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_RECORD_SECONDS = 180;
const MEDIA_RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

function formatCommentDate(value: string) {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

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

function validateCommentAudioFile(file: File): string | null {
  if (!file.type.startsWith('audio/')) {
    return 'Yalnızca ses dosyası yükleyebilirsiniz.';
  }
  if (file.size > MAX_COMMENT_AUDIO_BYTES) {
    return 'Ses dosyası 20MB sınırını aşıyor.';
  }
  return null;
}

function normalizeComment(row: RawSongChefComment): SongChefComment {
  return {
    ...row,
    content_html: sanitizeRichText(row.content_html),
    choir_members: Array.isArray(row.choir_members) ? row.choir_members[0] ?? null : row.choir_members ?? null,
  };
}

async function fetchComments(
  songId: string,
  selectedVoiceGroup: PreviewVoiceGroup,
  includeGlobalWhenScoped: boolean,
) {
  let query = supabase
    .from('repertoire_song_comments')
    .select(`
      id,
      song_id,
      content_html,
      target_voice_group,
      audio_drive_file_id,
      audio_file_name,
      audio_mime_type,
      audio_file_size_bytes,
      created_at,
      created_by,
      choir_members ( first_name, last_name, photo_url )
    `)
    .eq('song_id', songId)
    .order('created_at', { ascending: true });

  if (selectedVoiceGroup !== 'ALL') {
    if (includeGlobalWhenScoped) {
      query = query.or(`target_voice_group.eq.${selectedVoiceGroup},target_voice_group.is.null`);
    } else {
      query = query.eq('target_voice_group', selectedVoiceGroup);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => normalizeComment(row as RawSongChefComment));
}

function ProtectedCommentAudioPlayer({
  driveFileId,
  fileName,
  mimeType,
}: {
  driveFileId: string;
  fileName: string | null;
  mimeType: string | null;
}) {
  const { url, loading, error } = useProtectedDriveFileUrl({
    drive_file_id: driveFileId,
    file_name: fileName ?? 'sef-notu',
    mime_type: mimeType ?? 'audio/webm',
  });

  return (
    <div className="mt-2 rounded-[10px] border border-[var(--color-border)] bg-white/5 p-2">
      {url ? (
        <audio controls preload="none" className="w-full" src={url} />
      ) : loading ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-[var(--color-text-medium)]">
          <Loader2 size={12} className="animate-spin" />
          Ses kaydı yükleniyor...
        </div>
      ) : (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-rose-300">
          <AlertCircle size={12} />
          {error || 'Ses kaydı açılamadı.'}
        </div>
      )}
    </div>
  );
}

export function ChefCommentSection({
  songId,
  memberId,
  canComment,
  selectedVoiceGroup,
  composerTargetVoiceGroup,
}: ChefCommentSectionProps) {
  const { member, isAdmin } = useAuth();
  const isChef = isAdmin();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingHtml, setEditingHtml] = useState('');
  const [editorHtml, setEditorHtml] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRecording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const includeGlobalWhenScoped = !isChef;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const commentsQuery = useQuery({
    queryKey: COMMENTS_QUERY_KEY(songId, selectedVoiceGroup),
    queryFn: () => fetchComments(songId, selectedVoiceGroup, includeGlobalWhenScoped),
  });

  useEffect(() => {
    const channel = supabase
      .channel(`repertoire-song-comments:${songId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'repertoire_song_comments', filter: `song_id=eq.${songId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['repertoire-song-comments', songId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, songId]);

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioPreviewUrl]);

  useEffect(() => {
    return () => {
      if (recorderTimerRef.current) {
        clearInterval(recorderTimerRef.current);
        recorderTimerRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
      recorderChunksRef.current = [];
    };
  }, []);

  function clearAudioSelection(options?: { clearInput?: boolean }) {
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    setAudioPreviewUrl(null);
    setAudioFile(null);
    setAudioError(null);
    if (options?.clearInput !== false && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function setSelectedAudioFile(nextFile: File) {
    const validationError = validateCommentAudioFile(nextFile);
    if (validationError) {
      setAudioError(validationError);
      return;
    }

    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
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

  async function startRecording() {
    if (isRecording || submitMutation.isPending) {
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
      setRecordingSeconds(0);
      setRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setAudioError('Ses kaydı başlatılamadı.');
      };

      recorder.onstop = () => {
        const chunks = recorderChunksRef.current;
        const recordedType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: recordedType });
        recorderChunksRef.current = [];
        stopRecordingResources();
        setRecording(false);

        if (!blob.size) {
          setAudioError('Ses kaydı boş olduğu için kaydedilemedi.');
          return;
        }
        if (blob.size > MAX_COMMENT_AUDIO_BYTES) {
          setAudioError('Ses kaydı 20MB sınırını aşıyor.');
          return;
        }

        const fileName = `sef-notu-${Date.now()}.${fileExtensionForMimeType(recordedType)}`;
        const recordedFile = new File([blob], fileName, { type: recordedType });
        setSelectedAudioFile(recordedFile);
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
      stopRecordingResources();
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

  const submitMutation = useMutation({
    mutationFn: async ({ contentHtml, attachedAudioFile }: { contentHtml: string; attachedAudioFile: File | null }) => {
      await createSongComment({
        songId,
        contentHtml: sanitizeRichText(contentHtml),
        targetVoiceGroup: composerTargetVoiceGroup,
        audioFile: attachedAudioFile,
      });
    },
    onSuccess: async () => {
      setEditorHtml('');
      clearAudioSelection();
      await queryClient.invalidateQueries({ queryKey: ['repertoire-song-comments', songId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Yorum gönderilemedi.', 'Şef notu');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ commentId, contentHtml }: { commentId: string; contentHtml: string }) => {
      const { error } = await supabase
        .from('repertoire_song_comments')
        .update({ content_html: sanitizeRichText(contentHtml) })
        .eq('id', commentId);
      if (error) {
        throw error;
      }
    },
    onSuccess: async () => {
      setEditingCommentId(null);
      setEditingHtml('');
      await queryClient.invalidateQueries({ queryKey: ['repertoire-song-comments', songId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Yorum güncellenemedi.', 'Şef notu');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await deleteSongComment(commentId);
      return commentId;
    },
    onSuccess: async (commentId) => {
      setConfirmDeleteId(null);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingHtml('');
      }
      await queryClient.invalidateQueries({ queryKey: ['repertoire-song-comments', songId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Yorum silinemedi.', 'Şef notu');
    },
  });

  const comments = commentsQuery.data ?? [];
  const canSubmit = useMemo(
    () => Boolean(
      canComment &&
      memberId &&
      !submitMutation.isPending &&
      !isRecording &&
      (isRichTextMeaningful(editorHtml) || audioFile) &&
      (isChef || composerTargetVoiceGroup !== null),
    ),
    [audioFile, canComment, composerTargetVoiceGroup, editorHtml, isChef, isRecording, memberId, submitMutation.isPending],
  );

  const composerName = member?.first_name || 'Siz';
  const composerPhotoUrl = member?.photo_url ?? null;
  const scopeLabel = selectedVoiceGroup === 'ALL' ? 'Tümü' : selectedVoiceGroup;
  const pendingDeleteComment = comments.find((comment) => comment.id === confirmDeleteId) ?? null;

  function canEditComment(comment: SongChefComment) {
    if (comment.audio_drive_file_id) {
      return false;
    }
    return Boolean(canComment && memberId && comment.created_by === memberId);
  }

  function canDeleteComment(comment: SongChefComment) {
    if (!memberId) {
      return false;
    }
    if (comment.created_by === memberId && canComment) {
      return true;
    }
    return isChef;
  }

  function startEdit(comment: SongChefComment) {
    setEditingCommentId(comment.id);
    setEditingHtml(comment.content_html);
  }

  function cancelEdit() {
    setEditingCommentId(null);
    setEditingHtml('');
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

  return (
    <section className="mt-8">
      <div className="space-y-6">
        <div className="px-5 sm:px-6">
          <span className="page-kicker">Şef Notu · {scopeLabel}</span>
        </div>

        <div className="relative ml-9 space-y-8 border-l border-[var(--color-border-strong)] pb-4 md:ml-10">
          {commentsQuery.isPending ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-[var(--color-accent)]" />
            </div>
          ) : commentsQuery.isError ? (
            <div className="px-6 py-2 text-sm text-rose-300">Şef notları yüklenemedi.</div>
          ) : comments.length === 0 ? (
            <div className="px-6 py-2 text-sm text-[var(--color-text-medium)]">Henüz yorum yok.</div>
          ) : (
            comments.map((comment) => {
              const firstName = comment.choir_members?.first_name ?? '';
              const lastName = comment.choir_members?.last_name ?? '';
              const fullName = firstName || 'Bilinmeyen Üye';
              const photoUrl = comment.choir_members?.photo_url ?? null;
              const hasMeaningfulText = isRichTextMeaningful(comment.content_html);

              return (
                <article key={comment.id} className="group relative pl-6 pr-5 sm:pr-6">
                  <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                    {photoUrl ? (
                      <img src={photoUrl} alt={fullName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                        {getInitials(firstName, lastName)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[13px] font-semibold text-[var(--color-text-high)]">{fullName}</p>
                        <span className="rounded-full border border-[var(--color-border)] bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-medium)]">
                          {comment.target_voice_group ?? 'Tüm Koro'}
                        </span>
                        <span className="text-[11px] text-[var(--color-text-medium)]">{formatCommentDate(comment.created_at)}</span>

                        {canEditComment(comment) || canDeleteComment(comment) ? (
                          <div className="ml-1 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                            {canEditComment(comment) ? (
                              <button
                                type="button"
                                onClick={() => startEdit(comment)}
                                className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--color-accent)] transition-colors hover:bg-white/5"
                                title="Düzenle"
                              >
                                <Pencil size={10} strokeWidth={2.5} />
                              </button>
                            ) : null}
                            {canDeleteComment(comment) ? (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(comment.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--color-accent)] transition-colors hover:bg-rose-500/10"
                                title="Sil"
                              >
                                <Trash2 size={10} strokeWidth={2.5} />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {editingCommentId === comment.id ? (
                      <div className="mt-2 space-y-3">
                        <div className="reset-tiptap-styles">
                          <RichTextEditor content={editingHtml} onChange={setEditingHtml} placeholder="Yorumu düzenle..." borderless />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={updateMutation.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 disabled:opacity-50"
                            title="Vazgeç"
                          >
                            <X size={14} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMutation.mutate({ commentId: comment.id, contentHtml: editingHtml })}
                            disabled={updateMutation.isPending || !isRichTextMeaningful(editingHtml)}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-background)] transition-colors hover:opacity-90 disabled:opacity-50"
                            title="Kaydet"
                          >
                            {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.5} />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1">
                        {hasMeaningfulText ? (
                          <div
                            className="prose prose-invert max-w-none text-[var(--color-text-high)] opacity-90 prose-p:my-0.5 prose-p:text-[14px] prose-p:leading-[1.3] prose-ul:list-disc prose-ol:list-decimal prose-li:my-0.5 prose-a:text-[var(--color-accent)] prose-img:my-2 prose-img:max-h-[50vh] prose-img:w-full prose-img:rounded-[8px] prose-img:border prose-img:border-[var(--color-border)] prose-img:object-cover"
                            dangerouslySetInnerHTML={{ __html: sanitizeRichText(comment.content_html) }}
                          />
                        ) : null}

                        {comment.audio_drive_file_id ? (
                          <ProtectedCommentAudioPlayer
                            driveFileId={comment.audio_drive_file_id}
                            fileName={comment.audio_file_name}
                            mimeType={comment.audio_mime_type}
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}

          {canComment ? (
            <div className="relative mt-4 pl-6 pr-5 sm:pr-6">
              <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                {composerPhotoUrl ? (
                  <img src={composerPhotoUrl} alt={composerName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                    {getInitials(member?.first_name ?? '', member?.last_name ?? '')}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="reset-tiptap-styles">
                  <RichTextEditor content={editorHtml} onChange={setEditorHtml} placeholder="Yorum yaz..." borderless />
                </div>

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
                    disabled={submitMutation.isPending}
                    className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                      isRecording
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10'
                    } disabled:opacity-50`}
                    title={isRecording ? 'Kaydı durdur' : 'Mikrofonla kaydet'}
                  >
                    {isRecording ? <Square size={13} strokeWidth={2.4} /> : <Mic size={13} strokeWidth={2.4} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitMutation.isPending}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 disabled:opacity-50"
                    title="Cihazdan ses dosyası seç"
                  >
                    <Paperclip size={13} strokeWidth={2.4} />
                  </button>

                  {audioFile ? (
                    <button
                      type="button"
                      onClick={() => clearAudioSelection()}
                      disabled={submitMutation.isPending}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] bg-white/5 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 disabled:opacity-50"
                      title="Ses kaydını kaldır"
                    >
                      <X size={13} strokeWidth={2.4} />
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
                    <AlertCircle size={12} className="text-rose-400" />
                    <p className="text-xs text-rose-300">{audioError}</p>
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => submitMutation.mutate({ contentHtml: editorHtml, attachedAudioFile: audioFile })}
                    disabled={!canSubmit}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                    title="Gönder"
                  >
                    {submitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={2.5} />}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {commentsQuery.isError ? (
          <div className="mx-5 flex items-center gap-2 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-4 py-3 sm:mx-6">
            <AlertCircle size={14} className="text-rose-400" />
            <p className="text-sm text-rose-300">Şef notları alınamadı.</p>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteComment)}
        title="Şef notunu sil"
        description={pendingDeleteComment ? 'Bu not silinecek. İşlem geri alınamaz.' : ''}
        confirmLabel="Sil"
        tone="danger"
        loading={deleteMutation.isPending}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteComment) {
            deleteMutation.mutate(pendingDeleteComment.id);
          }
        }}
      />
    </section>
  );
}
