import { NextResponse } from 'next/server';

import { insertAssignmentAuditLog } from '@/lib/server/assignment-audit';
import { getActorMemberWithRoles } from '@/lib/server/reviewer-auth';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NoteType = 'submission' | 'reviewer';

interface UpdateNoteBody {
  submissionId?: string;
  noteType?: NoteType;
  note?: string | null;
}

interface SubmissionRow {
  id: string;
  assignment_id: string;
  member_id: string;
  submission_note: string | null;
  submission_note_history: unknown;
  reviewer_note: string | null;
  reviewer_audio_drive_file_id: string | null;
  reviewer_audio_file_name: string | null;
  reviewer_audio_mime_type: string | null;
  reviewer_audio_file_size_bytes: number | null;
  reviewer_note_history: unknown;
  is_reviewer_note_hidden: boolean | null;
}

interface PrivateNoteRow {
  reviewer_note: string | null;
  reviewer_audio_drive_file_id: string | null;
  reviewer_audio_file_name: string | null;
  reviewer_audio_mime_type: string | null;
  reviewer_audio_file_size_bytes: number | null;
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
    const body = (await request.json()) as UpdateNoteBody;

    const submissionId = body.submissionId?.trim();
    const noteType = body.noteType;
    const note = body.note?.trim() || null;

    if (!submissionId || (noteType !== 'submission' && noteType !== 'reviewer')) {
      return new NextResponse('Geçersiz istek gövdesi.', { status: 400 });
    }

    if (note && note.length > 1200) {
      return new NextResponse('Not 1200 karakterden uzun olamaz.', { status: 400 });
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

    const { actorMember, isChef, isSectionLeader } = actorContext;

    const { data: submissionData, error: submissionError } = await serviceClient
      .from('assignment_submissions')
      .select('id, assignment_id, member_id, submission_note, submission_note_history, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, reviewer_note_history, is_reviewer_note_hidden')
      .eq('id', submissionId)
      .maybeSingle();

    if (submissionError) {
      return new NextResponse(submissionError.message, { status: 500 });
    }

    const submission = (submissionData ?? null) as SubmissionRow | null;
    if (!submission?.id) {
      return new NextResponse('Teslim bulunamadı.', { status: 404 });
    }

    if (noteType === 'reviewer' && !isChef && !isSectionLeader) {
      return new NextResponse('Bu işlem için Şef veya Partisyon Şefi yetkisi gerekli.', { status: 403 });
    }

    if (noteType === 'submission') {
      const canEditOwn = submission.member_id === actorMember.id;
      let canEditScopedLeader = false;

      if (isSectionLeader && !isChef && actorMember.voice_group) {
        const { data: targetMember, error: targetMemberError } = await serviceClient
          .from('choir_members')
          .select('id, voice_group')
          .eq('id', submission.member_id)
          .maybeSingle();

        if (targetMemberError) {
          return new NextResponse(targetMemberError.message, { status: 500 });
        }

        canEditScopedLeader = Boolean(targetMember?.id && targetMember.voice_group === actorMember.voice_group);
      }

      if (!canEditOwn && !isChef && !canEditScopedLeader) {
        return new NextResponse('Bu teslim notunu düzenleyemezsiniz.', { status: 403 });
      }

      const nowIso = new Date().toISOString();
      const submissionHistory = ensureHistoryArray(submission.submission_note_history);
      const nextSubmissionHistory = [
        ...submissionHistory,
        {
          action: 'submission_note_updated',
          changed_at: nowIso,
          changed_by: actorMember.id,
          previous_note: submission.submission_note,
          next_note: note,
        },
      ];

      const { data: updatedSubmission, error: updateError } = await serviceClient
        .from('assignment_submissions')
        .update({
          submission_note: note,
          submission_note_history: nextSubmissionHistory,
          updated_at: nowIso,
        })
        .eq('id', submission.id)
        .select('id, submission_note, submission_note_history, updated_at')
        .maybeSingle();

      if (updateError) {
        return new NextResponse(updateError.message, { status: 500 });
      }

      await insertAssignmentAuditLog(serviceClient, {
        assignmentId: submission.assignment_id,
        submissionId: submission.id,
        memberId: submission.member_id,
        actorMemberId: actorMember.id,
        eventType: 'submission_note_updated',
        payload: {
          previous_note_length: submission.submission_note?.length ?? 0,
          next_note_length: note?.length ?? 0,
        },
      });

      return NextResponse.json(updatedSubmission);
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

      if (!targetMember?.id || !targetMember.voice_group || targetMember.voice_group !== actorMember.voice_group) {
        return new NextResponse('Sadece kendi partinizdeki teslimleri düzenleyebilirsiniz.', { status: 403 });
      }
    }

    const { data: privateNoteData, error: privateNoteError } = await serviceClient
      .from('assignment_submission_private_notes')
      .select('reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, note_history_json, is_hidden, last_hidden_by, last_hidden_at')
      .eq('submission_id', submission.id)
      .maybeSingle();

    if (privateNoteError) {
      return new NextResponse(privateNoteError.message, { status: 500 });
    }

    const privateNote = (privateNoteData ?? null) as PrivateNoteRow | null;
    const nowIso = new Date().toISOString();
    const reviewerHistory = ensureHistoryArray(submission.reviewer_note_history);
    const nextReviewerHistory = [
      ...reviewerHistory,
      {
        action: 'reviewer_note_updated',
        changed_at: nowIso,
        changed_by: actorMember.id,
        previous_note_length: submission.reviewer_note?.length ?? 0,
        next_note_length: note?.length ?? 0,
      },
    ];

    const previousPrivateNote = privateNote?.reviewer_note ?? submission.reviewer_note ?? null;
    const privateHistory = ensureHistoryArray(privateNote?.note_history_json);
    const nextPrivateHistory = [
      ...privateHistory,
      {
        action: 'reviewer_note_updated',
        changed_at: nowIso,
        changed_by: actorMember.id,
        previous_note: previousPrivateNote,
        next_note: note,
      },
    ];

    const isHidden = Boolean(submission.is_reviewer_note_hidden);

    const { error: privateUpsertError } = await serviceClient
      .from('assignment_submission_private_notes')
      .upsert(
        {
          submission_id: submission.id,
          assignment_id: submission.assignment_id,
          member_id: submission.member_id,
          reviewer_note: note,
          reviewer_audio_drive_file_id:
            privateNote?.reviewer_audio_drive_file_id ?? submission.reviewer_audio_drive_file_id ?? null,
          reviewer_audio_file_name:
            privateNote?.reviewer_audio_file_name ?? submission.reviewer_audio_file_name ?? null,
          reviewer_audio_mime_type:
            privateNote?.reviewer_audio_mime_type ?? submission.reviewer_audio_mime_type ?? null,
          reviewer_audio_file_size_bytes:
            privateNote?.reviewer_audio_file_size_bytes ?? submission.reviewer_audio_file_size_bytes ?? null,
          note_history_json: nextPrivateHistory,
          is_hidden: isHidden,
          last_hidden_by: privateNote?.last_hidden_by ?? null,
          last_hidden_at: privateNote?.last_hidden_at ?? null,
          last_updated_by: actorMember.id,
          last_updated_at: nowIso,
        },
        { onConflict: 'submission_id' },
      );

    if (privateUpsertError) {
      return new NextResponse(privateUpsertError.message, { status: 500 });
    }

    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update({
        reviewer_note: isHidden ? null : note,
        reviewer_note_history: nextReviewerHistory,
        updated_at: nowIso,
      })
      .eq('id', submission.id)
      .select('id, reviewer_note, reviewer_note_history, is_reviewer_note_hidden, hidden_by, hidden_at, updated_at')
      .maybeSingle();

    if (updateError) {
      return new NextResponse(updateError.message, { status: 500 });
    }

    await insertAssignmentAuditLog(serviceClient, {
      assignmentId: submission.assignment_id,
      submissionId: submission.id,
      memberId: submission.member_id,
      actorMemberId: actorMember.id,
      eventType: 'reviewer_note_updated',
      payload: {
        previous_note_length: previousPrivateNote?.length ?? 0,
        next_note_length: note?.length ?? 0,
        hidden: isHidden,
      },
    });

    return NextResponse.json(updatedSubmission);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
