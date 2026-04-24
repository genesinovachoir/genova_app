import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UpdateAssignmentBody {
  assignment_id?: string;
  title?: string;
  description?: string | null;
  deadline?: string | null;
  target_member_ids?: string[];
}

interface RoleRow {
  member_id?: string;
  roles?: { name?: string } | { name?: string }[] | null;
}

const BLOCKED_ASSIGNMENT_ROLES = new Set(['sef', 'partisyon sefi']);

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

function collectRoleNames(roleRows: RoleRow[] | null | undefined) {
  return new Set(
    (roleRows ?? [])
      .flatMap((entry) => {
        const roleData = entry.roles;
        if (!roleData) {
          return [];
        }

        if (Array.isArray(roleData)) {
          return roleData
            .map((role) => role?.name)
            .filter((name): name is string => Boolean(name))
            .map((name) => normalizeRoleName(name));
        }

        return roleData.name ? [normalizeRoleName(roleData.name)] : [];
      })
      .filter((roleName): roleName is string => Boolean(roleName)),
  );
}

function hasBlockedAssignmentRole(row: RoleRow) {
  const roleNames = collectRoleNames([row]);
  return Array.from(roleNames).some((roleName) => BLOCKED_ASSIGNMENT_ROLES.has(roleName));
}

function toUniqueStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function normalizeDeadline(deadline: string | null | undefined) {
  if (!deadline || !deadline.trim()) {
    return null;
  }

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UpdateAssignmentBody;

    const assignmentId = body.assignment_id?.trim() ?? '';
    const title = body.title?.trim() ?? '';
    const description = typeof body.description === 'string' && body.description.trim() ? body.description : null;
    const deadlineIso = normalizeDeadline(body.deadline);
    const targetMemberIds = toUniqueStringArray(body.target_member_ids);

    if (!assignmentId) {
      return new NextResponse('assignment_id zorunlu.', { status: 400 });
    }

    if (!title) {
      return new NextResponse('Ödev başlığı zorunlu.', { status: 400 });
    }

    if (body.deadline && !deadlineIso) {
      return new NextResponse('Geçerli bir son tarih giriniz.', { status: 400 });
    }

    if (targetMemberIds.length === 0) {
      return new NextResponse('En az bir hedef korist seçmelisiniz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: updaterMember, error: updaterError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (updaterError) {
      return new NextResponse(updaterError.message, { status: 500 });
    }
    if (!updaterMember?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 404 });
    }

    const { data: updaterRoles, error: updaterRolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', updaterMember.id);

    if (updaterRolesError) {
      return new NextResponse(updaterRolesError.message, { status: 500 });
    }

    const updaterRoleNames = collectRoleNames(updaterRoles as RoleRow[]);
    const isChef = updaterRoleNames.has('sef');
    const isSectionLeader = updaterRoleNames.has('partisyon sefi');

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const { data: assignment, error: assignmentError } = await serviceClient
      .from('assignments')
      .select('id, created_by')
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError) {
      return new NextResponse(assignmentError.message, { status: 500 });
    }

    if (!assignment?.id) {
      return new NextResponse('Ödev bulunamadı.', { status: 404 });
    }

    if (!isChef && assignment.created_by !== updaterMember.id) {
      return new NextResponse('Sadece kendi oluşturduğunuz ödevi güncelleyebilirsiniz.', { status: 403 });
    }

    if (!isChef && !updaterMember.voice_group) {
      return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
    }

    const { data: targetMembers, error: targetMembersError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group, is_active')
      .in('id', targetMemberIds);

    if (targetMembersError) {
      return new NextResponse(targetMembersError.message, { status: 500 });
    }

    const targetMemberMap = new Map((targetMembers ?? []).map((row) => [row.id, row]));
    const hasMissingMember = targetMemberIds.some((memberId) => !targetMemberMap.has(memberId));
    if (hasMissingMember) {
      return new NextResponse('Geçersiz hedef korist seçimi.', { status: 400 });
    }

    const hasInactiveMember = targetMemberIds.some((memberId) => targetMemberMap.get(memberId)?.is_active === false);
    if (hasInactiveMember) {
      return new NextResponse('Pasif kullanıcılara ödev atanamaz.', { status: 400 });
    }

    if (!isChef) {
      const outOfScopeTarget = targetMemberIds.some(
        (memberId) => targetMemberMap.get(memberId)?.voice_group !== updaterMember.voice_group,
      );
      if (outOfScopeTarget) {
        return new NextResponse('Sadece kendi partinizdeki koristlere ödev atayabilirsiniz.', { status: 403 });
      }
    }

    const { data: targetRoleRows, error: targetRoleRowsError } = await serviceClient
      .from('choir_member_roles')
      .select('member_id, roles(name)')
      .in('member_id', targetMemberIds);

    if (targetRoleRowsError) {
      return new NextResponse(targetRoleRowsError.message, { status: 500 });
    }

    const blockedTargets = ((targetRoleRows ?? []) as RoleRow[]).filter((row) => hasBlockedAssignmentRole(row));
    if (blockedTargets.length > 0) {
      return new NextResponse('Ödev yalnızca koristlere atanabilir. Şef/partisyon şefi hedeflenemez.', { status: 400 });
    }

    const { error: updateAssignmentError } = await serviceClient
      .from('assignments')
      .update({
        title,
        description,
        deadline: deadlineIso,
      })
      .eq('id', assignmentId);

    if (updateAssignmentError) {
      return new NextResponse(updateAssignmentError.message, { status: 500 });
    }

    const { error: deleteTargetsError } = await serviceClient
      .from('assignment_targets')
      .delete()
      .eq('assignment_id', assignmentId);
    if (deleteTargetsError) {
      return new NextResponse(deleteTargetsError.message, { status: 500 });
    }

    const { error: insertTargetsError } = await serviceClient
      .from('assignment_targets')
      .insert(
        targetMemberIds.map((memberId) => ({
          assignment_id: assignmentId,
          member_id: memberId,
        })),
      );

    if (insertTargetsError) {
      return new NextResponse(insertTargetsError.message, { status: 500 });
    }

    return NextResponse.json({
      id: assignmentId,
      title,
      deadline: deadlineIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
