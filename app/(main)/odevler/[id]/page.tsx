'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Upload,
  Calendar,
  Users,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Assignment, type AssignmentSubmission } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { FileUploadModal } from '@/components/FileUploadModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { uploadSubmission } from '@/lib/drive';

interface AssignmentDetailData {
  assignment: Assignment;
  submissions: AssignmentSubmission[];
  mySubmission: AssignmentSubmission | null;
}

type AssignmentChoirMember =
  | Assignment['choir_members']
  | Assignment['choir_members'][]
  | null
  | undefined;

interface AssignmentRow extends Omit<Assignment, 'choir_members' | 'submission' | 'submission_count'> {
  choir_members?: AssignmentChoirMember;
}

type SubmissionChoirMember =
  | AssignmentSubmission['choir_members']
  | AssignmentSubmission['choir_members'][]
  | null
  | undefined;

interface AssignmentSubmissionRow extends Omit<AssignmentSubmission, 'choir_members'> {
  choir_members?: SubmissionChoirMember;
}

function normalizeAssignment(row: AssignmentRow): Assignment {
  return {
    ...row,
    choir_members: Array.isArray(row.choir_members) ? row.choir_members[0] ?? undefined : row.choir_members ?? undefined,
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) {
    return '—';
  }

  return new Date(dateStr).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchAssignmentDetail({
  assignmentId,
  memberId,
  canReviewSubmissions,
}: {
  assignmentId: string;
  memberId: string | null;
  canReviewSubmissions: boolean;
}): Promise<AssignmentDetailData> {
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      id, title, description, deadline, target_voice_group, drive_folder_id, created_by, is_active, created_at, updated_at,
      choir_members!assignments_created_by_fkey ( first_name, last_name )
    `)
    .eq('id', assignmentId)
    .single();

  if (assignmentError) {
    throw assignmentError;
  }

  let submissions: AssignmentSubmission[] = [];
  if (canReviewSubmissions) {
    const { data: submissionRows, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select(`
        id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link,
        file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at,
        choir_members ( first_name, last_name, voice_group )
      `)
      .eq('assignment_id', assignmentId)
      .order('submitted_at', { ascending: false });

    if (submissionsError) {
      throw submissionsError;
    }

    submissions = ((submissionRows ?? []) as AssignmentSubmissionRow[]).map((submission) => ({
      ...submission,
      choir_members: Array.isArray(submission.choir_members)
        ? submission.choir_members[0] ?? undefined
        : submission.choir_members ?? undefined,
    }));
  }

  let mySubmission: AssignmentSubmission | null = null;
  if (memberId) {
    const { data: mySubmissionRow, error: mySubmissionError } = await supabase
      .from('assignment_submissions')
      .select(
        'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at',
      )
      .eq('assignment_id', assignmentId)
      .eq('member_id', memberId)
      .maybeSingle();

    if (mySubmissionError) {
      throw mySubmissionError;
    }

    mySubmission = (mySubmissionRow as AssignmentSubmission | null) ?? null;
  }

  return {
    assignment: normalizeAssignment(assignment as AssignmentRow),
    submissions,
    mySubmission,
  };
}

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const assignmentId = params?.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const canReviewSubmissions = isChef || isLeader;
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [submissionToDelete, setSubmissionToDelete] = useState<AssignmentSubmission | null>(null);

  const detailQuery = useQuery({
    queryKey: ['assignment-detail', assignmentId, member?.id ?? null, roleKey],
    queryFn: () =>
      fetchAssignmentDetail({
        assignmentId: assignmentId!,
        memberId: member?.id ?? null,
        canReviewSubmissions,
      }),
    enabled: Boolean(assignmentId) && !authLoading,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!assignmentId) {
        throw new Error('Ödev bulunamadı.');
      }
      await uploadSubmission(assignmentId, file);
    },
    onSuccess: async () => {
      setUploadOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
      toast.success('Teslim güncellendi.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Teslim yüklenemedi.', 'Yükleme başarısız');
    },
  });

  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase.from('assignment_submissions').delete().eq('id', submissionId);
      if (error) {
        throw error;
      }
      return submissionId;
    },
    onSuccess: async () => {
      setSubmissionToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
      toast.success('Teslim silindi.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Teslim silinemedi.', 'Silme başarısız');
    },
  });

  const assignment = detailQuery.data?.assignment ?? null;
  const submissions = detailQuery.data?.submissions ?? [];
  const mySubmission = detailQuery.data?.mySubmission ?? null;
  const deletingSubmissionId = deleteSubmissionMutation.isPending ? deleteSubmissionMutation.variables : null;

  return (
    <main className="page-shell space-y-6">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
      >
        <ArrowLeft size={14} /> Ödevler
      </button>

      {authLoading || detailQuery.isPending ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
        </div>
      ) : detailQuery.isError ? (
        <div className="glass-panel flex items-center gap-3 p-6">
          <AlertCircle size={20} className="text-red-400" />
          <p className="text-sm text-red-400">{detailQuery.error instanceof Error ? detailQuery.error.message : 'Veri yüklenemedi'}</p>
        </div>
      ) : !assignment ? null : (
        <>
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 sm:p-8">
            <span className="page-kicker">tempoyu koru</span>
            <h2 className="mt-3 font-serif text-[1.9rem] leading-tight tracking-[-0.05em] sm:text-[2.5rem]">{assignment.title}</h2>
            {assignment.description ? (
              <p className="mt-3 text-sm leading-7 text-[var(--color-text-medium)]">{assignment.description}</p>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                  <Calendar size={12} className="text-[var(--color-accent)]" /> Son Tarih
                </div>
                <p className="font-serif text-base tracking-[-0.04em]">
                  {assignment.deadline
                    ? new Date(assignment.deadline).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
                    : '—'}
                </p>
              </div>
              <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                  <Users size={12} className="text-[var(--color-accent)]" /> Hedef Grup
                </div>
                <p className="font-serif text-base tracking-[-0.04em]">{assignment.target_voice_group ?? 'Tüm Gruplar'}</p>
              </div>
              {canReviewSubmissions ? (
                <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                    <CheckCircle2 size={12} className="text-emerald-400" /> Teslim
                  </div>
                  <p className="font-serif text-base tracking-[-0.04em]">{submissions.length} teslim</p>
                </div>
              ) : null}
            </div>
          </motion.section>

          {!canReviewSubmissions ? (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="glass-panel p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-[var(--color-accent)]" />
                  <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)]">Teslimim</h3>
                </div>
              </div>

              {mySubmission ? (
                <div className="rounded-[4px] border border-emerald-500/30 bg-emerald-500/8 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-emerald-500/20">
                      <CheckCircle2 size={18} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-emerald-400">Teslim Edildi</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-text-medium)]">{mySubmission.file_name}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-medium)]">{formatDate(mySubmission.submitted_at)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {mySubmission.drive_web_view_link ? (
                        <a
                          href={mySubmission.drive_web_view_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        >
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                      <button
                        onClick={() => setUploadOpen(true)}
                        className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]"
                        title="Güncellemek için yeniden yükle"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4">
                    <Upload size={24} className="text-[var(--color-text-medium)]" />
                  </div>
                  <div>
                    <p className="font-medium text-[var(--color-text-high)]">Henüz teslim etmediniz</p>
                    <p className="mt-1 text-sm text-[var(--color-text-medium)]">Ses kaydı, MIDI veya PDF yükleyebilirsiniz.</p>
                  </div>
                  <button
                    onClick={() => setUploadOpen(true)}
                    className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.2),rgba(192,178,131,0.08))] px-6 py-3 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-accent)] active:scale-95"
                  >
                    <Upload size={14} /> Teslim Et
                  </button>
                </div>
              )}
            </motion.section>
          ) : null}

          {canReviewSubmissions ? (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass-panel p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)]">
                  Tüm Teslimler ({submissions.length})
                </h3>
              </div>

              {submissions.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">Henüz teslim yapılmamış.</p>
              ) : (
                <div className="space-y-2">
                  {submissions.map((submission) => {
                    const choirMember = submission.choir_members;
                    return (
                      <div key={submission.id} className="flex items-center gap-3 rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-400">
                          {choirMember?.first_name?.[0]}
                          {choirMember?.last_name?.[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {choirMember?.first_name} {choirMember?.last_name}
                          </p>
                          <p className="text-xs text-[var(--color-text-medium)]">
                            {choirMember?.voice_group} · {submission.file_name}
                          </p>
                          <p className="text-xs text-[var(--color-text-medium)]">{formatDate(submission.submitted_at)}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {submission.drive_web_view_link ? (
                            <a
                              href={submission.drive_web_view_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                            >
                              <ExternalLink size={13} />
                            </a>
                          ) : null}
                          {isChef ? (
                            <button
                              onClick={() => setSubmissionToDelete(submission)}
                              disabled={deleteSubmissionMutation.isPending}
                              className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-red-500/30 bg-red-500/10 text-red-400 disabled:opacity-50"
                            >
                              {deletingSubmissionId === submission.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>
          ) : null}
        </>
      )}

      <FileUploadModal
        isOpen={uploadOpen}
        onClose={() => !uploadMutation.isPending && setUploadOpen(false)}
        mode="submission"
        title={mySubmission ? 'Teslimi Güncelle' : 'Ödev Teslim Et'}
        description="Ses kaydı, MIDI veya PDF yükleyebilirsiniz (max 100MB)"
        onUpload={(file) => uploadMutation.mutateAsync(file)}
      />

      <ConfirmDialog
        open={Boolean(submissionToDelete)}
        title="Teslim silinsin mi?"
        description={submissionToDelete ? `“${submissionToDelete.file_name}” teslimi silinecek. Bu işlem geri alınamaz.` : ''}
        confirmLabel="Sil"
        tone="danger"
        loading={deleteSubmissionMutation.isPending}
        onClose={() => setSubmissionToDelete(null)}
        onConfirm={() => {
          if (submissionToDelete) {
            deleteSubmissionMutation.mutate(submissionToDelete.id);
          }
        }}
      />
    </main>
  );
}
