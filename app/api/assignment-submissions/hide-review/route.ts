import { NextResponse } from 'next/server';

import { insertAssignmentAuditLog } from '@/lib/server/assignment-audit';
import { getActorMemberWithRoles } from '@/lib/server/reviewer-auth';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HideReviewBody {
  submissionId?: string;
  hidden?: boolean;
}

interface SubmissionRow {
  id: string;
  assignment_id: string;
  member_id: string;
  reviewer_note: string | null;
  reviewer_note_history: unknown;
  is_reviewer_note_hidden: boolean | null;
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
    const body = (await request.json()) as HideReviewBody;

    const submissionId = body.submissionId?.trim();
    const hidden = Boolean(body.hidden);

    if (!submissionId) {
      return new NextResponse('Geçersiz submissionId.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    let actorContext;
    try {
      actorContext = await getActorMemberWithRoles({ serviceClient, authUserId: user.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yetki kontrolü başarısız.';
      const status = message.includes('bulunamadı') ? 404 : 500;
      return new NextResponse(message, { status });
    }

    const { actorMember, isChef } = actorContext;
    if (!isChef) {
      return new NextResponse('Bu işlem için Şef yetkisi gerekli.', { status: 403 });
    }

    const { data: submissionData, error: submissionError } = await serviceClient
      .from('assignment_submissions')
      .select('id, assignment_id, member_id, reviewer_note, reviewer_note_history, is_reviewer_note_hidden')
      .eq('id', submissionId)
      .maybeSingle();

    if (submissionError) {
      return new NextResponse(submissionError.message, { status: 500 });
    }

    const submission = (submissionData ?? null) as SubmissionRow | null;
    if (!submission?.id) {
      return new NextResponse('Teslim bulunamadı.', { status: 404 });
    }

    const currentlyHidden = Boolean(submission.is_reviewer_note_hidden);
    if (currentlyHidden === hidden) {
      return NextResponse.json({
        id: submission.id,
        is_reviewer_note_hidden: currentlyHidden,
        reviewer_note: submission.reviewer_note,
      });
    }

    const { data: privateNoteData, error: privateNoteError } = await serviceClient
      .from('assignment_submission_private_notes')
      .select('reviewer_note, note_history_json, is_hidden, last_hidden_by, last_hidden_at')
      .eq('submission_id', submission.id)
      .maybeSingle();

    if (privateNoteError) {
      return new NextResponse(privateNoteError.message, { status: 500 });
    }

    const privateNote = (privateNoteData ?? null) as PrivateNoteRow | null;
    const nowIso = new Date().toISOString();
    const privateHistory = ensureHistoryArray(privateNote?.note_history_json);
    const publicHistory = ensureHistoryArray(submission.reviewer_note_history);

    const { error: upsertPrivateError } = await serviceClient
      .from('assignment_submission_private_notes')
      .upsert(
        {
          submission_id: submission.id,
          assignment_id: submission.assignment_id,
          member_id: submission.member_id,
          reviewer_note: privateNote?.reviewer_note ?? submission.reviewer_note ?? null,
          note_history_json: [
            ...privateHistory,
            {
              action: hidden ? 'reviewer_note_hidden' : 'reviewer_note_unhidden',
              changed_at: nowIso,
              changed_by: actorMember.id,
            },
          ],
          is_hidden: hidden,
          last_hidden_by: hidden ? actorMember.id : (privateNote?.last_hidden_by ?? null),
          last_hidden_at: hidden ? nowIso : (privateNote?.last_hidden_at ?? null),
          last_updated_by: actorMember.id,
          last_updated_at: nowIso,
        },
        { onConflict: 'submission_id' },
      );

    if (upsertPrivateError) {
      return new NextResponse(upsertPrivateError.message, { status: 500 });
    }

    const restoredReviewerNote = hidden
      ? null
      : (privateNote?.reviewer_note ?? submission.reviewer_note ?? null);

    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update({
        reviewer_note: restoredReviewerNote,
        reviewer_note_history: [
          ...publicHistory,
          {
            action: hidden ? 'reviewer_note_hidden' : 'reviewer_note_unhidden',
            changed_at: nowIso,
            changed_by: actorMember.id,
          },
        ],
        is_reviewer_note_hidden: hidden,
        hidden_by: hidden ? actorMember.id : null,
        hidden_at: hidden ? nowIso : null,
        updated_at: nowIso,
      })
      .eq('id', submission.id)
      .select('id, reviewer_note, is_reviewer_note_hidden, hidden_by, hidden_at, updated_at')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    await insertAssignmentAuditLog(serviceClient, {
      assignmentId: submission.assignment_id,
      submissionId: submission.id,
      memberId: submission.member_id,
      actorMemberId: actorMember.id,
      eventType: hidden ? 'reviewer_note_hidden' : 'reviewer_note_unhidden',
      payload: {
        hidden,
      },
    });

    return NextResponse.json(updatedSubmission);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
