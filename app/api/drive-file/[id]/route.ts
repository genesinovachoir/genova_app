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
    console.error(`[DRIVE_FILE_PROXY] Storage file not found or error for path: ${tokenPayload.storagePath}, bucket: ${tokenPayload.storageBucket}. Error:`, error);
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
  try {
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
      console.error(`[DRIVE_FILE_PROXY] Token verification failed for id: ${id}. tokenPayload:`, tokenPayload);
      return new Response('Unauthorized', { status: 401 });
    }

    console.log(`[DRIVE_FILE_PROXY] Request started for id: ${id}, fileName: ${tokenPayload.fileName}, method: ${request.method}, range: ${request.headers.get('range')}`);

    if (tokenPayload.storageBucket && tokenPayload.storagePath) {
      console.log(`[DRIVE_FILE_PROXY] Proxying from Storage: bucket=${tokenPayload.storageBucket}, path=${tokenPayload.storagePath}`);
      return proxyStorageFile(request.method, tokenPayload);
    }

    const rangeHeader = request.headers.get('range');

    const upstreamUrl = new URL('https://drive.google.com/uc');
    upstreamUrl.searchParams.set('export', 'download');
    upstreamUrl.searchParams.set('id', id);

    console.log(`[DRIVE_FILE_PROXY] Upstream URL: ${upstreamUrl.toString()}`);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch (err: any) {
      console.error(`[DRIVE_FILE_PROXY] Fetch exception for id: ${id}:`, err);
      return new Response(`Drive bağlantı hatası: ${err?.message || 'Unknown error'}`, { status: 502 });
    }

    console.log(`[DRIVE_FILE_PROXY] Upstream response for id: ${id}, status: ${upstream.status}, content-type: ${upstream.headers.get('content-type')}`);

    const upstreamContentType = getSafeHeader(upstream.headers, 'content-type');
    const upstreamContentLength = getSafeHeader(upstream.headers, 'content-length');

    if (upstream.ok && isHtmlContentType(upstreamContentType) && !isHtmlContentType(tokenPayload.mimeType ?? null)) {
      console.error(`[DRIVE_FILE_PROXY] Upstream returned HTML instead of file for id: ${id}. This might be a Google Drive warning/login page.`);
      return new Response('Drive indirilebilir dosya yerine HTML bir sayfa dondurdu.', {
        status: 502,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    if (!upstream.ok) {
      console.error(`[DRIVE_FILE_PROXY] Upstream fetch failed for id: ${id}, status: ${upstream.status}`);
      const errorText = await upstream.text().catch(() => 'No body');
      console.error(`[DRIVE_FILE_PROXY] Upstream error body snippet: ${errorText.slice(0, 500)}`);
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

    console.log(`[DRIVE_FILE_PROXY] Upstream response headers for id: ${id}:`, Object.fromEntries(upstream.headers.entries()));

    // Optimization: For HEAD requests, if we have content-length from upstream, we don't need to download the body.
    if (request.method === 'HEAD' && upstreamContentLength) {
      const totalSize = parseInt(upstreamContentLength, 10);
      const baseHeaders = new Headers({
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalSize),
      });
      if (fileName) {
        baseHeaders.set('Content-Disposition', makeContentDisposition(fileName));
      }

      if (rangeHeader) {
        const range = parseRangeHeader(rangeHeader, totalSize);
        if (range) {
          const { start, end } = range;
          const chunkSize = end - start + 1;
          baseHeaders.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          baseHeaders.set('Content-Length', String(chunkSize));
          return new Response(null, { status: 206, headers: baseHeaders });
        } else {
          baseHeaders.set('Content-Range', `bytes */${totalSize}`);
          return new Response(null, { status: 416, headers: baseHeaders });
        }
      }
      return new Response(null, { status: 200, headers: baseHeaders });
    }

    // Buffer entire response so we can serve byte ranges correctly.
    // Note: For large files, this could be improved by streaming.
    const fullBuffer = await upstream.arrayBuffer();
    const totalSize = fullBuffer.byteLength;
    console.log(`[DRIVE_FILE_PROXY] Buffered file for id: ${id}, size: ${totalSize}, claimed: ${upstreamContentLength}`);

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
        console.warn(`[DRIVE_FILE_PROXY] Range not satisfiable for id: ${id}, rangeHeader: ${rangeHeader}, totalSize: ${totalSize}`);
        // Range Not Satisfiable
        const errorHeaders = new Headers(baseHeaders);
        errorHeaders.set('Content-Range', `bytes */${totalSize}`);
        return new Response(null, { status: 416, headers: errorHeaders });
      }

      const { start, end } = range;
      const chunkSize = end - start + 1;
      console.log(`[DRIVE_FILE_PROXY] Serving range for id: ${id}: ${start}-${end}/${totalSize} (chunkSize: ${chunkSize})`);
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
    console.log(`[DRIVE_FILE_PROXY] Serving full file for id: ${id}, totalSize: ${totalSize}`);
    baseHeaders.set('Content-Length', String(totalSize));
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: baseHeaders });
    }
    return new Response(fullBuffer, { status: 200, headers: baseHeaders });
  } catch (error: any) {
    console.error(`[DRIVE_FILE_PROXY] UNCAUGHT ERROR in proxyDriveFile for id:`, error);
    return new Response(`Server error proxying file: ${error?.message || 'Unknown'}`, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
