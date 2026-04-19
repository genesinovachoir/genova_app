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

    console.log(`[DRIVE_FILE_TOKEN] Generating token for file ${body.driveFileId}, user ${user.id}`);
    const authorizedFile = await authorizeDriveFileAccess(user.id, body.driveFileId);
    if (!authorizedFile) {
      console.warn(`[DRIVE_FILE_TOKEN] Access denied for file ${body.driveFileId}, user ${user.id}`);
      return new NextResponse('Bu dosyaya erişim yetkiniz yok.', { status: 403 });
    }

    const { token, expiresAt } = createDriveFileToken(authorizedFile, DRIVE_FILE_TOKEN_TTL_MS);
    console.log(`[DRIVE_FILE_TOKEN] Token generated successfully for ${body.driveFileId}`);
    return NextResponse.json({
      url: `/api/drive-file/${encodeURIComponent(authorizedFile.driveFileId)}?token=${encodeURIComponent(token)}`,
      expiresAt,
    });
  } catch (error: any) {
    console.error(`[DRIVE_FILE_TOKEN] Error generating token:`, error);
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
