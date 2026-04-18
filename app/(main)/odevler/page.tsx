'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Plus,
  Loader2,
  AlertCircle,
  Trash2,
  ArrowUpDown,
  Users,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Assignment, type AssignmentSubmission } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { createSlugLookup, getAssignmentPath } from '@/lib/internalPageLinks';
import { stripHtmlTags } from '@/lib/richText';

type AssignmentChoirMember =
  | Assignment['choir_members']
  | Assignment['choir_members'][]
  | null
  | undefined;

interface AssignmentRow extends Omit<Assignment, 'choir_members' | 'submission' | 'submission_count'> {
  choir_members?: AssignmentChoirMember;
}

interface AssignmentListItem extends Assignment {
  pending_submission_count?: number;
  total_submission_count?: number;
  approved_submission_count?: number;
  submitted_submission_count?: number;
  pending_review_submission_count?: number;
}

interface AssignmentTargetCountRow {
  assignment_id: string;
  member_id: string;
  choir_members?:
    | { voice_group: string | null }
    | Array<{ voice_group: string | null }>
    | null;
}

interface AssignmentTargetFallbackMemberRow {
  id: string;
  voice_group: string | null;
}

interface AssignmentSubmissionCountRow {
  assignment_id: string;
  member_id: string;
  status: AssignmentSubmission['status'] | null;
}

interface ChoirMemberRoleRow {
  member_id: string;
  roles?: { name?: string } | Array<{ name?: string }> | null;
}

const BLOCKED_ASSIGNMENT_ROLES = new Set(['Şef', 'Partisyon Şefi']);

function hasBlockedAssignmentRole(row: ChoirMemberRoleRow): boolean {
  if (!row.roles) {
    return false;
  }
  const roleEntries = Array.isArray(row.roles) ? row.roles : [row.roles];
  return roleEntries.some((entry) => Boolean(entry?.name && BLOCKED_ASSIGNMENT_ROLES.has(entry.name)));
}

function formatDeadline(deadline: string | null): { text: string; isUrgent: boolean } | null {
  if (!deadline) {
    return null;
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
  memberId,
  isChef,
  isLeader,
  reviewerVoiceGroup,
}: {
  memberId: string | null;
  isChef: boolean;
  isLeader: boolean;
  reviewerVoiceGroup: string | null;
}): Promise<AssignmentListItem[]> {
  const query = supabase
    .from('assignments')
    .select(`
      id, title, description, deadline, target_voice_group,
      drive_folder_id, created_by, is_active, created_at, updated_at,
      choir_members!assignments_created_by_fkey ( first_name, last_name )
    `)
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  let submissionsMap: Record<string, AssignmentSubmission | null> = {};
  let submissionStatsMap: Record<
    string,
    { pending: number; total: number; approved: number; submitted: number; pendingReview: number }
  > = {};
  const assignmentIds = ((data ?? []) as AssignmentRow[]).map((assignment) => assignment.id);

  if ((isChef || isLeader) && assignmentIds.length > 0) {
    const assignmentsById = new Map<string, AssignmentRow>();
    for (const assignment of (data ?? []) as AssignmentRow[]) {
      assignmentsById.set(assignment.id, assignment);
    }

    let assignmentTargets: AssignmentTargetCountRow[] = [];
    let targetsQuery = supabase
      .from('assignment_targets')
      .select('assignment_id, member_id, choir_members!inner ( voice_group )')
      .in('assignment_id', assignmentIds);

    if (isLeader && !isChef && reviewerVoiceGroup) {
      targetsQuery = targetsQuery.eq('choir_members.voice_group', reviewerVoiceGroup);
    }

    const { data: targetRows, error: targetRowsError } = await targetsQuery;
    if (targetRowsError) {
      throw targetRowsError;
    }
    assignmentTargets = (targetRows ?? []) as AssignmentTargetCountRow[];
    const targetIds = Array.from(new Set(assignmentTargets.map((row) => row.member_id).filter(Boolean)));
    if (targetIds.length > 0) {
      const { data: targetRoleRows, error: targetRoleRowsError } = await supabase
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', targetIds);
      if (targetRoleRowsError) {
        throw targetRoleRowsError;
      }
      const blockedIds = new Set(
        ((targetRoleRows ?? []) as ChoirMemberRoleRow[])
          .filter((row) => hasBlockedAssignmentRole(row))
          .map((row) => row.member_id),
      );
      assignmentTargets = assignmentTargets.filter((row) => !blockedIds.has(row.member_id));
    }

    const targetMemberIdsByAssignment = new Map<string, Set<string>>();
    const targetMemberIds = new Set<string>();
    for (const target of assignmentTargets) {
      if (!target.assignment_id || !target.member_id) {
        continue;
      }
      const existing = targetMemberIdsByAssignment.get(target.assignment_id) ?? new Set<string>();
      existing.add(target.member_id);
      targetMemberIdsByAssignment.set(target.assignment_id, existing);
      targetMemberIds.add(target.member_id);
    }

    const assignmentsWithoutTargets = assignmentIds.filter((assignmentId) => {
      const members = targetMemberIdsByAssignment.get(assignmentId);
      return !members || members.size === 0;
    });

    if (assignmentsWithoutTargets.length > 0) {
      let fallbackMembersQuery = supabase
        .from('choir_members')
        .select('id, voice_group')
        .eq('is_active', true);

      if (isLeader && !isChef) {
        if (!reviewerVoiceGroup) {
          fallbackMembersQuery = fallbackMembersQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          fallbackMembersQuery = fallbackMembersQuery.eq('voice_group', reviewerVoiceGroup);
        }
      }

      const { data: fallbackMembers, error: fallbackMembersError } = await fallbackMembersQuery;
      if (fallbackMembersError) {
        throw fallbackMembersError;
      }

      let fallbackRows = (fallbackMembers ?? []) as AssignmentTargetFallbackMemberRow[];
      const fallbackMemberIds = fallbackRows.map((row) => row.id);
      if (fallbackMemberIds.length > 0) {
        const { data: fallbackRoleRows, error: fallbackRoleRowsError } = await supabase
          .from('choir_member_roles')
          .select('member_id, roles(name)')
          .in('member_id', fallbackMemberIds);
        if (fallbackRoleRowsError) {
          throw fallbackRoleRowsError;
        }
        const blockedMemberIds = new Set(
          ((fallbackRoleRows ?? []) as ChoirMemberRoleRow[])
            .filter((row) => hasBlockedAssignmentRole(row))
            .map((row) => row.member_id),
        );
        fallbackRows = fallbackRows.filter((row) => !blockedMemberIds.has(row.id));
      }
      for (const assignmentId of assignmentsWithoutTargets) {
        const assignment = assignmentsById.get(assignmentId);
        if (!assignment) {
          continue;
        }

        const scopedMembers =
          assignment.target_voice_group && assignment.target_voice_group.trim()
            ? fallbackRows.filter((row) => row.voice_group === assignment.target_voice_group)
            : fallbackRows;

        if (scopedMembers.length === 0) {
          continue;
        }

        const existing = targetMemberIdsByAssignment.get(assignmentId) ?? new Set<string>();
        for (const member of scopedMembers) {
          existing.add(member.id);
          targetMemberIds.add(member.id);
        }
        targetMemberIdsByAssignment.set(assignmentId, existing);
      }
    }

    let submissionRows: AssignmentSubmissionCountRow[] = [];
    if (targetMemberIds.size > 0) {
      const { data: rows, error: submissionsError } = await supabase
        .from('assignment_submissions')
        .select('assignment_id, member_id, status')
        .in('assignment_id', assignmentIds)
        .in('member_id', Array.from(targetMemberIds));
      if (submissionsError) {
        throw submissionsError;
      }
      submissionRows = (rows ?? []) as AssignmentSubmissionCountRow[];
    } else {
      // Backward compatibility: eski ödevlerde assignment_targets yoksa en azından teslim sayılarını göster.
      let fallbackQuery = supabase
        .from('assignment_submissions')
        .select('assignment_id, member_id, status')
        .in('assignment_id', assignmentIds);

      if (isLeader && !isChef) {
        if (!reviewerVoiceGroup) {
          fallbackQuery = fallbackQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          const { data: groupMembers, error: groupMembersError } = await supabase
            .from('choir_members')
            .select('id')
            .eq('voice_group', reviewerVoiceGroup);
          if (groupMembersError) {
            throw groupMembersError;
          }

          const groupMemberIds = (groupMembers ?? []).map((member) => member.id);
          if (groupMemberIds.length === 0) {
            fallbackQuery = fallbackQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            fallbackQuery = fallbackQuery.in('member_id', groupMemberIds);
          }
        }
      }

      const { data: rows, error: fallbackSubmissionsError } = await fallbackQuery;
      if (fallbackSubmissionsError) {
        throw fallbackSubmissionsError;
      }
      submissionRows = (rows ?? []) as AssignmentSubmissionCountRow[];
    }

    const latestSubmissionStatusByAssignment = new Map<string, Map<string, AssignmentSubmission['status'] | null>>();
    for (const submission of submissionRows) {
      if (!submission.assignment_id || !submission.member_id) {
        continue;
      }
      const existing = latestSubmissionStatusByAssignment.get(submission.assignment_id) ?? new Map<string, AssignmentSubmission['status'] | null>();
      existing.set(submission.member_id, submission.status ?? null);
      latestSubmissionStatusByAssignment.set(submission.assignment_id, existing);
    }

    for (const assignmentId of assignmentIds) {
      const targetMembers = targetMemberIdsByAssignment.get(assignmentId);
      const submittedMembers = latestSubmissionStatusByAssignment.get(assignmentId) ?? new Map<string, AssignmentSubmission['status'] | null>();

      if (targetMembers && targetMembers.size > 0) {
        let submittedCount = 0;
        let approvedCount = 0;
        let pendingReviewCount = 0;
        for (const memberId of targetMembers) {
          if (!submittedMembers.has(memberId)) {
            continue;
          }
          submittedCount += 1;
          const status = submittedMembers.get(memberId);
          if (status === 'approved') {
            approvedCount += 1;
          }
          if (!status || status === 'pending') {
            pendingReviewCount += 1;
          }
        }

        const total = targetMembers.size;
        submissionStatsMap[assignmentId] = {
          pending: Math.max(total - approvedCount, 0),
          total,
          approved: approvedCount,
          submitted: submittedCount,
          pendingReview: pendingReviewCount,
        };
      } else {
        // assignment_targets yoksa teslim edenleri toplam kabul et.
        const submitted = submittedMembers.size;
        const approved = Array.from(submittedMembers.values()).filter((status) => status === 'approved').length;
        const pendingReview = Array.from(submittedMembers.values()).filter((status) => !status || status === 'pending').length;
        submissionStatsMap[assignmentId] = {
          pending: Math.max(submitted - approved, 0),
          total: submitted,
          approved,
          submitted,
          pendingReview,
        };
      }
    }
  }

  if (memberId && !isChef && !isLeader) {
    const { data: submissions, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select('id, assignment_id, status')
      .eq('member_id', memberId);

    if (submissionsError) {
      throw submissionsError;
    }

    submissionsMap = Object.fromEntries(
      (submissions ?? []).map((submission) => [
        submission.assignment_id,
        ({ id: submission.id, status: submission.status ?? null } as AssignmentSubmission),
      ]),
    );
  }

  return ((data ?? []) as AssignmentRow[]).map((assignment) => {
    const normalized = normalizeAssignment(assignment);
    const stats = submissionStatsMap[assignment.id];
    return {
      ...normalized,
      submission: submissionsMap[assignment.id] ?? null,
      pending_submission_count: stats?.pending ?? 0,
      total_submission_count: stats?.total ?? 0,
      approved_submission_count: stats?.approved ?? 0,
      submitted_submission_count: stats?.submitted ?? 0,
      pending_review_submission_count: stats?.pendingReview ?? 0,
    };
  });
}

function isMemberAssignmentCompleted(assignment: AssignmentListItem): boolean {
  if (!assignment.is_active) {
    return true;
  }
  return assignment.submission?.status === 'approved';
}

function isReviewerAssignmentCompleted(assignment: AssignmentListItem): boolean {
  if (!assignment.is_active) {
    return true;
  }
  const submitted = assignment.submitted_submission_count ?? 0;
  if (submitted <= 0) {
    return false;
  }
  return (assignment.pending_review_submission_count ?? 0) === 0;
}

export default function Odevler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const reviewerVoiceGroup = !isChef ? member?.voice_group ?? null : null;
  const canCreateAssignments = isChef || (isLeader && Boolean(member?.voice_group));
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [activeTab, setActiveTab] = useState('aktif');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<Assignment | null>(null);
  const [sortOption, setSortOption] = useState<'latest' | 'deadline'>('latest');

  const assignmentsQuery = useQuery({
    queryKey: ['assignments', member?.id ?? null, roleKey, reviewerVoiceGroup],
    queryFn: () =>
      fetchAssignments({
        memberId: member?.id ?? null,
        isChef,
        isLeader,
        reviewerVoiceGroup,
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

  const allAssignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const scopedAssignments = useMemo(() => {
    if (isLeader && !isChef) {
      return allAssignments.filter((assignment) => (assignment.total_submission_count ?? 0) > 0 || !assignment.is_active);
    }
    return allAssignments;
  }, [allAssignments, isChef, isLeader]);
  const reviewerView = isChef || isLeader;
  const activeTabLabel = reviewerView ? 'İncelenmedi' : 'Aktif';
  const completedTabLabel = reviewerView ? 'İncelendi' : 'Tamamlanan';

  const tabCounts = useMemo(() => {
    let active = 0;
    let completed = 0;

    for (const assignment of scopedAssignments) {
      const done = reviewerView
        ? isReviewerAssignmentCompleted(assignment)
        : isMemberAssignmentCompleted(assignment);

      if (done) {
        completed += 1;
      } else {
        active += 1;
      }
    }

    return { active, completed };
  }, [reviewerView, scopedAssignments]);

  const assignments = useMemo(() => {
    const filtered = scopedAssignments.filter((assignment) => {
      const done = reviewerView
        ? isReviewerAssignmentCompleted(assignment)
        : isMemberAssignmentCompleted(assignment);

      return activeTab === 'aktif' ? !done : done;
    });

    if (sortOption === 'deadline') {
      return [...filtered].sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
    }
    return [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [activeTab, reviewerView, scopedAssignments, sortOption]);

  const assignmentSlugLookup = useMemo(
    () =>
      createSlugLookup(
        allAssignments.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          created_at: assignment.created_at,
        })),
        'odev',
      ),
    [allAssignments],
  );

  return (
    <main className="page-shell space-y-6">
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 sm:p-8">
        <div className="flex flex-col items-center justify-center gap-6 px-1">
          <div className="flex items-center justify-center gap-4 sm:gap-6">
            <h2 className="text-center font-serif text-[2.1rem] leading-[0.95] tracking-[-0.06em] sm:text-[3.15rem]">
              Ödevler
            </h2>
            {canCreateAssignments ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex h-9 w-9 sm:h-11 sm:w-11 translate-y-[10%] sm:translate-y-[12%] items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,rgba(192,178,131,0.25),rgba(192,178,131,0.1))] text-[var(--color-accent)] transition-all hover:bg-[rgba(192,178,131,0.2)] active:scale-95 shadow-[0_4px_15px_rgba(0,0,0,0.2)]"
                title="Ödev Oluştur"
              >
                <Plus size={20} className="sm:w-6 sm:h-6" />
              </button>
            ) : null}
          </div>

          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            <div className="flex w-full items-center justify-center gap-4">
              {/* Aktif Tab Button */}
              <button
                onClick={() => setActiveTab('aktif')}
                className={`flex flex-1 items-center gap-3 rounded-2xl border transition-all duration-300 px-4 py-3.5 backdrop-blur-sm ${
                  activeTab === 'aktif'
                    ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                    : 'border-[var(--color-border)] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all ${
                  activeTab === 'aktif' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-emerald-400 opacity-40'
                }`} />
                <div className="flex flex-col items-start">
                  <span className={`text-[0.65rem] font-bold uppercase tracking-widest transition-colors ${
                    activeTab === 'aktif' ? 'text-emerald-400' : 'text-[var(--color-text-medium)]'
                  }`}>
                    {activeTabLabel}
                  </span>
                  <span className="font-serif text-xl leading-none tracking-tight text-white mt-1">
                    {tabCounts.active}
                  </span>
                </div>
              </button>
              
              {/* Tamamlanan Tab Button */}
              <button
                onClick={() => setActiveTab('tamamlanan')}
                className={`flex flex-1 items-center gap-3 rounded-2xl border transition-all duration-300 px-4 py-3.5 backdrop-blur-sm ${
                  activeTab === 'tamamlanan'
                    ? 'border-[var(--color-accent)] bg-white/[0.05] shadow-[0_0_20px_rgba(192,178,131,0.2)]'
                    : 'border-[var(--color-border)] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full transition-shadow ${
                  activeTab === 'tamamlanan' ? 'bg-[var(--color-accent)] shadow-[0_0_8px_rgba(192,178,131,0.5)]' : 'bg-neutral-500 opacity-50'
                }`} />
                <div className="flex flex-col items-start">
                  <span className={`text-[0.65rem] font-bold uppercase tracking-widest transition-colors ${
                    activeTab === 'tamamlanan' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'
                  }`}>
                    {completedTabLabel}
                  </span>
                  <span className="font-serif text-xl leading-none tracking-tight text-[var(--color-text-medium)] mt-1">
                    {tabCounts.completed}
                  </span>
                </div>
              </button>
            </div>

            {/* Sort Pill */}
            {assignments.length > 0 && (
              <button
                onClick={() => setSortOption(prev => prev === 'latest' ? 'deadline' : 'latest')}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/[0.03] px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)] opacity-70 transition-all hover:bg-white/[0.06] hover:opacity-100 active:scale-95"
              >
                <ArrowUpDown size={10} />
                {sortOption === 'latest' ? 'En Son Verilen' : 'En Yakın DEADLINE'}
              </button>
            )}
          </div>
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
        null
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence>
            {assignments.map((assignment, index) => {
              const deadlineInfo = formatDeadline(assignment.deadline);
              const deadlineText = deadlineInfo?.text ?? null;
              const isUrgent = deadlineInfo?.isUrgent ?? false;
              const isCompletedForCurrentUser = reviewerView
                ? isReviewerAssignmentCompleted(assignment)
                : isMemberAssignmentCompleted(assignment);
              const hasSubmitted = Boolean(assignment.submission);
              const submissionStatus = assignment.submission?.status ?? null;
              const reviewerTotal = assignment.total_submission_count ?? 0;
              const reviewerSubmitted = assignment.submitted_submission_count ?? 0;
              const reviewerPendingReview = assignment.pending_review_submission_count ?? 0;
              const creator = assignment.choir_members;
              const assignmentPath = `${getAssignmentPath(assignment, assignmentSlugLookup.slugById)}?aid=${assignment.id}`;

              return (
                <motion.article
                  key={assignment.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: 0.05 * index }}
                  className="group relative flex flex-col gap-3 rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4 pl-5 transition-all hover:bg-white/5 shadow-sm overflow-hidden cursor-pointer"
                  onClick={() => router.push(assignmentPath)}
                >
                  {isUrgent && !isCompletedForCurrentUser && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500/50" />
                  )}
                  {isCompletedForCurrentUser && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/50" />
                  )}
                  
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                        {reviewerView ? (
                          isCompletedForCurrentUser ? (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-emerald-400 opacity-90">
                              İncelendi
                            </span>
                          ) : (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-amber-300 opacity-90">
                              Bekleyen {reviewerPendingReview}
                            </span>
                          )
                        ) : hasSubmitted ? (
                          submissionStatus === 'approved' ? (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-emerald-400 opacity-90">
                              Onaylandı
                            </span>
                          ) : submissionStatus === 'rejected' ? (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-rose-300 opacity-90">
                              Revize Gerekli
                            </span>
                          ) : (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-amber-300 opacity-90">
                              İncelemede
                            </span>
                          )
                        ) : isUrgent ? (
                          <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-red-400 opacity-90">
                            Kritik
                          </span>
                        ) : null}
                        {deadlineText && (reviewerView || hasSubmitted || isUrgent) ? (
                           <span className="text-[var(--color-text-medium)]/30 text-[0.6rem]">•</span>
                        ) : null}
                        {deadlineText ? (
                          <span
                            className={`text-[0.65rem] font-bold uppercase tracking-[0.14em] ${
                              isUrgent ? 'text-red-500/80 [text-shadow:0_0_6px_rgba(239,68,68,0.2)]' : 'text-[var(--color-text-medium)]'
                            }`}
                          >
                            {deadlineText}
                          </span>
                        ) : null}
                      </div>
                      
                      <h3 className="font-serif text-lg leading-tight tracking-[-0.03em] transition-colors group-hover:text-[var(--color-accent)] line-clamp-1">
                        {assignment.title}
                      </h3>
                      
                      {creator ? (
                        <p className="mt-1 text-[0.75rem] text-[var(--color-text-medium)]/80">
                          Tanımlayan: {creator.first_name}
                        </p>
                      ) : null}
                      {(isChef || isLeader) ? (
                        <p className="mt-1 flex items-center gap-1.5 text-[0.74rem] text-[var(--color-text-medium)]">
                          <Users size={12} className="opacity-70" />
                          <span>
                            {reviewerSubmitted}/{reviewerTotal}
                          </span>
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => router.push(assignmentPath)}
                        className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-transparent text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] transition-colors"
                        title="Ödev Detayı"
                      >
                        <ChevronRight size={16} />
                      </button>
                      {isChef ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignmentToDelete(assignment);
                          }}
                          disabled={deleteMutation.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-transparent text-[var(--color-text-medium)] hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                          title="Ödevi Sil"
                        >
                          {deleteMutation.isPending && assignmentToDelete?.id === assignment.id ? (
                            <Loader2 size={14} className="animate-spin text-red-400" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      ) : null}
                    </div>
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
          isChef={isChef}
          creatorVoiceGroup={member.voice_group}
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
