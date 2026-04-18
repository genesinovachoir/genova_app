import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';
import type { AssignmentSubmission } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SUBMISSION_SIZE_BYTES = 100 * 1024 * 1024;
const STORAGE_BUCKET = 'assignment-submissions';
const STORAGE_LINK_PREFIX = 'storage://';
const ALLOWED_EXTENSIONS = new Set(['pdf', 'mid', 'midi', 'mp3', 'mp4', 'm4a', 'wav', 'ogg']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'audio/midi',
  'audio/x-midi',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'video/mp4',
]);
const SUBMISSION_SELECT_COLUMNS =
  'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, approved_at, approved_by';

function getSafeFileExtension(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext ?? '';
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[/\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'submission';
}

async function ensureStorageBucketExists() {
  const serviceClient = createSupabaseServiceClient();
  const { data: buckets, error: bucketsError } = await serviceClient.storage.listBuckets();
  if (bucketsError) {
    console.warn('Storage bucket listesi alınamadı:', bucketsError.message);
    return;
  }

  const alreadyExists = (buckets ?? []).some((bucket) => bucket.name === STORAGE_BUCKET);
  if (alreadyExists) {
    return;
  }

  const { error: createError } = await serviceClient.storage.createBucket(STORAGE_BUCKET, { public: false });
  if (createError && !/already exists/i.test(createError.message)) {
    console.warn('Storage bucket oluşturulamadı, devam ediliyor:', createError.message);
  }
}

function getRequiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} eksik`);
  }
  return value;
}

async function invokeDriveUploadFromStorage(payload: Record<string, unknown>, accessToken: string) {
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
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Drive upload başarısız (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as { submission?: AssignmentSubmission };
  if (!data?.submission) {
    throw new Error('Drive upload yanıtı geçersiz.');
  }

  return data.submission;
}

function makeStorageDriveFileId(existingDriveFileId: string | null | undefined) {
  if (existingDriveFileId && /^[a-zA-Z0-9_-]+$/.test(existingDriveFileId)) {
    return existingDriveFileId;
  }
  return `storage_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function persistSubmissionFromStorage(params: {
  serviceClient: ReturnType<typeof createSupabaseServiceClient>;
  assignmentId: string;
  memberId: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  note: string;
}) {
  const {
    serviceClient,
    assignmentId,
    memberId,
    storageBucket,
    storagePath,
    fileName,
    mimeType,
    fileSizeBytes,
    note,
  } = params;

  const { data: existingSubmission, error: existingSubmissionError } = await serviceClient
    .from('assignment_submissions')
    .select('id, drive_file_id')
    .eq('assignment_id', assignmentId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (existingSubmissionError) {
    throw new Error(existingSubmissionError.message);
  }

  const nowIso = new Date().toISOString();
  const payload = {
    drive_file_id: makeStorageDriveFileId(existingSubmission?.drive_file_id ?? null),
    drive_web_view_link: null,
    drive_download_link: `${STORAGE_LINK_PREFIX}${storageBucket}/${storagePath}`,
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    drive_member_folder_id: null,
    submitted_at: nowIso,
    updated_at: nowIso,
    status: 'pending',
    submission_note: note || null,
    reviewer_note: null,
    approved_at: null,
    approved_by: null,
  };

  if (existingSubmission?.id) {
    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update(payload)
      .eq('id', existingSubmission.id)
      .select(SUBMISSION_SELECT_COLUMNS)
      .single();
    if (updateError || !updatedSubmission) {
      throw new Error(updateError?.message || 'Teslim güncellenemedi.');
    }
    return updatedSubmission as AssignmentSubmission;
  }

  const { data: insertedSubmission, error: insertError } = await serviceClient
    .from('assignment_submissions')
    .insert({
      ...payload,
      assignment_id: assignmentId,
      member_id: memberId,
    })
    .select(SUBMISSION_SELECT_COLUMNS)
    .single();
  if (insertError || !insertedSubmission) {
    throw new Error(insertError?.message || 'Teslim kaydedilemedi.');
  }
  return insertedSubmission as AssignmentSubmission;
}

export async function POST(request: Request) {
  let storagePath: string | null = null;
  let shouldCleanupStoragePath = true;

  try {
    const { user, accessToken } = await requireAuthenticatedUser(request);
    const formData = await request.formData();

    const assignmentId = formData.get('assignmentId');
    const noteValue = formData.get('note');
    const file = formData.get('file');

    if (typeof assignmentId !== 'string' || !assignmentId) {
      return new NextResponse('Geçersiz assignmentId.', { status: 400 });
    }

    if (!(file instanceof File)) {
      return new NextResponse('Yüklenecek dosya bulunamadı.', { status: 400 });
    }

    if (file.size <= 0) {
      return new NextResponse('Dosya boş olamaz.', { status: 400 });
    }

    if (file.size > MAX_SUBMISSION_SIZE_BYTES) {
      return new NextResponse('Dosya boyutu 100MB sınırını aşıyor.', { status: 400 });
    }

    const extension = getSafeFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return new NextResponse('Desteklenmeyen dosya uzantısı.', { status: 400 });
    }

    if (file.type && !ALLOWED_MIME_TYPES.has(file.type) && !file.type.startsWith('audio/')) {
      return new NextResponse('Desteklenmeyen dosya türü.', { status: 400 });
    }

    const note = typeof noteValue === 'string' ? noteValue.trim() : '';
    if (note.length > 1200) {
      return new NextResponse('Not 1200 karakterden uzun olamaz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: member, error: memberError } = await serviceClient
      .from('choir_members')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (memberError) {
      return new NextResponse(memberError.message, { status: 400 });
    }
    if (!member?.id) {
      return new NextResponse('Kullanıcı için korist kaydı bulunamadı.', { status: 403 });
    }

    const { data: assignment, error: assignmentError } = await serviceClient
      .from('assignments')
      .select('id')
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError) {
      return new NextResponse(assignmentError.message, { status: 400 });
    }
    if (!assignment?.id) {
      return new NextResponse('Ödev bulunamadı.', { status: 404 });
    }

    const { data: assignmentTarget, error: targetError } = await serviceClient
      .from('assignment_targets')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('member_id', member.id)
      .maybeSingle();
    if (targetError) {
      return new NextResponse(targetError.message, { status: 400 });
    }
    if (!assignmentTarget?.id) {
      return new NextResponse('Bu ödev size atanmamış.', { status: 403 });
    }

    await ensureStorageBucketExists();

    const safeName = sanitizeFileName(file.name);
    storagePath = `${assignmentId}/${member.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';

    const { error: uploadError } = await serviceClient.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadError) {
      return new NextResponse(uploadError.message, { status: 400 });
    }

    let submission: AssignmentSubmission;
    try {
      submission = await invokeDriveUploadFromStorage(
        {
          action: 'upload_submission_from_storage',
          assignment_id: assignmentId,
          storage_bucket: STORAGE_BUCKET,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: mimeType,
          file_size_bytes: file.size,
          submission_note: note || null,
        },
        accessToken,
      );
    } catch (driveUploadError) {
      console.error('Drive upload başarısız, storage fallback devreye alındı:', driveUploadError);
      submission = await persistSubmissionFromStorage({
        serviceClient,
        assignmentId,
        memberId: member.id,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        fileName: file.name,
        mimeType,
        fileSizeBytes: file.size,
        note,
      });
      shouldCleanupStoragePath = false;
    }

    return NextResponse.json({ submission });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  } finally {
    if (storagePath && shouldCleanupStoragePath) {
      try {
        const serviceClient = createSupabaseServiceClient();
        await serviceClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
      } catch (cleanupError) {
        console.error('Geçici storage dosyası silinemedi:', cleanupError);
      }
    }
  }
}
