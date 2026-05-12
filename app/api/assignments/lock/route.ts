import { NextResponse } from 'next/server';

import { insertAssignmentAuditLog } from '@/lib/server/assignment-audit';
import { collectRoleNames, getActorMemberWithRoles } from '@/lib/server/reviewer-auth';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LockAssignmentBody {
  assignment_id?: string;
  locked?: boolean;
  mark_missing_as_not_done?: boolean;
}

interface AssignmentRow {
  id: string;
  created_by: string;
  target_voice_group: string | null;
  is_active: boolean;
  is_locked: boolean;
}

interface ChoirMemberRow {
  id: string;
  voice_group: string | null;
}

interface RoleRow {
  member_id?: string;
  roles?: { name?: string } | { name?: string }[] | null;
}

const BLOCKED_ASSIGNMENT_ROLES = new Set(['sef', 'partisyon sefi']);

function hasBlockedAssignmentRole(row: RoleRow): boolean {
  const roleNames = collectRoleNames([row]);
  return Array.from(roleNames).some((roleName) => BLOCKED_ASSIGNMENT_ROLES.has(roleName));
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as LockAssignmentBody;

    const assignmentId = body.assignment_id?.trim() ?? '';
    const locked = body.locked ?? true;
    const markMissingAsNotDone = body.mark_missing_as_not_done ?? true;

    if (!assignmentId) {
      return new NextResponse('assignment_id zorunlu.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    let actorContext;
    try {
      actorContext = await getActorMemberWithRoles({ serviceClient, authUserId: user.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yetki kontrolü başarısız.';
      const status = message.includes('bulunamadı') ? 404 : 500;
      return new NextResponse(message, { status });
    }

    const { actorMember, isChef, isSectionLeader } = actorContext;

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const { data: assignmentData, error: assignmentError } = await serviceClient
      .from('assignments')
      .select('id, created_by, target_voice_group, is_active, is_locked')
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError) {
      return new NextResponse(assignmentError.message, { status: 500 });
    }

    const assignment = (assignmentData ?? null) as AssignmentRow | null;
    if (!assignment?.id) {
      return new NextResponse('Ödev bulunamadı.', { status: 404 });
    }

    if (!isChef && assignment.created_by !== actorMember.id) {
      return new NextResponse('Sadece kendi oluşturduğunuz ödevi kilitleyebilirsiniz.', { status: 403 });
    }

    const nowIso = new Date().toISOString();

    const { data: updatedAssignment, error: updateError } = await serviceClient
      .from('assignments')
      .update({
        is_locked: locked,
        is_active: !locked,
        locked_at: locked ? nowIso : null,
        locked_by: locked ? actorMember.id : null,
        updated_at: nowIso,
      })
      .eq('id', assignmentId)
      .select('id, is_active, is_locked, locked_at, locked_by, updated_at')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    let targetMemberIds: string[] = [];

    const { data: explicitTargetRows, error: explicitTargetError } = await serviceClient
      .from('assignment_targets')
      .select('member_id')
      .eq('assignment_id', assignmentId);

    if (explicitTargetError) {
      return new NextResponse(explicitTargetError.message, { status: 500 });
    }

    targetMemberIds = (explicitTargetRows ?? [])
      .map((row) => row.member_id)
      .filter((memberId): memberId is string => Boolean(memberId));

    if (targetMemberIds.length === 0) {
      let fallbackMembersQuery = serviceClient
        .from('choir_members')
        .select('id, voice_group')
        .eq('is_active', true);

      if (assignment.target_voice_group) {
        fallbackMembersQuery = fallbackMembersQuery.eq('voice_group', assignment.target_voice_group);
      }

      if (!isChef && actorMember.voice_group) {
        fallbackMembersQuery = fallbackMembersQuery.eq('voice_group', actorMember.voice_group);
      }

      const { data: fallbackMembers, error: fallbackMembersError } = await fallbackMembersQuery;

      if (fallbackMembersError) {
        return new NextResponse(fallbackMembersError.message, { status: 500 });
      }

      let scopedFallbackMembers = (fallbackMembers ?? []) as ChoirMemberRow[];
      const fallbackMemberIds = scopedFallbackMembers.map((member) => member.id);

      if (fallbackMemberIds.length > 0) {
        const { data: fallbackRoleRows, error: fallbackRoleError } = await serviceClient
          .from('choir_member_roles')
          .select('member_id, roles(name)')
          .in('member_id', fallbackMemberIds);

        if (fallbackRoleError) {
          return new NextResponse(fallbackRoleError.message, { status: 500 });
        }

        const blockedIds = new Set(
          ((fallbackRoleRows ?? []) as RoleRow[])
            .filter((row) => hasBlockedAssignmentRole(row))
            .map((row) => row.member_id)
            .filter((memberId): memberId is string => Boolean(memberId)),
        );

        scopedFallbackMembers = scopedFallbackMembers.filter((member) => !blockedIds.has(member.id));
      }

      targetMemberIds = scopedFallbackMembers.map((member) => member.id);
    } else {
      const { data: targetRoleRows, error: targetRoleError } = await serviceClient
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', targetMemberIds);

      if (targetRoleError) {
        return new NextResponse(targetRoleError.message, { status: 500 });
      }

      const blockedIds = new Set(
        ((targetRoleRows ?? []) as RoleRow[])
          .filter((row) => hasBlockedAssignmentRole(row))
          .map((row) => row.member_id)
          .filter((memberId): memberId is string => Boolean(memberId)),
      );

      targetMemberIds = targetMemberIds.filter((memberId) => !blockedIds.has(memberId));
    }

    const uniqueTargetMemberIds = Array.from(new Set(targetMemberIds));
    let submittedMemberIds = new Set<string>();

    if (uniqueTargetMemberIds.length > 0) {
      const { data: submissionRows, error: submissionRowsError } = await serviceClient
        .from('assignment_submissions')
        .select('member_id')
        .eq('assignment_id', assignmentId)
        .in('member_id', uniqueTargetMemberIds);

      if (submissionRowsError) {
        return new NextResponse(submissionRowsError.message, { status: 500 });
      }

      submittedMemberIds = new Set(
        (submissionRows ?? [])
          .map((row) => row.member_id)
          .filter((memberId): memberId is string => Boolean(memberId)),
      );
    }

    const missingMemberIds = uniqueTargetMemberIds.filter((memberId) => !submittedMemberIds.has(memberId));

    if (locked && markMissingAsNotDone && missingMemberIds.length > 0) {
      const rows = missingMemberIds.map((missingMemberId) => ({
        assignment_id: assignmentId,
        submission_id: null,
        member_id: missingMemberId,
        actor_member_id: actorMember.id,
        event_type: 'assignment_missing_marked_not_done',
        event_payload: {
          reason: 'assignment_locked_without_submission',
        },
      }));

      const { error: missingAuditInsertError } = await serviceClient
        .from('assignment_submission_audit_logs')
        .insert(rows);

      if (missingAuditInsertError) {
        return new NextResponse(missingAuditInsertError.message, { status: 500 });
      }
    }

    await insertAssignmentAuditLog(serviceClient, {
      assignmentId,
      actorMemberId: actorMember.id,
      eventType: locked ? 'assignment_locked' : 'assignment_unlocked',
      payload: {
        locked,
        target_count: uniqueTargetMemberIds.length,
        submitted_count: submittedMemberIds.size,
        missing_count: missingMemberIds.length,
      },
    });

    return NextResponse.json({
      ...updatedAssignment,
      target_count: uniqueTargetMemberIds.length,
      submitted_count: submittedMemberIds.size,
      missing_count: missingMemberIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
