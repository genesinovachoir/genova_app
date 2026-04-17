import crypto from 'node:crypto';

import type { AuthorizedDriveFile } from '@/lib/server/drive-file-access';

interface DriveFileTokenPayload extends AuthorizedDriveFile {
  exp: number;
}

function getSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY eksik');
  }
  return secret;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function createDriveFileToken(file: AuthorizedDriveFile, ttlMs: number = 5 * 60_000) {
  const payload: DriveFileTokenPayload = {
    ...file,
    exp: Date.now() + ttlMs,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url');
  return { token: `${encodedPayload}.${signature}`, expiresAt: payload.exp };
}

export function verifyDriveFileToken(token: string): DriveFileTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = crypto.createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url');
  if (signature.length !== expectedSignature.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as DriveFileTokenPayload;
    if (!payload.driveFileId || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
