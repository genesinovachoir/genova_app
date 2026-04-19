'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
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
import { ReviewNoteDialog } from '@/components/ReviewNoteDialog';
import { useToast } from '@/components/ToastProvider';
import { uploadSubmission } from '@/lib/drive';
import { sanitizeRichText } from '@/lib/richText';
import { createSlugLookup, isUuidLike } from '@/lib/internalPageLinks';
import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';

interface AssignmentDetailData {
  assignmentId: string;
  assignment: Assignment;
  submissions: AssignmentSubmission[];
  mySubmission: AssignmentSubmission | null;
  targetMembers: AssignmentTargetMember[];
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

interface SubmissionMemberRow {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

type AssignmentTargetChoirMember =
  | { first_name: string; last_name: string; voice_group: string | null }
  | Array<{ first_name: string; last_name: string; voice_group: string | null }>
  | null
  | undefined;

interface AssignmentTargetRow {
  member_id: string;
  choir_members?: AssignmentTargetChoirMember;
}

interface AssignmentTargetFallbackRow {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface AssignmentTargetMember {
  member_id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface ReviewerMemberStatus {
  member_id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
  submission: AssignmentSubmission | null;
}

type ReviewerSubmissionState = 'missing' | 'pending' | 'approved' | 'rejected';

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

function getReviewerSubmissionState(submission: AssignmentSubmission | null): ReviewerSubmissionState {
  if (!submission) {
    return 'missing';
  }
  if (!submission.status || submission.status === 'pending') {
    return 'pending';
  }
  if (submission.status === 'approved') {
    return 'approved';
  }
  return 'rejected';
}

function getReviewerSubmissionLabel(state: ReviewerSubmissionState): string {
  if (state === 'approved') {
    return 'Onaylandı';
  }
  if (state === 'pending') {
    return 'İncelemede';
  }
  if (state === 'rejected') {
    return 'Revize İstendi';
  }
  return 'Teslim Etmedi';
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return 'Veri yüklenemedi';
}

interface ReviewSubmissionResponse {
  id: string;
  status: 'approved' | 'rejected';
  reviewer_note: string | null;
  approved_at: string | null;
  approved_by: string | null;
  updated_at: string | null;
}

interface DeleteSubmissionResponse {
  id: string;
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

async function reviewAssignmentSubmission(params: {
  submissionId: string;
  status: 'approved' | 'rejected';
  reviewerNote?: string;
}) {
  return postJsonWithAuth<ReviewSubmissionResponse>('/api/assignment-submissions/review', {
    submissionId: params.submissionId,
    status: params.status,
    reviewerNote: params.reviewerNote ?? null,
  });
}

async function deleteAssignmentSubmission(submissionId: string) {
  return postJsonWithAuth<DeleteSubmissionResponse>('/api/assignment-submissions/delete', {
    submissionId,
  });
}

function SubmissionFileLink({
  submission,
  className,
  children,
}: {
  submission: Pick<AssignmentSubmission, 'drive_file_id' | 'file_name' | 'mime_type' | 'drive_web_view_link'> | null | undefined;
  className: string;
  children?: ReactNode;
}) {
  const { url, loading } = useProtectedDriveFileUrl(submission);

  if (!submission?.drive_file_id && !submission?.drive_web_view_link) {
    return null;
  }

  const href = submission?.drive_web_view_link ?? url;

  if (!href) {
    return (
      <span className={className}>
        {loading ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} className="opacity-50" />}
      </span>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children ?? <ExternalLink size={13} />}
    </a>
  );
}

async function fetchAssignmentDetail({
  assignmentIdentifier,
  assignmentIdHint,
  memberId,
  canReviewSubmissions,
  reviewerVoiceGroup,
  isChef,
}: {
  assignmentIdentifier: string;
  assignmentIdHint: string | null;
  memberId: string | null;
  canReviewSubmissions: boolean;
  reviewerVoiceGroup: string | null;
  isChef: boolean;
}): Promise<AssignmentDetailData> {
  let assignmentId: string | null = null;

  if (assignmentIdHint && isUuidLike(assignmentIdHint)) {
    assignmentId = assignmentIdHint;
  } else if (isUuidLike(assignmentIdentifier)) {
    assignmentId = assignmentIdentifier;
  } else {
    const { data: slugRows, error: slugError } = await supabase
      .from('assignments')
      .select('id, title, created_at');

    if (slugError) {
      throw slugError;
    }

    const slugLookup = createSlugLookup((slugRows ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>, 'odev');
    const normalizedIdentifier = assignmentIdentifier.toLowerCase();
    assignmentId = slugLookup.itemBySlug.get(normalizedIdentifier)?.id ?? null;
    if (!assignmentId) {
      const matchingBaseSlugEntries = slugLookup.entries.filter((entry) => entry.baseSlug === normalizedIdentifier);
      if (matchingBaseSlugEntries.length === 1) {
        assignmentId = matchingBaseSlugEntries[0].item.id;
      } else if (matchingBaseSlugEntries.length > 1) {
        assignmentId = matchingBaseSlugEntries.at(-1)?.item.id ?? null;
      }
    }
  }

  if (!assignmentId) {
    throw new Error('Ödev bulunamadı.');
  }

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
  const normalizedAssignment = normalizeAssignment(assignment as AssignmentRow);

  let targetMembers: AssignmentTargetMember[] = [];
  let submissions: AssignmentSubmission[] = [];
  if (canReviewSubmissions) {
    try {
      let targetsQuery = supabase
        .from('assignment_targets')
        .select(`
          member_id,
          choir_members!inner ( first_name, last_name, voice_group )
        `)
        .eq('assignment_id', assignmentId);

      if (!isChef) {
        if (!reviewerVoiceGroup) {
          targetsQuery = targetsQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
        } else {
          targetsQuery = targetsQuery.eq('choir_members.voice_group', reviewerVoiceGroup);
        }
      }

      const { data: targetRows, error: targetRowsError } = await targetsQuery;
      if (targetRowsError) {
        throw targetRowsError;
      }

      targetMembers = ((targetRows ?? []) as AssignmentTargetRow[])
        .map((target) => {
          const choirMember = Array.isArray(target.choir_members)
            ? target.choir_members[0] ?? null
            : target.choir_members ?? null;
          if (!choirMember || !target.member_id) {
            return null;
          }
          return {
            member_id: target.member_id,
            first_name: choirMember.first_name,
            last_name: choirMember.last_name,
            voice_group: choirMember.voice_group,
          } satisfies AssignmentTargetMember;
        })
        .filter((target): target is AssignmentTargetMember => Boolean(target));

      if (targetMembers.length > 0) {
        const { data: targetRoleRows, error: targetRoleRowsError } = await supabase
          .from('choir_member_roles')
          .select('member_id, roles(name)')
          .in(
            'member_id',
            targetMembers.map((member) => member.member_id),
          );
        if (targetRoleRowsError) {
          throw targetRoleRowsError;
        }
        const blockedIds = new Set(
          ((targetRoleRows ?? []) as ChoirMemberRoleRow[])
            .filter((row) => hasBlockedAssignmentRole(row))
            .map((row) => row.member_id),
        );
        if (blockedIds.size > 0) {
          targetMembers = targetMembers.filter((member) => !blockedIds.has(member.member_id));
        }
      }

      if (targetMembers.length === 0) {
        let fallbackTargetQuery = supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group')
          .eq('is_active', true);

        if (normalizedAssignment.target_voice_group) {
          fallbackTargetQuery = fallbackTargetQuery.eq('voice_group', normalizedAssignment.target_voice_group);
        }

        if (!isChef) {
          if (!reviewerVoiceGroup) {
            fallbackTargetQuery = fallbackTargetQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            fallbackTargetQuery = fallbackTargetQuery.eq('voice_group', reviewerVoiceGroup);
          }
        }

        const { data: fallbackTargetRows, error: fallbackTargetError } = await fallbackTargetQuery;
        if (fallbackTargetError) {
          throw fallbackTargetError;
        }

        let fallbackRows = (fallbackTargetRows ?? []) as AssignmentTargetFallbackRow[];
        const fallbackIds = fallbackRows.map((row) => row.id);
        if (fallbackIds.length > 0) {
          const { data: fallbackRoleRows, error: fallbackRoleError } = await supabase
            .from('choir_member_roles')
            .select('member_id, roles(name)')
            .in('member_id', fallbackIds);
          if (fallbackRoleError) {
            throw fallbackRoleError;
          }
          const blockedIds = new Set(
            ((fallbackRoleRows ?? []) as ChoirMemberRoleRow[])
              .filter((row) => hasBlockedAssignmentRole(row))
              .map((row) => row.member_id),
          );
          fallbackRows = fallbackRows.filter((row) => !blockedIds.has(row.id));
        }

        targetMembers = fallbackRows.map((row) => ({
          member_id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          voice_group: row.voice_group,
        }));
      }

      const targetMemberIds = targetMembers.map((target) => target.member_id);

      let submissionsQuery = supabase
        .from('assignment_submissions')
        .select(`
          id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link,
          file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at,
          status, submission_note, reviewer_note, approved_at, approved_by
        `)
        .eq('assignment_id', assignmentId)
        .order('submitted_at', { ascending: false });

      if (targetMemberIds.length > 0) {
        submissionsQuery = submissionsQuery.in('member_id', targetMemberIds);
      } else if (!isChef) {
        if (!reviewerVoiceGroup) {
          submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          const { data: voiceGroupMembers, error: voiceGroupMembersError } = await supabase
            .from('choir_members')
            .select('id')
            .eq('voice_group', reviewerVoiceGroup)
            .eq('is_active', true);
          if (voiceGroupMembersError) {
            throw voiceGroupMembersError;
          }
          const voiceGroupMemberIds = (voiceGroupMembers ?? []).map((row) => row.id);
          if (voiceGroupMemberIds.length === 0) {
            submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            submissionsQuery = submissionsQuery.in('member_id', voiceGroupMemberIds);
          }
        }
      }

      const { data: submissionRows, error: submissionsError } = await submissionsQuery;
      if (submissionsError) {
        throw submissionsError;
      }

      const rawSubmissions = (submissionRows ?? []) as AssignmentSubmissionRow[];
      const submissionMemberIds = Array.from(
        new Set(rawSubmissions.map((submission) => submission.member_id).filter(Boolean)),
      );

      const submissionMembersById = new Map<string, SubmissionMemberRow>();
      if (submissionMemberIds.length > 0) {
        const { data: submissionMemberRows, error: submissionMembersError } = await supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group')
          .in('id', submissionMemberIds);
        if (submissionMembersError) {
          throw submissionMembersError;
        }
        for (const row of (submissionMemberRows ?? []) as SubmissionMemberRow[]) {
          submissionMembersById.set(row.id, row);
        }
      }

      submissions = rawSubmissions.map((submission) => {
        const choirMember = submission.member_id ? submissionMembersById.get(submission.member_id) : undefined;
        return {
          ...submission,
          choir_members: choirMember
            ? {
                first_name: choirMember.first_name,
                last_name: choirMember.last_name,
                voice_group: choirMember.voice_group,
              }
            : undefined,
        };
      });
    } catch (reviewFetchError) {
      // Kritik olmayan inceleme verisi hata verirse detay sayfasını yine aç.
      // Böylece kullanıcı ödevi görebilir; inceleme paneli boş kalır.
      console.error('Assignment review data fetch failed:', reviewFetchError);
      targetMembers = [];
      submissions = [];
    }
  }

  let mySubmission: AssignmentSubmission | null = null;
  if (memberId) {
    const { data: mySubmissionRow, error: mySubmissionError } = await supabase
      .from('assignment_submissions')
      .select(
        'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, approved_at, approved_by',
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
    assignmentId,
    assignment: normalizedAssignment,
    submissions,
    mySubmission,
    targetMembers,
  };
}

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assignmentIdHint = searchParams?.get('aid') ?? null;
  const assignmentIdentifier = decodeURIComponent(params?.id ?? '');
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const reviewerVoiceGroup = !isChef ? member?.voice_group ?? null : null;
  const canReviewSubmissions = isChef || isLeader;
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [submissionToDelete, setSubmissionToDelete] = useState<AssignmentSubmission | null>(null);
  const [reviewPanelTab, setReviewPanelTab] = useState<'status' | 'members'>('members');
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [reviewNoteDialog, setReviewNoteDialog] = useState<{
    open: boolean;
    type: 'approve' | 'reject';
    submission: AssignmentSubmission | null;
  }>({ open: false, type: 'approve', submission: null });
  const detailQueryKey = [
    'assignment-detail',
    assignmentIdentifier,
    assignmentIdHint,
    member?.id ?? null,
    roleKey,
    reviewerVoiceGroup,
  ] as const;

  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () =>
      fetchAssignmentDetail({
        assignmentIdentifier,
        assignmentIdHint,
        memberId: member?.id ?? null,
        canReviewSubmissions,
        reviewerVoiceGroup,
        isChef,
      }),
    enabled: Boolean(assignmentIdentifier) && !authLoading,
  });
  const resolvedAssignmentId = detailQuery.data?.assignmentId ?? null;

  const uploadMutation = useMutation({
    mutationFn: async ({ file, note }: { file: File; note?: string }) => {
      if (!resolvedAssignmentId) {
        throw new Error('Ödev bulunamadı.');
      }
      await uploadSubmission(resolvedAssignmentId, file, note);
    },
    onSuccess: async () => {
      setUploadOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['assignment-detail', assignmentIdentifier] });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
      toast.success('Teslim güncellendi.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Teslim yüklenemedi.', 'Yükleme başarısız');
    },
  });

  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const result = await deleteAssignmentSubmission(submissionId);
      return result.id;
    },
    onMutate: async (submissionId) => {
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const previousData = queryClient.getQueryData<AssignmentDetailData>(detailQueryKey);

      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.filter((submission) => submission.id !== submissionId),
          mySubmission: current.mySubmission?.id === submissionId ? null : current.mySubmission,
        };
      });

      return { previousData };
    },
    onSuccess: () => {
      setSubmissionToDelete(null);
      toast.success('Teslim silindi.');
    },
    onError: (error, _submissionId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(detailQueryKey, context.previousData);
      }
      toast.error(error instanceof Error ? error.message : 'Teslim silinemedi.', 'Silme başarısız');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      submissionId,
      status,
      reviewerNote,
    }: {
      submissionId: string;
      status: 'approved' | 'rejected';
      reviewerNote?: string;
    }) => {
      return reviewAssignmentSubmission({ submissionId, status, reviewerNote });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const previousData = queryClient.getQueryData<AssignmentDetailData>(detailQueryKey);
      const reviewedAt = new Date().toISOString();

      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.map((submission) =>
            submission.id === variables.submissionId
              ? {
                  ...submission,
                  status: variables.status,
                  reviewer_note: variables.reviewerNote ?? null,
                  approved_at: reviewedAt,
                  approved_by: member?.id ?? submission.approved_by ?? null,
                  updated_at: reviewedAt,
                }
              : submission,
          ),
        };
      });

      return { previousData };
    },
    onSuccess: (updatedSubmission) => {
      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.map((submission) =>
            submission.id === updatedSubmission.id
              ? {
                  ...submission,
                  status: updatedSubmission.status,
                  reviewer_note: updatedSubmission.reviewer_note ?? null,
                  approved_at: updatedSubmission.approved_at ?? submission.approved_at ?? null,
                  approved_by: updatedSubmission.approved_by ?? submission.approved_by ?? null,
                  updated_at: updatedSubmission.updated_at ?? submission.updated_at,
                }
              : submission,
          ),
        };
      });
      toast.success('Değerlendirme kaydedildi.');
    },
    onError: (error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(detailQueryKey, context.previousData);
      }
      toast.error(error instanceof Error ? error.message : 'Değerlendirme kaydedilemedi.', 'Hata');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
  });

  const assignment = detailQuery.data?.assignment ?? null;
  const submissions = detailQuery.data?.submissions;
  const mySubmission = detailQuery.data?.mySubmission ?? null;
  const targetMembers = detailQuery.data?.targetMembers;
  const deletingSubmissionId = deleteSubmissionMutation.isPending ? deleteSubmissionMutation.variables : null;

  const reviewerMemberStatuses = useMemo<ReviewerMemberStatus[]>(() => {
    const latestSubmissionByMember = new Map<string, AssignmentSubmission>();
    for (const submission of submissions ?? []) {
      if (!submission.member_id) {
        continue;
      }
      const existing = latestSubmissionByMember.get(submission.member_id);
      if (!existing) {
        latestSubmissionByMember.set(submission.member_id, submission);
        continue;
      }

      const existingTime = Date.parse(existing.submitted_at ?? '') || 0;
      const candidateTime = Date.parse(submission.submitted_at ?? '') || 0;
      if (candidateTime >= existingTime) {
        latestSubmissionByMember.set(submission.member_id, submission);
      }
    }

    const memberMap = new Map<
      string,
      Pick<ReviewerMemberStatus, 'member_id' | 'first_name' | 'last_name' | 'voice_group'>
    >();

    for (const target of targetMembers ?? []) {
      memberMap.set(target.member_id, {
        member_id: target.member_id,
        first_name: target.first_name,
        last_name: target.last_name,
        voice_group: target.voice_group,
      });
    }

    if (memberMap.size === 0) {
      for (const submission of submissions ?? []) {
        const choirMember = submission.choir_members;
        if (!submission.member_id || !choirMember) {
          continue;
        }
        memberMap.set(submission.member_id, {
          member_id: submission.member_id,
          first_name: choirMember.first_name,
          last_name: choirMember.last_name,
          voice_group: choirMember.voice_group ?? null,
        });
      }
    }

    const rows: ReviewerMemberStatus[] = Array.from(memberMap.values()).map((memberBase) => ({
      ...memberBase,
      submission: latestSubmissionByMember.get(memberBase.member_id) ?? null,
    }));

    rows.sort((a, b) => {
      const aSubmitted = Boolean(a.submission);
      const bSubmitted = Boolean(b.submission);
      if (aSubmitted !== bSubmitted) {
        return Number(bSubmitted) - Number(aSubmitted);
      }

      const voiceCompare = (a.voice_group ?? '').localeCompare(b.voice_group ?? '', 'tr');
      if (voiceCompare !== 0) {
        return voiceCompare;
      }

      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'tr');
    });

    return rows;
  }, [submissions, targetMembers]);

  const reviewerSubmittedMembers = useMemo(
    () => reviewerMemberStatuses.filter((row) => Boolean(row.submission)),
    [reviewerMemberStatuses],
  );
  const reviewerApprovedMembers = useMemo(
    () => reviewerMemberStatuses.filter((row) => getReviewerSubmissionState(row.submission) === 'approved'),
    [reviewerMemberStatuses],
  );
  const reviewerPendingMembers = useMemo(
    () => reviewerMemberStatuses.filter((row) => getReviewerSubmissionState(row.submission) === 'pending'),
    [reviewerMemberStatuses],
  );
  const reviewerRejectedMembers = useMemo(
    () => reviewerMemberStatuses.filter((row) => getReviewerSubmissionState(row.submission) === 'rejected'),
    [reviewerMemberStatuses],
  );
  const reviewerMissingMembers = useMemo(
    () => reviewerMemberStatuses.filter((row) => !row.submission),
    [reviewerMemberStatuses],
  );
  const reviewerTotalCount = reviewerMemberStatuses.length;
  const reviewerCompletedCount = reviewerSubmittedMembers.length;
  const completionPercentage =
    reviewerTotalCount > 0 ? Math.round((reviewerCompletedCount / reviewerTotalCount) * 100) : 0;
  const completionScopeLabel = isChef
    ? 'Toplam Koro'
    : reviewerVoiceGroup
      ? `${reviewerVoiceGroup} Partisi`
      : 'Kendi Partisi';
  const detailErrorMessage = getReadableErrorMessage(detailQuery.error);

  return (
    <main className="min-h-screen bg-[var(--color-background)] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="space-y-6 px-5 pt-[max(env(safe-area-inset-top),1.25rem)]">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-95"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>
        {authLoading || detailQuery.isPending ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
          </div>
        ) : detailQuery.isError ? (
          <div className="glass-panel flex items-center gap-3 p-6">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-sm text-red-400">{detailErrorMessage}</p>
          </div>
        ) : !assignment ? null : (
        <>
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-2">
            <span className="page-kicker">tempoyu koru</span>
            <h2 className="mt-3 font-serif text-[1.9rem] leading-tight tracking-[-0.05em] sm:text-[2.5rem]">{assignment.title}</h2>
            {assignment.description ? (
              <div
                className="prose prose-invert mt-3 max-w-none text-[var(--color-text-medium)] prose-p:my-1 prose-p:text-sm prose-p:leading-7 prose-a:text-[var(--color-accent)] prose-ul:list-disc prose-ol:list-decimal prose-li:my-0.5"
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.description) }}
              />
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">
                  <Calendar size={12} className="text-[var(--color-accent)]" /> Son Tarih
                </div>
                <p className="font-serif text-base tracking-[-0.04em]">
                  {assignment.deadline
                    ? new Date(assignment.deadline).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
                    : '—'}
                </p>
              </div>
              {canReviewSubmissions ? (
                <>
                  <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                    <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">
                      <Users size={12} className="text-[var(--color-accent)]" /> Kapsam
                    </div>
                    <p className="font-serif text-base tracking-[-0.04em]">{completionScopeLabel}</p>
                  </div>
                  <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                    <div className="mb-2 flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">
                      <CheckCircle2 size={12} className="text-emerald-400" /> Yapılma Yüzdesi
                    </div>
                    <p className="font-serif text-base tracking-[-0.04em]">%{completionPercentage}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-medium)]">
                      {reviewerCompletedCount} / {reviewerTotalCount} teslim
                    </p>
                  </div>
                </>
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
                      <SubmissionFileLink
                        submission={mySubmission}
                        className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      />
                      <button
                        onClick={() => setUploadOpen(true)}
                        className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]"
                        title="Güncellemek için yeniden yükle"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                  
                  {mySubmission.submission_note ? (
                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-text-medium)] mb-1">Notunuz</p>
                      <p className="text-sm text-[var(--color-text-high)]">{mySubmission.submission_note}</p>
                    </div>
                  ) : null}

                  {mySubmission.reviewer_note ? (
                    <div className="mt-4 p-3 rounded-[4px] bg-[var(--color-accent-soft)] border border-[var(--color-border)]">
                      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-accent)] mb-1">Şefin Notu</p>
                      <p className="text-sm text-[var(--color-text-high)]">{mySubmission.reviewer_note}</p>
                    </div>
                  ) : null}
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
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)]">
                    Teslim Takibi
                  </h3>
                </div>
                <p className="text-xs text-[var(--color-text-medium)]">
                  {reviewerCompletedCount} / {reviewerTotalCount} tamamlandı
                </p>
              </div>

              <div className="mb-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setReviewPanelTab('status')}
                  className={`rounded-[4px] border px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] ${
                    reviewPanelTab === 'status'
                      ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
                  }`}
                >
                  Teslim Durumu
                </button>
                <button
                  type="button"
                  onClick={() => setReviewPanelTab('members')}
                  className={`rounded-[4px] border px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] ${
                    reviewPanelTab === 'members'
                      ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]'
                  }`}
                >
                  Kişi Bazlı Liste
                </button>
              </div>

              {reviewPanelTab === 'status' ? (
                reviewerTotalCount === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">
                    Bu ödev için hedef korist bulunamadı.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-[4px] border border-emerald-500/30 bg-emerald-500/8 p-4">
                      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-emerald-300">
                        Onaylananlar ({reviewerApprovedMembers.length})
                      </p>
                      {reviewerApprovedMembers.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-medium)]">Henüz onaylanan yok.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {reviewerApprovedMembers.map((row) => (
                            <li key={`approved-${row.member_id}`} className="text-sm text-[var(--color-text-high)]">
                              {row.first_name} {row.last_name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-[4px] border border-amber-500/30 bg-amber-500/8 p-4">
                      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-amber-200">
                        İncelemede ({reviewerPendingMembers.length})
                      </p>
                      {reviewerPendingMembers.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-medium)]">İnceleme bekleyen teslim yok.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {reviewerPendingMembers.map((row) => (
                            <li key={`pending-${row.member_id}`} className="text-sm text-[var(--color-text-high)]">
                              {row.first_name} {row.last_name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-[4px] border border-orange-500/30 bg-orange-500/8 p-4">
                      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-orange-200">
                        Revize İstenen ({reviewerRejectedMembers.length})
                      </p>
                      {reviewerRejectedMembers.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-medium)]">Revize istenen teslim yok.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {reviewerRejectedMembers.map((row) => (
                            <li key={`rejected-${row.member_id}`} className="text-sm text-[var(--color-text-high)]">
                              {row.first_name} {row.last_name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-[4px] border border-rose-500/30 bg-rose-500/8 p-4">
                      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-rose-300">
                        Teslim Etmeyenler ({reviewerMissingMembers.length})
                      </p>
                      {reviewerMissingMembers.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-medium)]">Herkes teslim etmiş.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {reviewerMissingMembers.map((row) => (
                            <li key={`missing-${row.member_id}`} className="text-sm text-[var(--color-text-high)]">
                              {row.first_name} {row.last_name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )
              ) : reviewerMemberStatuses.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">
                  Kişi bazlı liste için hedef korist bulunamadı.
                </p>
              ) : (
                <div className="space-y-2">
                  {reviewerMemberStatuses.map((row) => {
                    const submission = row.submission;
                    const expanded = expandedMemberId === row.member_id;
                    const memberState = getReviewerSubmissionState(submission);
                    const memberStatusLabel = getReviewerSubmissionLabel(memberState);
                    const isPending = Boolean(submission && (!submission.status || submission.status === 'pending'));
                    const isApproved = submission?.status === 'approved';

                    return (
                      <div key={row.member_id} className="rounded-[4px] border border-[var(--color-border)] bg-white/4">
                        <button
                          type="button"
                          onClick={() => setExpandedMemberId((prev) => (prev === row.member_id ? null : row.member_id))}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text-high)]">
                              {row.first_name} {row.last_name}
                            </p>
                            <p className="text-xs text-[var(--color-text-medium)]">
                              {row.voice_group ?? 'Parti yok'} · {memberStatusLabel}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.12em] ${
                                memberState === 'approved'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : memberState === 'pending'
                                    ? 'bg-amber-500/15 text-amber-200'
                                    : memberState === 'rejected'
                                      ? 'bg-orange-500/15 text-orange-200'
                                      : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {memberStatusLabel}
                            </span>
                            <ChevronDown
                              size={14}
                              className={`text-[var(--color-text-medium)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        {expanded ? (
                          <div className="border-t border-[var(--color-border)] px-4 py-3">
                            {submission ? (
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm text-[var(--color-text-high)]">{submission.file_name}</p>
                                    <p className="text-xs text-[var(--color-text-medium)]">{formatDate(submission.submitted_at)}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <SubmissionFileLink
                                      submission={submission}
                                      className="inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)]"
                                    >
                                      <ExternalLink size={12} />
                                      Drive&apos;da Aç
                                    </SubmissionFileLink>
                                    {isChef ? (
                                      <button
                                        onClick={() => setSubmissionToDelete(submission)}
                                        disabled={deleteSubmissionMutation.isPending}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-red-500/30 bg-red-500/10 text-red-400 disabled:opacity-50"
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

                                {submission.submission_note ? (
                                  <div className="rounded-[4px] border border-[var(--color-border)] bg-white/5 p-3 text-sm text-[var(--color-text-medium)]">
                                    <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-medium)]">
                                      Korist Notu
                                    </p>
                                    {submission.submission_note}
                                  </div>
                                ) : null}

                                {submission.reviewer_note ? (
                                  <div className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-text-high)]">
                                    <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">
                                      Şef / Partisyon Şefi Notu
                                    </p>
                                    {submission.reviewer_note}
                                  </div>
                                ) : null}

                                {isPending ? (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        setReviewNoteDialog({
                                          open: true,
                                          type: 'approve',
                                          submission,
                                        });
                                      }}
                                      disabled={reviewMutation.isPending}
                                      className="flex flex-1 items-center justify-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-emerald-400 disabled:opacity-50"
                                    >
                                      <CheckCircle2 size={14} /> Onayla
                                    </button>
                                    <button
                                      onClick={() => {
                                        setReviewNoteDialog({
                                          open: true,
                                          type: 'reject',
                                          submission,
                                        });
                                      }}
                                      disabled={reviewMutation.isPending}
                                      className="flex flex-1 items-center justify-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-rose-400 disabled:opacity-50"
                                    >
                                      <AlertCircle size={14} /> Reddet
                                    </button>
                                  </div>
                                ) : (
                                  <p
                                    className={`text-[0.65rem] font-bold uppercase tracking-[0.14em] ${
                                      isApproved ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {isApproved ? 'Onaylandı' : 'Reddedildi'}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--color-text-medium)]">
                                Bu korist henüz ödevi teslim etmedi.
                              </p>
                            )}
                          </div>
                        ) : null}
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
        onUpload={async (file, _, note) => {
          await uploadMutation.mutateAsync({ file, note });
        }}
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

      <ReviewNoteDialog
        open={reviewNoteDialog.open}
        type={reviewNoteDialog.type}
        submissionName={reviewNoteDialog.submission?.file_name ?? 'Teslim'}
        loading={reviewMutation.isPending}
        onClose={() => {
          if (reviewMutation.isPending) {
            return;
          }
          setReviewNoteDialog({ open: false, type: 'approve', submission: null });
        }}
        onSubmit={async (note) => {
          const submission = reviewNoteDialog.submission;
          if (!submission?.id) {
            return;
          }

          await reviewMutation.mutateAsync({
            submissionId: submission.id,
            status: reviewNoteDialog.type === 'approve' ? 'approved' : 'rejected',
            reviewerNote: note,
          });

          setReviewNoteDialog({ open: false, type: 'approve', submission: null });
        }}
      />
      </div>
    </main>
  );
}
