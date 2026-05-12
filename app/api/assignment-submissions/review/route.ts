import { NextResponse } from 'next/server';

import { sendAssignmentReviewPush } from '@/lib/server/push-notifications';
import { insertAssignmentAuditLog } from '@/lib/server/assignment-audit';
import { getActorMemberWithRoles } from '@/lib/server/reviewer-auth';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ReviewStatus = 'approved' | 'rejected' | 'pending';

interface ReviewBody {
  submissionId?: string;
  status?: ReviewStatus;
  reviewerNote?: string | null;
}

interface ExistingSubmissionRow {
  id: string;
  assignment_id: string;
  member_id: string;
  status: string | null;
  reviewer_note: string | null;
  reviewer_note_history: unknown;
  is_reviewer_note_hidden: boolean | null;
  approved_at: string | null;
  approved_by: string | null;
}

interface PrivateNoteRow {
  reviewer_note: string | null;
  note_history_json: unknown;
  is_hidden: boolean;
  last_hidden_by: string | null;
  last_hidden_at: string | null;
}

function ensureHistoryArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as ReviewBody;

    const submissionId = body.submissionId?.trim();
    const status = body.status;
    const hasReviewerNoteKey = Object.prototype.hasOwnProperty.call(body, 'reviewerNote');
    const reviewerNote = hasReviewerNoteKey ? (body.reviewerNote?.trim() || null) : undefined;

    if (!submissionId || (status !== 'approved' && status !== 'rejected' && status !== 'pending')) {
      return new NextResponse('Geçersiz istek gövdesi.', { status: 400 });
    }

    if (typeof reviewerNote === 'string' && reviewerNote.length > 1200) {
      return new NextResponse('Not 1200 karakterden uzun olamaz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    let actorContext;
    try {
      actorContext = await getActorMemberWithRoles({
        serviceClient,
        authUserId: user.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yetki kontrolü başarısız.';
      const statusCode = message.includes('bulunamadı') ? 404 : 500;
      return new NextResponse(message, { status: statusCode });
    }

    const { actorMember, isChef, isSectionLeader } = actorContext;

    if (!isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    const { data: existingSubmission, error: existingSubmissionError } = await serviceClient
      .from('assignment_submissions')
      .select('id, assignment_id, member_id, status, reviewer_note, reviewer_note_history, is_reviewer_note_hidden, approved_at, approved_by')
      .eq('id', submissionId)
      .maybeSingle();

    if (existingSubmissionError) {
      return new NextResponse(existingSubmissionError.message, { status: 500 });
    }

    const submission = (existingSubmission ?? null) as ExistingSubmissionRow | null;

    if (!submission?.id) {
      return new NextResponse('Teslim bulunamadı.', { status: 404 });
    }

    if (!isChef) {
      if (!actorMember.voice_group) {
        return new NextResponse('Partisyon şefi için ses grubu tanımlı değil.', { status: 403 });
      }

      const { data: targetMember, error: targetMemberError } = await serviceClient
        .from('choir_members')
        .select('id, voice_group')
        .eq('id', submission.member_id)
        .maybeSingle();

      if (targetMemberError) {
        return new NextResponse(targetMemberError.message, { status: 500 });
      }

      if (!targetMember?.id) {
        return new NextResponse('Teslim sahibi korist bulunamadı.', { status: 404 });
      }

      if (!targetMember.voice_group || targetMember.voice_group !== actorMember.voice_group) {
        return new NextResponse('Sadece kendi partinizdeki teslimleri değerlendirebilirsiniz.', { status: 403 });
      }
    }

    const previousStatus = submission.status;
    const previousVisibleReviewerNote = submission.reviewer_note;
    const previousHidden = Boolean(submission.is_reviewer_note_hidden);
    const nowIso = new Date().toISOString();

    const { data: privateNoteData, error: privateNoteError } = await serviceClient
      .from('assignment_submission_private_notes')
      .select('reviewer_note, note_history_json, is_hidden, last_hidden_by, last_hidden_at')
      .eq('submission_id', submissionId)
      .maybeSingle();

    if (privateNoteError) {
      return new NextResponse(privateNoteError.message, { status: 500 });
    }

    const privateNoteRow = (privateNoteData ?? null) as PrivateNoteRow | null;

    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: nowIso,
      approved_at: status === 'pending' ? null : nowIso,
      approved_by: status === 'pending' ? null : actorMember.id,
    };

    let nextVisibleReviewerNote: string | null = previousVisibleReviewerNote;

    if (hasReviewerNoteKey) {
      const publicHistory = ensureHistoryArray(submission.reviewer_note_history);
      const nextPublicHistory = [
        ...publicHistory,
        {
          action: 'reviewer_note_updated',
          changed_at: nowIso,
          changed_by: actorMember.id,
          previous_note_length: previousVisibleReviewerNote?.length ?? 0,
          next_note_length: reviewerNote?.length ?? 0,
        },
      ];

      updatePayload.reviewer_note_history = nextPublicHistory;

      if (previousHidden) {
        updatePayload.reviewer_note = null;
        nextVisibleReviewerNote = null;
      } else {
        updatePayload.reviewer_note = reviewerNote ?? null;
        nextVisibleReviewerNote = reviewerNote ?? null;
      }

      const previousPrivateNote = privateNoteRow?.reviewer_note ?? previousVisibleReviewerNote ?? null;
      const privateHistory = ensureHistoryArray(privateNoteRow?.note_history_json);
      const nextPrivateHistory = [
        ...privateHistory,
        {
          action: 'reviewer_note_updated',
          changed_at: nowIso,
          changed_by: actorMember.id,
          previous_note: previousPrivateNote,
          next_note: reviewerNote ?? null,
        },
      ];

      const { error: upsertPrivateError } = await serviceClient
        .from('assignment_submission_private_notes')
        .upsert({
          submission_id: submission.id,
          assignment_id: submission.assignment_id,
          member_id: submission.member_id,
          reviewer_note: reviewerNote ?? null,
          note_history_json: nextPrivateHistory,
          is_hidden: previousHidden,
          last_hidden_by: privateNoteRow?.last_hidden_by ?? null,
          last_hidden_at: privateNoteRow?.last_hidden_at ?? null,
          last_updated_by: actorMember.id,
          last_updated_at: nowIso,
        }, { onConflict: 'submission_id' });

      if (upsertPrivateError) {
        return new NextResponse(upsertPrivateError.message, { status: 500 });
      }
    }

    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update(updatePayload)
      .eq('id', submissionId)
      .select('id, status, reviewer_note, is_reviewer_note_hidden, hidden_by, hidden_at, approved_at, approved_by, updated_at')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    if (!updatedSubmission) {
      return new NextResponse('Değerlendirme uygulanamadı.', { status: 409 });
    }

    await insertAssignmentAuditLog(serviceClient, {
      assignmentId: submission.assignment_id,
      submissionId: submission.id,
      memberId: submission.member_id,
      actorMemberId: actorMember.id,
      eventType: status === 'pending' ? 'submission_review_withdrawn' : 'submission_reviewed',
      payload: {
        previous_status: previousStatus,
        next_status: status,
        reviewer_note_changed: hasReviewerNoteKey,
        previous_hidden: previousHidden,
        next_hidden: Boolean(updatedSubmission.is_reviewer_note_hidden),
      },
    });

    if (status === 'approved' || status === 'rejected') {
      try {
        await sendAssignmentReviewPush({
          memberId: submission.member_id,
          assignmentId: submission.assignment_id,
          status,
          reviewerMessage: nextVisibleReviewerNote,
        });
      } catch (pushError) {
        console.error('Assignment review push send failed:', pushError);
      }
    }

    return NextResponse.json(updatedSubmission);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
