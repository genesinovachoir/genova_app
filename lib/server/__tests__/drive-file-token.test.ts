import { afterEach, describe, expect, it } from 'vitest';

import { createDriveFileToken, verifyDriveFileToken } from '@/lib/server/drive-file-token';

const ORIGINAL_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    return;
  }

  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SECRET;
});

describe('drive file token helpers', () => {
  it('creates and verifies a signed token', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';

    const { token } = createDriveFileToken({
      driveFileId: 'file-123',
      fileName: 'partisyon.pdf',
      mimeType: 'application/pdf',
    });

    expect(verifyDriveFileToken(token)).toMatchObject({
      driveFileId: 'file-123',
      fileName: 'partisyon.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('rejects a tampered token', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';

    const { token } = createDriveFileToken({
      driveFileId: 'file-123',
      fileName: 'partisyon.pdf',
      mimeType: 'application/pdf',
    });

    const [payload, signature] = token.split('.');
    const tampered = `${payload}.${signature?.slice(0, -1)}x`;

    expect(verifyDriveFileToken(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';

    const { token } = createDriveFileToken(
      {
        driveFileId: 'file-123',
        fileName: 'partisyon.pdf',
        mimeType: 'application/pdf',
      },
      -1,
    );

    expect(verifyDriveFileToken(token)).toBeNull();
  });
});
