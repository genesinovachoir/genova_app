'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Edit2, Eye, EyeOff, Loader2, Megaphone, CalendarDays, FileText, Music4, AlertTriangle, Info, Heart, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreateAnnouncementModal } from '@/components/CreateAnnouncementModal';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { sanitizeRichText } from '@/lib/richText';
import { createRealtimeTopic } from '@/lib/realtime';
import { supabase, type Announcement } from '@/lib/supabase';
import { useBackOrHome } from '@/hooks/useBackOrHome';
import { SwipeBack } from '@/components/SwipeBack';

const ICON_MAP: Record<string, React.ElementType> = {
  megaphone: Megaphone,
  calendar: CalendarDays,
  file: FileText,
  music: Music4,
  alert: AlertTriangle,
  info: Info,
  heart: Heart,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function getAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Oturum doğrulanamadı. Lütfen tekrar giriş yapın.');
  }

  return sessionData.session.access_token;
}

async function postJsonWithAuth<T>(url: string, payload: Record<string, unknown>) {
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

  return (await response.json()) as T;
}

async function fetchAnnouncement(id: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, choir_members(first_name, last_name)')
    .eq('id', id)
    .single();

  if (error) {
    throw error;
  }

  return data as Announcement;
}

export default function AnnouncementPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = params?.id as string;
  const { isAdmin, isSectionLeader, member } = useAuth();
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const handleBack = useBackOrHome();

  const announcementQuery = useQuery({
    queryKey: ['announcement', id],
    queryFn: () => fetchAnnouncement(id),
    enabled: Boolean(id),
  });

  const toggleHideMutation = useMutation({
    mutationFn: async (isHidden: boolean) => {
      await postJsonWithAuth<{ id: string }>('/api/announcements/update', {
        announcement_id: id,
        is_hidden: isHidden,
      });
    },
    onSuccess: async (_, isHidden) => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      await queryClient.invalidateQueries({ queryKey: ['announcement', id] });
      toast.success(isHidden ? 'Duyuru gizlendi.' : 'Duyuru görünür yapıldı.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'İşlem başarısız oldu.', 'Hata');
    },
  });

  const deleteAnnouncementMutation = useMutation({
    mutationFn: async () => {
      await postJsonWithAuth<{ id: string }>('/api/announcements/delete', {
        announcement_id: id,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      await queryClient.invalidateQueries({ queryKey: ['announcement', id] });
      setShowDeleteConfirm(false);
      toast.success('Duyuru silindi.');
      handleBack();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Duyuru silinemedi.', 'Hata');
    },
  });

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(createRealtimeTopic(`announcement-detail:${id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `id=eq.${id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['announcement', id] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  if (announcementQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
      </div>
    );
  }

  if (announcementQuery.isError || !announcementQuery.data) {
    return (
      <main className="min-h-screen bg-[var(--color-background)] px-5 pb-10 pt-[max(env(safe-area-inset-top),1.5rem)]">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 pr-3 pl-2.5 text-[var(--color-text-medium)] backdrop-blur-md transition-all hover:bg-white/10 hover:text-[var(--color-text-high)] active:scale-95"
          >
            <ArrowLeft size={16} />
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em]">Geri</span>
          </button>
          <span className="page-kicker">Duyuru</span>
        </div>
        <p className="mt-6 text-center text-[var(--color-text-medium)]">Duyuru bulunamadı.</p>
      </main>
    );
  }

  const announcement = announcementQuery.data;
  const Icon = ICON_MAP[announcement.icon] ?? Megaphone;
  const canEditAnnouncement = isAdmin() || (isSectionLeader() && announcement.created_by === member?.id);
  const canDeleteAnnouncement = announcement.created_by === member?.id;

  return (
    <SwipeBack fallback="/">
    <main className="min-h-screen bg-[var(--color-background)] px-5 pb-10 pt-[max(env(safe-area-inset-top),1.5rem)]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={handleBack}
            className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 pr-3 pl-2.5 text-[var(--color-text-medium)] backdrop-blur-md transition-all hover:bg-white/10 hover:text-[var(--color-text-high)] active:scale-95"
          >
            <ArrowLeft size={16} />
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em]">Geri</span>
          </button>
          <span className="page-kicker">Duyuru</span>
        </div>

        {canEditAnnouncement || canDeleteAnnouncement ? (
          <div className="flex items-center gap-2">
            {canEditAnnouncement ? (
              <>
                <button
                  onClick={() => toggleHideMutation.mutate(!announcement.is_hidden)}
                  disabled={toggleHideMutation.isPending}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border backdrop-blur-md transition-all active:scale-95 disabled:opacity-50 ${
                    announcement.is_hidden
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                      : 'border-white/10 bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10 hover:text-[var(--color-text-high)]'
                  }`}
                  title={announcement.is_hidden ? 'Göster' : 'Gizle'}
                >
                  {toggleHideMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : announcement.is_hidden ? (
                    <Eye size={13} />
                  ) : (
                    <EyeOff size={13} />
                  )}
                </button>
                <button
                  onClick={() => setEditingAnn(announcement)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[var(--color-text-medium)] backdrop-blur-md transition-all hover:bg-white/10 hover:text-[var(--color-text-high)] active:scale-95 disabled:opacity-50"
                >
                  <Edit2 size={13} />
                </button>
              </>
            ) : null}
            {canDeleteAnnouncement ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteAnnouncementMutation.isPending}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rose-500/35 bg-rose-500/10 text-rose-300 backdrop-blur-md transition-all hover:bg-rose-500/20 active:scale-95 disabled:opacity-50"
                title="Sil"
              >
                {deleteAnnouncementMutation.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] mt-0.5">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="mb-0.5 font-serif text-[19px] leading-[1.25] tracking-[-0.03em] text-[var(--color-text-high)]">{announcement.title}</h1>
            <div className="mt-1 flex flex-col gap-1">
              <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-medium)]">{formatDate(announcement.created_at)}</span>
              {announcement.choir_members ? (
                <span className="text-[0.75rem] font-medium text-[var(--color-text-high)]">
                  Yayınlayan: {(announcement.choir_members as { first_name: string; last_name: string }).first_name}{' '}
                  {(announcement.choir_members as { first_name: string; last_name: string }).last_name}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mb-6 h-px w-full bg-[var(--color-border)]" />

        <div
          className="prose max-w-none [--tw-prose-body:var(--color-text-high)] [--tw-prose-headings:var(--color-text-high)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-text-high)] [--tw-prose-bullets:var(--color-text-medium)] [--tw-prose-quotes:var(--color-text-high)] [--tw-prose-code:var(--color-text-high)] [--tw-prose-hr:var(--color-border)] prose-headings:my-2 prose-p:my-1 prose-p:text-[14px] prose-p:leading-[1.55] prose-a:text-[var(--color-accent)] prose-ul:list-disc prose-ol:list-decimal prose-li:my-0.5 prose-img:max-h-[60vh] prose-img:w-full prose-img:rounded-[var(--radius-panel)] prose-img:border prose-img:border-[var(--color-border)] prose-img:object-cover"
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(announcement.description) }}
        />
      </motion.div>

      <CreateAnnouncementModal
        open={Boolean(editingAnn)}
        onClose={() => setEditingAnn(null)}
        onCreated={async () => {
          setEditingAnn(null);
          await queryClient.invalidateQueries({ queryKey: ['announcement', id] });
          await queryClient.invalidateQueries({ queryKey: ['announcements'] });
        }}
        editAnnouncement={editingAnn}
      />
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Duyuruyu sil"
        description="Bu duyuru kalıcı olarak silinecek. İşlem geri alınamaz."
        confirmLabel="Sil"
        tone="danger"
        loading={deleteAnnouncementMutation.isPending}
        onClose={() => {
          if (!deleteAnnouncementMutation.isPending) {
            setShowDeleteConfirm(false);
          }
        }}
        onConfirm={() => {
          deleteAnnouncementMutation.mutate();
        }}
      />
    </main>
    </SwipeBack>
  );
}
