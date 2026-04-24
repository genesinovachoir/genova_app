import { NextResponse } from 'next/server';

import { sendAssignmentCreatedPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CreateAssignmentBody {
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

function formatDeadlineText(deadlineIso: string | null) {
  if (!deadlineIso) {
    return 'Belirlenen son tarih';
  }

  const date = new Date(deadlineIso);
  if (Number.isNaN(date.getTime())) {
    return 'Belirlenen son tarih';
  }

  const dateLabel = date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
  const timeLabel = date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Istanbul',
  });

  return `${dateLabel} ${timeLabel}`;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as CreateAssignmentBody;

    const title = body.title?.trim() ?? '';
    const description = typeof body.description === 'string' && body.description.trim() ? body.description : null;
    const deadlineIso = normalizeDeadline(body.deadline);
    const targetMemberIds = toUniqueStringArray(body.target_member_ids);

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

    const { data: creatorMember, error: creatorError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (creatorError) {
      return new NextResponse(creatorError.message, { status: 500 });
    }
    if (!creatorMember?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 404 });
    }

    const { data: creatorRoles, error: creatorRolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', creatorMember.id);

    if (creatorRolesError) {
      return new NextResponse(creatorRolesError.message, { status: 500 });
    }

    const creatorRoleNames = collectRoleNames(creatorRoles as RoleRow[]);
    const isChef = creatorRoleNames.has('sef');
    const isSectionLeader = creatorRoleNames.has('partisyon sefi');

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    if (!isChef && !creatorMember.voice_group) {
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
      return new NextResponse('Geçersiz hedef korişt seçimi.', { status: 400 });
    }

    const hasInactiveMember = targetMemberIds.some((memberId) => targetMemberMap.get(memberId)?.is_active === false);
    if (hasInactiveMember) {
      return new NextResponse('Pasif kullanıcılara ödev atanamaz.', { status: 400 });
    }

    if (!isChef) {
      const outOfScopeTarget = targetMemberIds.some(
        (memberId) => targetMemberMap.get(memberId)?.voice_group !== creatorMember.voice_group,
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

    const { data: assignment, error: insertAssignmentError } = await serviceClient
      .from('assignments')
      .insert({
        title,
        description,
        deadline: deadlineIso,
        target_voice_group: null,
        created_by: creatorMember.id,
        is_active: true,
      })
      .select('id, title, deadline')
      .maybeSingle();

    if (insertAssignmentError) {
      return new NextResponse(insertAssignmentError.message, { status: 500 });
    }
    if (!assignment?.id) {
      return new NextResponse('Ödev oluşturulamadı.', { status: 500 });
    }

    const { error: targetInsertError } = await serviceClient
      .from('assignment_targets')
      .insert(
        targetMemberIds.map((memberId) => ({
          assignment_id: assignment.id,
          member_id: memberId,
        })),
      );

    if (targetInsertError) {
      await serviceClient.from('assignments').delete().eq('id', assignment.id);
      return new NextResponse(targetInsertError.message, { status: 500 });
    }

    try {
      await sendAssignmentCreatedPush({
        assignmentId: assignment.id,
        deadlineText: formatDeadlineText(assignment.deadline),
        targetMemberIds,
      });
    } catch (pushError) {
      console.error('Assignment create push send failed:', pushError);
    }

    return NextResponse.json({
      id: assignment.id,
      title: assignment.title,
      deadline: assignment.deadline,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
