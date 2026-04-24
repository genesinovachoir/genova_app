'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import {
  X,
  Megaphone,
  CalendarDays,
  FileText,
  Music4,
  AlertTriangle,
  Info,
  Heart,
  Loader2,
  Search,
  Users,
  CheckSquare,
  Square,
  AlertCircle,
} from 'lucide-react';

import { supabase, type Announcement, type ChoirMember } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/richText';
import { useAuth } from './AuthProvider';
import { RichTextEditor } from './RichTextEditor';
import { useToast } from './ToastProvider';

const ICONS = [
  { key: 'megaphone', Icon: Megaphone },
  { key: 'calendar', Icon: CalendarDays },
  { key: 'file', Icon: FileText },
  { key: 'music', Icon: Music4 },
  { key: 'alert', Icon: AlertTriangle },
  { key: 'info', Icon: Info },
  { key: 'heart', Icon: Heart },
] as const;

const VOICE_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editAnnouncement?: Announcement | null;
}

interface AnnouncementDraft {
  icon: string;
  title: string;
  description: string;
}

type MemberWithSelection = ChoirMember & { selected: boolean };

function buildDraft(editAnnouncement?: Announcement | null): AnnouncementDraft {
  return {
    icon: editAnnouncement?.icon || 'megaphone',
    title: editAnnouncement?.title || '',
    description: sanitizeRichText(editAnnouncement?.description || '<p></p>'),
  };
}

interface PublishAnnouncementPayload {
  title: string;
  description: string;
  icon: string;
  target_users: string[];
  target_voice_groups: string[];
}

async function getAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Oturum doğrulanamadı. Lütfen tekrar giriş yapın.');
  }

  return sessionData.session.access_token;
}

async function postJsonWithAuth<TResponse, TPayload = unknown>(url: string, payload: TPayload) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `İstek başarısız (${response.status})`);
  }

  return (await response.json()) as TResponse;
}

export function CreateAnnouncementModal({ open, onClose, onCreated, editAnnouncement = null }: Props) {
  const initialDraft = useMemo(() => buildDraft(editAnnouncement), [editAnnouncement]);

  return (
    <AnimatePresence>
      {open ? (
        <AnnouncementModalBody
          key={editAnnouncement?.id ?? 'new-announcement'}
          initialDraft={initialDraft}
          editAnnouncement={editAnnouncement}
          onClose={onClose}
          onCreated={onCreated}
        />
      ) : null}
    </AnimatePresence>
  );
}

function AnnouncementModalBody({
  initialDraft,
  editAnnouncement,
  onClose,
  onCreated,
}: {
  initialDraft: AnnouncementDraft;
  editAnnouncement: Announcement | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { member, isAdmin, isSectionLeader } = useAuth();
  const toast = useToast();
  const [icon, setIcon] = useState(initialDraft.icon);
  const [title, setTitle] = useState(initialDraft.title);
  const [description, setDescription] = useState(initialDraft.description);
  const [submitting, setSubmitting] = useState(false);
  
  // Member selection states
  const [members, setMembers] = useState<MemberWithSelection[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('hide-nav');
    return () => document.body.classList.remove('hide-nav');
  }, []);

  const loadMembers = useCallback(async () => {
    if (!member) return;
    setLoadingMembers(true);
    
    let query = supabase
      .from('choir_members')
      .select('id, first_name, last_name, voice_group, sub_voice_group, auth_user_id, email, phone, is_active')
      .eq('is_active', true)
      .order('voice_group')
      .order('first_name');

    // Partisyon şefi ise sadece kendi grubunu görsün (Şef değilse)
    if (!isAdmin() && isSectionLeader() && member.voice_group) {
      query = query.eq('voice_group', member.voice_group);
    }

    const { data, error: membersError } = await query;
    if (membersError) {
      setError(membersError.message);
      setLoadingMembers(false);
      return;
    }

    const selectedIds = new Set(editAnnouncement?.target_users || []);
    const nextMembers = (data ?? [])
      .filter((m) => m.id !== member.id) // Kendini listeden çıkar
      .map((m) => ({
        ...m,
        selected: selectedIds.has(m.id),
      }));

    setMembers(nextMembers as MemberWithSelection[]);
    setLoadingMembers(false);
  }, [member, isAdmin, isSectionLeader, editAnnouncement]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMembers();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadMembers]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    return members.filter((m) => 
      !q ||
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      m.voice_group?.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const groupedMembers = useMemo(() => {
    const groups: Record<string, MemberWithSelection[]> = {};
    for (const voice of VOICE_ORDER) {
      const voiceMembers = filteredMembers.filter((m) => m.voice_group === voice);
      if (voiceMembers.length > 0) {
        groups[voice] = voiceMembers;
      }
    }
    const otherMembers = filteredMembers.filter((m) => !m.voice_group || !VOICE_ORDER.includes(m.voice_group));
    if (otherMembers.length > 0) {
      groups['Diğer'] = otherMembers;
    }
    return groups;
  }, [filteredMembers]);

  const selectedCount = members.filter((m) => m.selected).length;

  const toggleMember = (id: string) => {
    setMembers((prev) => prev.map((m) => m.id === id ? { ...m, selected: !m.selected } : m));
  };

  const toggleAllVisible = () => {
    const allVisibleSelected = filteredMembers.length > 0 && filteredMembers.every((m) => m.selected);
    const visibleIds = new Set(filteredMembers.map((m) => m.id));
    setMembers((prev) => prev.map((m) => visibleIds.has(m.id) ? { ...m, selected: !allVisibleSelected } : m));
  };

  const sanitizedDescription = useMemo(() => sanitizeRichText(description), [description]);
  const canSubmit = title.trim().length > 0 && sanitizedDescription !== '<p></p>' && selectedCount > 0;

  const handleClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!member || !canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const selectedMembers = members.filter((m) => m.selected);
    const target_users = [...selectedMembers.map((m) => m.id), member.id]; // Kendini her zaman ekle
    
    // Ses grubu tespiti
    const target_voice_groups: string[] = [];
    for (const voice of VOICE_ORDER) {
      const groupInList = members.filter(m => m.voice_group === voice);
      // Eğer listedeki (kurucu hariç) ilgili grubun tamamı seçildiyse, grubu hedefle
      if (groupInList.length > 0 && groupInList.every(m => m.selected)) {
        target_voice_groups.push(voice);
      }
    }

    // Kullanıcının talebi: Artik "boş = herkes" mantığı yok. 
    // "Bir duyuruyu görmesi için atanmış olması gerekir." 
    // Bu yüzden seçilenleri aynen kaydediyoruz.
    const payload: PublishAnnouncementPayload = {
      title: title.trim(),
      description: sanitizedDescription,
      icon,
      target_users,
      target_voice_groups,
    };

    let submitErrorMessage: string | null = null;
    if (editAnnouncement) {
      try {
        await postJsonWithAuth<{ id: string }>('/api/announcements/update', {
          announcement_id: editAnnouncement.id,
          ...payload,
        });
      } catch (requestError) {
        submitErrorMessage = requestError instanceof Error ? requestError.message : 'Duyuru güncellenemedi.';
      }
    } else {
      try {
        await postJsonWithAuth<{ id: string }>('/api/announcements/publish', payload);
      } catch (requestError) {
        submitErrorMessage = requestError instanceof Error ? requestError.message : 'Duyuru yayınlanamadı.';
      }
    }

    setSubmitting(false);

    if (submitErrorMessage) {
      setError(submitErrorMessage);
      toast.error(submitErrorMessage, 'Duyuru kaydedilemedi');
      return;
    }

    toast.success(editAnnouncement ? 'Duyuru güncellendi.' : 'Duyuru yayınlandı.');
    onCreated();
    onClose();
  };

  const isPlayerActive = useMiniAudioPlayerStore((state) => state.isActive);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[999] bg-[var(--color-surface-solid)]"
        style={{ 
          bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
          borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
          transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1), border-radius 0.4s'
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ 
          opacity: 1, 
          y: 0,
          bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0'
        }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ 
          type: 'spring', 
          bounce: 0.12, 
          duration: 0.45,
          bottom: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
        }}
        className="fixed inset-x-0 top-0 z-[999] flex flex-col overflow-hidden pt-[max(env(safe-area-inset-top),0px)]"
        style={{ 
          borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
          borderBottom: isPlayerActive ? '1px solid var(--color-border)' : 'none'
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)] shrink-0">
          <h2 className="font-serif text-[1.1rem] font-medium tracking-[-0.02em] text-[var(--color-text-high)]">
            {editAnnouncement ? 'Duyuruyu Düzenle' : 'Yeni Duyuru'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5" id="announcement-form">
            <div>
              <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">İkon Seç</p>
              <div className="flex flex-wrap gap-2">
                {ICONS.map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIcon(key)}
                    className={`flex items-center justify-center rounded-[8px] border p-2.5 transition-all active:scale-95 ${
                      icon === key
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
                    }`}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Başlık</p>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Duyuru başlığı..."
                required
                className="editorial-input"
              />
            </div>

            <div>
              <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Açıklama</p>
              <div className="reset-tiptap-styles">
                <RichTextEditor content={description} onChange={setDescription} />
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-[var(--color-accent)]" />
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Hedef Kitle ({selectedCount})</p>
                </div>
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  disabled={filteredMembers.length === 0}
                  className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)]"
                >
                  {filteredMembers.length > 0 && filteredMembers.every((m) => m.selected) ? 'Kaldır' : 'Tümünü Seç'}
                </button>
              </div>

              <div className="relative mb-3">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="İsim veya ses grubu ara..."
                  className="editorial-input themed-search-input !pl-9"
                  disabled={loadingMembers}
                />
              </div>

              <div className="max-h-[30vh] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                {loadingMembers ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">Üye bulunamadı</p>
                ) : (
                  Object.entries(groupedMembers).map(([voice, voiceMembers]) => (
                    <div key={voice}>
                      <div className="sticky top-0 bg-[var(--color-surface-solid)]/95 px-4 py-2 backdrop-blur-sm z-10">
                        <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">{voice}</span>
                      </div>
                      {voiceMembers.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMember(m.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                        >
                          {m.selected ? (
                            <CheckSquare size={15} className="shrink-0 text-[var(--color-accent)]" />
                          ) : (
                            <Square size={15} className="shrink-0 text-[var(--color-text-medium)]" />
                          )}
                          <span className="flex-1 text-sm">{m.first_name} {m.last_name}</span>
                          <span className="text-[0.6rem] text-[var(--color-text-medium)]">{m.sub_voice_group ?? m.voice_group}</span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                >
                  <AlertCircle size={14} className="text-red-400" />
                  <p className="text-xs text-red-400">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </div>

        <div className="shrink-0 border-t border-[var(--color-border)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="submit"
            form="announcement-form"
            disabled={submitting || !canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-4 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {editAnnouncement ? 'Güncelleniyor...' : 'Yayınlanıyor...'}
              </>
            ) : editAnnouncement ? (
              'Duyuruyu Güncelle'
            ) : (
              'Duyuruyu Yayınla'
            )}
          </button>
        </div>
      </motion.div>
    </>
  );
}
