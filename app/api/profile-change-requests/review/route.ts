import { NextResponse } from 'next/server';

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

  return roleNames.includes('Şef');
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
      .select('id, member_id, changes_json, status')
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

    if (action === 'approve') {
      const { error: memberUpdateError } = await serviceClient
        .from('choir_members')
        .update(existingRequest.changes_json as Record<string, unknown>)
        .eq('id', existingRequest.member_id);

      if (memberUpdateError) {
        return new NextResponse(memberUpdateError.message, { status: 500 });
      }
    }

    const reviewedAt = new Date().toISOString();
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    const { data: updatedRequest, error: requestUpdateError } = await serviceClient
      .from('profile_change_requests')
      .update({
        status: nextStatus,
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
