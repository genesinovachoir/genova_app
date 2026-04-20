'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Check, Loader2, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import { supabase, ChoirMember } from '@/lib/supabase';

interface SongAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  songId: string;
  songTitle: string;
  partName?: string;
  onSaved?: () => Promise<void> | void;
}

export function SongAssignmentModal({ isOpen, onClose, songId, songTitle, partName, onSaved }: SongAssignmentModalProps) {
  const isPlayerActive = useMiniAudioPlayerStore((state) => state.isActive);
  const [members, setMembers] = useState<ChoirMember[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        let assignedQuery = supabase.from('song_assignments').select('member_id').eq('song_id', songId);
        if (partName) {
          assignedQuery = assignedQuery.eq('part_name', partName);
        } else {
          assignedQuery = assignedQuery.is('part_name', null);
        }

        const [{ data: membersData }, { data: assignedData }] = await Promise.all([
          supabase
            .from('choir_members')
            .select('id, first_name, last_name, voice_group, sub_voice_group, auth_user_id, email, phone, is_active')
            .eq('is_active', true)
            .not('voice_group', 'eq', 'Şef')
            .order('voice_group').order('first_name'),
          assignedQuery,
        ]);

        setMembers(membersData ?? []);
        setAssigned(new Set((assignedData ?? []).map((a: { member_id: string }) => a.member_id)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Veri yüklenemedi');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, songId, partName]);

  const toggle = (memberId: string) => {
    setAssigned(prev => {
      const next = new Set(prev);
      next.has(memberId) ? next.delete(memberId) : next.add(memberId);
      return next;
    });
  };

  const normalizedSearch = search.trim().toLocaleLowerCase('tr-TR');
  const filteredMembers = members.filter(m =>
    !normalizedSearch ||
    `${m.first_name} ${m.last_name}`.toLocaleLowerCase('tr-TR').includes(normalizedSearch) ||
    m.voice_group?.toLocaleLowerCase('tr-TR').includes(normalizedSearch) ||
    m.sub_voice_group?.toLocaleLowerCase('tr-TR').includes(normalizedSearch)
  );

  const toggleAll = () => {
    if (filteredMembers.length === 0) {
      return;
    }

    const allFilteredSelected = filteredMembers.every(member => assigned.has(member.id));
    const filteredIds = new Set(filteredMembers.map(member => member.id));

    setAssigned(prev => {
      const next = new Set(prev);
      for (const member of filteredMembers) {
        if (allFilteredSelected) {
          next.delete(member.id);
        } else {
          next.add(member.id);
        }
      }

      if (!allFilteredSelected) {
        // Mevcut görünmeyen seçimleri koru; sadece filtrede görünenleri ekliyoruz.
        for (const id of prev) {
          if (!filteredIds.has(id)) {
            next.add(id);
          }
        }
      }

      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      // Tüm mevcut atamaları sil, yenilerini ekle
      let deleteQuery = supabase.from('song_assignments').delete().eq('song_id', songId);
      if (partName) {
        deleteQuery = deleteQuery.eq('part_name', partName);
      } else {
        deleteQuery = deleteQuery.is('part_name', null);
      }
      await deleteQuery;

      if (assigned.size > 0) {
        const inserts = Array.from(assigned).map(member_id => ({ song_id: songId, member_id, part_name: partName || null }));
        const { error: insertErr } = await supabase.from('song_assignments').upsert(inserts, { onConflict: 'song_id,member_id' });
        if (insertErr) throw new Error(insertErr.message);
      }

      await onSaved?.();
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onClose(); }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydetme başarısız');
    } finally {
      setSaving(false);
    }
  };

  const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every(member => assigned.has(member.id));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            onClick={() => !saving && onClose()}
            style={{ 
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
              borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
              transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1), border-radius 0.4s'
            }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: 0,
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0'
            }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ 
              type: 'spring', 
              stiffness: 400, 
              damping: 32,
              bottom: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
            }}
            className="fixed bottom-0 left-0 right-0 z-[90] mx-auto max-w-lg sm:inset-x-0 sm:top-0 sm:bottom-auto sm:flex sm:h-full sm:items-center sm:justify-center sm:p-6"
            style={{
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
              transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1)'
            }}
          >
            <div className="glass-panel w-full rounded-b-none sm:rounded-[4px] flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 p-6 pb-4 shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={16} className="text-[var(--color-accent)]" />
                    <span className="text-[0.65rem] uppercase tracking-[0.25em] text-[var(--color-text-medium)]">
                      {partName ? 'Partisyon Ataması' : 'Şarkı Ataması'}
                    </span>
                  </div>
                  <h3 className="font-serif text-xl tracking-[-0.04em] leading-tight">{songTitle} {partName && `- ${partName}`}</h3>
                  <p className="mt-1 text-xs text-[var(--color-text-medium)]">
                    {assigned.size} korist seçildi
                  </p>
                </div>
                <button onClick={() => !saving && onClose()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Search & Select All */}
              <div className="px-6 pb-4 shrink-0">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                    <input
                      type="text"
                      placeholder="İsim veya ses grubu ara..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="themed-search-input w-full rounded-[4px] py-2 pl-9 pr-3 text-[0.68rem] font-medium outline-none focus:border-[var(--color-accent)] transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={toggleAll}
                    disabled={filteredMembers.length === 0}
                    className="shrink-0 rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-2 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] hover:text-white transition-colors"
                  >
                    {allFilteredSelected ? 'Seçimi Kaldır' : 'Tümünü Seç'}
                  </button>
                </div>
              </div>

              {/* Members List */}
              <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-1 min-h-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">
                    Korist bulunamadı
                  </p>
                ) : (
                  filteredMembers.map(member => {
                    const isSelected = assigned.has(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => toggle(member.id)}
                        className={`w-full flex items-center gap-3 rounded-[4px] border px-4 py-3 text-left transition-all ${
                          isSelected
                            ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                            : 'border-[var(--color-border)] bg-white/2 hover:bg-white/4'
                        }`}
                      >
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border transition-colors ${
                          isSelected
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {isSelected && <Check size={11} className="text-[var(--color-background)]" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text-high)]">
                            {member.first_name} {member.last_name}
                          </p>
                          <p className="text-xs text-[var(--color-text-medium)]">
                            {member.sub_voice_group ?? member.voice_group}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="p-6 pt-3 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] sm:pb-6 shrink-0 border-t border-[var(--color-border)] space-y-3">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                    >
                      <AlertCircle size={14} className="text-red-400" />
                      <p className="text-xs text-red-400">{error}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {success && (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 size={16} />
                    <p className="text-sm">Atamalar kaydedildi!</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => !saving && onClose()} disabled={saving}
                    className="rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)] disabled:opacity-50"
                  >
                    İptal
                  </button>
                  <button onClick={handleSave} disabled={saving || loading}
                    className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.25),rgba(192,178,131,0.1))] px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-accent)] disabled:opacity-40 active:scale-95"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {saving ? 'Kaydediliyor...' : 'Kaydet'}
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
