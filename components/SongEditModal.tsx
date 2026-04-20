'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import {
  AlertCircle,
  ArrowLeft,
  AlertTriangle,
  Check,
  FileText,
  ImagePlus,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
  X,
  Users,
  Pencil,
} from 'lucide-react';
import { deleteDriveObject, deleteRepertoireFile, formatFileSize, uploadSongFile } from '@/lib/drive';
import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';
import { SongAssignmentModal } from './SongAssignmentModal';
import { LottieIcon } from '@/components/LottieIcon';
import {
  normalizeRepertoireSong,
  RepertoireFile,
  RepertoireSong,
  RepertoireSongRow,
  RepertoireTag,
  supabase,
} from '@/lib/supabase';

interface SongEditModalProps {
  isOpen: boolean;
  song: RepertoireSong | null;
  memberId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const SONG_SELECT = `
  id, title, composer, drive_folder_id, is_visible, created_at,
  repertoire_files (
    id, song_id, file_name, file_type, partition_label, drive_file_id,
    drive_web_view_link, drive_download_link, mime_type, file_size_bytes,
    created_at, updated_at, uploaded_by
  ),
  repertoire_song_tags (
    tag_id,
    repertoire_tags ( id, name, color, created_by, created_at )
  )
`;

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
const COVER_PARTITION_LABEL = '__cover__';
const TAG_LONG_PRESS_MS = 650;

function parseTimestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortFilesByCreatedAtAsc(files: RepertoireFile[]): RepertoireFile[] {
  return [...files].sort((a, b) => parseTimestamp(a.created_at) - parseTimestamp(b.created_at));
}

function sortFilesByCreatedAtDesc(files: RepertoireFile[]): RepertoireFile[] {
  return [...files].sort((a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at));
}

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

function isMp3File(file: File): boolean {
  return file.name.toLowerCase().endsWith('.mp3');
}

function isImageFile(file: File): boolean {
  if (file.type?.startsWith('image/')) {
    return true;
  }
  const lower = file.name.toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].some((ext) => lower.endsWith(ext));
}

function isCoverUploadFile(file: File): boolean {
  if (isPdfFile(file)) {
    return true;
  }
  if (file.type === 'application/pdf') {
    return true;
  }
  return isImageFile(file);
}

function isCoverFile(file: RepertoireFile): boolean {
  if (file.file_type !== 'other') {
    return false;
  }
  return (file.partition_label ?? '').toLowerCase() === COVER_PARTITION_LABEL;
}

function isPdfRepertoireFile(file: RepertoireFile | null | undefined): boolean {
  if (!file) {
    return false;
  }
  const mime = (file.mime_type ?? '').toLowerCase();
  const name = (file.file_name ?? '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

function getAudioLabel(file: RepertoireFile): string {
  const label = file.partition_label?.trim();
  if (label) {
    return label;
  }
  const baseName = file.file_name.replace(/\.[^.]+$/, '').trim();
  return baseName || 'Track';
}

function isCollectiveTrack(file: RepertoireFile): boolean {
  const text = `${getAudioLabel(file)} ${file.file_name}`.toLocaleLowerCase('tr-TR');
  return text.includes('toplu') || text.includes('tutti');
}

function isDriveNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('http 404') || message.includes('not found');
}

function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function SongEditModal({
  isOpen,
  song,
  memberId,
  onClose,
  onSaved,
}: SongEditModalProps) {
  const isPlayerActive = useMiniAudioPlayerStore((state) => state.isActive);
  const [currentSong, setCurrentSong] = useState<RepertoireSong | null>(song);
  const [availableTags, setAvailableTags] = useState<RepertoireTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState('');

  const [audioLabel, setAudioLabel] = useState('');
  const [showAudioLabelHint, setShowAudioLabelHint] = useState(false);

  const [loadingSong, setLoadingSong] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [replacingAudioId, setReplacingAudioId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [assignPartModal, setAssignPartModal] = useState<{ songId: string; songTitle: string; partName: string } | null>(null);
  const [partAssignmentCounts, setPartAssignmentCounts] = useState<Record<string, number>>({});
  const [savingTagId, setSavingTagId] = useState<string | null>(null);
  const [creatingTag, setCreatingTag] = useState(false);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<RepertoireTag | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [showDeleteSongDialog, setShowDeleteSongDialog] = useState(false);
  const [deleteSongCountdown, setDeleteSongCountdown] = useState(5);
  const [deletingSong, setDeletingSong] = useState(false);
  const [coverPreviewFailed, setCoverPreviewFailed] = useState(false);
  const [isTagEditMode, setIsTagEditMode] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const tagLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextTagClickRef = useRef<string | null>(null);

  const files = useMemo(() => currentSong?.files ?? [], [currentSong?.files]);
  const sheetFiles = useMemo(
    () => sortFilesByCreatedAtDesc(files.filter((file) => file.file_type === 'sheet')),
    [files],
  );
  const coverFiles = useMemo(
    () => files.filter(isCoverFile).sort((a, b) => {
      const aIsPdf = isPdfRepertoireFile(a);
      const bIsPdf = isPdfRepertoireFile(b);
      if (aIsPdf !== bIsPdf) return aIsPdf ? 1 : -1;
      return parseTimestamp(b.created_at) - parseTimestamp(a.created_at);
    }),
    [files],
  );
  const activeCover = coverFiles[0] ?? null;
  const activeCoverIsPdf = isPdfRepertoireFile(activeCover);
  const activeSheet = sheetFiles[0] ?? null;
  const audioFiles = useMemo(
    () => sortFilesByCreatedAtAsc(files.filter((file) => file.file_type === 'audio')),
    [files],
  );
  const assignableAudioFiles = useMemo(
    () => audioFiles.filter((file) => !isCollectiveTrack(file)),
    [audioFiles],
  );
  const { url: coverPreviewUrl } = useProtectedDriveFileUrl(activeCover);

  const isBusy = loadingSong ||
    uploadingCover ||
    uploadingPdf ||
    uploadingAudio ||
    Boolean(replacingAudioId) ||
    Boolean(deletingFileId) ||
    Boolean(savingTagId) ||
    creatingTag ||
    Boolean(deletingTagId) ||
    deletingSong;

  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    setTimeout(() => {
      setSuccessMessage((prev) => (prev === message ? null : prev));
    }, 1800);
  }, []);

  const loadTags = useCallback(async () => {
    const { data, error: tagsError } = await supabase
      .from('repertoire_tags')
      .select('id, name, color, created_by, created_at')
      .order('created_at');

    if (tagsError) {
      throw new Error(tagsError.message);
    }

    setAvailableTags((data ?? []) as RepertoireTag[]);
  }, []);

  const loadPartAssignmentCounts = useCallback(async (songId: string) => {
    const { data, error: countsError } = await supabase
      .from('song_assignments')
      .select('part_name')
      .eq('song_id', songId)
      .not('part_name', 'is', null);

    if (countsError) {
      throw new Error(countsError.message);
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = (row.part_name ?? '').trim();
      if (!key) {
        continue;
      }
      counts[key] = (counts[key] ?? 0) + 1;
    }
    setPartAssignmentCounts(counts);
  }, []);

  const loadSong = useCallback(async (songId: string) => {
    const { data, error: songError } = await supabase
      .from('repertoire')
      .select(SONG_SELECT)
      .eq('id', songId)
      .single();

    if (songError) {
      throw new Error(songError.message);
    }

    const normalized = normalizeRepertoireSong(data as RepertoireSongRow);
    setCurrentSong(normalized);
    setSelectedTagIds(new Set((normalized.tags ?? []).map((tag) => tag.id)));
  }, []);

  const refreshSong = useCallback(async () => {
    if (!song) {
      return;
    }
    await Promise.all([loadSong(song.id), loadPartAssignmentCounts(song.id)]);
  }, [loadPartAssignmentCounts, loadSong, song]);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
      document.body.classList.add('song-edit-open');
    } else {
      document.body.classList.remove('hide-nav');
      document.body.classList.remove('song-edit-open');
    }

    return () => {
      document.body.classList.remove('hide-nav');
      document.body.classList.remove('song-edit-open');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !song) {
      return;
    }

    setCurrentSong(song);
    setSelectedTagIds(new Set((song.tags ?? []).map((tag) => tag.id)));
    setAudioLabel('');
    setShowAudioLabelHint(false);
    setNewTagName('');
    setPendingDeleteTag(null);
    setShowDeleteSongDialog(false);
    setDeleteSongCountdown(5);
    setPartAssignmentCounts({});
    setError(null);
    setSuccessMessage(null);

    let cancelled = false;
    setLoadingSong(true);

    Promise.all([loadSong(song.id), loadTags(), loadPartAssignmentCounts(song.id)])
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Şarkı bilgileri yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSong(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, loadPartAssignmentCounts, loadSong, loadTags, song]);

  useEffect(() => {
    if (!showDeleteSongDialog) {
      return;
    }

    setDeleteSongCountdown(5);
    const timer = setInterval(() => {
      setDeleteSongCountdown((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [showDeleteSongDialog]);

  useEffect(() => {
    setCoverPreviewFailed(false);
  }, [activeCover?.id]);

  const handleClose = () => {
    if (isBusy) {
      return;
    }
    onClose();
  };

  const requireSongAndFolder = (): { songId: string; folderId: string } | null => {
    if (!currentSong) {
      setError('Şarkı bilgisi bulunamadı.');
      return null;
    }

    if (!currentSong.drive_folder_id) {
      setError('Bu şarkının Drive klasörü yok. Dosya işlemi yapılamaz.');
      return null;
    }

    return { songId: currentSong.id, folderId: currentSong.drive_folder_id };
  };

  const validateSize = (file: File): boolean => {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError('Dosya boyutu 100MB sınırını aşıyor.');
      return false;
    }
    return true;
  };

  const clearTagLongPress = useCallback(() => {
    if (tagLongPressTimerRef.current) {
      clearTimeout(tagLongPressTimerRef.current);
      tagLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTagLongPress();
  }, [clearTagLongPress]);

  const beginTagLongPress = (tag: RepertoireTag) => {
    clearTagLongPress();
    tagLongPressTimerRef.current = setTimeout(() => {
      ignoreNextTagClickRef.current = tag.id;
      setPendingDeleteTag(tag);
    }, TAG_LONG_PRESS_MS);
  };

  const handleCoverFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    if (!isCoverUploadFile(file)) {
      setError('Kapak için sadece görsel veya PDF dosyası yükleyebilirsiniz.');
      return;
    }

    if (!validateSize(file)) {
      return;
    }

    const context = requireSongAndFolder();
    if (!context) {
      return;
    }

    const oldCoverFiles = [...coverFiles];
    setUploadingCover(true);
    setError(null);

    try {
      const uploadedCover = await uploadSongFile(
        context.songId,
        context.folderId,
        file,
        'other',
        COVER_PARTITION_LABEL,
      );

      const filesToDelete = oldCoverFiles.filter((item) => item.id !== uploadedCover.id);
      const deleteResults = await Promise.allSettled(
        filesToDelete.map((item) => deleteRepertoireFile(item.drive_file_id, item.id)),
      );
      const failedDeleteCount = deleteResults.filter((result) => result.status === 'rejected').length;

      await refreshSong();
      await onSaved();

      if (failedDeleteCount > 0) {
        setError('Yeni kapak yüklendi ancak eski kapak dosyalarının bir kısmı silinemedi.');
      } else {
        showSuccess(oldCoverFiles.length > 0 ? 'Kapak görseli güncellendi.' : 'Kapak görseli yüklendi.');
      }
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kapak görseli yüklenemedi.');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleDeleteCover = async () => {
    if (!activeCover) {
      return;
    }

    setConfirmDeleteId(null);
    setDeletingFileId(activeCover.id);
    setError(null);

    try {
      await deleteRepertoireFile(activeCover.drive_file_id, activeCover.id);
      await refreshSong();
      await onSaved();
      showSuccess('Kapak görseli silindi.');
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kapak görseli silinemedi.');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handlePdfPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    if (!isPdfFile(file)) {
      setError('Sadece PDF yükleyebilirsiniz.');
      return;
    }

    if (!validateSize(file)) {
      return;
    }

    const context = requireSongAndFolder();
    if (!context) {
      return;
    }

    setUploadingPdf(true);
    setError(null);

    const oldSheetFiles = [...sheetFiles];

    try {
      const uploadedFile = await uploadSongFile(
        context.songId,
        context.folderId,
        file,
        'sheet',
      );

      const filesToDelete = oldSheetFiles.filter((item) => item.id !== uploadedFile.id);

      const deleteResults = await Promise.allSettled(
        filesToDelete.map((item) => deleteRepertoireFile(item.drive_file_id, item.id)),
      );

      const failedDeleteCount = deleteResults.filter((result) => result.status === 'rejected').length;

      await refreshSong();
      await onSaved();

      if (failedDeleteCount > 0) {
        setError('Yeni PDF yüklendi ancak eski PDF dosyalarının bir kısmı silinemedi.');
      } else {
        showSuccess(activeSheet ? 'PDF güncellendi.' : 'PDF yüklendi.');
      }
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : 'PDF yüklenemedi.');
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleDeletePdf = async () => {
    if (!activeSheet) {
      return;
    }

    setConfirmDeleteId(null);
    setDeletingFileId(activeSheet.id);
    setError(null);

    try {
      await deleteRepertoireFile(activeSheet.drive_file_id, activeSheet.id);
      await refreshSong();
      await onSaved();
      showSuccess('PDF silindi.');
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'PDF silinemedi.');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleAudioFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!selected) {
      return;
    }

    if (!isMp3File(selected)) {
      setError('Sadece MP3 dosyası yükleyebilirsiniz.');
      return;
    }

    if (!validateSize(selected)) {
      return;
    }

    setError(null);
    await handleAddAudio(selected);
  };

  const handleAddAudio = async (pickedFile?: File) => {
    const fileToUpload = pickedFile ?? null;
    if (!fileToUpload) {
      setError('Önce MP3 dosyası seçin.');
      return;
    }

    const label = audioLabel.trim();
    if (!label) {
      setError('MP3 için bir isim girin.');
      return;
    }

    const duplicate = audioFiles.some(
      (file) => getAudioLabel(file).toLocaleLowerCase('tr-TR') === label.toLocaleLowerCase('tr-TR'),
    );

    if (duplicate) {
      setError('Bu isimde bir MP3 zaten var. Lütfen farklı bir isim kullanın.');
      return;
    }

    const context = requireSongAndFolder();
    if (!context) {
      return;
    }

    setUploadingAudio(true);
    setError(null);

    try {
      await uploadSongFile(
        context.songId,
        context.folderId,
        fileToUpload,
        'audio',
        label,
      );
      setAudioLabel('');
      setShowAudioLabelHint(false);
      await refreshSong();
      await onSaved();
      showSuccess('MP3 eklendi.');
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : 'MP3 yüklenemedi.');
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleAudioPickClick = () => {
    if (uploadingAudio) {
      return;
    }

    if (!audioLabel.trim()) {
      setShowAudioLabelHint(true);
      return;
    }

    setShowAudioLabelHint(false);
    audioInputRef.current?.click();
  };

  const handleReplaceAudio = async (targetFile: RepertoireFile, file: File) => {
    if (!isMp3File(file)) {
      setError('Sadece MP3 dosyası yükleyebilirsiniz.');
      return;
    }

    if (!validateSize(file)) {
      return;
    }

    const context = requireSongAndFolder();
    if (!context) {
      return;
    }

    setReplacingAudioId(targetFile.id);
    setError(null);

    let uploaded = false;

    try {
      await uploadSongFile(
        context.songId,
        context.folderId,
        file,
        'audio',
        getAudioLabel(targetFile),
      );
      uploaded = true;

      await deleteRepertoireFile(targetFile.drive_file_id, targetFile.id);
      await refreshSong();
      await onSaved();
      showSuccess('MP3 dosyası değiştirildi.');
    } catch (replaceError: unknown) {
      await refreshSong();
      if (uploaded) {
        setError('Yeni MP3 yüklendi fakat eski dosya silinemedi. Listeyi kontrol edin.');
      } else {
        setError(replaceError instanceof Error ? replaceError.message : 'MP3 değiştirilemedi.');
      }
    } finally {
      setReplacingAudioId(null);
    }
  };

  const handleDeleteAudio = async (targetFile: RepertoireFile) => {
    setConfirmDeleteId(null);
    setDeletingFileId(targetFile.id);
    setError(null);

    try {
      await deleteRepertoireFile(targetFile.drive_file_id, targetFile.id);
      await refreshSong();
      await onSaved();
      showSuccess('MP3 silindi.');
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'MP3 silinemedi.');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleToggleTag = async (tag: RepertoireTag) => {
    if (!currentSong) {
      return;
    }

    const currentlySelected = selectedTagIds.has(tag.id);
    setSavingTagId(tag.id);
    setError(null);

    try {
      if (currentlySelected) {
        const { error: deleteError } = await supabase
          .from('repertoire_song_tags')
          .delete()
          .eq('song_id', currentSong.id)
          .eq('tag_id', tag.id);

        if (deleteError) {
          throw new Error(deleteError.message);
        }

        setSelectedTagIds((prev) => {
          const next = new Set(prev);
          next.delete(tag.id);
          return next;
        });
      } else {
        const { error: insertError } = await supabase
          .from('repertoire_song_tags')
          .insert({ song_id: currentSong.id, tag_id: tag.id });

        if (insertError) {
          throw new Error(insertError.message);
        }

        setSelectedTagIds((prev) => {
          const next = new Set(prev);
          next.add(tag.id);
          return next;
        });
      }

      await refreshSong();
      await onSaved();
    } catch (tagError: unknown) {
      setError(tagError instanceof Error ? tagError.message : 'Etiket işlemi başarısız.');
    } finally {
      setSavingTagId(null);
    }
  };

  const handleTagChipClick = (tag: RepertoireTag) => {
    if (ignoreNextTagClickRef.current === tag.id) {
      ignoreNextTagClickRef.current = null;
      return;
    }
    void handleToggleTag(tag);
  };

  const handleCreateTag = async () => {
    if (!currentSong) {
      return;
    }

    const normalized = normalizeTagName(newTagName);
    if (!normalized) {
      setError('Etiket adı boş olamaz.');
      return;
    }

    const existing = availableTags.find(
      (tag) => tag.name.toLocaleLowerCase('tr-TR') === normalized.toLocaleLowerCase('tr-TR'),
    );

    if (existing) {
      setNewTagName('');
      if (!selectedTagIds.has(existing.id)) {
        await handleToggleTag(existing);
      } else {
        showSuccess('Etiket zaten mevcut.');
      }
      return;
    }

    setCreatingTag(true);
    setError(null);

    try {
      const { data, error: insertTagError } = await supabase
        .from('repertoire_tags')
        .insert({
          name: normalized,
          created_by: memberId ?? null,
        })
        .select('id, name, color, created_by, created_at')
        .single();

      if (insertTagError) {
        throw new Error(insertTagError.message);
      }

      const createdTag = data as RepertoireTag;
      setAvailableTags((prev) =>
        [...prev, createdTag].sort((a, b) => parseTimestamp(a.created_at) - parseTimestamp(b.created_at)),
      );

      const { error: assignError } = await supabase
        .from('repertoire_song_tags')
        .insert({ song_id: currentSong.id, tag_id: createdTag.id });

      if (assignError) {
        throw new Error(assignError.message);
      }

      setSelectedTagIds((prev) => {
        const next = new Set(prev);
        next.add(createdTag.id);
        return next;
      });

      setNewTagName('');
      await refreshSong();
      await loadTags();
      await onSaved();
      showSuccess('Etiket oluşturuldu ve şarkıya eklendi.');
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : 'Etiket oluşturulamadı.');
    } finally {
      setCreatingTag(false);
    }
  };

  const handleDeleteTag = async () => {
    if (!pendingDeleteTag) {
      return;
    }

    const targetTag = pendingDeleteTag;
    setDeletingTagId(targetTag.id);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('repertoire_tags')
        .delete()
        .eq('id', targetTag.id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      setPendingDeleteTag(null);
      ignoreNextTagClickRef.current = null;
      setSelectedTagIds((prev) => {
        const next = new Set(prev);
        next.delete(targetTag.id);
        return next;
      });

      await Promise.all([refreshSong(), loadTags(), onSaved()]);
      showSuccess(`"${targetTag.name}" etiketi silindi.`);
    } catch (deleteErr: unknown) {
      setError(deleteErr instanceof Error ? deleteErr.message : 'Etiket silinemedi.');
    } finally {
      setDeletingTagId(null);
    }
  };
  
  const handleRenameTag = async (tagId: string) => {
    const newName = editingTagName.trim();
    if (!newName) {
      setEditingTagId(null);
      return;
    }

    setError(null);
    try {
      const { error: updateErr } = await supabase
        .from('repertoire_tags')
        .update({ name: newName })
        .eq('id', tagId);

      if (updateErr) throw updateErr;

      await loadTags();
      setEditingTagId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket güncellenemedi');
    }
  };

  const handleDeleteSong = async () => {
    if (!currentSong || deletingSong || deleteSongCountdown > 0) {
      return;
    }

    setDeletingSong(true);
    setError(null);

    try {
      if (currentSong.drive_folder_id) {
        try {
          await deleteDriveObject(currentSong.drive_folder_id);
        } catch (driveError: unknown) {
          if (!isDriveNotFoundError(driveError)) {
            throw driveError instanceof Error
              ? driveError
              : new Error('Drive klasörü silinemedi.');
          }
        }
      }

      const { error: deleteSongError } = await supabase
        .from('repertoire')
        .delete()
        .eq('id', currentSong.id);

      if (deleteSongError) {
        throw new Error(deleteSongError.message);
      }

      setShowDeleteSongDialog(false);
      await onSaved();
      onClose();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Şarkı silinemedi.');
    } finally {
      setDeletingSong(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && currentSong && (
          <React.Fragment key="song-edit-modal-wrapper">
            <motion.div
              key="song-edit-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm"
              onClick={handleClose}
              style={{ 
                bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
                borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
                transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1), border-radius 0.4s'
              }}
            />
            <motion.div
              key="song-edit-content"
              initial={{ opacity: 0, y: 30 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0'
              }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ 
                type: 'spring', 
                bounce: 0.08, 
                duration: 0.42,
                bottom: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
              }}
              className="fixed inset-x-0 top-0 z-[70] flex flex-col bg-[var(--color-surface-solid)] overflow-hidden"
              style={{ 
                borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
                borderBottom: isPlayerActive ? '1px solid var(--color-border)' : 'none'
              }}
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)]">
              <button
                type="button"
                onClick={handleClose}
                disabled={isBusy}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--color-border)] px-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] disabled:opacity-40"
              >
                <ArrowLeft size={14} />
                Geri
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteSongDialog(true)}
                disabled={isBusy}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-300/65 transition-colors hover:bg-red-500/15 hover:text-red-300/80 disabled:opacity-40"
              >
                <AlertTriangle size={14} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {loadingSong ? (
                <div className="flex items-center justify-center py-16">
                  <LottieIcon
                    path="/lottie/Insider-loading.json"
                    fallback={Loader2}
                    size={84}
                    loop
                    autoPlay
                    interactive={false}
                  />
                </div>
              ) : (
                <div className="relative mt-2 border-l border-[var(--color-border-strong)] ml-4 md:ml-6 space-y-8 pb-4">
                  {/* Cover Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <ImagePlus size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif"
                      className="hidden"
                      onChange={handleCoverFilePicked}
                    />

                    <div className="space-y-3 pt-0.5">
                      {activeCover ? (
                        <div className="group flex items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="h-14 w-12 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-white/5">
                              {activeCoverIsPdf ? (
                                <div className="flex h-full w-full items-center justify-center">
                                  <FileText size={14} className="text-[var(--color-text-medium)]" />
                                </div>
                              ) : coverPreviewUrl && !coverPreviewFailed ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={coverPreviewUrl}
                                  alt={`${currentSong.title} kapak`}
                                  className="h-full w-full object-cover"
                                  onError={() => setCoverPreviewFailed(true)}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <ImagePlus size={14} className="text-[var(--color-text-medium)]" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                                {activeCover.file_name}
                              </p>
                              <p className="mt-0.5 text-xs text-[var(--color-text-medium)]">
                                {formatFileSize(activeCover.file_size_bytes)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5 opacity-100 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
                            {confirmDeleteId === activeCover.id ? (
                              <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-2 py-0.5 border border-red-500/20">
                                <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Sil?</span>
                                <button
                                  type="button"
                                  onClick={handleDeleteCover}
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                                >
                                  <Check size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => coverInputRef.current?.click()}
                                  disabled={uploadingCover || deletingFileId === activeCover.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-45"
                                  title="Kapak Değiştir"
                                >
                                  {uploadingCover ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(activeCover.id)}
                                  disabled={uploadingCover || deletingFileId === activeCover.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-45"
                                  title="Kapak Sil"
                                >
                                  {deletingFileId === activeCover.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-[var(--color-text-medium)]">Henüz kapak görseli yok.</p>
                          <button
                            type="button"
                            onClick={() => coverInputRef.current?.click()}
                            disabled={uploadingCover}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                            title="Kapak Yükle"
                          >
                            {uploadingCover ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>

                  {/* PDF Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <FileText size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={handlePdfPicked}
                    />

                    <div className="space-y-3 pt-0.5">
                      {activeSheet ? (
                        <div className="group flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                              {activeSheet.file_name}
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--color-text-medium)]">
                              {formatFileSize(activeSheet.file_size_bytes)}
                            </p>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5 opacity-100 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
                            {confirmDeleteId === activeSheet.id ? (
                              <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-2 py-0.5 border border-red-500/20">
                                <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Sil?</span>
                                <button
                                  type="button"
                                  onClick={handleDeletePdf}
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                                >
                                  <Check size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => pdfInputRef.current?.click()}
                                  disabled={uploadingPdf || deletingFileId === activeSheet.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-45"
                                  title="PDF Değiştir"
                                >
                                  {uploadingPdf ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(activeSheet.id)}
                                  disabled={uploadingPdf || deletingFileId === activeSheet.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-45"
                                  title="PDF Sil"
                                >
                                  {deletingFileId === activeSheet.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-[var(--color-text-medium)]">Henüz nota PDF&apos;i yok.</p>
                          <button
                            type="button"
                            onClick={() => pdfInputRef.current?.click()}
                            disabled={uploadingPdf}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                            title="PDF Yükle"
                          >
                            {uploadingPdf ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>

                  {/* MP3 Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <Mic size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <div className="space-y-4 pt-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={audioLabel}
                          onChange={(event) => {
                            setAudioLabel(event.target.value);
                            if (event.target.value.trim()) {
                              setShowAudioLabelHint(false);
                            }
                          }}
                          placeholder="Paritsyon adı:"
                          className="editorial-input h-8 flex-1 !text-sm"
                        />
                        <input
                          ref={audioInputRef}
                          type="file"
                          accept=".mp3"
                          className="hidden"
                          onChange={handleAudioFileSelect}
                        />
                        <button
                          type="button"
                          onClick={handleAudioPickClick}
                          disabled={uploadingAudio}
                          aria-disabled={!audioLabel.trim() || uploadingAudio}
                          className={`flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors ${
                            !audioLabel.trim() && !uploadingAudio
                              ? 'cursor-not-allowed bg-white/5 text-[var(--color-text-low)]'
                              : 'bg-white/5 text-[var(--color-text-medium)] hover:text-white'
                          }`}
                          title="Dosya Seç"
                        >
                          {uploadingAudio ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          <span className="max-w-[70px] truncate">
                            {uploadingAudio ? 'Yükleniyor' : 'Seç'}
                          </span>
                        </button>
                      </div>
                      {showAudioLabelHint && !audioLabel.trim() && (
                        <div className="rounded-[6px] border border-orange-500/30 bg-orange-500/10 px-2.5 py-1.5 text-[0.66rem] text-orange-200">
                          Lütfen önce partisyon ismi giriniz. Örneğin Bas 1, Soprano 2
                        </div>
                      )}

                      <div className="space-y-3">
                        {audioFiles.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-medium)]">Henüz MP3 kanalı yok.</p>
                        ) : (
                          audioFiles.map((file) => {
                            const replacing = replacingAudioId === file.id;
                            const deleting = deletingFileId === file.id;

                            return (
                              <div key={file.id} className="group flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-[var(--color-text-high)]">
                                    {getAudioLabel(file)}
                                  </p>
                                  <p className="truncate text-xs text-[var(--color-text-medium)]">
                                    {file.file_name}
                                    {file.file_size_bytes ? ` · ${formatFileSize(file.file_size_bytes)}` : ''}
                                  </p>
                                </div>

                                <input
                                  ref={(node) => {
                                    replaceInputRefs.current[file.id] = node;
                                  }}
                                  type="file"
                                  accept=".mp3"
                                  className="hidden"
                                  onChange={(event) => {
                                    const picked = event.target.files?.[0];
                                    event.target.value = '';
                                    if (picked) {
                                      void handleReplaceAudio(file, picked);
                                    }
                                  }}
                                />

                                <div className="flex flex-shrink-0 items-center gap-1.5 opacity-100 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
                                  {confirmDeleteId === file.id ? (
                                    <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-2 py-0.5 border border-red-500/20">
                                      <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Sil?</span>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteAudio(file)}
                                        className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                                      >
                                        <Check size={11} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                                      >
                                        <X size={11} />
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => replaceInputRefs.current[file.id]?.click()}
                                        disabled={replacing || deleting}
                                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-45"
                                        title="Değiştir"
                                      >
                                        {replacing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(file.id)}
                                        disabled={replacing || deleting}
                                        className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-45"
                                        title="Sil"
                                      >
                                        {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </article>

                  {/* Tags Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <Tag size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <div className="space-y-4 pt-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(event) => setNewTagName(event.target.value)}
                          placeholder="Yeni etiket adı"
                          className="editorial-input h-8 flex-1 !text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCreateTag()}
                          disabled={creatingTag || !newTagName.trim()}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                          title="Etiket Oluştur"
                        >
                          {creatingTag ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                        <button
                          type="button"
                          onClick={() => setIsTagEditMode(!isTagEditMode)}
                          className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                            isTagEditMode 
                              ? 'border-[var(--color-accent)] bg-[rgba(192,178,131,0.2)] text-[var(--color-accent)]' 
                              : 'border-[var(--color-border)] bg-white/3 text-[var(--color-text-medium)] hover:text-[var(--color-text-high)]'
                          }`}
                          title="Etiketleri Düzenle"
                        >
                          <Pencil size={11} />
                        </button>

                        {availableTags.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-medium)]">Bölümde etiket bulunamadı.</p>
                        ) : (
                          availableTags
                            .filter(tag => tag.name.toLocaleLowerCase('tr-TR').includes(newTagName.trim().toLocaleLowerCase('tr-TR')))
                            .map((tag) => {
                              const active = selectedTagIds.has(tag.id);
                              const saving = savingTagId === tag.id;
                              const isEditingThis = editingTagId === tag.id;

                              return (
                                <div key={tag.id} className="relative shrink-0 group">
                                  {isEditingThis ? (
                                    <div className="flex items-center gap-1 rounded-full border border-[var(--color-accent)] bg-[rgba(192,178,131,0.1)] px-2 py-0.5">
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editingTagName}
                                        onChange={(e) => setEditingTagName(e.target.value)}
                                        onBlur={() => handleRenameTag(tag.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleRenameTag(tag.id);
                                          if (e.key === 'Escape') setEditingTagId(null);
                                        }}
                                        className="w-20 bg-transparent text-[0.6rem] font-semibold text-[var(--color-accent)] outline-none"
                                      />
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => !isTagEditMode && handleTagChipClick(tag)}
                                      onPointerDown={() => !isTagEditMode && beginTagLongPress(tag)}
                                      onPointerUp={clearTagLongPress}
                                      onPointerLeave={clearTagLongPress}
                                      onPointerCancel={clearTagLongPress}
                                      onContextMenu={(event) => event.preventDefault()}
                                      disabled={saving}
                                      className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[0.6rem] font-semibold transition-colors ${
                                        active
                                          ? 'bg-[rgba(192,178,131,0.15)] text-[var(--color-accent)]'
                                          : 'bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10'
                                      } disabled:opacity-45 ${isTagEditMode ? 'cursor-default' : ''}`}
                                    >
                                      {saving ? <Loader2 size={10} className="animate-spin" /> : active ? <Check size={10} /> : <Tag size={10} />}
                                      {tag.name}
                                    </button>
                                  )}

                                  {/* Edit Mode Overlays */}
                                  {isTagEditMode && !isEditingThis && (
                                    <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/35 backdrop-blur-[1px]">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingTagId(tag.id);
                                          setEditingTagName(tag.name);
                                        }}
                                        className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                                      >
                                        <Pencil size={11} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPendingDeleteTag(tag);
                                        }}
                                        className="p-1 text-red-400 hover:text-red-300 transition-colors"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                        )}
                      </div>
                    </div>
                  </article>

                  {/* Partisyon Ataması Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <Users size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <div className="space-y-4 pt-1">
                      {audioFiles.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-medium)] mt-1">Önce bir MP3 kanalı eklemelisiniz.</p>
                      ) : assignableAudioFiles.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {assignableAudioFiles.map((file) => {
                            const label = getAudioLabel(file);
                            const assignedCount = partAssignmentCounts[label] ?? 0;
                            return (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => setAssignPartModal({ songId: currentSong.id, songTitle: currentSong.title, partName: label })}
                                className="flex flex-col items-start gap-1 p-3 rounded-xl border border-[var(--color-border)] bg-white/2 hover:bg-white/5 hover:border-[var(--color-accent)]/50 transition-all text-left"
                              >
                                <span className="text-xs font-semibold text-[var(--color-text-high)] truncate w-full">{label}</span>
                                <span className="text-[0.65rem] text-[var(--color-text-medium)]">
                                  {assignedCount > 0 ? `(${assignedCount})` : 'Atama Yap →'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </article>
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="flex items-center gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                  >
                    <AlertCircle size={14} className="text-red-300" />
                    <p className="text-sm text-red-300">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {successMessage && !error && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="flex items-center gap-2 rounded-[8px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
                  >
                    <Check size={14} className="text-emerald-300" />
                    <p className="text-sm text-emerald-300">{successMessage}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showDeleteSongDialog && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[87] bg-black/70"
                      onClick={() => {
                        if (!deletingSong) {
                          setShowDeleteSongDialog(false);
                        }
                      }}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 16 }}
                      className="fixed inset-x-5 bottom-6 z-[88] mx-auto max-w-md rounded-[12px] border border-red-500/30 bg-[var(--color-surface-solid)] p-4"
                    >
                      <p className="text-sm text-[var(--color-text-high)]">
                        Bu şarkıyı ve tüm ilgili dosyaları silmek istiyor musunuz? Bu işlem geri alınamaz.
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDeleteSongDialog(false)}
                          disabled={deletingSong}
                          className="rounded-[8px] border border-[var(--color-border)] bg-white/5 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-medium)] disabled:opacity-50"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSong()}
                          disabled={deletingSong || deleteSongCountdown > 0}
                          className="inline-flex items-center justify-center gap-2 rounded-[8px] border border-red-500/40 bg-red-500/15 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-red-300 disabled:opacity-40"
                        >
                          {deletingSong ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {deleteSongCountdown > 0 ? `Sil (${deleteSongCountdown}s)` : 'Sil'}
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {pendingDeleteTag && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[85] bg-black/60"
                      onClick={() => !deletingTagId && setPendingDeleteTag(null)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 16 }}
                      className="fixed inset-x-5 bottom-6 z-[86] mx-auto max-w-md rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-solid)] p-4"
                    >
                      <p className="text-sm text-[var(--color-text-high)]">
                        &quot;{pendingDeleteTag.name}&quot; etiketini silmek istiyor musunuz? Bu işlem şarkıları etkilemez.
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteTag(null)}
                          disabled={Boolean(deletingTagId)}
                          className="rounded-[8px] border border-[var(--color-border)] bg-white/5 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-medium)] disabled:opacity-50"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTag()}
                          disabled={Boolean(deletingTagId)}
                          className="inline-flex items-center justify-center gap-2 rounded-[8px] border border-red-500/40 bg-red-500/15 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-red-300 disabled:opacity-50"
                        >
                          {deletingTagId ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          Sil
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            </motion.div>
          </React.Fragment>
        )}
      </AnimatePresence>

      {/* Partition Assignment Nested Modal */}
      {assignPartModal && (
        <SongAssignmentModal
          isOpen={true}
          onClose={() => setAssignPartModal(null)}
          songId={assignPartModal.songId}
          songTitle={assignPartModal.songTitle}
          partName={assignPartModal.partName}
          onSaved={async () => {
            await loadPartAssignmentCounts(assignPartModal.songId);
            await onSaved();
          }}
        />
      )}
    </>
  );
}
