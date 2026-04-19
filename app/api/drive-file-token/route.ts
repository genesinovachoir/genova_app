import { NextResponse } from 'next/server';

import { authorizeDriveFileAccess } from '@/lib/server/drive-file-access';
import { createDriveFileToken } from '@/lib/server/drive-file-token';
import { requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DRIVE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DRIVE_FILE_TOKEN_TTL_MS = 60 * 60_000;

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as { driveFileId?: string };

    if (!body.driveFileId || !DRIVE_FILE_ID_PATTERN.test(body.driveFileId)) {
      return new NextResponse('Geçersiz Drive dosya kimliği.', { status: 400 });
    }

    const authorizedFile = await authorizeDriveFileAccess(user.id, body.driveFileId);
    if (!authorizedFile) {
      return new NextResponse('Bu dosyaya erişim yetkiniz yok.', { status: 403 });
    }

    const { token, expiresAt } = createDriveFileToken(authorizedFile, DRIVE_FILE_TOKEN_TTL_MS);
    return NextResponse.json({
      url: `/api/drive-file/${encodeURIComponent(authorizedFile.driveFileId)}?token=${encodeURIComponent(token)}`,
      expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
