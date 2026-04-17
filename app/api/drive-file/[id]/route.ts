import { NextRequest } from 'next/server';

import { verifyDriveFileToken } from '@/lib/server/drive-file-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DRIVE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function getSafeHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  return value && value.length > 0 ? value : null;
}

function isHtmlContentType(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
}

function makeContentDisposition(fileName: string) {
  const fallbackName = fileName
    .replace(/["\\\r\n]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_');
  const encodedName = encodeURIComponent(fileName).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

async function proxyDriveFile(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!DRIVE_FILE_ID_PATTERN.test(id)) {
    return new Response('Invalid Drive file id.', { status: 400 });
  }
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const tokenPayload = verifyDriveFileToken(token);
  if (!tokenPayload || tokenPayload.driveFileId !== id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const upstreamUrl = new URL('https://drive.google.com/uc');
  upstreamUrl.searchParams.set('export', 'download');
  upstreamUrl.searchParams.set('id', id);

  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  if (range) {
    requestHeaders.set('range', range);
  }

  const upstream = await fetch(upstreamUrl, {
    headers: requestHeaders,
    redirect: 'follow',
    cache: 'no-store',
  });

  const upstreamContentType = getSafeHeader(upstream.headers, 'content-type');
  if (upstream.ok && isHtmlContentType(upstreamContentType) && !isHtmlContentType(tokenPayload.mimeType ?? null)) {
    return new Response('Drive indirilebilir dosya yerine HTML bir sayfa dondurdu.', {
      status: 502,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const contentType =
    upstreamContentType ||
    tokenPayload.mimeType ||
    'application/octet-stream';
  const fileName = tokenPayload.fileName;

  const responseHeaders = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': getSafeHeader(upstream.headers, 'accept-ranges') || 'bytes',
  });

  const contentLength = getSafeHeader(upstream.headers, 'content-length');
  if (contentLength) {
    responseHeaders.set('Content-Length', contentLength);
  }

  const contentRange = getSafeHeader(upstream.headers, 'content-range');
  if (contentRange) {
    responseHeaders.set('Content-Range', contentRange);
  }

  if (fileName) {
    responseHeaders.set('Content-Disposition', makeContentDisposition(fileName));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return proxyDriveFile(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const response = await proxyDriveFile(request, context);

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
