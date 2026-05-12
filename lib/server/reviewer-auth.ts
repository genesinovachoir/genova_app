import { createSupabaseServiceClient } from './supabase-auth';

interface RoleRow {
  roles?: { name?: string } | { name?: string }[] | null;
}

export function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

export function collectRoleNames(roleRows: RoleRow[] | null | undefined) {
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

export async function getActorMemberWithRoles(params: {
  serviceClient: ReturnType<typeof createSupabaseServiceClient>;
  authUserId: string;
}) {
  const { serviceClient, authUserId } = params;

  const { data: actorMember, error: actorError } = await serviceClient
    .from('choir_members')
    .select('id, voice_group')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actorError) {
    throw new Error(actorError.message);
  }

  if (!actorMember?.id) {
    throw new Error('Kullanıcı için korist kaydı bulunamadı.');
  }

  const { data: actorRoles, error: actorRolesError } = await serviceClient
    .from('choir_member_roles')
    .select('roles(name)')
    .eq('member_id', actorMember.id);

  if (actorRolesError) {
    throw new Error(actorRolesError.message);
  }

  const roleNames = collectRoleNames(actorRoles as RoleRow[]);
  const isChef = roleNames.has('sef');
  const isSectionLeader = roleNames.has('partisyon sefi');

  return {
    actorMember,
    roleNames,
    isChef,
    isSectionLeader,
  };
}
