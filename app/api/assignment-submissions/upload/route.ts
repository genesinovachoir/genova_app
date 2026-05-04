import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { sendAssignmentSubmittedPush } from '@/lib/server/push-notifications';
import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';
import type { AssignmentSubmission } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SUBMISSION_SIZE_MB = 50;
const MAX_SUBMISSION_SIZE_BYTES = MAX_SUBMISSION_SIZE_MB * 1024 * 1024;
const STORAGE_BUCKET = 'assignment-submissions';
const STORAGE_LINK_PREFIX = 'storage://';
const SUBMISSION_SELECT_COLUMNS =
  'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, approved_at, approved_by';
const SUBMISSION_SNAPSHOT_COLUMNS =
  'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, approved_at, approved_by';

interface SubmissionSnapshot {
  id: string;
  assignment_id: string;
  member_id: string;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  drive_download_link: string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  drive_member_folder_id: string | null;
  submitted_at: string;
  updated_at: string | null;
  status: string | null;
  submission_note: string | null;
  reviewer_note: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

interface ExistingSubmissionRef {
  id: string;
  drive_file_id: string | null;
}

interface RoleRow {
  member_id?: string | null;
  roles?: { name?: string } | { name?: string }[] | null;
}

interface ReviewerMemberRow {
  id: string;
  voice_group: string | null;
  is_active: boolean | null;
}

const REVIEWER_ROLE_CHEF = 'sef';
const REVIEWER_ROLE_SECTION_LEADER = 'partisyon sefi';

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

function collectRoleNames(row: RoleRow) {
  const roleData = row.roles;
  if (!roleData) {
    return new Set<string>();
  }

  const roles = Array.isArray(roleData) ? roleData : [roleData];
  return new Set(
    roles
      .map((role) => role?.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => normalizeRoleName(name)),
  );
}

async function getAssignmentSubmissionReviewerMemberIds(params: {
  serviceClient: ReturnType<typeof createSupabaseServiceClient>;
  submitterMemberId: string;
  submitterVoiceGroup: string | null;
}) {
  const { serviceClient, submitterMemberId, submitterVoiceGroup } = params;

  const { data: roleRows, error: roleRowsError } = await serviceClient
    .from('choir_member_roles')
    .select('member_id, roles(name)');
  if (roleRowsError) {
    throw new Error(roleRowsError.message);
  }

  const chefMemberIds = new Set<string>();
  const sectionLeaderMemberIds = new Set<string>();

  for (const row of (roleRows ?? []) as RoleRow[]) {
    if (!row.member_id) {
      continue;
    }
    const roleNames = collectRoleNames(row);
    if (roleNames.has(REVIEWER_ROLE_CHEF)) {
      chefMemberIds.add(row.member_id);
    }
    if (roleNames.has(REVIEWER_ROLE_SECTION_LEADER)) {
      sectionLeaderMemberIds.add(row.member_id);
    }
  }

  const candidateMemberIds = Array.from(new Set([...chefMemberIds, ...sectionLeaderMemberIds]));
  if (candidateMemberIds.length === 0) {
    return [];
  }

  const { data: reviewerMembers, error: reviewerMembersError } = await serviceClient
    .from('choir_members')
    .select('id, voice_group, is_active')
    .in('id', candidateMemberIds);
  if (reviewerMembersError) {
    throw new Error(reviewerMembersError.message);
  }

  const recipientIds = new Set<string>();
  for (const reviewer of (reviewerMembers ?? []) as ReviewerMemberRow[]) {
    if (!reviewer.id || reviewer.id === submitterMemberId || reviewer.is_active === false) {
      continue;
    }
    if (chefMemberIds.has(reviewer.id)) {
      recipientIds.add(reviewer.id);
      continue;
    }
    if (
      submitterVoiceGroup &&
      sectionLeaderMemberIds.has(reviewer.id) &&
      reviewer.voice_group === submitterVoiceGroup
    ) {
      recipientIds.add(reviewer.id);
    }
  }

  return Array.from(recipientIds);
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

async function archiveSubmissionSnapshot(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  snapshot: SubmissionSnapshot | null,
) {
  if (!snapshot?.id) {
    return;
  }

  const { error: archiveError } = await serviceClient
    .from('assignment_submission_history')
    .insert({
      assignment_id: snapshot.assignment_id,
      member_id: snapshot.member_id,
      source_submission_id: snapshot.id,
      drive_file_id: snapshot.drive_file_id,
      drive_web_view_link: snapshot.drive_web_view_link,
      drive_download_link: snapshot.drive_download_link,
      file_name: snapshot.file_name,
      mime_type: snapshot.mime_type,
      file_size_bytes: snapshot.file_size_bytes,
      drive_member_folder_id: snapshot.drive_member_folder_id,
      submitted_at: snapshot.submitted_at,
      updated_at: snapshot.updated_at,
      status: snapshot.status,
      submission_note: snapshot.submission_note,
      reviewer_note: snapshot.reviewer_note,
      approved_at: snapshot.approved_at,
      approved_by: snapshot.approved_by,
      archive_reason: 'resubmitted',
    });
  if (archiveError) {
    throw new Error(archiveError.message);
  }
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
  const existingRef = (existingSubmission ?? null) as ExistingSubmissionRef | null;

  const nowIso = new Date().toISOString();
  const payload = {
    drive_file_id: makeStorageDriveFileId(existingRef?.drive_file_id ?? null),
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

  if (existingRef?.id) {
    const { data: updatedSubmission, error: updateError } = await serviceClient
      .from('assignment_submissions')
      .update(payload)
      .eq('id', existingRef.id)
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
      return new NextResponse(`Dosya boyutu ${MAX_SUBMISSION_SIZE_MB}MB sınırını aşıyor.`, { status: 400 });
    }

    const note = typeof noteValue === 'string' ? noteValue.trim() : '';
    if (note.length > 1200) {
      return new NextResponse('Not 1200 karakterden uzun olamaz.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();

    const { data: member, error: memberError } = await serviceClient
      .from('choir_members')
      .select('id, first_name, last_name, voice_group')
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
      .select('id, title')
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

    const { data: existingSubmissionSnapshotRow, error: existingSnapshotError } = await serviceClient
      .from('assignment_submissions')
      .select(SUBMISSION_SNAPSHOT_COLUMNS)
      .eq('assignment_id', assignmentId)
      .eq('member_id', member.id)
      .maybeSingle();
    if (existingSnapshotError) {
      return new NextResponse(existingSnapshotError.message, { status: 400 });
    }
    const existingSubmissionSnapshot = (existingSubmissionSnapshotRow ?? null) as SubmissionSnapshot | null;

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

    await archiveSubmissionSnapshot(serviceClient, existingSubmissionSnapshot);

    try {
      const targetMemberIds = await getAssignmentSubmissionReviewerMemberIds({
        serviceClient,
        submitterMemberId: member.id,
        submitterVoiceGroup: member.voice_group ?? null,
      });
      await sendAssignmentSubmittedPush({
        assignmentId,
        assignmentTitle: assignment.title,
        submitterName: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim(),
        targetMemberIds,
        isResubmission: Boolean(existingSubmissionSnapshot),
      });
    } catch (pushError) {
      console.error('Assignment submission push send failed:', pushError);
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
