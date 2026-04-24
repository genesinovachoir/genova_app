import { NextResponse } from 'next/server';

import { sendRehearsalCreatedPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CreateRehearsalBody {
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

function stripHtml(raw: string | null | undefined) {
  if (!raw) {
    return '';
  }

  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateLabel(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function buildEventDetails(input: {
  date: string;
  startTime: string;
  endTime: string | null;
  location: string;
  notes: string | null;
}) {
  const timeLabel = input.endTime ? `${input.startTime} - ${input.endTime}` : input.startTime;
  const segments = [
    `Tarih: ${formatDateLabel(input.date)}`,
    `Saat: ${timeLabel}`,
    `Yer: ${input.location}`,
  ];

  const cleanedNotes = stripHtml(input.notes);
  if (cleanedNotes) {
    segments.push(`Detay: ${cleanedNotes}`);
  }

  return segments.join(' | ');
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as CreateRehearsalBody;

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

    if (!date || !isValidDate(date)) {
      return new NextResponse('Geçerli bir tarih zorunludur.', { status: 400 });
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

    const { data: creatorRoles, error: rolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', creatorMember.id);

    if (rolesError) {
      return new NextResponse(rolesError.message, { status: 500 });
    }

    const roleNames = collectRoleNames(creatorRoles as RoleRow[]);
    const isChef = roleNames.has('sef');
    const canManage = isChef || roleNames.has('partisyon sefi');
    if (!canManage) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
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
        if (!creatorMember.voice_group) {
          return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
        }
        const outOfScopeTarget = inviteeMemberIds.some((memberId) => invitedMap.get(memberId)?.voice_group !== creatorMember.voice_group);
        if (outOfScopeTarget) {
          return new NextResponse('Sadece kendi partinizdeki koristleri davet edebilirsiniz.', { status: 403 });
        }
      }
    }

    const { data: insertedRehearsal, error: insertError } = await serviceClient
      .from('rehearsals')
      .insert({
        date,
        start_time: startTime,
        end_time: endTime,
        title,
        location,
        notes,
        collect_attendance: collectAttendance,
        attendance_note: attendanceNote,
        created_by: creatorMember.id,
      })
      .select('id, title, date, start_time, end_time, location, notes, collect_attendance')
      .maybeSingle();

    if (insertError) {
      return new NextResponse(insertError.message, { status: 500 });
    }

    if (!insertedRehearsal?.id) {
      return new NextResponse('Etkinlik oluşturulamadı.', { status: 500 });
    }

    if (inviteeMemberIds.length > 0) {
      const { error: inviteInsertError } = await serviceClient
        .from('rehearsal_invitees')
        .insert(inviteeMemberIds.map((memberId) => ({ rehearsal_id: insertedRehearsal.id, member_id: memberId })));

      if (inviteInsertError) {
        await serviceClient.from('rehearsals').delete().eq('id', insertedRehearsal.id);
        return new NextResponse(inviteInsertError.message, { status: 500 });
      }
    }

    const details = buildEventDetails({
      date: insertedRehearsal.date,
      startTime: insertedRehearsal.start_time,
      endTime: insertedRehearsal.end_time,
      location: insertedRehearsal.location,
      notes: insertedRehearsal.notes,
    });

    try {
      await sendRehearsalCreatedPush({
        rehearsalId: insertedRehearsal.id,
        rehearsalTitle: insertedRehearsal.title,
        rehearsalDetails: details,
        collectAttendance: insertedRehearsal.collect_attendance,
        targetMemberIds: inviteeMemberIds,
        rehearsalDate: insertedRehearsal.date,
      });
    } catch (pushError) {
      console.error('Rehearsal create push send failed:', pushError);
    }

    return NextResponse.json({
      id: insertedRehearsal.id,
      title: insertedRehearsal.title,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
