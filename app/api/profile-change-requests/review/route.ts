import { NextResponse } from 'next/server';

import {
  getProfileChangeKeys,
  haveOverlappingProfileChangeKeys,
  pickProfileChangeValues,
  sanitizeProfileChanges,
  toProfileChangePayload,
} from '@/lib/profile-change-requests';
import { sendProfileDecisionPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ReviewAction = 'approve' | 'reject';

interface ReviewBody {
  requestId?: string;
  action?: ReviewAction;
  rejectReason?: string;
}

interface ReviewerRoleEntry {
  roles?: { name?: string } | { name?: string }[] | null;
}

const PROFILE_MEMBER_SELECT =
  'id, email, phone, birth_date, school_id, department_id, linkedin_url, instagram_url, youtube_url, spotify_url, photo_url';

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

function hasChefRole(roleRows: ReviewerRoleEntry[] | null | undefined) {
  const roleNames = (roleRows ?? []).flatMap((entry) => {
    const roleData = entry.roles;
    if (!roleData) {
      return [];
    }
    if (Array.isArray(roleData)) {
      return roleData.map((role) => role?.name).filter((name): name is string => Boolean(name));
    }
    return roleData.name ? [roleData.name] : [];
  });

  return roleNames.some((roleName) => normalizeRoleName(roleName) === 'sef');
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as ReviewBody;

    const requestId = body.requestId?.trim();
    const action = body.action;
    const rejectReason = body.rejectReason?.trim() || null;

    if (!requestId || (action !== 'approve' && action !== 'reject')) {
      return new NextResponse('Geçersiz istek gövdesi.', { status: 400 });
    }

    if (action === 'reject' && rejectReason && rejectReason.length > 1200) {
      return new NextResponse('Red sebebi çok uzun.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: reviewer, error: reviewerError } = await serviceClient
      .from('choir_members')
      .select('id, first_name, last_name')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (reviewerError) {
      return new NextResponse(reviewerError.message, { status: 500 });
    }

    if (!reviewer) {
      return new NextResponse('Choir member kaydı bulunamadı.', { status: 404 });
    }

    const { data: roleRows, error: roleError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', reviewer.id);

    if (roleError) {
      return new NextResponse(roleError.message, { status: 500 });
    }

    if (!hasChefRole(roleRows as ReviewerRoleEntry[])) {
      return new NextResponse('Bu işlem için Şef yetkisi gerekli.', { status: 403 });
    }

    const { data: existingRequest, error: existingRequestError } = await serviceClient
      .from('profile_change_requests')
      .select('id, member_id, changes_json, status, created_at')
      .eq('id', requestId)
      .maybeSingle();

    if (existingRequestError) {
      return new NextResponse(existingRequestError.message, { status: 500 });
    }

    if (!existingRequest) {
      return new NextResponse('Profil değişiklik talebi bulunamadı.', { status: 404 });
    }

    if (existingRequest.status !== 'pending') {
      return new NextResponse('Talep zaten sonuçlandırılmış.', { status: 409 });
    }

    const sanitizedChanges = sanitizeProfileChanges(existingRequest.changes_json);
    const changeKeys = getProfileChangeKeys(sanitizedChanges);
    if (action === 'approve' && changeKeys.length === 0) {
      return new NextResponse('Onaylanacak geçerli profil alanı bulunamadı.', { status: 400 });
    }

    const { data: olderPendingRequests, error: olderPendingError } = await serviceClient
      .from('profile_change_requests')
      .select('id, changes_json, created_at')
      .eq('member_id', existingRequest.member_id)
      .eq('status', 'pending')
      .lt('created_at', existingRequest.created_at)
      .order('created_at', { ascending: true });

    if (olderPendingError) {
      return new NextResponse(olderPendingError.message, { status: 500 });
    }

    const blockingRequest = (olderPendingRequests ?? []).find((row) =>
      haveOverlappingProfileChangeKeys(sanitizeProfileChanges(row.changes_json), sanitizedChanges),
    );

    if (blockingRequest) {
      return new NextResponse(
        'Bu talep daha eski bekleyen bir profil talebiyle aynı alanı değiştiriyor. Önce önceki talebi onaylayın veya reddedin.',
        { status: 409 },
      );
    }

    const { data: targetMember, error: targetMemberError } = await serviceClient
      .from('choir_members')
      .select(PROFILE_MEMBER_SELECT)
      .eq('id', existingRequest.member_id)
      .maybeSingle();

    if (targetMemberError) {
      return new NextResponse(targetMemberError.message, { status: 500 });
    }

    if (!targetMember) {
      return new NextResponse('Talep sahibi bulunamadı.', { status: 404 });
    }

    const reviewPreviousValues = pickProfileChangeValues(targetMember as Record<string, unknown>, changeKeys);

    const reviewedAt = new Date().toISOString();
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    const { data: updatedRequest, error: requestUpdateError } = await serviceClient
      .from('profile_change_requests')
      .update({
        status: nextStatus,
        previous_values_json: toProfileChangePayload(reviewPreviousValues),
        reviewed_by: reviewer.id,
        reviewed_at: reviewedAt,
        reject_reason: action === 'reject' ? rejectReason : null,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id, member_id, status, reject_reason, reviewed_at, reviewed_by')
      .maybeSingle();

    if (requestUpdateError) {
      return new NextResponse(requestUpdateError.message, { status: 500 });
    }

    if (!updatedRequest) {
      return new NextResponse('Talep zaten sonuçlandırılmış.', { status: 409 });
    }

    if (action === 'approve') {
      const { error: memberUpdateError } = await serviceClient
        .from('choir_members')
        .update(toProfileChangePayload(sanitizedChanges))
        .eq('id', updatedRequest.member_id);

      if (memberUpdateError) {
        await serviceClient
          .from('profile_change_requests')
          .update({
            status: 'pending',
            reviewed_by: null,
            reviewed_at: null,
            reject_reason: null,
          })
          .eq('id', requestId)
          .eq('reviewed_by', reviewer.id);

        return new NextResponse(memberUpdateError.message, { status: 500 });
      }
    }

    try {
      await sendProfileDecisionPush({
        memberId: updatedRequest.member_id,
        status: updatedRequest.status as 'approved' | 'rejected',
        rejectReason: updatedRequest.reject_reason,
        reviewerName: `${reviewer.first_name ?? ''} ${reviewer.last_name ?? ''}`.trim() || null,
      });
    } catch (pushError) {
      console.error('Profile review push send failed:', pushError);
    }

    return NextResponse.json({
      id: updatedRequest.id,
      status: updatedRequest.status,
      rejectReason: updatedRequest.reject_reason,
      reviewedAt: updatedRequest.reviewed_at,
      reviewedBy: updatedRequest.reviewed_by,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
