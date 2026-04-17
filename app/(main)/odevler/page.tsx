'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Music4,
  Upload,
  CheckCircle2,
  ChevronRight,
  Plus,
  Loader2,
  AlertCircle,
  Trash2,
  Users,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Assignment } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';

type AssignmentChoirMember =
  | Assignment['choir_members']
  | Assignment['choir_members'][]
  | null
  | undefined;

interface AssignmentRow extends Omit<Assignment, 'choir_members' | 'submission' | 'submission_count'> {
  choir_members?: AssignmentChoirMember;
}

function formatDeadline(deadline: string | null): { text: string; isUrgent: boolean } {
  if (!deadline) {
    return { text: 'Son tarih yok', isUrgent: false };
  }

  const date = new Date(deadline);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return { text: 'Süresi doldu', isUrgent: true };
  }
  if (days === 0) {
    return { text: 'Bugün', isUrgent: true };
  }
  if (days <= 3) {
    return { text: `${days} gün kaldı`, isUrgent: true };
  }

  return {
    text: date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
    isUrgent: false,
  };
}

function normalizeAssignment(row: AssignmentRow): Assignment {
  return {
    ...row,
    choir_members: Array.isArray(row.choir_members) ? row.choir_members[0] ?? undefined : row.choir_members ?? undefined,
  };
}

async function fetchAssignments({
  activeTab,
  memberId,
  isChef,
  isLeader,
}: {
  activeTab: string;
  memberId: string | null;
  isChef: boolean;
  isLeader: boolean;
}) {
  const query = supabase
    .from('assignments')
    .select(`
      id, title, description, deadline, target_voice_group,
      drive_folder_id, created_by, is_active, created_at, updated_at,
      choir_members!assignments_created_by_fkey ( first_name, last_name )
    `)
    .order('created_at', { ascending: false });

  if (activeTab !== 'arsiv') {
    query.eq('is_active', activeTab === 'aktif');
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  let submissionsMap: Record<string, boolean> = {};
  if (memberId && !isChef && !isLeader) {
    const { data: submissions, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select('assignment_id')
      .eq('member_id', memberId);

    if (submissionsError) {
      throw submissionsError;
    }

    submissionsMap = Object.fromEntries((submissions ?? []).map((submission) => [submission.assignment_id, true]));
  }

  return ((data ?? []) as AssignmentRow[]).map((assignment) => ({
    ...normalizeAssignment(assignment),
    submission: submissionsMap[assignment.id] ? ({ id: 'exists' } as Assignment['submission']) : null,
  }));
}

export default function Odevler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [activeTab, setActiveTab] = useState('aktif');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<Assignment | null>(null);

  const assignmentsQuery = useQuery({
    queryKey: ['assignments', activeTab, member?.id ?? null, roleKey],
    queryFn: () =>
      fetchAssignments({
        activeTab,
        memberId: member?.id ?? null,
        isChef,
        isLeader,
      }),
    enabled: !authLoading,
  });

  const deleteMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);
      if (error) {
        throw error;
      }
      return assignmentId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
      toast.success('Ödev silindi.');
      setAssignmentToDelete(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Ödev silinemedi.', 'Silme başarısız');
    },
  });

  const assignments = assignmentsQuery.data ?? [];

  return (
    <main className="page-shell space-y-6">
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <span className="page-kicker">tempoyu koru</span>
            <h2 className="mt-4 font-serif text-[2.1rem] leading-[0.95] tracking-[-0.06em] sm:text-[3.15rem]">
              Teslim akışını sahne temposunda tut.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--color-text-medium)] sm:text-base">
              Her ödev tek bir yayın satırı: ne isteniyor, ne zamana kadar ve hangi grubu etkiliyor.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="status-pill">{assignments.length} ödev</div>
            {isLeader ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.2),rgba(192,178,131,0.08))] px-4 py-2.5 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-accent)] active:scale-95"
              >
                <Plus size={14} /> Ödev Oluştur
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex gap-3 overflow-x-auto no-scrollbar">
          {[
            ['aktif', 'Aktif'],
            ['tamamlanan', 'Tamamlananlar'],
            ['arsiv', 'Arşiv'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`shrink-0 rounded-[4px] px-4 py-2.5 text-[0.68rem] font-bold uppercase tracking-[0.22em] ${
                activeTab === key
                  ? 'border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.2),rgba(192,178,131,0.08))] text-[var(--color-accent)]'
                  : 'border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </motion.section>

      {authLoading || assignmentsQuery.isPending ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
        </div>
      ) : assignmentsQuery.isError ? (
        <div className="glass-panel flex items-center gap-3 p-6">
          <AlertCircle size={20} className="shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{assignmentsQuery.error instanceof Error ? assignmentsQuery.error.message : 'Veri yüklenemedi'}</p>
        </div>
      ) : assignments.length === 0 ? (
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel flex flex-col items-center px-6 py-16 text-center"
        >
          <div className="relative flex h-32 w-32 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-[linear-gradient(160deg,rgba(192,178,131,0.12),transparent)]">
            <Music4 className="text-white/10" size={64} />
          </div>
          <h3 className="mt-6 font-serif text-2xl tracking-[-0.05em]">Her şey güncel</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-[var(--color-text-medium)]">
            Bu kategoride şu an ödev yok. Yeni görev düştüğünde burada görünecek.
          </p>
        </motion.section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence>
            {assignments.map((assignment, index) => {
              const { text: deadlineText, isUrgent } = formatDeadline(assignment.deadline);
              const hasSubmitted = Boolean(assignment.submission);
              const creator = assignment.choir_members;

              return (
                <motion.article
                  key={assignment.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: 0.05 * index }}
                  className="glass-panel p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        {hasSubmitted ? (
                          <span className="rounded-[2px] border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-emerald-400">
                            Teslim Edildi
                          </span>
                        ) : null}
                        {isUrgent && !hasSubmitted ? (
                          <span className="rounded-[2px] border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-red-400">
                            Kritik
                          </span>
                        ) : null}
                        {assignment.target_voice_group ? (
                          <span className="rounded-[2px] border border-[var(--color-border)] bg-white/4 px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.15em] text-[var(--color-text-medium)]">
                            {assignment.target_voice_group}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="font-serif text-xl leading-tight tracking-[-0.04em]">{assignment.title}</h3>
                      {creator ? (
                        <p className="mt-1 text-xs text-[var(--color-text-medium)]">
                          {creator.first_name} {creator.last_name} tarafından
                        </p>
                      ) : null}
                    </div>

                    {isChef ? (
                      <button
                        onClick={() => setAssignmentToDelete(assignment)}
                        disabled={deleteMutation.isPending}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-red-500/30 bg-red-500/10 text-red-400 disabled:opacity-50"
                      >
                        {deleteMutation.isPending && assignmentToDelete?.id === assignment.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </button>
                    ) : null}
                  </div>

                  {assignment.description ? (
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--color-text-medium)]">{assignment.description}</p>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                        <Calendar size={11} className={isUrgent ? 'text-red-400' : 'text-[var(--color-accent)]'} />
                        Son Tarih
                      </div>
                      <p className={`font-serif text-base tracking-[-0.04em] ${isUrgent ? 'text-red-400' : 'text-[var(--color-text-high)]'}`}>
                        {deadlineText}
                      </p>
                    </div>
                    <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                        <Users size={11} className="text-[var(--color-accent)]" />
                        Hedef
                      </div>
                      <p className="font-serif text-base tracking-[-0.04em] text-[var(--color-text-high)]">
                        {assignment.target_voice_group ?? 'Tüm Gruplar'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => router.push(`/odevler/${assignment.id}`)}
                      className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-high)] active:scale-95"
                    >
                      <ChevronRight size={14} /> Detay
                    </button>
                    {!isChef && !isLeader && !hasSubmitted ? (
                      <button
                        onClick={() => router.push(`/odevler/${assignment.id}`)}
                        className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.2),rgba(192,178,131,0.08))] px-4 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--color-accent)] active:scale-95"
                      >
                        <Upload size={14} /> Teslim Et
                      </button>
                    ) : null}
                    {hasSubmitted ? (
                      <div className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-emerald-400">
                        <CheckCircle2 size={14} /> Teslim Edildi
                      </div>
                    ) : null}
                    {isChef || isLeader ? (
                      <button
                        onClick={() => router.push(`/odevler/${assignment.id}`)}
                        className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.2),rgba(192,178,131,0.08))] px-4 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--color-accent)] active:scale-95"
                      >
                        <Users size={14} /> Teslimler
                      </button>
                    ) : null}
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </section>
      )}

      {member ? (
        <CreateAssignmentModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={async () => {
            setShowCreateModal(false);
            await queryClient.invalidateQueries({ queryKey: ['assignments'] });
            toast.success('Ödev listesi güncellendi.');
          }}
          creatorMemberId={member.id}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(assignmentToDelete)}
        title="Ödev silinsin mi?"
        description={assignmentToDelete ? `“${assignmentToDelete.title}” ödevi silinecek. Bu işlem geri alınamaz.` : ''}
        confirmLabel="Sil"
        tone="danger"
        loading={deleteMutation.isPending}
        onClose={() => setAssignmentToDelete(null)}
        onConfirm={() => {
          if (assignmentToDelete) {
            deleteMutation.mutate(assignmentToDelete.id);
          }
        }}
      />
    </main>
  );
}
