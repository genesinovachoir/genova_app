import { NextRequest } from 'next/server';

import { createSupabaseServiceClient } from '@/lib/server/supabase-auth';
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

async function proxyStorageFile(requestMethod: string, tokenPayload: ReturnType<typeof verifyDriveFileToken>) {
  if (!tokenPayload?.storageBucket || !tokenPayload.storagePath) {
    return new Response('Storage dosya konumu eksik.', { status: 500 });
  }

  const serviceClient = createSupabaseServiceClient();
  const { data, error } = await serviceClient
    .storage
    .from(tokenPayload.storageBucket)
    .download(tokenPayload.storagePath);

  if (error || !data) {
    return new Response('Dosya depolamada bulunamadı.', {
      status: 404,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const responseHeaders = new Headers({
    'Content-Type': data.type || tokenPayload.mimeType || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'none',
  });

  if (tokenPayload.fileName) {
    responseHeaders.set('Content-Disposition', makeContentDisposition(tokenPayload.fileName));
  }

  if (requestMethod === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: responseHeaders,
    });
  }

  return new Response(data.stream(), {
    status: 200,
    headers: responseHeaders,
  });
}

// Parse a single "bytes=start-end" range header value against a known total size.
// Returns null if the header is absent/malformed, or { start, end } (inclusive) otherwise.
function parseRangeHeader(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const rawStart = match[1];
  const rawEnd = match[2];

  let start: number;
  let end: number;

  if (rawStart === '' && rawEnd !== '') {
    // Suffix range: bytes=-500 => last 500 bytes
    const suffix = parseInt(rawEnd, 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = rawStart !== '' ? parseInt(rawStart, 10) : 0;
    end = rawEnd !== '' ? parseInt(rawEnd, 10) : totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return null;
  }

  end = Math.min(end, totalSize - 1);
  return { start, end };
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

  if (tokenPayload.storageBucket && tokenPayload.storagePath) {
    return proxyStorageFile(request.method, tokenPayload);
  }

  const rangeHeader = request.headers.get('range');

  // Fetch the full file from Drive WITHOUT forwarding the Range header.
  // Google Drive's /uc?export=download endpoint ignores Range headers and always
  // responds with 200 + the full body, so we handle byte-range slicing ourselves.
  const upstreamUrl = new URL('https://drive.google.com/uc');
  upstreamUrl.searchParams.set('export', 'download');
  upstreamUrl.searchParams.set('id', id);

  const upstream = await fetch(upstreamUrl, {
    redirect: 'follow',
    cache: 'no-store',
  });

  const upstreamContentType = getSafeHeader(upstream.headers, 'content-type');
  if (upstream.ok && isHtmlContentType(upstreamContentType) && !isHtmlContentType(tokenPayload.mimeType ?? null)) {
    return new Response('Drive indirilebilir dosya yerine HTML bir sayfa dondurdu.', {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  if (!upstream.ok) {
    return new Response('Drive dosyasi alinamadi.', {
      status: upstream.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const contentType =
    upstreamContentType ||
    tokenPayload.mimeType ||
    'application/octet-stream';
  const fileName = tokenPayload.fileName;

  // Buffer entire response so we can serve byte ranges correctly.
  const fullBuffer = await upstream.arrayBuffer();
  const totalSize = fullBuffer.byteLength;

  const baseHeaders = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
  });
  if (fileName) {
    baseHeaders.set('Content-Disposition', makeContentDisposition(fileName));
  }

  // Serve a partial response when the client requested a range.
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, totalSize);
    if (!range) {
      // Range Not Satisfiable
      const errorHeaders = new Headers(baseHeaders);
      errorHeaders.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers: errorHeaders });
    }

    const { start, end } = range;
    const chunkSize = end - start + 1;
    const chunk = fullBuffer.slice(start, end + 1);

    const partialHeaders = new Headers(baseHeaders);
    partialHeaders.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    partialHeaders.set('Content-Length', String(chunkSize));

    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers: partialHeaders });
    }
    return new Response(chunk, { status: 206, headers: partialHeaders });
  }

  // No range requested — return the full file.
  baseHeaders.set('Content-Length', String(totalSize));
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: baseHeaders });
  }
  return new Response(fullBuffer, { status: 200, headers: baseHeaders });
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
