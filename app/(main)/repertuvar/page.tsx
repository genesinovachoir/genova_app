'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  FileText, Search, Plus,
  Users, Eye, EyeOff, Loader2, AlertCircle, Pencil, Trash2
} from 'lucide-react';
import {
  supabase,
  RepertoireFile,
  RepertoireSong,
  RepertoireSongRow,
  RepertoireTag,
  normalizeRepertoireSongs,
} from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { AddSongModal } from '@/components/AddSongModal';
import { ProtectedDriveImage } from '@/components/ProtectedDriveImage';
import { SongAssignmentModal } from '@/components/SongAssignmentModal';
import { SongEditModal } from '@/components/SongEditModal';
import { createSlugLookup, getRepertoirePath } from '@/lib/internalPageLinks';

const ACCENT_GRADIENTS = [
  'from-[#D4C8A0]/20 via-[#E0D8B8]/5 to-transparent',
  'from-sky-300/18 via-sky-200/5 to-transparent',
  'from-rose-300/18 via-rose-200/5 to-transparent',
  'from-violet-300/18 via-violet-200/5 to-transparent',
  'from-emerald-300/18 via-emerald-200/5 to-transparent',
  'from-orange-300/18 via-orange-200/5 to-transparent',
];

const COVER_PARTITION_LABEL = '__cover__';
const TAG_LONG_PRESS_MS = 650;

function isCoverFile(fileType: string, partitionLabel: string | null | undefined): boolean {
  return fileType === 'other' && (partitionLabel ?? '').toLowerCase() === COVER_PARTITION_LABEL;
}

function isPdfRepertoireFile(file: RepertoireFile | null | undefined): boolean {
  if (!file) {
    return false;
  }
  const mime = (file.mime_type ?? '').toLowerCase();
  const name = (file.file_name ?? '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

export default function Repertuvar() {
  const router = useRouter();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const isChoristUser = !isChef && !isLeader;

  const [songs, setSongs] = useState<RepertoireSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('Tümü');
  const [tags, setTags] = useState<RepertoireTag[]>([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [assignModal, setAssignModal] = useState<{ songId: string; songTitle: string } | null>(null);
  const [editSong, setEditSong] = useState<RepertoireSong | null>(null);
  const [userParts, setUserParts] = useState<Record<string, string>>({});
  const [assignedSongIds, setAssignedSongIds] = useState<Set<string>>(new Set());
  const [pendingDeleteTag, setPendingDeleteTag] = useState<RepertoireTag | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [isTagEditMode, setIsTagEditMode] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextClickRef = useRef<string | null>(null);

  const visibleTags = useMemo(() => {
    // Şefler ve Bölüm Şefleri tüm etiketleri her zaman görebilir.
    if (isChef || isLeader) return tags;

    // Koristler için sadece onlara tanımlanmış ve görünür olan şarkıların etiketlerini bul.
    const assignedTagsIds = new Set<string>();
    songs.forEach((song) => {
      // Şarkı görünür mü ve kullanıcıya atanmış mı?
      if (song.is_visible && assignedSongIds.has(song.id)) {
        song.tags?.forEach((t) => assignedTagsIds.add(t.id));
      }
    });

    return tags.filter((tag) => assignedTagsIds.has(tag.id));
  }, [isChef, isLeader, tags, songs, assignedSongIds]);

  const tagOptions = useMemo(
    () => ['Tümü', ...visibleTags.map((tag) => tag.name), ...(isChef ? ['Gizli'] : [])],
    [isChef, visibleTags],
  );

  const fetchTags = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('repertoire_tags')
        .select('id, name, color, created_by, created_at')
        .order('created_at');
      setTags((data ?? []) as RepertoireTag[]);
    } catch {
      setTags([]);
    }
  }, []);

  const fetchSongs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('repertoire')
        .select(`
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
        `)
        .order('title');

      if (fetchErr) throw new Error(fetchErr.message);
      const normalizedSongs = normalizeRepertoireSongs(data as RepertoireSongRow[] | null);
      setSongs(normalizedSongs.filter((song) => Boolean(song.drive_folder_id)));

      if (member?.id) {
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from('song_assignments')
          .select('song_id, part_name')
          .eq('member_id', member.id);

        if (assignmentsError) {
          throw new Error(assignmentsError.message);
        }

        const partsMap = (assignmentsData ?? []).reduce((acc, row) => {
          if (row.part_name) {
            acc[row.song_id] = row.part_name;
          }
          return acc;
        }, {} as Record<string, string>);

        const assignedIds = new Set((assignmentsData ?? []).map((row) => row.song_id));
        setUserParts(partsMap);
        setAssignedSongIds(assignedIds);
      } else {
        setUserParts({});
        setAssignedSongIds(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [member?.id]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    fetchSongs();
    fetchTags();
  }, [authLoading, fetchSongs, fetchTags]);

  useEffect(() => {
    if (!tagOptions.includes(activeTag)) {
      setActiveTag('Tümü');
    }
  }, [activeTag, tagOptions]);

  const refreshSongsAndTags = useCallback(async () => {
    await Promise.all([fetchSongs(), fetchTags()]);
  }, [fetchSongs, fetchTags]);

  const clearTagLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTagLongPress();
  }, [clearTagLongPress]);

  const beginTagLongPress = (tag: RepertoireTag) => {
    clearTagLongPress();
    longPressTimerRef.current = setTimeout(() => {
      ignoreNextClickRef.current = tag.name;
      setPendingDeleteTag(tag);
    }, TAG_LONG_PRESS_MS);
  };

  const handleTagButtonClick = (tagName: string) => {
    if (ignoreNextClickRef.current === tagName) {
      ignoreNextClickRef.current = null;
      return;
    }
    setActiveTag(tagName);
  };

  const handleDeleteTag = async () => {
    if (!pendingDeleteTag) {
      return;
    }

    const tagToDelete = pendingDeleteTag;
    setDeletingTagId(tagToDelete.id);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('repertoire_tags')
        .delete()
        .eq('id', tagToDelete.id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      if (activeTag === tagToDelete.name) {
        setActiveTag('Tümü');
      }

      setPendingDeleteTag(null);
      ignoreNextClickRef.current = null;
      await refreshSongsAndTags();
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

      await fetchTags();
      setEditingTagId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket güncellenemedi');
    }
  };

  const toggleVisibility = async (song: RepertoireSong) => {
    if (!isChef) return;
    await supabase.from('repertoire').update({ is_visible: !song.is_visible }).eq('id', song.id);
    setSongs(prev => prev.map(s => s.id === song.id ? { ...s, is_visible: !s.is_visible } : s));
  };

  const filtered = songs
    .filter(s => {
      const searchLower = search.toLowerCase();
      const matchSearch = !search ||
        s.title.toLowerCase().includes(searchLower) ||
        s.composer?.toLowerCase().includes(searchLower) ||
        (s.tags ?? []).some((tag) => tag.name.toLowerCase().includes(searchLower));
      const matchVisibility = isChef ? true : s.is_visible;
      const matchAssignment = !isChoristUser || assignedSongIds.has(s.id);
      if (activeTag === 'Gizli') return matchSearch && !s.is_visible && matchAssignment;
      const matchTag = activeTag === 'Tümü'
        ? true
        : (s.tags ?? []).some((tag) => tag.name === activeTag);
      return matchSearch && matchVisibility && matchTag && matchAssignment;
    });

  const totalAccessibleSongs = useMemo(() => {
    return songs.filter(s => {
      const matchVisibility = isChef ? true : s.is_visible;
      const matchAssignment = !isChoristUser || assignedSongIds.has(s.id);
      return matchVisibility && matchAssignment;
    }).length;
  }, [songs, isChef, isChoristUser, assignedSongIds]);

  const songSlugLookup = useMemo(
    () =>
      createSlugLookup(
        songs.map((song) => ({
          id: song.id,
          title: song.title,
          created_at: song.created_at,
        })),
        'sarki',
      ),
    [songs],
  );

  return (
    <main className="page-shell space-y-6">
      {/* Hero Header */}
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 sm:p-8">
        <div className="flex flex-col items-center justify-center gap-6 px-1">
          <div className="flex items-center justify-center gap-4 sm:gap-6">
            <h1 className="text-center font-serif text-[2.8rem] leading-[0.85] tracking-[-0.04em] sm:text-[4.2rem] lg:text-[5.2rem]">
              Repertuvar
            </h1>
            {isChef && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex h-9 w-9 sm:h-11 sm:w-11 translate-y-[10%] sm:translate-y-[12%] items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.25),rgba(192,178,131,0.1))] text-[var(--color-accent)] transition-all hover:bg-[rgba(192,178,131,0.2)] active:scale-95 shadow-[0_4px_15px_rgba(0,0,0,0.2)]"
                title="Şarkı Ekle"
              >
                <Plus size={20} className="sm:w-6 sm:h-6" />
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        {/* Search */}
        <div className="mt-8">
          <div className="relative">
            <div className="relative flex items-center">
              <motion.div 
                animate={search ? { scale: 1.1, color: "var(--color-accent)" } : { scale: 1, color: "rgba(163, 163, 163, 1)" }}
                className="pointer-events-none absolute left-5 flex items-center justify-center transition-colors duration-300"
              >
                <Search size={20} strokeWidth={1.5} />
              </motion.div>
              
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="themed-search-input w-full rounded-full py-2 pl-14 pr-8 font-serif text-[0.9rem] italic tracking-tight outline-none transition-all duration-500"
              />

              {/* Right side actions (Clear button) */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3 pointer-events-none">
                <AnimatePresence>
                  {search && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      onClick={() => setSearch('')}
                      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-soft-bg)] text-[var(--color-text-medium)] transition-all active:scale-90"
                    >
                      <Plus size={18} className="rotate-45" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
            
            {/* Subtle bottom accent line */}
            <motion.div 
              className="absolute bottom-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#9A8455]/40 to-transparent"
              initial={{ scaleX: 0.5, opacity: 0.2 }}
              animate={search ? { scaleX: 1, opacity: 0.8 } : { scaleX: 0.5, opacity: 0.2 }}
              transition={{ duration: 0.6 }}
            />
          </div>
        </div>

        {/* Etiket Çubuğu */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {/* Edit Mode Toggle Button */}
          {isChef && (
            <button
              onClick={() => setIsTagEditMode(!isTagEditMode)}
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full border transition-all ${
                isTagEditMode 
                  ? 'border-[var(--color-accent)] bg-[rgba(192,178,131,0.2)] text-[var(--color-accent)]' 
                  : 'border-[var(--color-border)] bg-white/3 text-[var(--color-text-medium)] hover:text-[var(--color-text-high)]'
              }`}
              title="Etiketleri Düzenle"
            >
              <Pencil size={12} />
            </button>
          )}

          {tagOptions.map((tag) => {
            const tagEntity = tags.find((item) => item.name === tag) ?? null;
            const allowLongPressDelete = Boolean(isChef && tagEntity);
            const isSpecial = tag === 'Tümü' || tag === 'Gizli';
            const isEditingThis = tagEntity && editingTagId === tagEntity.id;

            return (
              <div key={tag} className="relative shrink-0 group">
                {isEditingThis ? (
                  <div className="flex items-center gap-1 rounded-full border border-[var(--color-accent)] bg-[rgba(192,178,131,0.1)] px-2 py-0.5">
                    <input
                      autoFocus
                      type="text"
                      value={editingTagName}
                      onChange={(e) => setEditingTagName(e.target.value)}
                      onBlur={() => handleRenameTag(tagEntity.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameTag(tagEntity.id);
                        if (e.key === 'Escape') setEditingTagId(null);
                      }}
                      className="w-20 bg-transparent text-[0.65rem] font-medium text-[var(--color-accent)] outline-none"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => !isTagEditMode && handleTagButtonClick(tag)}
                    onPointerDown={() => {
                      if (!isTagEditMode && tagEntity && allowLongPressDelete) {
                        beginTagLongPress(tagEntity);
                      }
                    }}
                    onPointerUp={clearTagLongPress}
                    onPointerLeave={clearTagLongPress}
                    onPointerCancel={clearTagLongPress}
                    onContextMenu={(event) => {
                      if (allowLongPressDelete) {
                        event.preventDefault();
                      }
                    }}
                    className={`shrink-0 rounded-full px-3 py-1 text-[0.65rem] font-medium transition-all ${
                      activeTag === tag
                        ? 'border border-[var(--color-border-strong)] bg-[rgba(192,178,131,0.15)] text-[var(--color-accent)]'
                        : 'border border-[var(--color-border)] bg-white/3 text-[var(--color-text-medium)] hover:border-white/20 hover:text-[var(--color-text-high)]'
                    } ${isTagEditMode && !isSpecial ? 'cursor-default' : ''}`}
                  >
                    {tag === 'Tümü' ? `${tag} (${totalAccessibleSongs})` : tag}
                  </button>
                )}

                {/* Edit Mode Overlays */}
                {isTagEditMode && !isSpecial && tagEntity && !isEditingThis && (
                  <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/30 backdrop-blur-[1px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTagId(tagEntity.id);
                        setEditingTagName(tagEntity.name);
                      }}
                      className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteTag(tagEntity);
                      }}
                      className="p-1 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
        </div>
      ) : error ? (
        <div className="glass-panel flex items-center gap-3 p-6">
          <AlertCircle size={20} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        null
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence>
            {filtered.map((song, index) => {
              const accent = ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length];
              const coverFiles = song.files?.filter((f) => isCoverFile(f.file_type, f.partition_label)) ?? [];
              const coverFile = coverFiles.sort((a, b) => {
                const aIsPdf = isPdfRepertoireFile(a);
                const bIsPdf = isPdfRepertoireFile(b);
                if (aIsPdf !== bIsPdf) return aIsPdf ? 1 : -1;
                return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
              })[0];
              const coverIsPdf = isPdfRepertoireFile(coverFile);

              return (
                <motion.article
                  key={song.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: 0.05 * index }}
                  onClick={() => router.push(getRepertoirePath(song, songSlugLookup.slugById))}
                  className={`glass-panel cursor-pointer p-5 sm:p-6 transition-all hover:border-white/20 ${!song.is_visible ? 'opacity-60' : ''}`}
                >
                  <div className="grid gap-4 sm:grid-cols-[110px_minmax(0,1fr)]">
                    {/* PDF Thumbnail */}
                    <div className={`relative overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-gradient-to-br ${accent}`} style={{ minHeight: 140 }}>
                      {coverFile ? (
                        coverIsPdf ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <FileText className="text-white/20" size={52} />
                          </div>
                        ) : (
                          <ProtectedDriveImage
                            file={coverFile}
                            alt={song.title}
                            className="absolute inset-0 h-full w-full object-cover object-top"
                            loading="lazy"
                            fallback={
                              <FileText className="absolute bottom-3 right-3 text-white/10" size={48} />
                            }
                          />
                        )
                      ) : (
                        <FileText className="absolute bottom-3 right-3 text-white/10" size={48} />
                      )}
                      {!song.is_visible && (
                        <div className="absolute top-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[0.5rem] font-semibold uppercase tracking-widest text-white/70 backdrop-blur-sm">
                          Gizli
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex min-w-0 flex-col justify-between">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-serif text-xl tracking-[-0.05em] leading-tight">{song.title}</h3>
                          {song.composer && (
                            <p className="mt-1.5 text-sm text-[var(--color-text-medium)]">{song.composer}</p>
                          )}
                        </div>
                        {/* Chef actions */}
                        {isChef && (
                          <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setEditSong(song)}
                              title="Düzenle"
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] hover:text-[var(--color-accent)] transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => toggleVisibility(song)}
                              title={song.is_visible ? 'Gizle' : 'Göster'}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
                            >
                              {song.is_visible ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <div />
                        {userParts[song.id] && (
                          <div
                            className={`rounded-[4px] border px-2 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase shadow-sm ${
                              (() => {
                                const lower = userParts[song.id].toLowerCase();
                                if (lower.includes('soprano')) return 'bg-[rgba(251,113,133,0.15)] border-[rgba(251,113,133,0.35)] text-[#fb7185]';
                                if (lower.includes('alto')) return 'bg-[rgba(251,191,36,0.15)] border-[rgba(251,191,36,0.35)] text-[#fbbf24]';
                                if (lower.includes('tenor')) return 'bg-[rgba(56,189,248,0.15)] border-[rgba(56,189,248,0.35)] text-[#38bdf8]';
                                if (lower.includes('bass') || lower.includes('bas')) return 'bg-[rgba(167,139,250,0.15)] border-[rgba(167,139,250,0.35)] text-[#a78bfa]';
                                return 'bg-white/5 border-white/10 text-white/70';
                              })()
                            }`}
                          >
                            {userParts[song.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </section>
      )}

      <AnimatePresence>
        {pendingDeleteTag && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deletingTagId && setPendingDeleteTag(null)}
              className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+140px)] z-[81] mx-auto max-w-[300px] rounded-[24px] border border-[var(--color-border-strong)] bg-[var(--color-surface-solid)] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
            >
              <div className="mb-3 flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                  <Trash2 size={20} />
                </div>
              </div>
              
              <h3 className="mb-1 text-center font-serif text-lg font-medium tracking-tight text-[var(--color-text-high)]">
                Etiketi Sil?
              </h3>
              
              <p className="mb-6 text-center text-[0.75rem] leading-relaxed text-[var(--color-text-medium)]">
                <span className="font-bold text-[var(--color-text-high)]">"{pendingDeleteTag.name}"</span> etiketi silinecek. Bu işlem geri alınamaz ve şarkıları etkilemez.
              </p>
              
              <div className="flex flex-col gap-2">
                <button
                  disabled={Boolean(deletingTagId)}
                  onClick={handleDeleteTag}
                  className="flex w-full items-center justify-center rounded-full bg-red-500 py-3 text-[0.7rem] font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-red-600 active:scale-[0.98] disabled:opacity-50"
                >
                  {deletingTagId ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    'Silmeyi Onayla'
                  )}
                </button>
                <button
                  onClick={() => setPendingDeleteTag(null)}
                  disabled={Boolean(deletingTagId)}
                  className="flex w-full items-center justify-center rounded-full border border-[var(--color-border)] bg-white/5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)] transition-all hover:bg-white/10 active:scale-[0.98]"
                >
                  Vazgeç
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AddSongModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSuccess={fetchSongs} />
      <SongEditModal
        isOpen={Boolean(editSong)}
        song={editSong}
        memberId={member?.id ?? null}
        onClose={() => setEditSong(null)}
        onSaved={refreshSongsAndTags}
      />
      {assignModal && (
        <SongAssignmentModal
          isOpen={true}
          onClose={() => setAssignModal(null)}
          songId={assignModal.songId}
          songTitle={assignModal.songTitle}
        />
      )}
    </main>
  );
}
