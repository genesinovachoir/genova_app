import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DeleteAssignmentBody {
  assignment_id?: string;
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
    const body = (await request.json()) as DeleteAssignmentBody;

    const assignmentId = body.assignment_id?.trim() ?? '';
    if (!assignmentId) {
      return new NextResponse('assignment_id zorunlu.', { status: 400 });
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

    const roleNames = collectRoleNames(actorRoles as RoleRow[]);
    const isChef = roleNames.has('sef');
    const isSectionLeader = roleNames.has('partisyon sefi');

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

    if (!isChef && assignment.created_by !== actorMember.id) {
      return new NextResponse('Sadece kendi oluşturduğunuz ödevi silebilirsiniz.', { status: 403 });
    }

    const { data: deleted, error: deleteError } = await serviceClient
      .from('assignments')
      .delete()
      .eq('id', assignmentId)
      .select('id')
      .maybeSingle();

    if (deleteError) {
      return new NextResponse(deleteError.message, { status: 500 });
    }

    if (!deleted?.id) {
      return new NextResponse('Ödev silinemedi.', { status: 500 });
    }

    return NextResponse.json({ id: deleted.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
