import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UpdateRehearsalBody {
  rehearsal_id?: string;
  date?: string;
  start_time?: string;
  end_time?: string | null;
  title?: string;
  location?: string;
  notes?: string | null;
  collect_attendance?: boolean;
  attendance_note?: string | null;
  invitee_member_ids?: string[];
}

interface RoleRow {
  roles?: { name?: string } | { name?: string }[] | null;
}

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

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTime(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : null;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UpdateRehearsalBody;

    const rehearsalId = body.rehearsal_id?.trim() ?? '';
    const date = body.date?.trim() ?? '';
    const startTime = normalizeTime(body.start_time) ?? '19:30';
    const endTime = normalizeTime(body.end_time);
    const title = body.title?.trim() || 'Prova';
    const location = body.location?.trim() || 'Büyük Salon';
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes : null;
    const collectAttendance = body.collect_attendance !== false;
    const attendanceNote = typeof body.attendance_note === 'string' && body.attendance_note.trim()
      ? body.attendance_note
      : notes;
    const inviteeMemberIds = toUniqueStringArray(body.invitee_member_ids);

    if (!rehearsalId) {
      return new NextResponse('rehearsal_id zorunlu.', { status: 400 });
    }

    if (!date || !isValidDate(date)) {
      return new NextResponse('Geçerli bir tarih zorunludur.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: actorMember, error: actorError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (actorError) {
      return new NextResponse(actorError.message, { status: 500 });
    }

    if (!actorMember?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 404 });
    }

    const { data: actorRoles, error: rolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', actorMember.id);

    if (rolesError) {
      return new NextResponse(rolesError.message, { status: 500 });
    }

    const roleNames = collectRoleNames(actorRoles as RoleRow[]);
    const isChef = roleNames.has('sef');
    const isSectionLeader = roleNames.has('partisyon sefi');

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const { data: rehearsal, error: rehearsalError } = await serviceClient
      .from('rehearsals')
      .select('id, created_by')
      .eq('id', rehearsalId)
      .maybeSingle();

    if (rehearsalError) {
      return new NextResponse(rehearsalError.message, { status: 500 });
    }

    if (!rehearsal?.id) {
      return new NextResponse('Etkinlik bulunamadı.', { status: 404 });
    }

    if (!isChef && rehearsal.created_by !== actorMember.id) {
      return new NextResponse('Sadece kendi oluşturduğunuz etkinliği güncelleyebilirsiniz.', { status: 403 });
    }

    if (inviteeMemberIds.length > 0) {
      const { data: invitedMembers, error: invitedMembersError } = await serviceClient
        .from('choir_members')
        .select('id, is_active, voice_group')
        .in('id', inviteeMemberIds);

      if (invitedMembersError) {
        return new NextResponse(invitedMembersError.message, { status: 500 });
      }

      const invitedMap = new Map((invitedMembers ?? []).map((row) => [row.id, row]));
      const hasMissingMember = inviteeMemberIds.some((memberId) => !invitedMap.has(memberId));
      if (hasMissingMember) {
        return new NextResponse('Geçersiz davetli seçimi.', { status: 400 });
      }

      const hasInactiveMember = inviteeMemberIds.some((memberId) => invitedMap.get(memberId)?.is_active === false);
      if (hasInactiveMember) {
        return new NextResponse('Pasif kullanıcılar davet edilemez.', { status: 400 });
      }

      if (!isChef) {
        if (!actorMember.voice_group) {
          return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
        }
        const outOfScopeTarget = inviteeMemberIds.some((memberId) => invitedMap.get(memberId)?.voice_group !== actorMember.voice_group);
        if (outOfScopeTarget) {
          return new NextResponse('Sadece kendi partinizdeki koristleri davet edebilirsiniz.', { status: 403 });
        }
      }
    }

    const { error: updateError } = await serviceClient
      .from('rehearsals')
      .update({
        date,
        start_time: startTime,
        end_time: endTime,
        title,
        location,
        notes,
        collect_attendance: collectAttendance,
        attendance_note: attendanceNote,
      })
      .eq('id', rehearsalId);

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    const { error: clearInviteeError } = await serviceClient
      .from('rehearsal_invitees')
      .delete()
      .eq('rehearsal_id', rehearsalId);
    if (clearInviteeError) {
      return new NextResponse(clearInviteeError.message, { status: 500 });
    }

    if (inviteeMemberIds.length > 0) {
      const { error: insertInviteeError } = await serviceClient
        .from('rehearsal_invitees')
        .insert(inviteeMemberIds.map((memberId) => ({ rehearsal_id: rehearsalId, member_id: memberId })));

      if (insertInviteeError) {
        return new NextResponse(insertInviteeError.message, { status: 500 });
      }
    }

    return NextResponse.json({
      id: rehearsalId,
      title,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
