'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Music4,
  Pause,
  Pencil,
  Play,
  Redo2,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Undo2,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';

import { AnnotationStage } from '@/components/repertuvar/AnnotationStage';
import { ChefCommentSection } from '@/components/repertuvar/ChefCommentSection';
import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';
import { getProtectedDriveFileUrl } from '@/lib/drive-file-url';
import {
  loadAnnotationsForFile,
  saveLayerSnapshot,
} from '@/lib/repertuvar/annotations';
import {
  buildOfflineSongVersion,
  clearOfflineSongSyncState,
  getOfflineDriveFileUrl,
  getOfflineSongSettings,
  isRepertoireOfflineSupported,
  markOfflineSongSynced,
  removeOfflineSongFiles,
  setOfflineSongEnabled,
  syncSongFilesForOffline,
  type OfflineSyncFileInput,
  type OfflineSyncResult,
} from '@/lib/repertuvar/offline';
import {
  ANNOTATION_COLOR_SWATCHES,
  AnnotationColor,
  AnnotationItem,
  AnnotationLayerKey,
  AnnotationTool,
  PreviewVoiceGroup,
  VOICE_GROUPS,
  VoiceGroup,
  asVoiceGroup,
  cloneAnnotationItems,
  getPreviewVoiceGroupLabel,
  getLayerLabel,
  makeLayerPageKey,
  makeSharedVoiceGroupLayerKey,
} from '@/lib/repertuvar/annotation-types';
import { RepertoireFile, RepertoireSong } from '@/lib/supabase';
import {
  getLayerItemsFromStore,
  useRepertoireWorkspaceStore,
} from '@/store/useRepertoireWorkspaceStore';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import { getSharedAudioElement, resolveAudioUrl } from '@/lib/shared-audio';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();


const COVER_PARTITION_LABEL = '__cover__';
const DEFAULT_PAGE_ASPECT_RATIO = 1.414;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

interface RepertoireWorkspaceProps {
  song: RepertoireSong;
  memberId: string | null;
  voiceGroup: string | null;
  isChef: boolean;
  isSectionLeader: boolean;
}

interface QueuedSavePayload {
  fileId: string;
  pageNumber: number;
  layerKey: AnnotationLayerKey;
  items: AnnotationItem[];
}

interface VisibilityModeOption {
  label: string;
  personal: boolean;
  shared: boolean;
  previewVoiceGroup: PreviewVoiceGroup;
}

const TOOL_CYCLE: Array<{
  tool: Exclude<AnnotationTool, null>;
  label: string;
  Icon: typeof Pencil;
}> = [
  { tool: 'pen', label: 'Kalem', Icon: Pencil },
  { tool: 'arrow', label: 'Ok', Icon: ArrowRight },
  { tool: 'rectangle', label: 'Kutu', Icon: Square },
  { tool: 'eraser', label: 'Silgi', Icon: Eraser },
];

const COLOR_OPTIONS: AnnotationColor[] = ['black', 'red', 'white'];

function getSheetTabLabel(file: RepertoireFile) {
  return file.partition_label ? `${file.partition_label} · ${file.file_name}` : file.file_name;
}

function isCoverFile(file: RepertoireFile): boolean {
  return file.file_type === 'other' && (file.partition_label ?? '').toLowerCase() === COVER_PARTITION_LABEL;
}

function isPdfRepertoireFile(file: RepertoireFile | null | undefined): boolean {
  if (!file) {
    return false;
  }
  const mime = (file.mime_type ?? '').toLowerCase();
  const name = (file.file_name ?? '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

function getInlineFileSource(
  file: Pick<RepertoireFile, 'drive_download_link' | 'drive_file_id'> | null | undefined,
  protectedUrl: string | null,
  allowOfflineFallback: boolean,
): string | null {
  if (allowOfflineFallback) {
    const offlineUrl = getOfflineDriveFileUrl(file);
    if (offlineUrl) {
      return offlineUrl;
    }
  }
  return protectedUrl ?? file?.drive_download_link ?? null;
}

function formatSyncedAtLabel(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(timestamp);
  } catch {
    return null;
  }
}

// ─── AudioPanel ──────────────────────────────────────────────────────────────
interface AudioPanelProps {
  songId: string;
  songTitle: string;
  coverSource: string | null;
  audioFiles: RepertoireFile[];
  selectedAudio: RepertoireFile | null;
  selectedAudioSource: string | null;
  allowOfflineFallback: boolean;
  audioRef: { current: HTMLAudioElement | null };
  setSelectedAudioId: (id: string | null) => void;
  setAudioState: (state: { isPlaying?: boolean; currentTime?: number; duration?: number }) => void;
  renderUi?: boolean;
}

function getAudioDisplayName(file: RepertoireFile): string {
  const customLabel = file.partition_label?.trim();
  if (customLabel) {
    return customLabel;
  }
  const baseName = file.file_name.replace(/\.[^.]+$/, '').trim();
  return baseName || 'Track';
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatSecondsOnly(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {
    return '0s';
  }
  return `${Math.floor(seconds)}s`;
}

function isSourceMatch(audio: HTMLAudioElement, source: string | null): boolean {
  if (!source) {
    return false;
  }
  return audio.src === resolveAudioUrl(source);
}

function AudioPanel({
  songId,
  songTitle,
  coverSource,
  audioFiles,
  selectedAudio,
  selectedAudioSource,
  allowOfflineFallback,
  audioRef,
  setSelectedAudioId,
  setAudioState,
  renderUi = true,
}: AudioPanelProps) {
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const progressRectRef = useRef<DOMRect | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const setMiniSession = useMiniAudioPlayerStore((state) => state.setSession);
  const setMiniPlaybackState = useMiniAudioPlayerStore((state) => state.setPlaybackState);
  const isUnmountingRef = useRef(false);
  const latestIsPlayingRef = useRef(false);
  const latestCurrentTimeRef = useRef(0);
  const latestDurationRef = useRef(0);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const intendedPlayState = useRef(false);
  const intendedTimeRef = useRef(0);
  const prevSourceRef = useRef(selectedAudioSource);
  const prevSongIdRef = useRef(songId);

  useEffect(() => {
    if (prevSourceRef.current !== selectedAudioSource) {
      prevSourceRef.current = selectedAudioSource;
      intendedTimeRef.current = currentTime;
    }
  }, [selectedAudioSource, currentTime]);

  useEffect(() => {
    latestIsPlayingRef.current = isPlaying;
    latestCurrentTimeRef.current = currentTime;
    latestDurationRef.current = duration;
  }, [currentTime, duration, isPlaying]);

  const closeOnOutside = useCallback((e: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', closeOnOutside);
    else document.removeEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [open, closeOnOutside]);

  const hasMultiple = audioFiles.length > 1;
  const activeLabel = selectedAudio ? getAudioDisplayName(selectedAudio) : 'Prova';

  const currentIndex = audioFiles.findIndex((f) => f.id === selectedAudio?.id);

  function handlePlayPause() {
    const el = audioRef.current;
    if (!el) return;

    if (selectedAudioSource && !isSourceMatch(el, selectedAudioSource)) {
      el.src = selectedAudioSource;
      intendedPlayState.current = true;
      el.play().catch(() => {
        intendedPlayState.current = false;
        setIsPlaying(false);
        setAudioState({ isPlaying: false });
        setMiniPlaybackState({ isPlaying: false });
      });
      return;
    }

    if (el.paused) {
      intendedPlayState.current = true;
      el.play().catch(() => {
        intendedPlayState.current = false;
        setIsPlaying(false);
        setAudioState({ isPlaying: false });
        setMiniPlaybackState({ isPlaying: false });
      });
    } else {
      intendedPlayState.current = false;
      el.pause();
    }
  }

  function switchToAudio(fileId: string) {
    const el = audioRef.current;
    if (el) {
      intendedTimeRef.current = Number.isFinite(el.currentTime) ? el.currentTime : currentTime;
      intendedPlayState.current = !el.paused;
    } else {
      intendedTimeRef.current = currentTime;
    }
    setSelectedAudioId(fileId);
  }

  function handlePrev() {
    if (!hasMultiple || currentIndex <= 0) return;
    switchToAudio(audioFiles[currentIndex - 1].id);
  }

  function handleNext() {
    if (!hasMultiple || currentIndex >= audioFiles.length - 1) return;
    switchToAudio(audioFiles[currentIndex + 1].id);
  }

  // Progress bar interaction
  const getProgressFromEvent = useCallback((clientX: number, rect: DOMRect) => {
    if (!duration) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  function handleProgressStart(e: React.MouseEvent | React.TouchEvent) {
    if (!duration || duration <= 0) return;
    
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    progressRectRef.current = rect;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const val = getProgressFromEvent(clientX, rect);
    if (val === null) return;

    if ('touches' in e) {
      touchStartPosRef.current = { x: clientX, y: clientY };
    }

    holdTimerRef.current = setTimeout(() => {
      setIsDragging(true);
      setDragValue(val);
    }, 200);
  }

  useEffect(() => {
    const handleUp = () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      
      if (isDragging) {
        if (audioRef.current) {
          audioRef.current.currentTime = dragValue;
        }
        setCurrentTime(dragValue);
        setIsDragging(false);
      }
      touchStartPosRef.current = null;
    };

    const handleMove = (clientX: number, clientY: number, e?: TouchEvent) => {
      if (!duration || !progressRectRef.current) return;

      if (!isDragging && touchStartPosRef.current) {
        const dx = clientX - touchStartPosRef.current.x;
        const dy = clientY - touchStartPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }
        }
      }

      if (isDragging) {
        if (e) e.preventDefault();
        const val = getProgressFromEvent(clientX, progressRectRef.current);
        if (val !== null) setDragValue(val);
      }
    };

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY, e);

    if (isDragging || holdTimerRef.current) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', handleUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [audioRef, dragValue, duration, getProgressFromEvent, isDragging]);

  const displayTime = isDragging ? dragValue : currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  useEffect(() => {
    const sharedAudio = getSharedAudioElement();
    audioElementRef.current = sharedAudio;
    audioRef.current = sharedAudio;

    return () => {
      audioRef.current = null;
    };
  }, [audioRef]);

  useEffect(() => {
    if (prevSongIdRef.current === songId) {
      return;
    }

    prevSongIdRef.current = songId;
    intendedPlayState.current = false;
    intendedTimeRef.current = 0;

    const el = audioElementRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }

    setAudioState({ isPlaying: false, currentTime: 0, duration: 0 });
    setMiniPlaybackState({ isPlaying: false, currentTime: 0, duration: 0 });
  }, [songId, setAudioState, setMiniPlaybackState]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el || selectedAudioSource) {
      return;
    }

    intendedPlayState.current = false;
    el.pause();
    el.removeAttribute('src');
    el.load();
    setAudioState({ isPlaying: false, currentTime: 0, duration: 0 });
    setMiniPlaybackState({ isPlaying: false, currentTime: 0, duration: 0 });
  }, [selectedAudioSource, setAudioState, setMiniPlaybackState]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el) {
      return;
    }
    el.playbackRate = playbackRate;
  }, [playbackRate, selectedAudioSource]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el) {
      return;
    }

    const handlePlay = () => {
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      setIsPlaying(matchesSelection && !el.paused);
      setAudioState({ isPlaying: matchesSelection && !el.paused });
      setMiniPlaybackState({ isPlaying: matchesSelection && !el.paused });
      intendedPlayState.current = true;
    };

    const handlePause = () => {
      if (isUnmountingRef.current) return;
      if (intendedPlayState.current) return;
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      setIsPlaying(false);
      setAudioState({ isPlaying: matchesSelection ? false : latestIsPlayingRef.current });
      setMiniPlaybackState({ isPlaying: false });
    };

    const handleTimeUpdate = () => {
      const t = el.currentTime;
      const d = el.duration || 0;
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      if (matchesSelection) {
        if (!isDragging) {
          setCurrentTime(t);
          intendedTimeRef.current = t;
        }
        setDuration(d);
        setAudioState({ currentTime: t, duration: d });
        setMiniPlaybackState({ currentTime: t, duration: d });
      }
    };

    const handleLoadedMetadata = () => {
      const d = el.duration || 0;
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      if (matchesSelection) {
        const targetTime = Math.min(intendedTimeRef.current, d);
        if (Number.isFinite(targetTime) && targetTime >= 0) {
          el.currentTime = targetTime;
        }
        el.playbackRate = playbackRate;
        setDuration(d);
        setAudioState({ currentTime: targetTime, duration: d });
        setCurrentTime(targetTime);
        setMiniPlaybackState({ currentTime: targetTime, duration: d });
      }

      if (intendedPlayState.current) {
        el.play().catch(() => {
          intendedPlayState.current = false;
          setIsPlaying(false);
          setAudioState({ isPlaying: false });
          setMiniPlaybackState({ isPlaying: false });
        });
      }
    };

    const handleEnded = () => {
      intendedPlayState.current = false;
      setIsPlaying(false);
      setAudioState({ isPlaying: false });
      setMiniPlaybackState({ isPlaying: false });
    };

    const handleError = () => {
      const err = el.error;
      console.error(`[AUDIO_PLAYER_ERROR] Workspace player error for src: ${el.src}. Error code: ${err?.code}, message: ${err?.message}`);
      
      intendedPlayState.current = false;
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      if (!matchesSelection) {
        return;
      }

      setIsPlaying(false);
      setAudioState({ isPlaying: false });
      setMiniPlaybackState({ isPlaying: false });
    };

    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('loadedmetadata', handleLoadedMetadata);
    el.addEventListener('ended', handleEnded);
    el.addEventListener('error', handleError);

    return () => {
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('timeupdate', handleTimeUpdate);
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('error', handleError);
    };
  }, [isDragging, playbackRate, selectedAudioSource, setAudioState, setMiniPlaybackState]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el || !selectedAudioSource) {
      return;
    }

    const resolved = resolveAudioUrl(selectedAudioSource);
    if (el.src !== resolved) {
      // Always switch source if it's different to ensure context switching.
      // Setting el.src will also stop current playback if any.
      el.src = selectedAudioSource;
    }
  }, [selectedAudioSource]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const matchesSelection = isSourceMatch(el, selectedAudioSource);
      const playingThisSelection = matchesSelection && !el.paused;
      setIsPlaying(playingThisSelection);
      setAudioState({ isPlaying: playingThisSelection });

      if (matchesSelection) {
        const t = Number.isFinite(el.currentTime) ? el.currentTime : 0;
        const d = Number.isFinite(el.duration) ? el.duration : 0;
        setCurrentTime(t);
        setDuration(d);
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [selectedAudioSource, setAudioState]);

  useEffect(() => {
    // Fetch protected URLs for ALL audio files in parallel so every partition appears in the list.
    let cancelled = false;
    async function buildAndSetTracks() {
      const resolvedTracks = await Promise.all(
        audioFiles.map(async (file) => {
          // For the currently selected file, prefer the already-resolved selectedAudioSource.
          if (file.id === selectedAudio?.id && selectedAudioSource) {
            return { id: file.id, label: getAudioDisplayName(file), source: selectedAudioSource };
          }
          // For others: use offline route only when offline fallback is explicitly active.
          if (allowOfflineFallback) {
            const offlineUrl = getOfflineDriveFileUrl(file);
            if (offlineUrl) {
              return { id: file.id, label: getAudioDisplayName(file), source: offlineUrl };
            }
          }
          try {
            const protectedUrl = await getProtectedDriveFileUrl(file);
            const source = protectedUrl ?? file.drive_download_link;
            if (!source) return null;
            return { id: file.id, label: getAudioDisplayName(file), source };
          } catch {
            const fallback = file.drive_download_link;
            if (!fallback) return null;
            return { id: file.id, label: getAudioDisplayName(file), source: fallback };
          }
        }),
      );

      if (cancelled) return;

      const miniTracks = resolvedTracks.filter(
        (item): item is { id: string; label: string; source: string } => Boolean(item),
      );

      const latestSession = useMiniAudioPlayerStore.getState();
      const elNow = audioElementRef.current;
      const sameSongSession = latestSession.isActive && latestSession.songId === songId;
      const canUseLiveAudioState = Boolean(sameSongSession && elNow && elNow.src);
      const defaultTrackId = selectedAudio?.id ?? miniTracks[0]?.id ?? null;
      const sessionTrackIdIsValid = Boolean(
        latestSession.currentTrackId && miniTracks.some((track) => track.id === latestSession.currentTrackId),
      );

      // Keep the live playback snapshot intact until this page has a confirmed audio source.
      // Otherwise the floating player briefly receives 0s/1x state and snaps back to the start.
      setMiniSession({
        songId,
        songTitle,
        coverSource,
        tracks: miniTracks,
        currentTrackId: sameSongSession
          ? (sessionTrackIdIsValid ? latestSession.currentTrackId : defaultTrackId)
          : defaultTrackId,
        currentTime: canUseLiveAudioState && elNow
          ? (Number.isFinite(elNow.currentTime) ? elNow.currentTime : 0)
          : sameSongSession
            ? latestSession.currentTime
            : currentTime,
        duration: canUseLiveAudioState && elNow
          ? (Number.isFinite(elNow.duration) ? elNow.duration : 0)
          : sameSongSession
            ? latestSession.duration
            : duration,
        isPlaying: canUseLiveAudioState && elNow
          ? !elNow.paused
          : sameSongSession
            ? latestSession.isPlaying
            : isPlaying,
        playbackRate: canUseLiveAudioState && elNow
          ? elNow.playbackRate
          : sameSongSession
            ? latestSession.playbackRate
            : playbackRate,
      });
    }

    void buildAndSetTracks();
    return () => { cancelled = true; };
  }, [
    audioFiles,
    coverSource,
    currentTime,
    duration,
    isPlaying,
    playbackRate,
    songId,
    selectedAudio?.id,
    selectedAudioSource,
    allowOfflineFallback,
    setMiniSession,
    songTitle,
  ]);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
      const sharedAudio = audioElementRef.current;
      const isActuallyPlaying = Boolean(sharedAudio && !sharedAudio.paused);
      
      // Only keep playing in the mini player if it was actively playing when leaving.
      if (isActuallyPlaying) {
        setMiniPlaybackState({
          isPlaying: true,
          currentTime: sharedAudio?.currentTime ?? latestCurrentTimeRef.current,
          duration: sharedAudio?.duration ?? latestDurationRef.current,
        });
      } else {
        // If it was paused, ensure the mini player is also paused.
        setMiniPlaybackState({
          isPlaying: false,
          currentTime: sharedAudio?.currentTime ?? latestCurrentTimeRef.current,
          duration: sharedAudio?.duration ?? latestDurationRef.current,
        });
      }
    };
  }, [setMiniPlaybackState]);

  if (!renderUi) {
    return null;
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-white/[0.04]">
      {/* Top bar: icon + track label + dropdown */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Music4 size={12} className="text-purple-400 shrink-0" />

        {audioFiles.length === 0 ? (
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)]">
            Prova
          </span>
        ) : (
          <div className="relative flex-1 min-w-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => hasMultiple && setOpen((v) => !v)}
              disabled={!hasMultiple}
              className={`inline-flex items-center gap-1 max-w-full text-[0.6rem] font-bold uppercase tracking-[0.18em] truncate transition-colors ${
                hasMultiple
                  ? 'cursor-pointer text-[var(--color-accent)]'
                  : 'cursor-default text-[var(--color-text-medium)]'
              }`}
            >
              <span className="truncate">{activeLabel}</span>
              {hasMultiple && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="9" height="9"
                  viewBox="0 0 24 24"
                  fill="none" stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </button>

            {/* Track dropdown */}
            {open && hasMultiple && (
              <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[180px] overflow-hidden rounded-[10px] border border-[var(--color-border-strong)] bg-[#0f0f12] shadow-2xl">
                {audioFiles.map((file, idx) => {
                  const label = getAudioDisplayName(file);
                  const isActive = file.id === selectedAudio?.id;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => {
                        switchToAudio(file.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-text-medium)] hover:bg-white/5 hover:text-[var(--color-text-high)]'
                      }`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.5rem] font-bold ${
                        isActive ? 'bg-[var(--color-accent)] text-black' : 'bg-white/10 text-[var(--color-text-low)]'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Track count badge */}
        {audioFiles.length > 1 && (
          <span className="ml-auto shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-bold uppercase tracking-widest text-[var(--color-text-low)]">
            {currentIndex + 1}/{audioFiles.length}
          </span>
        )}
      </div>

      {/* Player body */}
      {audioFiles.length === 0 ? (
        <div className="px-3 py-3 text-center">
          <p className="text-xs text-[var(--color-text-medium)]">Kayıt yok.</p>
        </div>
      ) : !selectedAudioSource ? (
        <div className="px-3 py-3 text-center">
          <p className="text-xs text-orange-300">Oynatma linki yok.</p>
        </div>
      ) : (
        <div className="space-y-2 px-3 py-2.5">
          {/* Controls row */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[0.62rem] tabular-nums text-[var(--color-text-low)]">
              {formatSecondsOnly(displayTime)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrev}
                disabled={!hasMultiple || currentIndex <= 0}
                className="flex h-6 w-6 items-center justify-center text-[var(--color-text-low)] transition-all hover:text-[var(--color-text-high)] disabled:cursor-not-allowed disabled:opacity-20 active:scale-90"
                title="Önceki parça"
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                onClick={handlePlayPause}
                className="relative flex h-8 w-8 shrink-0 items-center justify-center text-[var(--color-text-high)] transition-all hover:text-[var(--color-accent)] active:scale-95"
                title={isPlaying ? 'Durdur' : 'Oynat'}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="translate-x-[1px]" />}
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!hasMultiple || currentIndex >= audioFiles.length - 1}
                className="flex h-6 w-6 items-center justify-center text-[var(--color-text-low)] transition-all hover:text-[var(--color-text-high)] disabled:cursor-not-allowed disabled:opacity-20 active:scale-90"
                title="Sonraki parça"
              >
                <SkipForward size={13} />
              </button>
            </div>
            <label className="sr-only" htmlFor="audio-speed-select">Hız</label>
            <select
              id="audio-speed-select"
              value={playbackRate}
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
              className="h-6 rounded-[6px] border border-[var(--color-border)] bg-white/5 px-1.5 text-[0.56rem] font-bold text-[var(--color-text-medium)] outline-none"
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </div>

          {/* Seekable bar */}
          <div className="space-y-1.5">
            <div
              ref={progressRef}
              onMouseDown={handleProgressStart}
              onTouchStart={handleProgressStart}
              className="group relative h-4 w-full cursor-pointer rounded-full bg-white/10 overflow-visible flex items-center touch-none"
            >
              <div className={`relative w-full transition-[height] duration-200 rounded-full bg-white/10 overflow-visible ${isDragging ? 'h-1.5' : 'h-1'}`}>
                {/* Filled portion */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-[width] duration-75"
                  style={{ width: `${progress}%` }}
                />
                {/* Thumb dot */}
                <div
                  className={`pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-[opacity,transform,box-shadow] duration-200 ${isDragging ? 'opacity-100 scale-110' : 'opacity-0 scale-50'}`}
                  style={{ left: `calc(${progress}% - 7px)` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function RepertoireWorkspace({
  song,
  memberId,
  voiceGroup,
  isChef,
  isSectionLeader,
}: RepertoireWorkspaceProps) {
  const memoizedPdfOptions = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
  }), []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savePayloadRef = useRef<Record<string, QueuedSavePayload>>({});
  const saveStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptedAutoSyncVersionRef = useRef<string | null>(null);

  const [viewerWidth, setViewerWidth] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [offlineSupported, setOfflineSupported] = useState(false);
  const [offlineEnabled, setOfflineEnabledState] = useState(false);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<string | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [offlineLastSyncedAt, setOfflineLastSyncedAt] = useState<number | null>(null);
  const [offlineSyncedVersion, setOfflineSyncedVersion] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const store = useRepertoireWorkspaceStore();
  const {
    selectedPdfId,
    selectedAudioId,
    currentPage,
    totalPages,
    isEditMode,
    activeLayerKey,
    previewVoiceGroup,
    activeTool,
    activeColor,
    visibility,
    layersByPage,
    historyByLayerPage,
    futureByLayerPage,
    saveState,
    saveError,
    annotationLoading,
    annotationError,
    documentError,
    pageAspectRatio,
    setSelectedPdfId,
    setSelectedAudioId,
    setCurrentPage,
    setTotalPages,
    setEditMode,
    setActiveLayerKey,
    setPreviewVoiceGroup,
    setActiveTool,
    setActiveColor,
    toggleVisibility,
    replaceFileLayers,
    commitLayerItems,
    undoLayer,
    redoLayer,
    setSaveState,
    setAnnotationLoading,
    setAnnotationError,
    setDocumentError,
    setPageAspectRatio,
    setAudioState,
    reset,
  } = store;
  const normalizedVoiceGroup = asVoiceGroup(voiceGroup);

  const sheetFiles = [...(song.files ?? [])]
    .filter((file) => file.file_type === 'sheet')
    .sort((a, b) => {
      const aTime = Date.parse(a.created_at || '') || 0;
      const bTime = Date.parse(b.created_at || '') || 0;
      return bTime - aTime;
    });
  const audioFiles = [...(song.files ?? [])]
    .filter((file) => file.file_type === 'audio')
    .sort((a, b) => {
      const aTime = Date.parse(a.created_at || '') || 0;
      const bTime = Date.parse(b.created_at || '') || 0;
      return aTime - bTime;
    });
  const coverFiles = [...(song.files ?? [])]
    .filter(isCoverFile)
    .sort((a, b) => {
      const aTime = Date.parse(a.created_at || '') || 0;
      const bTime = Date.parse(b.created_at || '') || 0;
      return bTime - aTime;
    });
  const filesWithDriveId = useMemo(
    () => [...(song.files ?? [])].filter((file) => Boolean(file.drive_file_id)),
    [song.files],
  );
  const offlineSongVersion = useMemo(
    () => buildOfflineSongVersion(filesWithDriveId),
    [filesWithDriveId],
  );

  const editableLayerOptions = useMemo(() => {
    const options: AnnotationLayerKey[] = [];

    if (memberId) {
      options.push('personal');
    }

    if (isChef) {
      options.push('shared_all');
      VOICE_GROUPS.forEach((group) => options.push(makeSharedVoiceGroupLayerKey(group)));
    } else if (isSectionLeader && normalizedVoiceGroup) {
      options.push(makeSharedVoiceGroupLayerKey(normalizedVoiceGroup));
    }

    return options;
  }, [isChef, isSectionLeader, memberId, normalizedVoiceGroup]);

  const defaultSheetFile = sheetFiles[0] ?? null;
  const defaultAudioFile = audioFiles[0] ?? null;
  const selectedCover = coverFiles[0] ?? null;

  const selectedPdf =
    sheetFiles.find((file) => file.id === selectedPdfId) ??
    defaultSheetFile;
  const selectedAudio =
    audioFiles.find((file) => file.id === selectedAudioId) ??
    defaultAudioFile;
  const { url: protectedSelectedPdfSource } = useProtectedDriveFileUrl(selectedPdf);
  const { url: protectedSelectedCoverSource } = useProtectedDriveFileUrl(selectedCover);
  const { url: protectedSelectedAudioSource } = useProtectedDriveFileUrl(selectedAudio);
  const hasFreshOfflineSnapshot = offlineEnabled && offlineSyncedVersion === offlineSongVersion;
  const allowOfflineFallback = offlineEnabled && (!isOnline || hasFreshOfflineSnapshot);
  const selectedPdfSource = getInlineFileSource(selectedPdf, protectedSelectedPdfSource, allowOfflineFallback);
  const selectedCoverSource = getInlineFileSource(selectedCover, protectedSelectedCoverSource, allowOfflineFallback);
  const selectedCoverPreviewSource = selectedCoverSource;
  const selectedCoverIsPdf = isPdfRepertoireFile(selectedCover);
  const selectedAudioSource = getInlineFileSource(selectedAudio, protectedSelectedAudioSource, allowOfflineFallback);
  const hasCoverPage = Boolean(selectedCoverPreviewSource);
  const totalDisplayPages = totalPages + (hasCoverPage ? 1 : 0);
  const canGoPrevPage = Boolean(selectedPdf) && currentPage > 1;
  const canGoNextPage = totalDisplayPages > 0 && currentPage < totalDisplayPages;
  const isCoverPage = hasCoverPage && currentPage === 1;
  const activePdfPageNumber =
    selectedPdf && (!hasCoverPage || currentPage > 1)
      ? (hasCoverPage ? currentPage - 1 : currentPage)
      : null;

  const sharedPreviewGroup: PreviewVoiceGroup = (isChef || isSectionLeader)
    ? previewVoiceGroup
    : normalizedVoiceGroup ?? 'ALL';
  const commentPreviewVoiceGroup: PreviewVoiceGroup = isChef
    ? previewVoiceGroup
    : isSectionLeader
      ? (previewVoiceGroup === 'ALL' ? (normalizedVoiceGroup ?? 'ALL') : previewVoiceGroup)
      : normalizedVoiceGroup ?? 'ALL';
  const commentTargetVoiceGroup: VoiceGroup | null = isChef
    ? (previewVoiceGroup === 'ALL' ? null : previewVoiceGroup)
    : normalizedVoiceGroup ?? null;

  const visibilityModeOptions = useMemo<VisibilityModeOption[]>(() => {
    if (isChef) {
      return [
        { label: 'Hepsi', personal: true, shared: true, previewVoiceGroup: 'ALL' },
        { label: 'Siz', personal: true, shared: false, previewVoiceGroup: 'ALL' },
        { label: 'Tüm Koro', personal: false, shared: true, previewVoiceGroup: 'ALL' },
        { label: 'Sop', personal: false, shared: true, previewVoiceGroup: 'Soprano' },
        { label: 'Alt', personal: false, shared: true, previewVoiceGroup: 'Alto' },
        { label: 'Ten', personal: false, shared: true, previewVoiceGroup: 'Tenor' },
        { label: 'Bas', personal: false, shared: true, previewVoiceGroup: 'Bass' },
      ];
    }

    if (isSectionLeader && normalizedVoiceGroup) {
      return [
        {
          label: 'Hepsi',
          personal: true,
          shared: true,
          previewVoiceGroup: 'ALL',
        },
        {
          label: 'Siz',
          personal: true,
          shared: false,
          previewVoiceGroup: 'ALL',
        },
        {
          label: 'Tüm Koro',
          personal: false,
          shared: true,
          previewVoiceGroup: 'ALL',
        },
        {
          label: getLayerLabel(makeSharedVoiceGroupLayerKey(normalizedVoiceGroup)),
          personal: false,
          shared: true,
          previewVoiceGroup: normalizedVoiceGroup,
        },
      ];
    }

    return [
      {
        label: 'Hepsi',
        personal: true,
        shared: true,
        previewVoiceGroup: normalizedVoiceGroup ?? 'ALL',
      },
      {
        label: 'Siz',
        personal: true,
        shared: false,
        previewVoiceGroup: normalizedVoiceGroup ?? 'ALL',
      },
      {
        label: 'Tüm Koro',
        personal: false,
        shared: true,
        previewVoiceGroup: normalizedVoiceGroup ?? 'ALL',
      },
    ];
  }, [isChef, isSectionLeader, normalizedVoiceGroup]);

  const activeVisibilityMode =
    visibilityModeOptions.find(
      (option) =>
        option.personal === visibility.personal &&
        option.shared === visibility.shared &&
        (!(isChef || isSectionLeader) || option.previewVoiceGroup === previewVoiceGroup),
    ) ?? visibilityModeOptions[0];

  const activeContextKey = selectedPdf && activePdfPageNumber
    ? makeLayerPageKey({
        fileId: selectedPdf.id,
        pageNumber: activePdfPageNumber,
        layerKey: activeLayerKey,
      })
    : null;

  const personalContextKey = selectedPdf && activePdfPageNumber
    ? makeLayerPageKey({
        fileId: selectedPdf.id,
        pageNumber: activePdfPageNumber,
        layerKey: 'personal',
      })
    : null;

  const sharedAllContextKey = selectedPdf && activePdfPageNumber
    ? makeLayerPageKey({
        fileId: selectedPdf.id,
        pageNumber: activePdfPageNumber,
        layerKey: 'shared_all',
      })
    : null;

  const sharedVoiceGroupContextKeys = selectedPdf && activePdfPageNumber
    ? sharedPreviewGroup === 'ALL'
      ? (isChef || isSectionLeader)
        ? VOICE_GROUPS.map((group) =>
            makeLayerPageKey({
              fileId: selectedPdf.id,
              pageNumber: activePdfPageNumber,
              layerKey: makeSharedVoiceGroupLayerKey(group),
            }),
          )
        : []
      : [
          makeLayerPageKey({
            fileId: selectedPdf.id,
            pageNumber: activePdfPageNumber,
            layerKey: makeSharedVoiceGroupLayerKey(sharedPreviewGroup),
          }),
        ]
    : [];

  const activeItems = activeContextKey
    ? layersByPage[activeContextKey] ?? []
    : [];

  const visibleAnnotationEntries: Array<{
    contextKey: string;
    item: AnnotationItem;
    isActiveLayer: boolean;
  }> = [];

  if (visibility.shared && sharedAllContextKey) {
    (layersByPage[sharedAllContextKey] ?? []).forEach((item) => {
      visibleAnnotationEntries.push({
        contextKey: sharedAllContextKey,
        item,
        isActiveLayer: sharedAllContextKey === activeContextKey,
      });
    });
  }

  if (visibility.shared) {
    sharedVoiceGroupContextKeys.forEach((contextKey) => {
      (layersByPage[contextKey] ?? []).forEach((item) => {
        visibleAnnotationEntries.push({
          contextKey,
          item,
          isActiveLayer: contextKey === activeContextKey,
        });
      });
    });
  }

  if (visibility.personal && personalContextKey) {
    (layersByPage[personalContextKey] ?? []).forEach((item) => {
      visibleAnnotationEntries.push({
        contextKey: personalContextKey,
        item,
        isActiveLayer: personalContextKey === activeContextKey,
      });
    });
  }

  const activeLayerHistory = activeContextKey
    ? historyByLayerPage[activeContextKey] ?? []
    : [];
  const activeLayerFuture = activeContextKey
    ? futureByLayerPage[activeContextKey] ?? []
    : [];

  const canEdit =
    editableLayerOptions.length > 0 &&
    Boolean(selectedPdf) &&
    Boolean(memberId) &&
    Boolean(activePdfPageNumber);
  const stageAspectRatio = pageAspectRatio ?? DEFAULT_PAGE_ASPECT_RATIO;
  const offlineSyncedAtLabel = formatSyncedAtLabel(offlineLastSyncedAt);

  const syncSongForOffline = useCallback(async (reason: 'manual' | 'auto') => {
    if (!offlineSupported) {
      throw new Error('Bu cihaz offline repertuvar desteğini sunmuyor.');
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      throw new Error('İnternet bağlantısı yok. Yeniden bağlanınca tekrar deneyin.');
    }

    if (filesWithDriveId.length === 0) {
      throw new Error('Offline kaydetmek için uygun Drive dosyası bulunamadı.');
    }

    setOfflineSyncing(true);
    setOfflineError(null);
    setOfflineStatus(reason === 'manual' ? 'Dosyalar indiriliyor...' : 'Offline yedek güncelleniyor...');

    try {
      const filesToSync: OfflineSyncFileInput[] = [];
      for (const file of filesWithDriveId) {
        const protectedUrl = await getProtectedDriveFileUrl(file);
        const source = protectedUrl ?? file.drive_download_link;
        if (!source) {
          throw new Error(`${file.file_name} için indirme bağlantısı oluşturulamadı.`);
        }

        filesToSync.push({
          driveFileId: file.drive_file_id,
          url: source,
          fileName: file.file_name,
          mimeType: file.mime_type,
        });
      }

      const result: OfflineSyncResult = await syncSongFilesForOffline(song.id, filesToSync);
      markOfflineSongSynced(song.id, offlineSongVersion, result.syncedAt);
      setOfflineLastSyncedAt(result.syncedAt);
      setOfflineSyncedVersion(offlineSongVersion);
      setOfflineStatus(`${result.cachedCount} dosya offline kullanıma hazır.`);
      attemptedAutoSyncVersionRef.current = null;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Offline yedekleme başarısız oldu.';
      setOfflineError(message);
      setOfflineStatus(null);
      throw error;
    } finally {
      setOfflineSyncing(false);
    }
  }, [filesWithDriveId, offlineSongVersion, offlineSupported, song.id]);

  const handleOfflineToggle = useCallback(async () => {
    if (!offlineSupported) {
      setOfflineError('Bu cihaz offline repertuvar desteğini sunmuyor.');
      return;
    }

    const nextEnabled = !offlineEnabled;
    setOfflineEnabledState(nextEnabled);
    setOfflineSongEnabled(song.id, nextEnabled);
    setOfflineError(null);
    attemptedAutoSyncVersionRef.current = null;

    if (!nextEnabled) {
      setOfflineSyncing(true);
      try {
        const result = await removeOfflineSongFiles(song.id);
        clearOfflineSongSyncState(song.id);
        setOfflineLastSyncedAt(null);
        setOfflineSyncedVersion(null);
        setOfflineStatus(result.removedCount > 0 ? 'Offline dosyalar kaldırıldı.' : 'Offline kullanım kapatıldı.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Offline dosyalar kaldırılamadı.';
        setOfflineError(message);
      } finally {
        setOfflineSyncing(false);
      }
      return;
    }

    if (!isOnline) {
      setOfflineStatus('Offline mod açıldı. İnternete bağlanınca dosyalar otomatik indirilecek.');
      return;
    }

    try {
      await syncSongForOffline('manual');
    } catch {
      // syncSongForOffline already sets user-facing error state
    }
  }, [isOnline, offlineEnabled, offlineSupported, song.id, syncSongForOffline]);

  useEffect(() => {
    const supported = isRepertoireOfflineSupported();
    setOfflineSupported(supported);
    setOfflineStatus(null);
    setOfflineError(null);
    setOfflineSyncing(false);
    attemptedAutoSyncVersionRef.current = null;

    if (typeof window !== 'undefined') {
      setIsOnline(window.navigator.onLine);
    }

    if (!supported) {
      setOfflineEnabledState(false);
      setOfflineLastSyncedAt(null);
      setOfflineSyncedVersion(null);
      return;
    }

    const settings = getOfflineSongSettings(song.id);
    setOfflineEnabledState(settings.enabled);
    setOfflineLastSyncedAt(settings.lastSyncedAt);
    setOfflineSyncedVersion(settings.version);
  }, [song.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      setIsOnline(true);
      attemptedAutoSyncVersionRef.current = null;
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!offlineSupported || !offlineEnabled || !isOnline || offlineSyncing) {
      return;
    }

    const settings = getOfflineSongSettings(song.id);
    if (settings.version === offlineSongVersion) {
      return;
    }

    if (attemptedAutoSyncVersionRef.current === offlineSongVersion) {
      return;
    }

    attemptedAutoSyncVersionRef.current = offlineSongVersion;
    void syncSongForOffline('auto').catch(() => {
      // syncSongForOffline already sets user-facing error state
    });
  }, [
    isOnline,
    offlineEnabled,
    offlineSongVersion,
    offlineSupported,
    offlineSyncing,
    song.id,
    syncSongForOffline,
  ]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setViewerWidth(Math.floor(entry.contentRect.width));
      }
    });

    observer.observe(node);
    setViewerWidth(node.clientWidth);

    return () => observer.disconnect();
  }, [selectedPdf?.id, hasCoverPage, selectedPdfSource]);

  useEffect(() => {
    reset();
    const timerMap = saveTimersRef.current;

    return () => {
      Object.values(timerMap).forEach((timer) => clearTimeout(timer));
      if (saveStateTimeoutRef.current) {
        clearTimeout(saveStateTimeoutRef.current);
      }
      reset();
    };
  }, [reset, song.id]);

  useEffect(() => {
    if (!selectedPdfId && defaultSheetFile) {
      setSelectedPdfId(defaultSheetFile.id);
      return;
    }

    if (selectedPdfId && !sheetFiles.some((file) => file.id === selectedPdfId)) {
      setSelectedPdfId(defaultSheetFile?.id ?? null);
    }
  }, [defaultSheetFile, selectedPdfId, setSelectedPdfId, sheetFiles]);

  useEffect(() => {
    if (!selectedAudioId && defaultAudioFile) {
      setSelectedAudioId(defaultAudioFile.id);
      return;
    }

    if (selectedAudioId && !audioFiles.some((file) => file.id === selectedAudioId)) {
      setSelectedAudioId(defaultAudioFile?.id ?? null);
    }
  }, [audioFiles, defaultAudioFile, selectedAudioId, setSelectedAudioId]);

  useEffect(() => {
    if (editableLayerOptions.length === 0) {
      if (isEditMode) {
        setEditMode(false);
        setActiveTool(null);
      }
      return;
    }

    if (!editableLayerOptions.includes(activeLayerKey)) {
      setActiveLayerKey(editableLayerOptions[0]);
      setActiveTool(null);
    }
  }, [activeLayerKey, editableLayerOptions, isEditMode, setActiveLayerKey, setActiveTool, setEditMode]);

  useEffect(() => {
    if (!selectedPdf) {
      return;
    }

    setCurrentPage(1);
    setTotalPages(0);
    setEditMode(false);
    setActiveTool(null);
    setDocumentError(null);
    setPageAspectRatio(null);

    if (!memberId) {
      replaceFileLayers(selectedPdf.id, {});
      return;
    }

    let cancelled = false;
    setAnnotationLoading(true);
    setAnnotationError(null);

    loadAnnotationsForFile(selectedPdf.id)
      .then((layers) => {
        if (cancelled) {
          return;
        }
        replaceFileLayers(selectedPdf.id, layers);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        replaceFileLayers(selectedPdf.id, {});
        setAnnotationError(error instanceof Error ? error.message : 'Notlar yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) {
          setAnnotationLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    memberId,
    replaceFileLayers,
    selectedPdf,
    setActiveTool,
    setAnnotationError,
    setAnnotationLoading,
    setCurrentPage,
    setDocumentError,
    setEditMode,
    setPageAspectRatio,
    setTotalPages,
  ]);

  useEffect(() => {
    if (totalDisplayPages > 0 && currentPage > totalDisplayPages) {
      setCurrentPage(totalDisplayPages);
    }
  }, [currentPage, setCurrentPage, totalDisplayPages]);

  useEffect(() => {
    if (isCoverPage && isEditMode) {
      setEditMode(false);
      setActiveTool(null);
    }
  }, [isCoverPage, isEditMode, setActiveTool, setEditMode]);

  function setTransientSavedState() {
    if (saveStateTimeoutRef.current) {
      clearTimeout(saveStateTimeoutRef.current);
    }

    setSaveState('saved');
    saveStateTimeoutRef.current = setTimeout(() => {
      setSaveState('idle');
    }, 1500);
  }

  function queueSave(payload: QueuedSavePayload) {
    if (!memberId) {
      return;
    }

    const contextKey = makeLayerPageKey({
      fileId: payload.fileId,
      pageNumber: payload.pageNumber,
      layerKey: payload.layerKey,
    });

    savePayloadRef.current[contextKey] = {
      ...payload,
      items: cloneAnnotationItems(payload.items),
    };

    if (saveTimersRef.current[contextKey]) {
      clearTimeout(saveTimersRef.current[contextKey]);
    }

    setSaveState('saving');

    saveTimersRef.current[contextKey] = setTimeout(async () => {
      const queuedPayload = savePayloadRef.current[contextKey];

      if (!queuedPayload) {
        return;
      }

      try {
        await saveLayerSnapshot({
          songId: song.id,
          repertoireFileId: queuedPayload.fileId,
          pageNumber: queuedPayload.pageNumber,
          layerKey: queuedPayload.layerKey,
          annotations: queuedPayload.items,
          memberId,
        });

        delete savePayloadRef.current[contextKey];
        setTransientSavedState();
      } catch (error) {
        setSaveState(
          'error',
          error instanceof Error ? error.message : 'Notlar kaydedilemedi.',
        );
      }
    }, 500);
  }

  function commitActiveItems(items: AnnotationItem[]) {
    if (!selectedPdf || !activeContextKey) {
      return;
    }

    commitLayerItems(activeContextKey, items);
    queueSave({
      fileId: selectedPdf.id,
      pageNumber: currentPage,
      layerKey: activeLayerKey,
      items,
    });
  }

  function handleUndo() {
    if (!selectedPdf || !activeContextKey) {
      return;
    }

    undoLayer(activeContextKey);
    queueSave({
      fileId: selectedPdf.id,
      pageNumber: currentPage,
      layerKey: activeLayerKey,
      items: getLayerItemsFromStore(activeContextKey),
    });
  }

  function handleRedo() {
    if (!selectedPdf || !activeContextKey) {
      return;
    }

    redoLayer(activeContextKey);
    queueSave({
      fileId: selectedPdf.id,
      pageNumber: currentPage,
      layerKey: activeLayerKey,
      items: getLayerItemsFromStore(activeContextKey),
    });
  }

  function handleClearPage() {
    if (!selectedPdf || !activeContextKey) {
      return;
    }

    commitLayerItems(activeContextKey, []);
    queueSave({
      fileId: selectedPdf.id,
      pageNumber: currentPage,
      layerKey: activeLayerKey,
      items: [],
    });
  }

  function handleLayerSelect(layerKey: AnnotationLayerKey) {
    setActiveLayerKey(layerKey);
    setActiveTool(null);

    if (isChef || isSectionLeader) {
      if (layerKey === 'shared_all') {
        setPreviewVoiceGroup('ALL');
      } else if (layerKey.startsWith('shared_voice_group:')) {
        setPreviewVoiceGroup(layerKey.replace('shared_voice_group:', '') as VoiceGroup);
      }
    }
  }

  function handleLayerCycle() {
    if (editableLayerOptions.length === 0) {
      return;
    }

    const currentIndex = editableLayerOptions.indexOf(activeLayerKey);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % editableLayerOptions.length;
    handleLayerSelect(editableLayerOptions[nextIndex]);
  }

  function handleEditToggle() {
    if (!canEdit) {
      return;
    }

    const nextValue = !isEditMode;
    setEditMode(nextValue);

    if (!nextValue) {
      setActiveTool(null);
    }
  }

  function applyVisibilityMode(option: VisibilityModeOption) {
    if (visibility.personal !== option.personal) {
      toggleVisibility('personal');
    }

    if (visibility.shared !== option.shared) {
      toggleVisibility('shared');
    }

    if (isChef || isSectionLeader) {
      setPreviewVoiceGroup(option.previewVoiceGroup);
    }
  }

  function handleVisibilityCycle() {
    const currentIndex = visibilityModeOptions.indexOf(activeVisibilityMode);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % visibilityModeOptions.length;
    applyVisibilityMode(visibilityModeOptions[nextIndex]);
  }

  function handlePreviewGroupChange(value: PreviewVoiceGroup) {
    setPreviewVoiceGroup(value);

    if (
      value !== 'ALL' &&
      activeLayerKey !== 'shared_all' &&
      activeLayerKey !== makeSharedVoiceGroupLayerKey(value)
    ) {
      setActiveLayerKey('personal');
      setActiveTool(null);
    }
  }

  function handleToolCycle() {
    const idx = TOOL_CYCLE.findIndex((o) => o.tool === activeTool);
    if (idx === -1) {
      setActiveTool(TOOL_CYCLE[0].tool);
    } else {
      setActiveTool(TOOL_CYCLE[(idx + 1) % TOOL_CYCLE.length].tool);
    }
  }

  function handleColorCycle() {
    const idx = COLOR_OPTIONS.indexOf(activeColor);
    setActiveColor(COLOR_OPTIONS[(idx + 1) % COLOR_OPTIONS.length]);
  }

  function zoomIn() {
    setZoomLevel((prev) => Math.min(MAX_ZOOM, Math.round((prev + ZOOM_STEP) * 10) / 10));
  }

  function zoomOut() {
    setZoomLevel((prev) => Math.max(MIN_ZOOM, Math.round((prev - ZOOM_STEP) * 10) / 10));
  }

  function resetZoom() {
    setZoomLevel(1.0);
  }

  const activeToolInfo = TOOL_CYCLE.find((o) => o.tool === activeTool) ?? null;
  const ToolIcon = activeToolInfo?.Icon ?? Pencil;
  const toolLabel = activeToolInfo?.label ?? '—';
  const zoomedWidth = viewerWidth > 0 ? Math.floor(viewerWidth * zoomLevel) : 0;

  function renderWorkspaceControls(extraClassName?: string) {
    return (
      <div className={`flex flex-wrap items-center gap-1 ${extraClassName ?? ''}`}>
        {canEdit && (
          <button
            type="button"
            onClick={handleEditToggle}
            className={`shrink-0 inline-flex h-8 items-center justify-center rounded-[8px] border px-2 transition-colors ${
              isEditMode
                ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
            }`}
            title={isEditMode ? 'Bitir' : 'Düzenle'}
          >
            {saveState === 'saving' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : saveState === 'error' ? (
              <AlertCircle size={13} className="text-red-400" />
            ) : isEditMode ? (
              <Check size={15} />
            ) : (
              <Pencil size={13} />
            )}
          </button>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={!canGoPrevPage}
            className="inline-flex h-8 w-6 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="h-8 inline-flex items-center rounded-[8px] border border-[var(--color-border)] bg-white/4 px-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-medium)]">
            {currentPage} / {totalDisplayPages || 0}
          </div>
          <button
            type="button"
            onClick={() => setCurrentPage(Math.min(totalDisplayPages, currentPage + 1))}
            disabled={!canGoNextPage}
            className="inline-flex h-8 w-6 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <button
          type="button"
          onClick={handleVisibilityCycle}
          className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] ${
            visibility.personal || visibility.shared
              ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
          }`}
        >
          {visibility.personal || visibility.shared ? <Eye size={13} /> : <EyeOff size={13} />}
          {activeVisibilityMode.label}
        </button>

        {false && isChef && (
          <label className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-white/4 px-2.5 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-medium)]">
            <Users size={13} />
            <select
              value={previewVoiceGroup}
              onChange={(event) => handlePreviewGroupChange(event.target.value as PreviewVoiceGroup)}
              className="bg-transparent text-[0.65rem] text-[var(--color-text-high)] outline-none"
            >
              <option value="ALL">Tüm Partisyonlar</option>
              {VOICE_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>
        )}

        {isEditMode && (
          <div className="flex items-center gap-1.5 rounded-[8px] border border-[var(--color-accent)]/25 bg-white/3 px-2 py-1.5">
            <button
              type="button"
              onClick={handleLayerCycle}
              disabled={editableLayerOptions.length === 0}
              title="Katman"
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)] disabled:opacity-40"
            >
              <Users size={12} />
              {getLayerLabel(activeLayerKey)}
            </button>

            <span className="h-4 w-px bg-[var(--color-border)]" />

            <button
              type="button"
              onClick={handleToolCycle}
              title={toolLabel}
              className={`flex h-6 w-6 items-center justify-center rounded-[6px] border ${
                activeTool
                  ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
              }`}
            >
              <ToolIcon size={12} />
            </button>

            <button
              type="button"
              onClick={handleColorCycle}
              title={activeColor === 'black' ? 'Siyah' : activeColor === 'red' ? 'Kırmızı' : 'Beyaz'}
              className="h-6 w-6 rounded-full border-2 border-white/25 transition-transform active:scale-90"
              style={{ backgroundColor: ANNOTATION_COLOR_SWATCHES[activeColor] }}
            />

            <span className="h-4 w-px bg-[var(--color-border)]" />

            <button
              type="button"
              onClick={handleUndo}
              disabled={activeLayerHistory.length === 0}
              title="Geri Al"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] disabled:opacity-30"
            >
              <Undo2 size={12} />
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={activeLayerFuture.length === 0}
              title="İleri Al"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] disabled:opacity-30"
            >
              <Redo2 size={12} />
            </button>

            <button
              type="button"
              onClick={handleClearPage}
              disabled={activeItems.length === 0}
              title="Sayfayı Temizle"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-red-500/30 bg-red-500/10 text-red-400 disabled:opacity-30"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderToolbar(extraClassName?: string, hideEmptyWarning?: boolean) {
    return (
      <div className={`flex items-start justify-between gap-1 ${extraClassName ?? ''}`}>
        <div className="flex flex-wrap items-center gap-1">
          {!hideEmptyWarning && sheetFiles.length === 0 && (
            <div className="rounded-[8px] border border-[var(--color-border)] bg-white/4 px-3 py-2 text-xs text-[var(--color-text-medium)]">
              PDF bulunamadı
            </div>
          )}

          {renderWorkspaceControls()}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomLevel <= MIN_ZOOM}
            className="inline-flex h-8 w-7 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] disabled:opacity-40"
            title="Küçült"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="h-8 inline-flex items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-white/4 px-1.5 text-[0.62rem] font-bold tracking-[0.12em] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
            title="Sıfırla"
          >
            %{Math.round(zoomLevel * 100)}
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomLevel >= MAX_ZOOM}
            className="inline-flex h-8 w-7 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] disabled:opacity-40"
            title="Büyüt"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* AudioPanel — ses lojiği, görsel arayüz yok */}
      <AudioPanel
        songId={song.id}
        songTitle={song.title}
        coverSource={selectedCoverPreviewSource}
        audioFiles={audioFiles}
        selectedAudio={selectedAudio ?? null}
        selectedAudioSource={selectedAudioSource}
        allowOfflineFallback={allowOfflineFallback}
        audioRef={audioRef}
        setSelectedAudioId={setSelectedAudioId}
        setAudioState={setAudioState}
        renderUi={false}
      />

      {saveState === 'error' && saveError && (
        <div className="flex items-center gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-sm text-red-400">{saveError}</p>
        </div>
      )}

      {annotationError && (
        <div className="flex items-center gap-2 rounded-[10px] border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <AlertCircle size={14} className="text-orange-300" />
          <p className="text-sm text-orange-200">{annotationError}</p>
        </div>
      )}

      {/* PDF Çerçevesi — tam genişlik, üstten boşluk ve negatif margin ayarlı */}
      <div className="relative mt-4 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-pdf-stage-bg)] p-1 sm:p-2 -mx-[18px] sm:mx-0">

        {/* Araç çubuğu: kontroller + zoom (Üst) */}
        {renderToolbar('mb-3')}

        {!selectedPdf && !hasCoverPage ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
            <FileText size={48} className="text-[var(--color-text-medium)]/40" />
            <h4 className="mt-4 font-serif text-2xl tracking-[-0.04em]">PDF bulunamadı</h4>
            <p className="mt-2 max-w-md text-sm text-[var(--color-text-medium)]">
              Çalışma alanı için önce nota PDF yüklenmeli.
            </p>
          </div>
        ) : !selectedPdfSource && selectedPdf && !hasCoverPage ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
            <FileText size={48} className="text-[var(--color-text-medium)]/40" />
            <h4 className="mt-4 font-serif text-2xl tracking-[-0.04em]">Bu PDF uygulama içinde açılamıyor</h4>
            <p className="mt-2 max-w-md text-sm text-[var(--color-text-medium)]">
              Doğrudan indirme bağlantısı olmadığı için bu sekmede inline görüntüleme pasif. Alttaki dosya listesinden dış bağlantıyı kullanabilirsin.
            </p>
          </div>
        ) : (
          <div ref={containerRef} className="mx-auto w-full max-w-[1200px] overflow-x-auto">
            {viewerWidth > 0 && (
              selectedPdfSource ? (
                <Document
                  file={selectedPdfSource}
                  loading={
                    <div className="flex min-h-[360px] items-center justify-center">
                      <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
                    </div>
                  }
                  noData={
                    <div className="flex min-h-[360px] items-center justify-center text-sm text-[var(--color-text-medium)]">
                      PDF yüklenemedi.
                    </div>
                  }
                  options={memoizedPdfOptions}
                  onLoadError={(error) => {
                    setDocumentError(error.message);
                    setTotalPages(0);
                  }}
                  onLoadSuccess={({ numPages }) => {
                    setDocumentError(null);
                    setTotalPages(numPages);
                    const nextTotal = numPages + (hasCoverPage ? 1 : 0);
                    if (currentPage > nextTotal) {
                      setCurrentPage(nextTotal);
                    }
                  }}
                >
                  <div
                    className="repertoire-pdf-stage relative mx-auto overflow-hidden rounded-[8px]"
                    style={{
                      width: zoomedWidth,
                      height: zoomedWidth * stageAspectRatio,
                    }}
                  >
                    {isCoverPage && selectedCoverPreviewSource ? (
                      selectedCoverIsPdf ? (
                        <iframe
                          src={`${selectedCoverPreviewSource}#page=1&toolbar=0&navpanes=0&scrollbar=0`}
                          title={`${song.title} kapak PDF`}
                          className="h-full w-full border-0"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedCoverPreviewSource}
                          alt={`${song.title} kapak`}
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <>
                        <Page
                          pageNumber={activePdfPageNumber ?? 1}
                          width={zoomedWidth}
                          renderAnnotationLayer={false}
                          renderTextLayer={false}
                          onLoadSuccess={(page) => {
                            const viewport = page.getViewport({ scale: 1 });
                            setPageAspectRatio(viewport.height / viewport.width);
                          }}
                        />

                        {activePdfPageNumber && pageAspectRatio && (
                          <AnnotationStage
                            key={`${selectedPdf?.id ?? 'none'}:${activePdfPageNumber}:${activeLayerKey}:${activeTool ?? 'none'}:${isEditMode ? 'edit' : 'read'}`}
                            width={zoomedWidth}
                            height={zoomedWidth * stageAspectRatio}
                            items={visibleAnnotationEntries}
                            activeItems={activeItems}
                            activeTool={activeTool}
                            activeColor={activeColor}
                            isEditMode={isEditMode}
                            onCommitActiveItems={commitActiveItems}
                          />
                        )}
                      </>
                    )}

                    {annotationLoading && (
                      <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-end p-4">
                        <div className="inline-flex items-center gap-2 rounded-[999px] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)]">
                          <Loader2 size={13} className="animate-spin" />
                          Notlar yükleniyor
                        </div>
                      </div>
                    )}

                    {!isEditMode && totalDisplayPages > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={!canGoPrevPage}
                          className="absolute inset-y-0 left-0 z-10 w-[18%] min-w-[56px] max-w-[112px] bg-transparent disabled:pointer-events-none"
                          aria-label="Önceki sayfa"
                        />
                        <button
                          type="button"
                          onClick={() => setCurrentPage(Math.min(totalDisplayPages, currentPage + 1))}
                          disabled={!canGoNextPage}
                          className="absolute inset-y-0 right-0 z-10 w-[18%] min-w-[56px] max-w-[112px] bg-transparent disabled:pointer-events-none"
                          aria-label="Sonraki sayfa"
                        />
                      </>
                    )}
                  </div>
                </Document>
              ) : (
                <div
                  className="repertoire-pdf-stage relative mx-auto overflow-hidden rounded-[8px]"
                  style={{
                    width: zoomedWidth,
                    height: zoomedWidth * stageAspectRatio,
                  }}
                >
                  {selectedCoverPreviewSource ? (
                    selectedCoverIsPdf ? (
                      <iframe
                        src={`${selectedCoverPreviewSource}#page=1&toolbar=0&navpanes=0&scrollbar=0`}
                        title={`${song.title} kapak PDF`}
                        className="h-full w-full border-0"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedCoverPreviewSource}
                        alt={`${song.title} kapak`}
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FileText size={48} className="text-[var(--color-text-medium)]/40" />
                    </div>
                  )}

                  {!isEditMode && totalDisplayPages > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={!canGoPrevPage}
                        className="absolute inset-y-0 left-0 z-10 w-[18%] min-w-[56px] max-w-[112px] bg-transparent disabled:pointer-events-none"
                        aria-label="Önceki sayfa"
                      />
                      <button
                        type="button"
                        onClick={() => setCurrentPage(Math.min(totalDisplayPages, currentPage + 1))}
                        disabled={!canGoNextPage}
                        className="absolute inset-y-0 right-0 z-10 w-[18%] min-w-[56px] max-w-[112px] bg-transparent disabled:pointer-events-none"
                        aria-label="Sonraki sayfa"
                      />
                    </>
                  )}
                </div>
              )
            )}

            {documentError && (
              <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3">
                <AlertCircle size={14} className="text-red-400" />
                <p className="text-sm text-red-400">{documentError}</p>
              </div>
            )}
          </div>
        )}

        {/* Araç çubuğu: kontroller + zoom (Alt) */}
        {!(!selectedPdf && !hasCoverPage) && (selectedPdfSource || selectedPdf || hasCoverPage) && (
          renderToolbar('mt-3', true)
        )}
      </div>

      <ChefCommentSection
        key={`${song.id}:${commentPreviewVoiceGroup}`}
        songId={song.id}
        memberId={memberId}
        canComment={isChef || isSectionLeader}
        selectedVoiceGroup={commentPreviewVoiceGroup}
        composerTargetVoiceGroup={commentTargetVoiceGroup}
      />

      <section className="glass-panel p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              OFFLINE KULLANIM
            </p>
            <h3 className="mt-0.5 font-serif text-xl leading-tight tracking-[-0.03em]">Bu şarkıyı cihaza indir</h3>
            <p className="mt-0.5 text-[0.68rem] italic leading-tight text-[var(--color-text-medium)] opacity-70">
              Son güncelleme: {offlineSyncedAtLabel ?? 'Henüz güncelleme yapılmadı'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleOfflineToggle();
            }}
            disabled={!offlineSupported || offlineSyncing || filesWithDriveId.length === 0}
            role="switch"
            aria-checked={offlineEnabled}
            aria-label="Offline kullanım"
            className={`relative ml-2 inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              offlineEnabled
                ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                : 'border-[var(--color-border)] bg-white/6'
            }`}
          >
            <span
              className={`absolute left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                offlineEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
            {offlineSyncing && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={12} className="animate-spin text-[var(--color-text-high)]" />
              </span>
            )}
          </button>
        </div>

        {!offlineSupported && (
          <div className="mt-3 rounded-[10px] border border-orange-500/30 bg-orange-500/10 px-4 py-3">
            <p className="text-sm text-orange-300">Bu tarayıcıda offline repertuvar desteği kullanılamıyor.</p>
          </div>
        )}

        {filesWithDriveId.length === 0 && (
          <div className="mt-3 rounded-[10px] border border-orange-500/30 bg-orange-500/10 px-4 py-3">
            <p className="text-sm text-orange-300">Bu şarkıda offline saklanabilecek Drive dosyası bulunamadı.</p>
          </div>
        )}

        {offlineStatus && (
          <div className="mt-3 rounded-[10px] border border-[var(--color-border)] bg-white/5 px-4 py-3">
            <p className="text-sm text-[var(--color-text-medium)]">{offlineStatus}</p>
          </div>
        )}

        {offlineError && (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertCircle size={14} className="text-red-400" />
            <p className="text-sm text-red-400">{offlineError}</p>
          </div>
        )}
      </section>
    </>
  );
}
