'use client';

import { useState } from 'react';
import { ArrowLeft, Loader2, Megaphone, CalendarDays, FileText, Music4, AlertTriangle, Info, Heart, Edit2, Trash2 } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreateAnnouncementModal } from '@/components/CreateAnnouncementModal';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { sanitizeRichText } from '@/lib/richText';
import { supabase, type Announcement } from '@/lib/supabase';

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = params?.id as string;
  const { isAdmin, isSectionLeader, member } = useAuth();
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const announcementQuery = useQuery({
    queryKey: ['announcement', id],
    queryFn: () => fetchAnnouncement(id),
    enabled: Boolean(id),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await postJsonWithAuth<{ id: string }>('/api/announcements/delete', {
        announcement_id: id,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Duyuru silindi.');
      router.back();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Duyuru silinemedi.', 'Silme başarısız');
    },
  });

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
        <button onClick={() => router.back()} className="mb-8 inline-flex items-center gap-2 text-[var(--color-text-medium)]">
          <ArrowLeft size={18} />
          <span className="text-xs uppercase tracking-[0.1em]">Geri</span>
        </button>
        <p className="text-center text-[var(--color-text-medium)]">Duyuru bulunamadı.</p>
      </main>
    );
  }

  const announcement = announcementQuery.data;
  const Icon = ICON_MAP[announcement.icon] ?? Megaphone;
  const canEditDelete = isAdmin() || (isSectionLeader() && announcement.created_by === member?.id);

  return (
    <main className="min-h-screen bg-[var(--color-background)] px-5 pb-10 pt-[max(env(safe-area-inset-top),1.5rem)]">
      <div className="mb-8 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-95"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri Dön</span>
        </button>

        {canEditDelete ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingAnn(announcement)}
              disabled={deleteMutation.isPending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:bg-white/10 hover:text-[var(--color-text-high)] active:scale-90 disabled:opacity-50"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-rose-500/30 bg-rose-500/10 text-rose-400 transition-colors hover:bg-rose-500/20 active:scale-90 disabled:opacity-50"
            >
              {deleteMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        ) : null}
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
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

      <ConfirmDialog
        open={confirmOpen}
        title="Silme işlemini onaylıyor musunuz?"
        description={`“${announcement.title}” duyurusu silinecektir. Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        tone="danger"
        loading={deleteMutation.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />

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
    </main>
  );
}
