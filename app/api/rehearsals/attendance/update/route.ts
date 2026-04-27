import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ManualAttendanceStatus = 'approved' | 'rejected' | 'clear';

interface UpdateAttendanceBody {
  rehearsal_id?: string;
  member_id?: string;
  status?: ManualAttendanceStatus;
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

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UpdateAttendanceBody;

    const rehearsalId = body.rehearsal_id?.trim() ?? '';
    const targetMemberId = body.member_id?.trim() ?? '';
    const status = body.status;

    if (!rehearsalId || !targetMemberId) {
      return new NextResponse('rehearsal_id ve member_id zorunludur.', { status: 400 });
    }

    if (status !== 'approved' && status !== 'rejected' && status !== 'clear') {
      return new NextResponse('Geçersiz katılım durumu.', { status: 400 });
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
      .select('id, collect_attendance')
      .eq('id', rehearsalId)
      .maybeSingle();

    if (rehearsalError) {
      return new NextResponse(rehearsalError.message, { status: 500 });
    }

    if (!rehearsal?.id) {
      return new NextResponse('Etkinlik bulunamadı.', { status: 404 });
    }

    if (!rehearsal.collect_attendance) {
      return new NextResponse('Bu etkinlik için katılım alınmıyor.', { status: 400 });
    }

    const { data: invitee, error: inviteeError } = await serviceClient
      .from('rehearsal_invitees')
      .select('member_id')
      .eq('rehearsal_id', rehearsalId)
      .eq('member_id', targetMemberId)
      .maybeSingle();

    if (inviteeError) {
      return new NextResponse(inviteeError.message, { status: 500 });
    }

    if (!invitee?.member_id) {
      return new NextResponse('Bu kişi etkinliğe davetli değil.', { status: 400 });
    }

    const { data: targetMember, error: targetMemberError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group, is_active')
      .eq('id', targetMemberId)
      .maybeSingle();

    if (targetMemberError) {
      return new NextResponse(targetMemberError.message, { status: 500 });
    }

    if (!targetMember?.id || targetMember.is_active === false) {
      return new NextResponse('Geçersiz hedef korist.', { status: 400 });
    }

    if (!isChef) {
      if (!actorMember.voice_group) {
        return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
      }

      if (targetMember.voice_group !== actorMember.voice_group) {
        return new NextResponse('Sadece kendi partinizdeki koristlerin katılımını düzenleyebilirsiniz.', { status: 403 });
      }
    }

    if (status === 'clear') {
      const { error: deleteError } = await serviceClient
        .from('attendance')
        .delete()
        .eq('rehearsal_id', rehearsalId)
        .eq('member_id', targetMemberId);

      if (deleteError) {
        return new NextResponse(deleteError.message, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await serviceClient
      .from('attendance')
      .upsert(
        {
          rehearsal_id: rehearsalId,
          member_id: targetMemberId,
          status,
          checked_in_at: now,
          approved_by: actorMember.id,
          approved_at: now,
        },
        { onConflict: 'rehearsal_id,member_id' },
      );

    if (upsertError) {
      return new NextResponse(upsertError.message, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
