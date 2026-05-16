import { NextResponse } from 'next/server';

import { sendAssignmentReviewPush } from '@/lib/server/push-notifications';
import { insertAssignmentAuditLog } from '@/lib/server/assignment-audit';
import { getActorMemberWithRoles } from '@/lib/server/reviewer-auth';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ReviewStatus = 'approved' | 'rejected' | 'pending';

const MAX_REVIEW_AUDIO_SIZE_MB = 20;
const MAX_REVIEW_AUDIO_SIZE_BYTES = MAX_REVIEW_AUDIO_SIZE_MB * 1024 * 1024;

interface ReviewBody {
  submissionId?: string;
  status?: ReviewStatus;
  reviewerNote?: string | null;
  clearReviewerAudio?: boolean;
}

interface ParsedReviewRequest {
  submissionId: string | null;
  status: ReviewStatus | undefined;
  hasReviewerNoteKey: boolean;
  reviewerNote: string | null | undefined;
  clearReviewerAudio: boolean;
  audioFile: File | null;
}

interface ExistingSubmissionRow {
  id: string;
  assignment_id: string;
  member_id: string;
  status: string | null;
  reviewer_note: string | null;
  reviewer_audio_drive_file_id: string | null;
  reviewer_audio_file_name: string | null;
  reviewer_audio_mime_type: string | null;
  reviewer_audio_file_size_bytes: number | null;
  reviewer_note_history: unknown;
  is_reviewer_note_hidden: boolean | null;
  approved_at: string | null;
  approved_by: string | null;
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

interface ReviewAudioFields {
  reviewer_audio_drive_file_id: string | null;
  reviewer_audio_file_name: string | null;
  reviewer_audio_mime_type: string | null;
  reviewer_audio_file_size_bytes: number | null;
}

interface DriveReviewAudioResponse {
  audio?: {
    drive_file_id?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    file_size_bytes?: number | null;
  };
}

function ensureHistoryArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function getRequiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} eksik`);
  }
  return value;
}

async function parseReviewRequest(request: Request): Promise<ParsedReviewRequest> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const rawSubmissionId = formData.get('submissionId');
    const rawStatus = formData.get('status');
    const rawReviewerNote = formData.get('reviewerNote');
    const rawAudioFile = formData.get('reviewerAudioFile');
    const rawClearReviewerAudio = formData.get('clearReviewerAudio');

    return {
      submissionId: typeof rawSubmissionId === 'string' ? rawSubmissionId.trim() : null,
      status: typeof rawStatus === 'string' ? (rawStatus as ReviewStatus) : undefined,
      hasReviewerNoteKey: formData.has('reviewerNote'),
      reviewerNote: typeof rawReviewerNote === 'string' ? (rawReviewerNote.trim() || null) : undefined,
      clearReviewerAudio: rawClearReviewerAudio === 'true',
      audioFile: rawAudioFile instanceof File ? rawAudioFile : null,
    };
  }

  const body = (await request.json()) as ReviewBody;
  const hasReviewerNoteKey = Object.prototype.hasOwnProperty.call(body, 'reviewerNote');

  return {
    submissionId: body.submissionId?.trim() ?? null,
    status: body.status,
    hasReviewerNoteKey,
    reviewerNote: hasReviewerNoteKey ? (body.reviewerNote?.trim() || null) : undefined,
    clearReviewerAudio: Boolean(body.clearReviewerAudio),
    audioFile: null,
  };
}

async function fileToBase64(file: File) {
  return Buffer.from(await file.arrayBuffer()).toString('base64');
}

async function uploadReviewAudioFile(params: {
  accessToken: string;
  submissionId: string;
  file: File;
}): Promise<ReviewAudioFields> {
  const { accessToken, submissionId, file } = params;
  if (!file.type.startsWith('audio/')) {
    throw new Error('Yalnızca ses dosyası yükleyebilirsiniz.');
  }
  if (file.size <= 0) {
    throw new Error('Ses dosyası boş olamaz.');
  }
  if (file.size > MAX_REVIEW_AUDIO_SIZE_BYTES) {
    throw new Error(`Ses dosyası ${MAX_REVIEW_AUDIO_SIZE_MB}MB sınırını aşıyor.`);
  }

  const projectUrl = getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const endpoint = `${projectUrl.replace(/\/$/, '')}/functions/v1/drive-manager-v2`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: 'upload_assignment_review_audio',
      submission_id: submissionId,
      audio_file_name: file.name,
      audio_mime_type: file.type || 'audio/webm',
      audio_data_base64: await fileToBase64(file),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Ses dosyası Drive'a yüklenemedi (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as DriveReviewAudioResponse;
  if (!payload.audio?.drive_file_id || !payload.audio.file_name) {
    throw new Error('Ses yükleme yanıtı geçersiz.');
  }

  return {
    reviewer_audio_drive_file_id: payload.audio.drive_file_id,
    reviewer_audio_file_name: payload.audio.file_name,
    reviewer_audio_mime_type: payload.audio.mime_type ?? file.type ?? null,
    reviewer_audio_file_size_bytes: payload.audio.file_size_bytes ?? file.size,
  };
}

function audioFieldsFromRow(row: {
  reviewer_audio_drive_file_id?: string | null;
  reviewer_audio_file_name?: string | null;
  reviewer_audio_mime_type?: string | null;
  reviewer_audio_file_size_bytes?: number | null;
} | null | undefined): ReviewAudioFields {
  return {
    reviewer_audio_drive_file_id: row?.reviewer_audio_drive_file_id ?? null,
    reviewer_audio_file_name: row?.reviewer_audio_file_name ?? null,
    reviewer_audio_mime_type: row?.reviewer_audio_mime_type ?? null,
    reviewer_audio_file_size_bytes: row?.reviewer_audio_file_size_bytes ?? null,
  };
}

export async function POST(request: Request) {
  try {
    const { user, accessToken } = await requireAuthenticatedUser(request);
    const {
      submissionId,
      status,
      hasReviewerNoteKey,
      reviewerNote,
      clearReviewerAudio,
      audioFile,
    } = await parseReviewRequest(request);

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
      .select('id, assignment_id, member_id, status, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, reviewer_note_history, is_reviewer_note_hidden, approved_at, approved_by')
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
    const previousVisibleReviewerAudio = audioFieldsFromRow(submission);
    const previousHidden = Boolean(submission.is_reviewer_note_hidden);
    const nowIso = new Date().toISOString();

    const { data: privateNoteData, error: privateNoteError } = await serviceClient
      .from('assignment_submission_private_notes')
      .select('reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, note_history_json, is_hidden, last_hidden_by, last_hidden_at')
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
    let nextVisibleReviewerAudio = previousVisibleReviewerAudio;
    const hasAudioFile = Boolean(audioFile && audioFile.size > 0);
    const shouldClearReviewerAudio = clearReviewerAudio || status === 'pending';
    const nextReviewerAudio = hasAudioFile
      ? await uploadReviewAudioFile({ accessToken, submissionId, file: audioFile as File })
      : shouldClearReviewerAudio
        ? {
            reviewer_audio_drive_file_id: null,
            reviewer_audio_file_name: null,
            reviewer_audio_mime_type: null,
            reviewer_audio_file_size_bytes: null,
          }
        : undefined;

    if (hasReviewerNoteKey || nextReviewerAudio !== undefined) {
      const publicHistory = ensureHistoryArray(submission.reviewer_note_history);
      const nextPublicHistory = [
        ...publicHistory,
        {
          action: 'reviewer_note_updated',
          changed_at: nowIso,
          changed_by: actorMember.id,
          previous_note_length: previousVisibleReviewerNote?.length ?? 0,
          next_note_length: reviewerNote?.length ?? 0,
          audio_changed: nextReviewerAudio !== undefined,
        },
      ];

      updatePayload.reviewer_note_history = nextPublicHistory;

      const previousPrivateNote = privateNoteRow?.reviewer_note ?? previousVisibleReviewerNote ?? null;
      const nextPrivateNote = hasReviewerNoteKey ? (reviewerNote ?? null) : previousPrivateNote;

      if (hasReviewerNoteKey) {
        if (previousHidden) {
          updatePayload.reviewer_note = null;
          nextVisibleReviewerNote = null;
        } else {
          updatePayload.reviewer_note = nextPrivateNote;
          nextVisibleReviewerNote = nextPrivateNote;
        }
      }

      if (nextReviewerAudio !== undefined) {
        if (previousHidden) {
          updatePayload.reviewer_audio_drive_file_id = null;
          updatePayload.reviewer_audio_file_name = null;
          updatePayload.reviewer_audio_mime_type = null;
          updatePayload.reviewer_audio_file_size_bytes = null;
          nextVisibleReviewerAudio = {
            reviewer_audio_drive_file_id: null,
            reviewer_audio_file_name: null,
            reviewer_audio_mime_type: null,
            reviewer_audio_file_size_bytes: null,
          };
        } else {
          Object.assign(updatePayload, nextReviewerAudio);
          nextVisibleReviewerAudio = nextReviewerAudio;
        }
      }

      const previousPrivateAudio = privateNoteRow?.reviewer_audio_drive_file_id
        ? audioFieldsFromRow(privateNoteRow)
        : previousVisibleReviewerAudio;
      const nextPrivateAudio = nextReviewerAudio ?? previousPrivateAudio;
      const privateHistory = ensureHistoryArray(privateNoteRow?.note_history_json);
      const nextPrivateHistory = [
        ...privateHistory,
        {
          action: 'reviewer_note_updated',
          changed_at: nowIso,
          changed_by: actorMember.id,
          previous_note: previousPrivateNote,
          next_note: nextPrivateNote,
          previous_audio_drive_file_id: previousPrivateAudio.reviewer_audio_drive_file_id,
          next_audio_drive_file_id: nextPrivateAudio.reviewer_audio_drive_file_id,
        },
      ];

      const { error: upsertPrivateError } = await serviceClient
        .from('assignment_submission_private_notes')
        .upsert({
          submission_id: submission.id,
          assignment_id: submission.assignment_id,
          member_id: submission.member_id,
          reviewer_note: nextPrivateNote,
          ...nextPrivateAudio,
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
      .select('id, status, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, is_reviewer_note_hidden, hidden_by, hidden_at, approved_at, approved_by, updated_at')
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
        reviewer_audio_changed: nextReviewerAudio !== undefined,
        previous_hidden: previousHidden,
        next_hidden: Boolean(updatedSubmission.is_reviewer_note_hidden),
        next_audio_drive_file_id: nextVisibleReviewerAudio.reviewer_audio_drive_file_id,
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
