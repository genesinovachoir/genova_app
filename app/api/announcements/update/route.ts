import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VOICE_GROUPS = new Set(['Soprano', 'Alto', 'Tenor', 'Bass']);
const ANNOUNCEMENT_ICONS = new Set(['megaphone', 'calendar', 'file', 'music', 'alert', 'info', 'heart']);

interface UpdateAnnouncementBody {
  announcement_id?: string;
  title?: string;
  description?: string;
  icon?: string;
  target_users?: string[];
  target_voice_groups?: string[];
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

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UpdateAnnouncementBody;

    const announcementId = body.announcement_id?.trim() ?? '';
    const title = body.title?.trim() ?? '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const icon = typeof body.icon === 'string' && ANNOUNCEMENT_ICONS.has(body.icon) ? body.icon : 'megaphone';
    const requestedTargetUsers = toUniqueStringArray(body.target_users);
    const targetVoiceGroups = toUniqueStringArray(body.target_voice_groups).filter((group) => VOICE_GROUPS.has(group));

    if (!announcementId) {
      return new NextResponse('announcement_id zorunlu.', { status: 400 });
    }

    if (!title || !description || description === '<p></p>') {
      return new NextResponse('Duyuru başlığı ve içeriği zorunludur.', { status: 400 });
    }

    if (requestedTargetUsers.length === 0) {
      return new NextResponse('En az bir hedef kullanıcı seçmelisiniz.', { status: 400 });
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
      return new NextResponse('Sadece kendi oluşturduğunuz duyuruyu güncelleyebilirsiniz.', { status: 403 });
    }

    const targetMemberIds = Array.from(new Set([...requestedTargetUsers, actorMember.id]));

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
      return new NextResponse('Geçersiz hedef kullanıcı seçimi.', { status: 400 });
    }

    const hasInactiveMember = targetMemberIds.some((memberId) => targetMemberMap.get(memberId)?.is_active === false);
    if (hasInactiveMember) {
      return new NextResponse('Pasif kullanıcılara duyuru atanamaz.', { status: 400 });
    }

    if (!isChef) {
      if (!actorMember.voice_group) {
        return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
      }

      const outOfScopeTarget = targetMemberIds.some((memberId) => {
        if (memberId === actorMember.id) {
          return false;
        }
        return targetMemberMap.get(memberId)?.voice_group !== actorMember.voice_group;
      });

      if (outOfScopeTarget) {
        return new NextResponse('Sadece kendi partinizdeki koristlere duyuru atayabilirsiniz.', { status: 403 });
      }
    }

    const { data: updatedAnnouncement, error: updateError } = await serviceClient
      .from('announcements')
      .update({
        title,
        description,
        icon,
        target_users: targetMemberIds,
        target_voice_groups: targetVoiceGroups,
      })
      .eq('id', announcementId)
      .select('id, title')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    if (!updatedAnnouncement?.id) {
      return new NextResponse('Duyuru güncellenemedi.', { status: 500 });
    }

    return NextResponse.json({
      id: updatedAnnouncement.id,
      title: updatedAnnouncement.title,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
