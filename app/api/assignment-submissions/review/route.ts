import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ReviewStatus = 'approved' | 'rejected';

interface ReviewBody {
  submissionId?: string;
  status?: ReviewStatus;
  reviewerNote?: string | null;
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
    const body = (await request.json()) as ReviewBody;

    const submissionId = body.submissionId?.trim();
    const status = body.status;
    const reviewerNote = body.reviewerNote?.trim() || null;

    if (!submissionId || (status !== 'approved' && status !== 'rejected')) {
      return new NextResponse('Geçersiz istek gövdesi.', { status: 400 });
    }

    if (reviewerNote && reviewerNote.length > 1200) {
      return new NextResponse('Not 1200 karakterden uzun olamaz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: reviewerMember, error: reviewerMemberError } = await serviceClient
      .from('choir_members')
      .select('id, voice_group')
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
    const isChef = roleNames.has('sef');
    const isSectionLeader = roleNames.has('partisyon sefi');

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const { data: existingSubmission, error: existingSubmissionError } = await serviceClient
      .from('assignment_submissions')
      .select('id, member_id, status')
      .eq('id', submissionId)
      .maybeSingle();
    if (existingSubmissionError) {
      return new NextResponse(existingSubmissionError.message, { status: 500 });
    }
    if (!existingSubmission?.id) {
      return new NextResponse('Teslim bulunamadı.', { status: 404 });
    }

    const existingStatus = existingSubmission.status as string | null;
    if (existingStatus && existingStatus !== 'pending') {
      return new NextResponse('Teslim zaten değerlendirilmiş.', { status: 409 });
    }

    if (!isChef) {
      if (!reviewerMember.voice_group) {
        return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
      }

      const { data: targetMember, error: targetMemberError } = await serviceClient
        .from('choir_members')
        .select('id, voice_group')
        .eq('id', existingSubmission.member_id)
        .maybeSingle();
      if (targetMemberError) {
        return new NextResponse(targetMemberError.message, { status: 500 });
      }
      if (!targetMember?.id) {
        return new NextResponse('Teslim sahibi korist bulunamadı.', { status: 404 });
      }
      if (!targetMember.voice_group || targetMember.voice_group !== reviewerMember.voice_group) {
        return new NextResponse('Sadece kendi partinizdeki teslimleri değerlendirebilirsiniz.', { status: 403 });
      }
    }

    const reviewedAt = new Date().toISOString();
    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update({
        status,
        reviewer_note: reviewerNote,
        approved_at: reviewedAt,
        approved_by: reviewerMember.id,
      })
      .eq('id', submissionId)
      .select('id, status, reviewer_note, approved_at, approved_by, updated_at')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    if (!updatedSubmission) {
      return new NextResponse('Değerlendirme uygulanamadı.', { status: 409 });
    }

    return NextResponse.json(updatedSubmission);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
