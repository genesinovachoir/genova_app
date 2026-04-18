import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STORAGE_LINK_PREFIX = 'storage://';

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR');
}

function parseStorageLocation(rawValue: string | null | undefined): { bucket: string; path: string } | null {
  if (!rawValue || !rawValue.startsWith(STORAGE_LINK_PREFIX)) {
    return null;
  }

  const withoutPrefix = rawValue.slice(STORAGE_LINK_PREFIX.length);
  const firstSlashIndex = withoutPrefix.indexOf('/');
  if (firstSlashIndex <= 0 || firstSlashIndex === withoutPrefix.length - 1) {
    return null;
  }

  const bucket = withoutPrefix.slice(0, firstSlashIndex);
  const path = withoutPrefix.slice(firstSlashIndex + 1);
  if (!bucket || !path) {
    return null;
  }
  return { bucket, path };
}

function getRequiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} eksik`);
  }
  return value;
}

async function invokeDriveMigration(payload: Record<string, unknown>, accessToken: string) {
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
    throw new Error(text || `Drive migration başarısız (HTTP ${response.status}).`);
  }
}

export async function POST(request: Request) {
  try {
    const { user, accessToken } = await requireAuthenticatedUser(request);
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

    const { data: roleRows, error: roleError } = await serviceClient
      .from('choir_member_roles')
      .select('roles(name)')
      .eq('member_id', member.id);
    if (roleError) {
      return new NextResponse(roleError.message, { status: 400 });
    }

    const normalizedRoles = new Set(
      (roleRows ?? [])
        .map((entry: { roles?: { name?: string } | { name?: string }[] | null }) => {
          const rawRole = Array.isArray(entry.roles) ? entry.roles[0]?.name : entry.roles?.name;
          return rawRole ? normalizeRoleName(rawRole) : null;
        })
        .filter((value): value is string => Boolean(value)),
    );
    if (!normalizedRoles.has('sef')) {
      return new NextResponse('Bu işlem için Şef yetkisi gerekir.', { status: 403 });
    }

    const { data: submissions, error: submissionsError } = await serviceClient
      .from('assignment_submissions')
      .select('id, assignment_id, drive_download_link, file_name, mime_type, file_size_bytes, submission_note')
      .ilike('drive_download_link', 'storage://%')
      .order('submitted_at', { ascending: true });
    if (submissionsError) {
      return new NextResponse(submissionsError.message, { status: 400 });
    }

    let migratedCount = 0;
    let deletedSourceCount = 0;
    const failed: Array<{ id: string; reason: string }> = [];

    for (const submission of submissions ?? []) {
      const storageLocation = parseStorageLocation(submission.drive_download_link);
      if (!storageLocation) {
        failed.push({ id: submission.id, reason: 'Storage yolu ayrıştırılamadı.' });
        continue;
      }

      try {
        await invokeDriveMigration(
          {
            action: 'migrate_submission_from_storage',
            submission_id: submission.id,
            assignment_id: submission.assignment_id,
            storage_bucket: storageLocation.bucket,
            storage_path: storageLocation.path,
            file_name: submission.file_name,
            mime_type: submission.mime_type,
            file_size_bytes: submission.file_size_bytes,
            submission_note: submission.submission_note ?? null,
          },
          accessToken,
        );
        migratedCount += 1;
      } catch (error) {
        failed.push({
          id: submission.id,
          reason: error instanceof Error ? error.message : 'Edge migration hatası',
        });
        continue;
      }

      const { error: removeError } = await serviceClient.storage.from(storageLocation.bucket).remove([storageLocation.path]);
      if (!removeError) {
        deletedSourceCount += 1;
      }
    }

    return NextResponse.json({
      total: submissions?.length ?? 0,
      migratedCount,
      deletedSourceCount,
      failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migration failed';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
