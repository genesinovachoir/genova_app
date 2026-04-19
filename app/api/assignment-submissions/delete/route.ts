import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DeleteBody {
  submissionId?: string;
}

interface ReviewerRoleRow {
  roles?: { name?: string } | { name?: string }[] | null;
}

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR');
}

function collectRoleNames(roleRows: ReviewerRoleRow[] | null | undefined) {
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
    const body = (await request.json()) as DeleteBody;
    const submissionId = body.submissionId?.trim();

    if (!submissionId) {
      return new NextResponse('Geçersiz submissionId.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: reviewerMember, error: reviewerMemberError } = await serviceClient
      .from('choir_members')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (reviewerMemberError) {
      return new NextResponse(reviewerMemberError.message, { status: 500 });
    }
    if (!reviewerMember?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 404 });
    }

    const { data: reviewerRoles, error: reviewerRolesError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', reviewerMember.id);
    if (reviewerRolesError) {
      return new NextResponse(reviewerRolesError.message, { status: 500 });
    }

    const roleNames = collectRoleNames(reviewerRoles as ReviewerRoleRow[]);
    if (!roleNames.has('sef')) {
      return new NextResponse('Bu işlem için Şef yetkisi gerekli.', { status: 403 });
    }

    const { data: deletedSubmission, error: deleteError } = await serviceClient
      .from('assignment_submissions')
      .delete()
      .eq('id', submissionId)
      .select('id')
      .maybeSingle();

    if (deleteError) {
      return new NextResponse(deleteError.message, { status: 500 });
    }

    if (!deletedSubmission?.id) {
      return new NextResponse('Teslim silinemedi veya bulunamadı.', { status: 404 });
    }

    return NextResponse.json({ id: deletedSubmission.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
