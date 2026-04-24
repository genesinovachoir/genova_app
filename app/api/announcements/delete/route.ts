import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DeleteAnnouncementBody {
  announcement_id?: string;
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
    const body = (await request.json()) as DeleteAnnouncementBody;

    const announcementId = body.announcement_id?.trim() ?? '';
    if (!announcementId) {
      return new NextResponse('announcement_id zorunlu.', { status: 400 });
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

    const { data: announcement, error: announcementError } = await serviceClient
      .from('announcements')
      .select('id, created_by')
      .eq('id', announcementId)
      .maybeSingle();

    if (announcementError) {
      return new NextResponse(announcementError.message, { status: 500 });
    }

    if (!announcement?.id) {
      return new NextResponse('Duyuru bulunamadı.', { status: 404 });
    }

    if (!isChef && announcement.created_by !== actorMember.id) {
      return new NextResponse('Sadece kendi oluşturduğunuz duyuruyu silebilirsiniz.', { status: 403 });
    }

    const { data: deleted, error: deleteError } = await serviceClient
      .from('announcements')
      .delete()
      .eq('id', announcementId)
      .select('id')
      .maybeSingle();

    if (deleteError) {
      return new NextResponse(deleteError.message, { status: 500 });
    }

    if (!deleted?.id) {
      return new NextResponse('Duyuru silinemedi.', { status: 500 });
    }

    return NextResponse.json({ id: deleted.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
