'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, X, ChevronDown } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import { getSharedAudioElement, resolveAudioUrl } from '@/lib/shared-audio';

function formatSecondsOnly(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
  }
  return `${Math.floor(seconds)}s`;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function isSourceMatch(audio: HTMLAudioElement, source: string | null): boolean {
  if (!source) {
    return false;
  }
  return audio.src === resolveAudioUrl(source);
}

interface FloatingMiniPlayerProps {
  hasBottomNav: boolean;
}

export function FloatingMiniPlayer({ hasBottomNav }: FloatingMiniPlayerProps) {
  const pathname = usePathname();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isNavHiddenByPopup, setIsNavHiddenByPopup] = useState(false);

  const {
    isActive,
    songId,
    songTitle,
    coverSource,
    tracks,
    currentTrackId,
    currentTime,
    duration,
    isPlaying,
    playbackRate,
    setPlaybackState,
    setCurrentTrackId,
    reset,
  } = useMiniAudioPlayerStore((state) => state);

  const isSongDetailPage = pathname.startsWith('/repertuvar/');
  const isOwnSongPage = isSongDetailPage;
  const shouldDockToBottom = !hasBottomNav || isNavHiddenByPopup;
  const [partitionOpen, setPartitionOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const partitionBtnRef = useRef<HTMLButtonElement | null>(null);
  const speedBtnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const speedDropdownRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const progressRectRef = useRef<DOMRect | null>(null);
  const isSwitchingRef = useRef(false);
  const pendingSeekTimeRef = useRef(0);
  const latestCurrentTimeRef = useRef(0);
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const [speedDropdownPos, setSpeedDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const currentIndex = useMemo(
    () => tracks.findIndex((track) => track.id === currentTrackId),
    [tracks, currentTrackId],
  );
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : null;

  useEffect(() => {
    const sharedAudio = getSharedAudioElement();
    audioRef.current = sharedAudio;
  }, []);

  useEffect(() => {
    latestCurrentTimeRef.current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  }, [currentTime]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const body = document.body;
    const update = () => {
      const hidden = body.classList.contains('hide-nav') || body.classList.contains('song-edit-open');
      setIsNavHiddenByPopup(hidden);
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !currentTrack?.source) {
      return;
    }

    const resolved = resolveAudioUrl(currentTrack.source);
    if (el.src !== resolved) {
      isSwitchingRef.current = true;
      pendingSeekTimeRef.current = Number.isFinite(el.currentTime)
        ? Math.max(0, el.currentTime)
        : latestCurrentTimeRef.current;
      el.src = currentTrack.source;
      // We'll seek in handleLoadedMetadata, but we can try here too if already ready.
      if (el.readyState >= 1 && pendingSeekTimeRef.current > 0) {
        el.currentTime = Math.min(pendingSeekTimeRef.current, el.duration || pendingSeekTimeRef.current);
      }
    } else if (Math.abs(el.currentTime - currentTime) > 2) {
      pendingSeekTimeRef.current = Math.max(0, currentTime);
      el.currentTime = Math.max(0, currentTime);
    }
  }, [currentTrack?.source, currentTime]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }

    const safeDuration = Number.isFinite(el.duration) ? el.duration : 0;
    if (isSwitchingRef.current) {
      setPlaybackState({
        isPlaying: !el.paused,
        currentTime: Math.max(0, pendingSeekTimeRef.current),
        duration: safeDuration,
      });
      return;
    }

    setPlaybackState({
      isPlaying: !el.paused,
      currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: safeDuration,
    });
  }, [currentTrack?.id, setPlaybackState]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    if (!isActive || isSongDetailPage) {
      return;
    }
    if (isPlaying && el.paused) {
      el.play().catch(() => {
        // Keep the mini player visible even if autoplay is blocked after route change.
      });
    }
  }, [isActive, isPlaying, isSongDetailPage]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }

    const handlePlay = () => setPlaybackState({ isPlaying: true });
    const handlePause = () => setPlaybackState({ isPlaying: false });
    const handleTimeUpdate = () => {
      // Ignore time updates while switching to prevent snapping back to 0
      if (isSwitchingRef.current) return;
      pendingSeekTimeRef.current = Number.isFinite(el.currentTime) ? Math.max(0, el.currentTime) : 0;
      setPlaybackState({
        currentTime: el.currentTime,
        duration: el.duration || 0,
      });
    };
    const handleLoadedMetadata = () => {
      const targetTime = Number.isFinite(pendingSeekTimeRef.current)
        ? Math.max(0, pendingSeekTimeRef.current)
        : latestCurrentTimeRef.current;
      if (targetTime > 0) {
        el.currentTime = Math.min(targetTime, el.duration || targetTime);
      }
      pendingSeekTimeRef.current = Number.isFinite(el.currentTime) ? Math.max(0, el.currentTime) : 0;
      setPlaybackState({
        currentTime: pendingSeekTimeRef.current,
        duration: el.duration || 0,
      });
      // Delay clearing the switching flag slightly to let the first timeupdate settle
      setTimeout(() => {
        isSwitchingRef.current = false;
      }, 50);
    };
    const handleEnded = () => setPlaybackState({ isPlaying: false });
    const handleError = () => {
      const err = el.error;
      console.error(`[AUDIO_PLAYER_ERROR] Mini player error for id: ${currentTrackId}, src: ${el.src}. Error code: ${err?.code}, message: ${err?.message}`);
      isSwitchingRef.current = false;
      setPlaybackState({ isPlaying: false });
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
  }, [setPlaybackState]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setPartitionOpen(false);
      }
    };
    if (partitionOpen) {
      document.addEventListener('mousedown', closeOnOutside);
    }
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [partitionOpen]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (speedDropdownRef.current && !speedDropdownRef.current.contains(event.target as Node)) {
        setSpeedOpen(false);
      }
    };
    if (speedOpen) {
      document.addEventListener('mousedown', closeOnOutside);
    }
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [speedOpen]);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < tracks.length - 1;

  function getSafeResumeTime() {
    const el = audioRef.current;
    if (el && Number.isFinite(el.currentTime)) {
      return Math.max(0, el.currentTime);
    }
    return latestCurrentTimeRef.current;
  }

  function handlePrev() {
    if (!canGoPrev) {
      return;
    }
    const target = tracks[currentIndex - 1];
    const resumeTime = getSafeResumeTime();
    pendingSeekTimeRef.current = resumeTime;
    setCurrentTrackId(target.id);
    setPlaybackState({ isPlaying: true, currentTime: resumeTime });
  }

  function handleNext() {
    if (!canGoNext) {
      return;
    }
    const target = tracks[currentIndex + 1];
    const resumeTime = getSafeResumeTime();
    pendingSeekTimeRef.current = resumeTime;
    setCurrentTrackId(target.id);
    setPlaybackState({ isPlaying: true, currentTime: resumeTime });
  }

  function handlePlayPause() {
    const el = audioRef.current;
    if (!el) {
      return;
    }

    if (currentTrack?.source && !isSourceMatch(el, currentTrack.source)) {
      isSwitchingRef.current = true;
      pendingSeekTimeRef.current = getSafeResumeTime();
      el.src = currentTrack.source;
    }

    if (el.paused) {
      setPlaybackState({ isPlaying: true });
      el.play()
        .then(() => {
          setPlaybackState({ isPlaying: true });
        })
        .catch(() => {
          setPlaybackState({ isPlaying: false });
        });
      return;
    }

    setPlaybackState({ isPlaying: false });
    el.pause();
  }

  function handleClose() {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    pendingSeekTimeRef.current = 0;
    reset();
  }

  const getProgressValue = useCallback((clientX: number, rect: DOMRect) => {
    if (!duration || duration <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  function startDragging(time: number) {
    setIsDragging(true);
    setDragTime(time);
  }

  function handleSeekStart(event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    if (!duration || duration <= 0) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    progressRectRef.current = rect;
    
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const targetTime = getProgressValue(clientX, rect);

    // Store start position for touch jitter check
    if ('touches' in event) {
      touchStartPosRef.current = { x: clientX, y: clientY };
    }

    // Set hold timer
    holdTimerRef.current = setTimeout(() => {
      startDragging(targetTime);
      // Immediately update audio if needed, or wait for move
    }, 200);

    // If it's a mouse click, we might want immediate seek on click?
    // User requested "hold. yapıp basılı tutarak sürükleyebilmek"
    // I'll make it so it seeks immediately ONLY on mouse click, but hold on touch?
    // Actually, consistency is better. Let's make it hold for both.
  }

  useEffect(() => {
    const handleGlobalUp = () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      
      if (isDragging) {
        const el = audioRef.current;
        if (el && dragTime !== null) {
          el.currentTime = dragTime;
          setPlaybackState({ currentTime: dragTime });
        }
        setIsDragging(false);
        setDragTime(null);
      }
      touchStartPosRef.current = null;
    };

    if (isDragging || holdTimerRef.current) {
      window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchend', handleGlobalUp);
    }
    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [isDragging, dragTime, setPlaybackState]);

  useEffect(() => {
    if (!isDragging && !holdTimerRef.current) return;

    const handleMove = (clientX: number, clientY: number) => {
      if (!progressRectRef.current || !duration) return;

      // If we are just holding but haven't started dragging yet, check for jitter
      if (!isDragging && touchStartPosRef.current) {
        const dx = clientX - touchStartPosRef.current.x;
        const dy = clientY - touchStartPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          // Moved too much before hold triggered, cancel hold
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }
        }
      }

      if (isDragging) {
        const time = getProgressValue(clientX, progressRectRef.current);
        setDragTime(time);
      }
    };

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      // Prevent scrolling while scrubbing
      if (isDragging) e.preventDefault();
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [isDragging, duration, getProgressValue]);

  if (!isActive || !currentTrack?.source) {
    return null;
  }

  const marqueeText = `${songTitle} - '${currentTrack.label}'`;
  const activeTime = dragTime ?? currentTime;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (activeTime / duration) * 100)) : 0;

  return (
    <>
      <div className={`fixed inset-x-0 z-[55] px-3 ${shouldDockToBottom ? 'bottom-[calc(0.5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(6.7rem+env(safe-area-inset-bottom))]'}`}>
        <div className={`relative mx-auto w-[calc(100%-0.25rem)] max-w-md rounded-[12px] border border-[var(--color-border-strong)] bg-[var(--color-player-bg)] px-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.45)] ${isOwnSongPage ? 'py-4' : 'py-2.5'}`}>
          <button
            type="button"
            onClick={handleClose}
            className="absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-player-solid)] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
            title="Kapat"
          >
            <X size={11} />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-[4px] border border-[var(--color-border)] bg-[var(--color-soft-bg)]">
              {coverSource ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverSource} alt={songTitle} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="h-full w-full bg-[var(--color-soft-bg)]" />
              )}
            </div>

            <div className="min-w-0 flex-[1_1_0%] overflow-hidden whitespace-nowrap">
              <div className="mini-player-marquee-track flex w-max items-center">
                <span className="pr-8 text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-[var(--color-text-high)]">
                  {marqueeText}
                </span>
                <span aria-hidden="true" className="pr-8 text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-[var(--color-text-high)]">
                  {marqueeText}
                </span>
              </div>
            </div>

            <span className="font-mono text-[0.62rem] tabular-nums text-[var(--color-text-low)]">
              {formatSecondsOnly(dragTime ?? currentTime)}
            </span>

            <button
              type="button"
              onClick={handlePlayPause}
              className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
              title={isPlaying ? 'Duraklat' : 'Oynat'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} className="translate-x-[1px]" />}
            </button>

            {isOwnSongPage && (
              <button
                ref={partitionBtnRef}
                type="button"
                onClick={() => {
                  if (partitionOpen) {
                    setPartitionOpen(false);
                    setDropdownPos(null);
                  } else {
                    const rect = partitionBtnRef.current?.getBoundingClientRect();
                    if (rect) {
                      const dropdownWidth = 180; // matching min-w-[180px]
                      const margin = 12;
                      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - dropdownWidth - margin));
                      setDropdownPos({ bottom: window.innerHeight - rect.top + 8, left });
                    }
                    setPartitionOpen(true);
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-soft-bg)] pl-2 pr-1.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] focus:outline-none"
              >
                <span className="max-w-[80px] truncate">{currentTrack.label}</span>
                <ChevronDown size={11} className={`transition-transform duration-200 ${partitionOpen ? 'rotate-180' : ''}`} />
              </button>
            )}

            <button
              ref={speedBtnRef}
              type="button"
              onClick={() => {
                if (speedOpen) {
                  setSpeedOpen(false);
                  setSpeedDropdownPos(null);
                } else {
                  const rect = speedBtnRef.current?.getBoundingClientRect();
                  if (rect) {
                    const dropdownWidth = 100; // matching min-w-[100px]
                    const margin = 12;
                    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - dropdownWidth - margin));
                    setSpeedDropdownPos({ bottom: window.innerHeight - rect.top + 8, left });
                  }
                  setSpeedOpen(true);
                }
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-soft-bg)] pl-2 pr-1.5 py-1 text-[0.58rem] font-bold text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] focus:outline-none"
            >
              <span>{playbackRate}x</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${speedOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <div className="mt-3 flex items-center">
            <div
              className="group relative flex h-6 flex-1 cursor-pointer items-center touch-none"
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              ref={progressRef}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, duration)}
              aria-valuenow={Math.max(0, activeTime)}
            >
              <div className={`relative w-full transition-[height] duration-200 rounded-full bg-[var(--color-soft-bg-hover)] overflow-visible ${isDragging ? 'h-1.5' : 'h-[3px]'}`}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-[width] duration-75"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-[opacity,transform,box-shadow] duration-200 pointer-events-none ${isDragging ? 'opacity-100 scale-110' : 'opacity-0 scale-50'}`}
                  style={{ left: `calc(${progress}% - 7px)` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Partition dropdown — fixed portal, escapes all stacking contexts */}
      <AnimatePresence>
        {partitionOpen && dropdownPos && (
          <>
            {/* backdrop to catch outside clicks */}
            <div
              className="fixed inset-0 z-[199]"
              onClick={() => { setPartitionOpen(false); setDropdownPos(null); }}
            />
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              style={{ bottom: dropdownPos.bottom, left: dropdownPos.left }}
              className="fixed z-[200] min-w-[180px] max-h-[40vh] overflow-y-auto rounded-[12px] border border-[var(--color-border-strong)] bg-[var(--color-player-solid)] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl origin-bottom-left"
            >
              <div className="px-3 py-2 border-b border-white/5 mb-1">
                <span className="text-[0.5rem] font-bold uppercase tracking-widest text-[var(--color-text-low)]">Partisyon Seçimi</span>
              </div>
              {tracks.map((track) => {
                const active = track.id === currentTrackId;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      if (track.id === currentTrackId) {
                        setPlaybackState({ isPlaying: true });
                        setPartitionOpen(false);
                        setDropdownPos(null);
                        return;
                      }
                      const resumeTime = getSafeResumeTime();
                      pendingSeekTimeRef.current = resumeTime;
                      setCurrentTrackId(track.id);
                      setPlaybackState({ isPlaying: true, currentTime: resumeTime });
                      setPartitionOpen(false);
                      setDropdownPos(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left text-[0.62rem] font-semibold uppercase tracking-[0.08em] transition-all ${
                      active ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)] hover:bg-[var(--color-soft-bg)] hover:text-[var(--color-text-high)]'
                    }`}
                  >
                    <div className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${active ? 'bg-[var(--color-accent)]' : 'border border-white/20'}`} />
                    {track.label}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Speed dropdown — fixed portal */}
      <AnimatePresence>
        {speedOpen && speedDropdownPos && (
          <>
            <div
              className="fixed inset-0 z-[199]"
              onClick={() => { setSpeedOpen(false); setSpeedDropdownPos(null); }}
            />
            <motion.div
              ref={speedDropdownRef}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              style={{ bottom: speedDropdownPos.bottom, left: speedDropdownPos.left }}
              className="fixed z-[200] min-w-[100px] overflow-hidden rounded-[12px] border border-[var(--color-border-strong)] bg-[var(--color-player-solid)] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl origin-bottom-left"
            >
              <div className="px-3 py-2 border-b border-white/5 mb-1 text-center">
                <span className="text-[0.5rem] font-bold uppercase tracking-widest text-[var(--color-text-low)]">Oynatma Hızı</span>
              </div>
              {PLAYBACK_SPEEDS.map((speed) => {
                const active = playbackRate === speed;
                return (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => {
                      setPlaybackState({ playbackRate: speed });
                      setSpeedOpen(false);
                      setSpeedDropdownPos(null);
                    }}
                    className={`flex w-full items-center justify-center rounded-[6px] px-3 py-2 text-center text-[0.62rem] font-bold transition-all ${
                      active ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)] hover:bg-[var(--color-soft-bg)] hover:text-[var(--color-text-high)]'
                    }`}
                  >
                    {speed}x
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div
        aria-hidden
        className={shouldDockToBottom
          ? (isOwnSongPage ? 'h-[calc(7.5rem+env(safe-area-inset-bottom))]' : 'h-[calc(4.8rem+env(safe-area-inset-bottom))]')
          : (isOwnSongPage ? 'h-[calc(6.6rem+env(safe-area-inset-bottom))]' : 'h-[calc(3.9rem+env(safe-area-inset-bottom))]')}
      />
    </>
  );
}
