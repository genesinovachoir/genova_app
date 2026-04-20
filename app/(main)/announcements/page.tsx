'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Megaphone, CalendarDays, FileText, Music4, AlertTriangle, Info, Heart, Loader2, ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Announcement } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { CreateAnnouncementModal } from '@/components/CreateAnnouncementModal';
import { useToast } from '@/components/ToastProvider';

const ICON_MAP: Record<string, React.ElementType> = {
  megaphone: Megaphone,
  calendar: CalendarDays,
  file: FileText,
  music: Music4,
  alert: AlertTriangle,
  info: Info,
  heart: Heart,
};

const ANNOUNCEMENTS_QUERY_KEY = ['announcements', 'all'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, choir_members(first_name, last_name)')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Announcement[];
}

export default function AnnouncementsPage() {
  const { isAdmin, isSectionLeader } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const announcementsQuery = useQuery({
    queryKey: ANNOUNCEMENTS_QUERY_KEY,
    queryFn: fetchAnnouncements,
  });

  const announcements = announcementsQuery.data ?? [];

  return (
    <main className="min-h-screen bg-[var(--color-background)] px-5 pb-10 pt-[max(env(safe-area-inset-top),1.5rem)]">
      <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="flex h-full flex-col">
        <div className="mb-6 flex flex-col gap-4">
          <button
            onClick={() => router.back()}
            className="inline-flex w-fit items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-95"
          >
            <ArrowLeft size={18} />
            <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
          </button>
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-serif text-[24px] leading-none tracking-[-0.03em] text-[var(--color-text-high)]">Tüm Duyurular</h1>
            {(isAdmin() || isSectionLeader()) && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-all hover:bg-[var(--color-accent)] hover:text-[var(--color-background)] active:scale-95"
              >
                <Plus size={16} />
              </button>
            )}
          </div>
        </div>

        {announcementsQuery.isPending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
          </div>
        ) : announcementsQuery.isError ? (
          <div className="glass-panel p-5 text-sm text-rose-300">
            Duyurular yüklenemedi. Lütfen tekrar deneyin.
          </div>
        ) : announcements.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-medium)]">Henüz duyuru yok.</p>
        ) : (
          <div className="space-y-2">
            {announcements.map((ann) => {
              const Icon = ICON_MAP[ann.icon] ?? Megaphone;
              const targetGroup = ann.target_voice_groups?.[0];

              let borderStyles = 'border-[var(--color-border)] bg-white/4';
              let iconStyles = 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]';

              if (targetGroup === 'Soprano') {
                borderStyles = 'bg-[rgba(251,113,133,0.08)] border-[rgba(251,113,133,0.35)]';
                iconStyles = 'bg-[rgba(251,113,133,0.15)] border-[rgba(251,113,133,0.35)] text-[#fb7185]';
              } else if (targetGroup === 'Alto') {
                borderStyles = 'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.35)]';
                iconStyles = 'bg-[rgba(251,191,36,0.15)] border-[rgba(251,191,36,0.35)] text-[#fbbf24]';
              } else if (targetGroup === 'Tenor') {
                borderStyles = 'bg-[rgba(56,189,248,0.08)] border-[rgba(56,189,248,0.35)]';
                iconStyles = 'bg-[rgba(56,189,248,0.15)] border-[rgba(56,189,248,0.35)] text-[#38bdf8]';
              } else if (targetGroup === 'Bass') {
                borderStyles = 'bg-[rgba(167,139,250,0.08)] border-[rgba(167,139,250,0.35)]';
                iconStyles = 'bg-[rgba(167,139,250,0.15)] border-[rgba(167,139,250,0.35)] text-[#a78bfa]';
              }

              return (
                <div key={ann.id} className="flex items-center gap-2">
                  <Link href={`/announcements/${ann.id}`} className="block min-w-0 flex-1">
                    <div className={`rounded-[4px] border ${borderStyles} p-3 transition-colors hover:bg-white/5 active:scale-[0.98]`}>
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border ${iconStyles}`}>
                          <Icon size={16} />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="line-clamp-2 font-serif text-[15px] leading-tight tracking-[-0.03em]">{ann.title}</p>
                          <p className="mt-1.5 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-medium)]">{formatDate(ann.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      <CreateAnnouncementModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={async () => {
          setShowCreateModal(false);
          await queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
          toast.success('Duyuru listesi güncellendi.');
        }}
      />
    </main>
  );
}
