import { NextResponse } from 'next/server';

import { sendAnnouncementPublishedPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VOICE_GROUPS = new Set(['Soprano', 'Alto', 'Tenor', 'Bass']);
const ANNOUNCEMENT_ICONS = new Set(['megaphone', 'calendar', 'file', 'music', 'alert', 'info', 'heart']);

interface PublishAnnouncementBody {
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
    const body = (await request.json()) as PublishAnnouncementBody;

    const title = body.title?.trim() ?? '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const icon = typeof body.icon === 'string' && ANNOUNCEMENT_ICONS.has(body.icon) ? body.icon : 'megaphone';
    const requestedTargetUsers = toUniqueStringArray(body.target_users);
    const targetVoiceGroups = toUniqueStringArray(body.target_voice_groups).filter((group) => VOICE_GROUPS.has(group));

    if (!title || !description || description === '<p></p>') {
      return new NextResponse('Duyuru başlığı ve içeriği zorunludur.', { status: 400 });
    }

    if (requestedTargetUsers.length === 0) {
      return new NextResponse('En az bir hedef kullanıcı seçmelisiniz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: creatorMember, error: creatorError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group, first_name, last_name')
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
    const isSectionLeader = roleNames.has('partisyon sefi');

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const targetMemberIds = Array.from(new Set([...requestedTargetUsers, creatorMember.id]));

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
      if (!creatorMember.voice_group) {
        return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
      }

      const outOfScopeTarget = targetMemberIds.some((memberId) => {
        if (memberId === creatorMember.id) {
          return false;
        }
        return targetMemberMap.get(memberId)?.voice_group !== creatorMember.voice_group;
      });

      if (outOfScopeTarget) {
        return new NextResponse('Sadece kendi partinizdeki koristlere duyuru atayabilirsiniz.', { status: 403 });
      }
    }

    const { data: insertedAnnouncement, error: insertError } = await serviceClient
      .from('announcements')
      .insert({
        title,
        description,
        icon,
        target_users: targetMemberIds,
        target_voice_groups: targetVoiceGroups,
        created_by: creatorMember.id,
      })
      .select('id, title, description')
      .maybeSingle();

    if (insertError) {
      return new NextResponse(insertError.message, { status: 500 });
    }

    if (!insertedAnnouncement?.id) {
      return new NextResponse('Duyuru oluşturulamadı.', { status: 500 });
    }

    const pushTargetMemberIds = targetMemberIds.filter((memberId) => memberId !== creatorMember.id);
    const publisherName = `${creatorMember.first_name ?? ''} ${creatorMember.last_name ?? ''}`.trim() || null;

    try {
      await sendAnnouncementPublishedPush({
        announcementId: insertedAnnouncement.id,
        title: insertedAnnouncement.title ?? title,
        description: insertedAnnouncement.description ?? '',
        targetMemberIds: pushTargetMemberIds,
        publisherName,
      });
    } catch (pushError) {
      console.error('Announcement push send failed:', pushError);
    }

    return NextResponse.json({
      id: insertedAnnouncement.id,
      title,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
