import { NextResponse } from 'next/server';

import { sendRepertoireAssignmentPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UpdateRepertoireAssignmentsBody {
  song_id?: string;
  part_name?: string | null;
  member_ids?: string[];
}

interface RoleRow {
  member_id?: string;
  roles?: { name?: string } | { name?: string }[] | null;
}

const BLOCKED_REPERTOIRE_ASSIGNMENT_ROLES = new Set(['sef', 'partisyon sefi']);

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

function hasBlockedRepertoireAssignmentRole(row: RoleRow) {
  const roleNames = collectRoleNames([row]);
  return Array.from(roleNames).some((roleName) => BLOCKED_REPERTOIRE_ASSIGNMENT_ROLES.has(roleName));
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

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UpdateRepertoireAssignmentsBody;

    const songId = body.song_id?.trim() ?? '';
    const partName = typeof body.part_name === 'string' && body.part_name.trim() ? body.part_name.trim() : null;
    const memberIds = toUniqueStringArray(body.member_ids);

    if (!songId) {
      return new NextResponse('song_id zorunlu.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: actorMember, error: actorError } = await serviceClient
      .from('choir_members')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (actorError) {
      return new NextResponse(actorError.message, { status: 500 });
    }

    if (!actorMember?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 404 });
    }

    const { data: actorRoles, error: actorRolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', actorMember.id);

    if (actorRolesError) {
      return new NextResponse(actorRolesError.message, { status: 500 });
    }

    const actorRoleNames = collectRoleNames(actorRoles as RoleRow[]);
    if (!actorRoleNames.has('sef')) {
      return new NextResponse('Bu işlem için Şef yetkisi gerekli.', { status: 403 });
    }

    const { data: song, error: songError } = await serviceClient
      .from('repertoire')
      .select('id, title')
      .eq('id', songId)
      .maybeSingle();

    if (songError) {
      return new NextResponse(songError.message, { status: 500 });
    }

    if (!song?.id) {
      return new NextResponse('Repertuvar bulunamadı.', { status: 404 });
    }

    let existingAssignmentsQuery = serviceClient
      .from('song_assignments')
      .select('member_id')
      .eq('song_id', songId);

    existingAssignmentsQuery = partName
      ? existingAssignmentsQuery.eq('part_name', partName)
      : existingAssignmentsQuery.is('part_name', null);

    const { data: existingAssignments, error: existingAssignmentsError } = await existingAssignmentsQuery;
    if (existingAssignmentsError) {
      return new NextResponse(existingAssignmentsError.message, { status: 500 });
    }

    const existingMemberIds = new Set((existingAssignments ?? []).map((assignment) => assignment.member_id));
    const newlyAddedMemberIds = memberIds.filter((memberId) => !existingMemberIds.has(memberId));

    if (memberIds.length > 0) {
      const { data: targetMembers, error: targetMembersError } = await serviceClient
        .from('choir_members')
        .select('id, is_active')
        .in('id', memberIds);

      if (targetMembersError) {
        return new NextResponse(targetMembersError.message, { status: 500 });
      }

      const targetMemberMap = new Map((targetMembers ?? []).map((row) => [row.id, row]));
      const hasMissingMember = memberIds.some((memberId) => !targetMemberMap.has(memberId));
      if (hasMissingMember) {
        return new NextResponse('Geçersiz hedef korist seçimi.', { status: 400 });
      }

      const hasInactiveMember = memberIds.some((memberId) => targetMemberMap.get(memberId)?.is_active === false);
      if (hasInactiveMember) {
        return new NextResponse('Pasif kullanıcılara repertuvar atanamaz.', { status: 400 });
      }

      const { data: targetRoleRows, error: targetRoleRowsError } = await serviceClient
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', memberIds);

      if (targetRoleRowsError) {
        return new NextResponse(targetRoleRowsError.message, { status: 500 });
      }

      const blockedTargets = ((targetRoleRows ?? []) as RoleRow[]).filter((row) => hasBlockedRepertoireAssignmentRole(row));
      if (blockedTargets.length > 0) {
        return new NextResponse('Repertuvar yalnızca koristlere atanabilir. Şef/partisyon şefi hedeflenemez.', { status: 400 });
      }
    }

    let deleteAssignmentsQuery = serviceClient
      .from('song_assignments')
      .delete()
      .eq('song_id', songId);

    deleteAssignmentsQuery = partName
      ? deleteAssignmentsQuery.eq('part_name', partName)
      : deleteAssignmentsQuery.is('part_name', null);

    const { error: deleteAssignmentsError } = await deleteAssignmentsQuery;
    if (deleteAssignmentsError) {
      return new NextResponse(deleteAssignmentsError.message, { status: 500 });
    }

    if (memberIds.length > 0) {
      const { error: insertAssignmentsError } = await serviceClient
        .from('song_assignments')
        .upsert(
          memberIds.map((memberId) => ({
            song_id: songId,
            member_id: memberId,
            part_name: partName,
          })),
          { onConflict: 'song_id,member_id' },
        );

      if (insertAssignmentsError) {
        return new NextResponse(insertAssignmentsError.message, { status: 500 });
      }
    }

    if (newlyAddedMemberIds.length > 0) {
      try {
        await sendRepertoireAssignmentPush({
          songId: song.id,
          songTitle: song.title,
          partName,
          targetMemberIds: newlyAddedMemberIds,
        });
      } catch (pushError) {
        console.error('Repertoire assignment push send failed:', pushError);
      }
    }

    return NextResponse.json({
      ok: true,
      song_id: songId,
      part_name: partName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
