'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { supabase } from '@/lib/supabase';
import { addMembersToRoom, fetchRoomMembers } from '@/lib/chat';
import type { ChatRoomMember } from '@/lib/chat';

interface AddableMember {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  voice_group: string | null;
}

interface AddMemberModalProps {
  isOpen: boolean;
  roomId: string;
  currentMemberIds: string[];
  onClose: () => void;
  onMembersChange: (members: ChatRoomMember[]) => void;
}

export function AddMemberModal({
  isOpen,
  roomId,
  currentMemberIds,
  onClose,
  onMembersChange,
}: AddMemberModalProps) {
  const toast = useToast();
  const [members, setMembers] = useState<AddableMember[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMemberIdSet = useMemo(
    () => new Set(currentMemberIds),
    [currentMemberIds]
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setSelected([]);
    setSearch('');
    setError(null);
    setIsFetching(true);

    const fetchAddableMembers = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('choir_members')
          .select('id, first_name, last_name, photo_url, voice_group')
          .eq('is_active', true)
          .order('first_name');

        if (cancelled) return;
        if (fetchError) {
          console.error('Failed to fetch addable members:', fetchError);
          setError('Üyeler yüklenemedi.');
          setMembers([]);
          return;
        }

        const existingIds = new Set(currentMemberIds);
        setMembers(
          ((data ?? []) as AddableMember[]).filter((member) => !existingIds.has(member.id))
        );
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch addable members:', err);
        setError('Üyeler yüklenemedi.');
        setMembers([]);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    };

    void fetchAddableMembers();

    return () => {
      cancelled = true;
    };
  }, [isOpen, currentMemberIds]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return members;

    return members.filter((member) => {
      const name = `${member.first_name} ${member.last_name}`.toLocaleLowerCase('tr-TR');
      const voiceGroup = member.voice_group?.toLocaleLowerCase('tr-TR') ?? '';
      return name.includes(q) || voiceGroup.includes(q);
    });
  }, [members, search]);

  const toggleMember = (memberId: string) => {
    setSelected((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleAddMembers = async () => {
    const selectedIds = Array.from(
      new Set(selected.filter((id) => !currentMemberIdSet.has(id)))
    );
    if (selectedIds.length === 0) return;

    setIsAdding(true);
    setError(null);
    try {
      await addMembersToRoom(roomId, selectedIds);
      const updatedMembers = await fetchRoomMembers(roomId);
      onMembersChange(updatedMembers);
      toast.success(`${selectedIds.length} üye gruba eklendi.`);
      onClose();
    } catch (err) {
      console.error('Failed to add members:', err);
      const message = err instanceof Error ? err.message : 'Üyeler eklenemedi.';
      setError(message);
      toast.error(message, 'Üye ekleme');
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[260] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={() => {
          if (!isAdding) onClose();
        }}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0.98 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.98 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-lg rounded-t-3xl bg-[var(--color-background)] pb-[env(safe-area-inset-bottom,16px)] shadow-2xl sm:rounded-3xl"
          style={{ maxHeight: '85dvh' }}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                <UserPlus size={18} />
              </div>
              <h2 className="text-lg font-bold text-[var(--color-text-high)]">
                Üye Ekle
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isAdding}
              className="rounded-full p-1.5 text-[var(--color-text-medium)] hover:bg-[var(--color-surface)] disabled:opacity-40"
              aria-label="Üye ekleme penceresini kapat"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="flex flex-col overflow-hidden px-4 py-4"
            style={{ maxHeight: 'calc(85dvh - 60px)' }}
          >
            <div className="relative mb-3 shrink-0">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-low)]"
                size={16}
              />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Kişi ara..."
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-4 text-sm text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                autoFocus
              />
            </div>

            {selected.length > 0 ? (
              <p className="mb-2 shrink-0 text-xs text-[var(--color-text-low)]">
                {selected.length} kişi seçildi
              </p>
            ) : null}

            {error ? (
              <div className="mb-3 shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {error}
              </div>
            ) : null}

            <div className="min-h-[220px] flex-1 overflow-y-auto">
              {isFetching ? (
                <div className="flex h-48 items-center justify-center text-[var(--color-text-low)]">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] px-6 text-center">
                  <p className="text-sm font-medium text-[var(--color-text-high)]">
                    {members.length === 0 ? 'Eklenebilecek üye yok' : 'Sonuç bulunamadı'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-low)]">
                    {members.length === 0
                      ? 'Aktif koristlerin tamamı bu grupta görünüyor.'
                      : 'Arama metnini değiştirerek tekrar deneyin.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredMembers.map((member) => {
                    const isSelected = selected.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => toggleMember(member.id)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-accent-soft)]'
                            : 'hover:bg-[var(--color-surface)]'
                        }`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface)]">
                          {member.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.photo_url}
                              alt={`${member.first_name} ${member.last_name}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-sm font-bold text-[var(--color-accent)]">
                              {member.first_name[0]}
                              {member.last_name[0]}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                            {member.first_name} {member.last_name}
                          </p>
                          {member.voice_group ? (
                            <p className="text-xs text-[var(--color-text-low)]">
                              {member.voice_group}
                            </p>
                          ) : null}
                        </div>
                        {isSelected ? (
                          <Check size={18} className="shrink-0 text-[var(--color-accent)]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 flex shrink-0 gap-2">
              <button
                onClick={onClose}
                disabled={isAdding}
                className="flex-1 rounded-xl border border-[var(--color-border)] py-2.5 text-sm font-medium text-[var(--color-text-medium)] disabled:opacity-40"
              >
                İptal
              </button>
              <button
                onClick={() => void handleAddMembers()}
                disabled={selected.length === 0 || isAdding}
                className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {isAdding ? 'Ekleniyor...' : 'Ekle'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
