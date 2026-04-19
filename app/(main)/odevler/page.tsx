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
  Pencil,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Assignment, type AssignmentSubmission } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { createSlugLookup, getAssignmentPath } from '@/lib/internalPageLinks';

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

type ReviewerSubmissionState = 'missing' | 'pending' | 'approved' | 'rejected';

interface ReviewerQueueTargetRow {
  assignment_id: string;
  member_id: string;
  choir_members?:
    | {
        id: string;
        first_name: string;
        last_name: string;
        voice_group: string | null;
        is_active: boolean | null;
      }
    | Array<{
        id: string;
        first_name: string;
        last_name: string;
        voice_group: string | null;
        is_active: boolean | null;
      }>
    | null;
}

interface ReviewerQueueSubmissionRow {
  id: string;
  assignment_id: string;
  member_id: string;
  status: AssignmentSubmission['status'] | null;
  submitted_at: string | null;
}

interface ReviewerQueueMember {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface ReviewerQueueItem {
  assignment_id: string;
  assignment_title: string;
  assignment_created_at: string;
  assignment_deadline: string | null;
  assignment_is_active: boolean;
  assignment_creator_first_name: string | null;
  assignment_creator_last_name: string | null;
  assignment_creator_role: string | null;
  member_id: string;
  member_first_name: string;
  member_last_name: string;
  member_voice_group: string | null;
  submission_id: string | null;
  submission_status: ReviewerSubmissionState;
  submission_submitted_at: string | null;
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

function normalizeReviewerQueueTargetMember(
  row: ReviewerQueueTargetRow,
): ReviewerQueueMember | null {
  const choirMember = Array.isArray(row.choir_members)
    ? row.choir_members[0] ?? null
    : row.choir_members ?? null;
  if (!choirMember || !row.member_id || choirMember.is_active === false) {
    return null;
  }
  return {
    id: row.member_id,
    first_name: choirMember.first_name,
    last_name: choirMember.last_name,
    voice_group: choirMember.voice_group,
  };
}

function getReviewerSubmissionStateFromRaw(
  submissionStatus: AssignmentSubmission['status'] | null | undefined,
): ReviewerSubmissionState {
  if (submissionStatus === 'approved') {
    return 'approved';
  }
  if (submissionStatus === 'rejected') {
    return 'rejected';
  }
  if (submissionStatus === 'pending' || submissionStatus === null || typeof submissionStatus === 'undefined') {
    return 'pending';
  }
  return 'pending';
}

async function fetchReviewerQueue({
  isChef,
  reviewerVoiceGroup,
}: {
  isChef: boolean;
  reviewerVoiceGroup: string | null;
}): Promise<ReviewerQueueItem[]> {
  if (!isChef && !reviewerVoiceGroup) {
    return [];
  }

  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from('assignments')
    .select(`
      id, title, description, deadline, target_voice_group,
      drive_folder_id, created_by, is_active, created_at, updated_at,
      choir_members!assignments_created_by_fkey ( 
        id,
        first_name, 
        last_name,
        choir_member_roles ( roles ( name ) )
      )
    `)
    .order('created_at', { ascending: false });
  if (assignmentsError) {
    throw assignmentsError;
  }

  const normalizedAssignments = ((assignmentsData as unknown) as AssignmentRow[]).map(normalizeAssignment);
  const assignmentIds = normalizedAssignments.map((assignment) => assignment.id);
  if (assignmentIds.length === 0) {
    return [];
  }

  const assignmentsById = new Map<string, Assignment>();
  for (const assignment of normalizedAssignments) {
    assignmentsById.set(assignment.id, assignment);
  }

  let targetsQuery = supabase
    .from('assignment_targets')
    .select(`
      assignment_id,
      member_id,
      choir_members!inner ( id, first_name, last_name, voice_group, is_active )
    `)
    .in('assignment_id', assignmentIds);

  if (!isChef && reviewerVoiceGroup) {
    targetsQuery = targetsQuery.eq('choir_members.voice_group', reviewerVoiceGroup);
  }

  const { data: targetRows, error: targetRowsError } = await targetsQuery;
  if (targetRowsError) {
    throw targetRowsError;
  }

  const targetsByAssignment = new Map<string, Map<string, ReviewerQueueMember>>();
  for (const row of (targetRows ?? []) as ReviewerQueueTargetRow[]) {
    const member = normalizeReviewerQueueTargetMember(row);
    if (!member || !row.assignment_id) {
      continue;
    }
    const assignmentTargets = targetsByAssignment.get(row.assignment_id) ?? new Map<string, ReviewerQueueMember>();
    assignmentTargets.set(member.id, member);
    targetsByAssignment.set(row.assignment_id, assignmentTargets);
  }

  const explicitTargetIds = Array.from(
    new Set(
      Array.from(targetsByAssignment.values()).flatMap((memberMap) => Array.from(memberMap.keys())),
    ),
  );
  if (explicitTargetIds.length > 0) {
    const { data: targetRoleRows, error: targetRoleRowsError } = await supabase
      .from('choir_member_roles')
      .select('member_id, roles(name)')
      .in('member_id', explicitTargetIds);
    if (targetRoleRowsError) {
      throw targetRoleRowsError;
    }
    const blockedIds = new Set(
      ((targetRoleRows ?? []) as ChoirMemberRoleRow[])
        .filter((row) => hasBlockedAssignmentRole(row))
        .map((row) => row.member_id),
    );
    if (blockedIds.size > 0) {
      for (const [assignmentId, assignmentTargets] of targetsByAssignment.entries()) {
        for (const blockedId of blockedIds) {
          assignmentTargets.delete(blockedId);
        }
        if (assignmentTargets.size === 0) {
          targetsByAssignment.delete(assignmentId);
        } else {
          targetsByAssignment.set(assignmentId, assignmentTargets);
        }
      }
    }
  }

  const assignmentsWithoutTargets = assignmentIds.filter((assignmentId) => {
    const targets = targetsByAssignment.get(assignmentId);
    return !targets || targets.size === 0;
  });

  if (assignmentsWithoutTargets.length > 0) {
    let fallbackMembersQuery = supabase
      .from('choir_members')
      .select('id, first_name, last_name, voice_group, is_active')
      .eq('is_active', true);

    if (!isChef && reviewerVoiceGroup) {
      fallbackMembersQuery = fallbackMembersQuery.eq('voice_group', reviewerVoiceGroup);
    }

    const { data: fallbackMembersData, error: fallbackMembersError } = await fallbackMembersQuery;
    if (fallbackMembersError) {
      throw fallbackMembersError;
    }

    let fallbackMembers = (fallbackMembersData ?? []) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      voice_group: string | null;
      is_active: boolean;
    }>;

    const fallbackMemberIds = fallbackMembers.map((member) => member.id);
    if (fallbackMemberIds.length > 0) {
      const { data: fallbackRoleRows, error: fallbackRoleRowsError } = await supabase
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', fallbackMemberIds);
      if (fallbackRoleRowsError) {
        throw fallbackRoleRowsError;
      }
      const blockedIds = new Set(
        ((fallbackRoleRows ?? []) as ChoirMemberRoleRow[])
          .filter((row) => hasBlockedAssignmentRole(row))
          .map((row) => row.member_id),
      );
      fallbackMembers = fallbackMembers.filter((member) => !blockedIds.has(member.id));
    }

    for (const assignmentId of assignmentsWithoutTargets) {
      const assignment = assignmentsById.get(assignmentId);
      if (!assignment) {
        continue;
      }

      const scopedFallbackMembers =
        assignment.target_voice_group && assignment.target_voice_group.trim()
          ? fallbackMembers.filter((member) => member.voice_group === assignment.target_voice_group)
          : fallbackMembers;

      if (scopedFallbackMembers.length === 0) {
        continue;
      }

      const assignmentTargets = targetsByAssignment.get(assignmentId) ?? new Map<string, ReviewerQueueMember>();
      for (const member of scopedFallbackMembers) {
        assignmentTargets.set(member.id, {
          id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          voice_group: member.voice_group,
        });
      }
      if (assignmentTargets.size > 0) {
        targetsByAssignment.set(assignmentId, assignmentTargets);
      }
    }
  }

  const assignmentIdsWithTargets = Array.from(targetsByAssignment.keys());
  const targetMemberIds = Array.from(
    new Set(
      assignmentIdsWithTargets.flatMap((assignmentId) => Array.from(targetsByAssignment.get(assignmentId)?.keys() ?? [])),
    ),
  );

  const latestSubmissionByAssignmentMember = new Map<string, ReviewerQueueSubmissionRow>();
  if (assignmentIdsWithTargets.length > 0 && targetMemberIds.length > 0) {
    const { data: submissionRows, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select('id, assignment_id, member_id, status, submitted_at')
      .in('assignment_id', assignmentIdsWithTargets)
      .in('member_id', targetMemberIds)
      .order('submitted_at', { ascending: false });
    if (submissionsError) {
      throw submissionsError;
    }

    for (const submission of (submissionRows ?? []) as ReviewerQueueSubmissionRow[]) {
      if (!submission.assignment_id || !submission.member_id) {
        continue;
      }
      const key = `${submission.assignment_id}:${submission.member_id}`;
      const existing = latestSubmissionByAssignmentMember.get(key);
      if (!existing) {
        latestSubmissionByAssignmentMember.set(key, submission);
        continue;
      }
      const existingTime = Date.parse(existing.submitted_at ?? '') || 0;
      const candidateTime = Date.parse(submission.submitted_at ?? '') || 0;
      if (candidateTime >= existingTime) {
        latestSubmissionByAssignmentMember.set(key, submission);
      }
    }
  }

  const queueItems: ReviewerQueueItem[] = [];
  for (const assignment of normalizedAssignments) {
    const targets = Array.from(targetsByAssignment.get(assignment.id)?.values() ?? []);
    if (targets.length === 0) {
      continue;
    }

    targets.sort((a, b) => {
      const voiceCompare = (a.voice_group ?? '').localeCompare(b.voice_group ?? '', 'tr');
      if (voiceCompare !== 0) {
        return voiceCompare;
      }
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'tr');
    });

    for (const target of targets) {
      const key = `${assignment.id}:${target.id}`;
      const latestSubmission = latestSubmissionByAssignmentMember.get(key);

      queueItems.push({
        assignment_id: assignment.id,
        assignment_title: assignment.title,
        assignment_created_at: assignment.created_at,
        assignment_deadline: assignment.deadline,
        assignment_is_active: assignment.is_active,
        assignment_creator_first_name: assignment.choir_members?.first_name ?? null,
        assignment_creator_last_name: assignment.choir_members?.last_name ?? null,
        assignment_creator_role: assignment.choir_members?.choir_member_roles?.[0]?.roles?.name ?? null,
        member_id: target.id,
        member_first_name: target.first_name,
        member_last_name: target.last_name,
        member_voice_group: target.voice_group,
        submission_id: latestSubmission?.id ?? null,
        submission_status: latestSubmission
          ? getReviewerSubmissionStateFromRaw(latestSubmission.status ?? null)
          : 'missing',
        submission_submitted_at: latestSubmission?.submitted_at ?? null,
      });
    }
  }

  return queueItems;
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
      choir_members!assignments_created_by_fkey ( 
        id,
        first_name, 
        last_name,
        choir_member_roles ( roles ( name ) )
      )
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
  const assignmentIds = ((data as unknown) as AssignmentRow[]).map((assignment) => assignment.id);

  if ((isChef || isLeader) && assignmentIds.length > 0) {
    const assignmentsById = new Map<string, AssignmentRow>();
    for (const assignment of ((data as unknown) as AssignmentRow[])) {
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

  return ((data as unknown) as AssignmentRow[]).map((assignment) => {
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

function isReviewerQueueItemCompleted(item: ReviewerQueueItem): boolean {
  if (!item.assignment_is_active) {
    return true;
  }
  if (item.submission_status === 'approved' || item.submission_status === 'rejected') {
    return true;
  }
  return false;
}

function getAssignmentCreatedByLabel(item: {
  assignment_creator_first_name: string | null;
  assignment_creator_last_name: string | null;
  assignment_creator_role: string | null;
}): string {
  if (item.assignment_creator_first_name || item.assignment_creator_last_name) {
    return `${item.assignment_creator_first_name ?? ''} ${item.assignment_creator_last_name ?? ''}`.trim();
  }
  return 'Bilinmiyor';
}

export default function Odevler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const reviewerVoiceGroup = !isChef ? member?.voice_group ?? null : null;
  const reviewerView = isChef || isLeader;
  const canCreateAssignments = isChef || (isLeader && Boolean(member?.voice_group));
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [activeTab, setActiveTab] = useState<'aktif' | 'tamamlanan'>('aktif');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assignmentToEditId, setAssignmentToEditId] = useState<string | null>(null);
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
    enabled: !authLoading && !reviewerView,
  });

  const reviewerQueueQuery = useQuery({
    queryKey: ['reviewer-assignment-queue', roleKey, reviewerVoiceGroup],
    queryFn: () =>
      fetchReviewerQueue({
        isChef,
        reviewerVoiceGroup,
      }),
    enabled: !authLoading && reviewerView,
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['reviewer-assignment-queue'] }),
      ]);
      toast.success('Ödev silindi.');
      setAssignmentToDelete(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Ödev silinemedi.', 'Silme başarısız');
    },
  });

  const memberAssignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const reviewerQueueItems = useMemo(() => reviewerQueueQuery.data ?? [], [reviewerQueueQuery.data]);

  const memberTabCounts = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const assignment of memberAssignments) {
      if (isMemberAssignmentCompleted(assignment)) {
        completed += 1;
      } else {
        active += 1;
      }
    }
    return { active, completed };
  }, [memberAssignments]);

  const reviewerTabCounts = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const item of reviewerQueueItems) {
      if (isReviewerQueueItemCompleted(item)) {
        completed += 1;
      } else {
        active += 1;
      }
    }
    return { active, completed };
  }, [reviewerQueueItems]);

  const tabCounts = reviewerView ? reviewerTabCounts : memberTabCounts;

  const reviewerAssignments = useMemo(() => {
    const grouped = new Map<
      string,
      {
        assignment_id: string;
        assignment_title: string;
        assignment_created_at: string;
        assignment_deadline: string | null;
        assignment_is_active: boolean;
        assignment_creator_first_name: string | null;
        assignment_creator_last_name: string | null;
        assignment_creator_role: string | null;
        total: number;
        submitted: number;
      }
    >();

    for (const item of reviewerQueueItems) {
      const existing = grouped.get(item.assignment_id) ?? {
        assignment_id: item.assignment_id,
        assignment_title: item.assignment_title,
        assignment_created_at: item.assignment_created_at,
        assignment_deadline: item.assignment_deadline,
        assignment_is_active: item.assignment_is_active,
        assignment_creator_first_name: item.assignment_creator_first_name,
        assignment_creator_last_name: item.assignment_creator_last_name,
        assignment_creator_role: item.assignment_creator_role,
        total: 0,
        submitted: 0,
      };

      existing.total += 1;
      if (item.submission_status !== 'missing') {
        existing.submitted += 1;
      }
      grouped.set(item.assignment_id, existing);
    }

    const rows = Array.from(grouped.values());
    const filtered = rows.filter((row) => {
      const done = row.total > 0 && row.submitted >= row.total;
      return activeTab === 'aktif' ? !done : done;
    });

    if (sortOption === 'deadline') {
      return [...filtered].sort((a, b) => {
        if (!a.assignment_deadline && !b.assignment_deadline) return 0;
        if (!a.assignment_deadline) return 1;
        if (!b.assignment_deadline) return -1;
        return new Date(a.assignment_deadline).getTime() - new Date(b.assignment_deadline).getTime();
      });
    }

    return [...filtered].sort(
      (a, b) => new Date(b.assignment_created_at).getTime() - new Date(a.assignment_created_at).getTime(),
    );
  }, [activeTab, reviewerQueueItems, sortOption]);

  const memberRows = useMemo(() => {
    const filtered = memberAssignments.filter((assignment) => {
      const done = isMemberAssignmentCompleted(assignment);
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
  }, [activeTab, memberAssignments, sortOption]);

  const assignmentSlugLookup = useMemo(() => {
    const source = reviewerView
      ? Array.from(
          new Map(
            reviewerQueueItems.map((item) => [
              item.assignment_id,
              {
                id: item.assignment_id,
                title: item.assignment_title,
                created_at: item.assignment_created_at,
              },
            ]),
          ).values(),
        )
      : memberAssignments.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          created_at: assignment.created_at,
        }));

    return createSlugLookup(source, 'odev');
  }, [memberAssignments, reviewerQueueItems, reviewerView]);

  const listCount = reviewerView ? reviewerAssignments.length : memberRows.length;
  const activeTabLabel = reviewerView ? 'Bekleyen' : 'Aktif';
  const completedTabLabel = reviewerView ? 'Tamamlanan' : 'Tamamlanan';
  const isLoading = authLoading || (reviewerView ? reviewerQueueQuery.isPending : assignmentsQuery.isPending);
  const isError = reviewerView ? reviewerQueueQuery.isError : assignmentsQuery.isError;
  const listError = reviewerView ? reviewerQueueQuery.error : assignmentsQuery.error;

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
                <Plus size={20} className="sm:h-6 sm:w-6" />
              </button>
            ) : null}
          </div>

          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            {reviewerView ? (
              <div className="flex w-full items-center justify-center gap-2">
                <button
                  onClick={() => setActiveTab('aktif')}
                  className={`rounded-full border px-4 py-2 text-[0.62rem] font-bold uppercase tracking-[0.14em] ${
                    activeTab === 'aktif'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                      : 'border-[var(--color-border)] text-[var(--color-text-medium)]'
                  }`}
                >
                  Aktif ({tabCounts.active})
                </button>
                <button
                  onClick={() => setActiveTab('tamamlanan')}
                  className={`rounded-full border px-4 py-2 text-[0.62rem] font-bold uppercase tracking-[0.14em] ${
                    activeTab === 'tamamlanan'
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-medium)]'
                  }`}
                >
                  Tamamlanan ({tabCounts.completed})
                </button>
              </div>
            ) : (
            <div className="flex w-full items-center justify-center gap-4">
              <button
                onClick={() => setActiveTab('aktif')}
                className={`flex flex-1 items-center gap-3 rounded-2xl border px-4 py-3.5 backdrop-blur-sm transition-all duration-300 ${
                  activeTab === 'aktif'
                    ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                    : 'border-[var(--color-border)] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all ${
                    activeTab === 'aktif'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                      : 'bg-emerald-400 opacity-40'
                  }`}
                />
                <div className="flex flex-col items-start">
                  <span
                    className={`text-[0.65rem] font-bold uppercase tracking-widest transition-colors ${
                      activeTab === 'aktif' ? 'text-emerald-400' : 'text-[var(--color-text-medium)]'
                    }`}
                  >
                    {activeTabLabel}
                  </span>
                  <span className="mt-1 font-serif text-xl leading-none tracking-tight text-[var(--color-text-high)]">
                    {tabCounts.active}
                  </span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('tamamlanan')}
                className={`flex flex-1 items-center gap-3 rounded-2xl border px-4 py-3.5 backdrop-blur-sm transition-all duration-300 ${
                  activeTab === 'tamamlanan'
                    ? 'border-[var(--color-accent)] bg-white/[0.05] shadow-[0_0_20px_rgba(192,178,131,0.2)]'
                    : 'border-[var(--color-border)] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition-shadow ${
                    activeTab === 'tamamlanan'
                      ? 'bg-[var(--color-accent)] shadow-[0_0_8px_rgba(192,178,131,0.5)]'
                      : 'bg-neutral-500 opacity-50'
                  }`}
                />
                <div className="flex flex-col items-start">
                  <span
                    className={`text-[0.65rem] font-bold uppercase tracking-widest transition-colors ${
                      activeTab === 'tamamlanan' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'
                    }`}
                  >
                    {completedTabLabel}
                  </span>
                  <span className="mt-1 font-serif text-xl leading-none tracking-tight text-[var(--color-text-medium)]">
                    {tabCounts.completed}
                  </span>
                </div>
              </button>
            </div>
            )}

            {listCount > 0 ? (
              <button
                onClick={() => setSortOption((previous) => (previous === 'latest' ? 'deadline' : 'latest'))}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/[0.03] px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)] opacity-70 transition-all hover:bg-white/[0.06] hover:opacity-100 active:scale-95"
              >
                <ArrowUpDown size={10} />
                {sortOption === 'latest' ? 'En Güncel' : 'En Yakın Deadline'}
              </button>
            ) : null}
          </div>
        </div>
      </motion.section>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
        </div>
      ) : isError ? (
        <div className="glass-panel flex items-center gap-3 p-6">
          <AlertCircle size={20} className="shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{listError instanceof Error ? listError.message : 'Veri yüklenemedi'}</p>
        </div>
      ) : reviewerView ? (
        reviewerAssignments.length === 0 ? (
          <div className="glass-panel p-7 text-center">
            <p className="text-sm text-[var(--color-text-medium)]">
              {activeTab === 'aktif' ? 'Aktif ödev bulunamadı.' : 'Tamamlanan ödev bulunamadı.'}
            </p>
          </div>
        ) : (
          <section className="space-y-2">
            <AnimatePresence>
              {reviewerAssignments.map((item, index) => {
                const assignmentPath = `${getAssignmentPath(
                  { id: item.assignment_id, title: item.assignment_title },
                  assignmentSlugLookup.slugById,
                )}?aid=${item.assignment_id}`;
                const deadlineInfo = formatDeadline(item.assignment_deadline);
                const createdByLabel = getAssignmentCreatedByLabel(item);
                const progress = item.total > 0 ? Math.round((item.submitted / item.total) * 100) : 0;

                const isCreatorChef = item.assignment_creator_role === 'Şef';
                const canModifyAssignment = isChef || (isLeader && !isCreatorChef);

                return (
                  <motion.article
                    key={item.assignment_id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: 0.03 * index }}
                    onClick={() => router.push(assignmentPath)}
                    className="group relative cursor-pointer overflow-hidden rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4 pl-5 shadow-sm transition-all hover:bg-white/5"
                  >
                    <div className={`absolute bottom-0 left-0 top-0 w-1 ${progress >= 100 ? 'bg-emerald-500/55' : 'bg-rose-500/55'}`} />


                    <div className="relative flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-lg tracking-[-0.03em] text-[var(--color-text-high)]">
                          {item.assignment_title}
                        </p>

                        <p className="mt-1 text-[0.72rem] text-[var(--color-text-medium)]/90">
                          Tanımlayan: {createdByLabel}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-[var(--color-text-medium)]">
                          <span>%{progress} tamamlandı</span>
                          <span>{item.submitted}/{item.total}</span>
                          {deadlineInfo ? <span className={deadlineInfo.isUrgent ? 'text-red-400' : ''}>{deadlineInfo.text}</span> : null}
                        </div>
                      </div>

                      {canModifyAssignment && (
                        <div className="relative z-10 flex shrink-0 items-center gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentToEditId(item.assignment_id);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--color-text-medium)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                            title="Ödevi Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentToDelete({
                                id: item.assignment_id,
                                title: item.assignment_title,
                                description: null,
                                deadline: item.assignment_deadline,
                                target_voice_group: null,
                                drive_folder_id: null,
                                created_by: '',
                                is_active: item.assignment_is_active,
                                created_at: item.assignment_created_at,
                                updated_at: item.assignment_created_at,
                              });
                            }}
                            disabled={deleteMutation.isPending}
                            className="flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--color-text-medium)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                            title="Ödevi Sil"
                          >
                            {deleteMutation.isPending && assignmentToDelete?.id === item.assignment_id ? (
                              <Loader2 size={14} className="animate-spin text-red-400" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </section>
        )
      ) : memberRows.length === 0 ? (
        <div className="glass-panel p-7 text-center">
          <p className="text-sm text-[var(--color-text-medium)]">
            {activeTab === 'aktif' ? 'Aktif ödev bulunamadı.' : 'Tamamlanan ödev bulunamadı.'}
          </p>
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence>
            {memberRows.map((assignment, index) => {
              const deadlineInfo = formatDeadline(assignment.deadline);
              const deadlineText = deadlineInfo?.text ?? null;
              const isUrgent = deadlineInfo?.isUrgent ?? false;
              const isCompletedForCurrentUser = isMemberAssignmentCompleted(assignment);
              const hasSubmitted = Boolean(assignment.submission);
              const submissionStatus = assignment.submission?.status ?? null;
              const creator = assignment.choir_members;
              const assignmentPath = `${getAssignmentPath(assignment, assignmentSlugLookup.slugById)}?aid=${assignment.id}`;

              return (
                <motion.article
                  key={assignment.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: 0.05 * index }}
                  className="group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4 pl-5 shadow-sm transition-all hover:bg-white/5"
                  onClick={() => router.push(assignmentPath)}
                >
                  {isUrgent && !isCompletedForCurrentUser ? (
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-red-500/50" />
                  ) : null}
                  {isCompletedForCurrentUser ? (
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-emerald-500/50" />
                  ) : null}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        {hasSubmitted ? (
                          submissionStatus === 'approved' ? (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-emerald-500 opacity-90">
                              Onaylandı
                            </span>
                          ) : submissionStatus === 'rejected' ? (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-rose-500 opacity-90">
                              Revize Gerekli
                            </span>
                          ) : (
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-amber-500 opacity-90">
                              İncelemede
                            </span>
                          )
                        ) : isUrgent ? (
                          <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-red-400 opacity-90">
                            Kritik
                          </span>
                        ) : null}
                        {deadlineText && (hasSubmitted || isUrgent) ? (
                          <span className="text-[0.6rem] text-[var(--color-text-medium)]/30">•</span>
                        ) : null}
                        {deadlineText ? (
                          <span
                            className={`text-[0.65rem] font-bold uppercase tracking-[0.14em] ${
                              isUrgent
                                ? 'text-red-500/80 [text-shadow:0_0_6px_rgba(239,68,68,0.2)]'
                                : 'text-[var(--color-text-medium)]'
                            }`}
                          >
                            {deadlineText}
                          </span>
                        ) : null}
                      </div>

                      <h3 className="line-clamp-1 font-serif text-lg leading-tight tracking-[-0.03em] transition-colors group-hover:text-[var(--color-accent)]">
                        {assignment.title}
                      </h3>

                      {creator ? (
                        <p className="mt-1 text-[0.75rem] text-[var(--color-text-medium)]/80">
                          Tanımlayan: {creator.first_name}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => router.push(assignmentPath)}
                        className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-transparent text-[var(--color-text-medium)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                        title="Ödev Detayı"
                      >
                        <ChevronRight size={16} />
                      </button>
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
          isOpen={showCreateModal || Boolean(assignmentToEditId)}
          onClose={() => {
            setShowCreateModal(false);
            setAssignmentToEditId(null);
          }}
          onSuccess={async () => {
            setShowCreateModal(false);
            setAssignmentToEditId(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['assignments'] }),
              queryClient.invalidateQueries({ queryKey: ['reviewer-assignment-queue'] }),
            ]);
            toast.success('Ödev listesi güncellendi.');
          }}
          creatorMemberId={member.id}
          isChef={isChef}
          creatorVoiceGroup={member.voice_group}
          editingAssignmentId={assignmentToEditId}
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
