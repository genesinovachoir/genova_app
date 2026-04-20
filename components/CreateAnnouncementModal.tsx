'use client';

import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';

import { supabase, type Announcement } from '@/lib/supabase';
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

function buildDraft(editAnnouncement?: Announcement | null): AnnouncementDraft {
  return {
    icon: editAnnouncement?.icon || 'megaphone',
    title: editAnnouncement?.title || '',
    description: sanitizeRichText(editAnnouncement?.description || '<p></p>'),
  };
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
  const { member } = useAuth();
  const toast = useToast();
  const [icon, setIcon] = useState(initialDraft.icon);
  const [title, setTitle] = useState(initialDraft.title);
  const [description, setDescription] = useState(initialDraft.description);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.classList.add('hide-nav');
    return () => document.body.classList.remove('hide-nav');
  }, []);

  const sanitizedDescription = useMemo(() => sanitizeRichText(description), [description]);
  const canSubmit = title.trim().length > 0 && sanitizedDescription !== '<p></p>';

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

    const payload = {
      title: title.trim(),
      description: sanitizedDescription,
      icon,
    };

    const { error } = editAnnouncement
      ? await supabase.from('announcements').update(payload).eq('id', editAnnouncement.id)
      : await supabase.from('announcements').insert({
          ...payload,
          created_by: member.id,
        });

    setSubmitting(false);

    if (error) {
      toast.error(error.message, 'Duyuru kaydedilemedi');
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
