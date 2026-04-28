import { NextResponse } from 'next/server';

import {
  getProfileChangeKeys,
  haveSameProfileChangeKeys,
  pickProfileChangeValues,
  removeUnchangedProfileValues,
  sanitizeProfileChanges,
  toProfileChangePayload,
} from '@/lib/profile-change-requests';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SubmitBody {
  changes?: unknown;
  note?: unknown;
}

interface PendingRequestRow {
  id: string;
  changes_json: unknown;
}

const PROFILE_MEMBER_SELECT =
  'id, email, phone, birth_date, school_id, department_id, linkedin_url, instagram_url, youtube_url, spotify_url, photo_url';

function sanitizeNote(raw: unknown) {
  if (typeof raw !== 'string') {
    return null;
  }

  const note = raw.trim();
  return note.length > 0 ? note : null;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as SubmitBody;
    const note = sanitizeNote(body.note);

    if (note && note.length > 1200) {
      return new NextResponse('Not çok uzun.', { status: 400 });
    }

    const submittedChanges = sanitizeProfileChanges(body.changes);
    const submittedKeys = getProfileChangeKeys(submittedChanges);

    if (submittedKeys.length === 0) {
      return new NextResponse('Gönderilecek geçerli profil alanı bulunamadı.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();
    const { data: member, error: memberError } = await serviceClient
      .from('choir_members')
      .select(PROFILE_MEMBER_SELECT)
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (memberError) {
      return new NextResponse(memberError.message, { status: 500 });
    }

    if (!member) {
      return new NextResponse('Choir member kaydı bulunamadı.', { status: 404 });
    }

    const currentValues = pickProfileChangeValues(member as Record<string, unknown>, submittedKeys);
    const changes = removeUnchangedProfileValues(submittedChanges, currentValues);
    const changeKeys = getProfileChangeKeys(changes);

    if (changeKeys.length === 0) {
      return NextResponse.json({ mode: 'unchanged' });
    }

    const previousValues = pickProfileChangeValues(member as Record<string, unknown>, changeKeys);
    const normalizedChanges = toProfileChangePayload(changes);
    const normalizedPreviousValues = toProfileChangePayload(previousValues);

    const { data: pendingRows, error: pendingError } = await serviceClient
      .from('profile_change_requests')
      .select('id, changes_json')
      .eq('member_id', member.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (pendingError) {
      return new NextResponse(pendingError.message, { status: 500 });
    }

    const pendingRequests = ((pendingRows ?? []) as PendingRequestRow[]).map((row) => ({
      id: row.id,
      changes: sanitizeProfileChanges(row.changes_json),
    }));
    const matchingRequest = pendingRequests.find((row) => haveSameProfileChangeKeys(row.changes, changes));

    if (matchingRequest) {
      const { data: updatedRequest, error: updateError } = await serviceClient
        .from('profile_change_requests')
        .update({
          changes_json: normalizedChanges,
          previous_values_json: normalizedPreviousValues,
          note,
          reviewed_by: null,
          reviewed_at: null,
          reject_reason: null,
        })
        .eq('id', matchingRequest.id)
        .eq('member_id', member.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (updateError) {
        return new NextResponse(updateError.message, { status: 500 });
      }

      if (!updatedRequest) {
        return new NextResponse('Bekleyen talep artık güncel değil. Lütfen tekrar deneyin.', { status: 409 });
      }

      const duplicateIds = pendingRequests
        .filter((row) => row.id !== matchingRequest.id && haveSameProfileChangeKeys(row.changes, changes))
        .map((row) => row.id);

      if (duplicateIds.length > 0) {
        const { error: deleteError } = await serviceClient
          .from('profile_change_requests')
          .delete()
          .eq('member_id', member.id)
          .eq('status', 'pending')
          .in('id', duplicateIds);

        if (deleteError) {
          console.warn('Duplicate profile change requests could not be removed:', deleteError);
        }
      }

      return NextResponse.json({ id: updatedRequest.id, mode: 'updated' });
    }

    const { data: insertedRequest, error: insertError } = await serviceClient
      .from('profile_change_requests')
      .insert({
        member_id: member.id,
        changes_json: normalizedChanges,
        previous_values_json: normalizedPreviousValues,
        note,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      return new NextResponse(insertError.message, { status: 500 });
    }

    return NextResponse.json({ id: insertedRequest?.id ?? null, mode: 'created' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
