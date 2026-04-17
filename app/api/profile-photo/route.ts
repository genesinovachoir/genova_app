import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 dakika
const RATE_LIMIT_MAX_REQUESTS = 8;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type RateLimitEntry = { count: number; resetAt: number };

const globalForRateLimit = globalThis as typeof globalThis & {
  __profilePhotoRateLimit?: Map<string, RateLimitEntry>;
};

const rateLimitStore = globalForRateLimit.__profilePhotoRateLimit ?? new Map<string, RateLimitEntry>();
globalForRateLimit.__profilePhotoRateLimit = rateLimitStore;

function getBearerToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') || 'unknown';
}

function isWebpBuffer(payload: Buffer) {
  if (payload.length < 12) return false;
  return (
    payload.subarray(0, 4).toString('ascii') === 'RIFF' &&
    payload.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isPngBuffer(payload: Buffer) {
  if (payload.length < 8) return false;
  return payload.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpegBuffer(payload: Buffer) {
  if (payload.length < 4) return false;
  return payload[0] === 0xff && payload[1] === 0xd8 && payload[payload.length - 2] === 0xff && payload[payload.length - 1] === 0xd9;
}

function isAllowedImageBuffer(fileType: string, payload: Buffer) {
  if (fileType === 'image/webp') return isWebpBuffer(payload);
  if (fileType === 'image/png') return isPngBuffer(payload);
  if (fileType === 'image/jpeg') return isJpegBuffer(payload);
  return false;
}

function getFileExtension(fileType: string) {
  if (fileType === 'image/png') return 'png';
  if (fileType === 'image/jpeg') return 'jpg';
  return 'webp';
}

export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return new NextResponse('Supabase env eksik', { status: 500 });
    }
    if (!supabaseServiceRoleKey) {
      return new NextResponse('SUPABASE_SERVICE_ROLE_KEY eksik', { status: 500 });
    }

    const token = getBearerToken(req);
    if (!token) return new NextResponse('Unauthorized', { status: 401 });

    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return new NextResponse('Unauthorized', { status: 401 });

    const ip = getClientIp(req);
    const now = Date.now();
    const rlKey = `${authData.user.id}:${ip}`;
    const current = rateLimitStore.get(rlKey);
    if (!current || current.resetAt <= now) {
      rateLimitStore.set(rlKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    } else {
      if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
        const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
        return new NextResponse('Çok fazla yükleme denemesi. Lütfen daha sonra tekrar deneyin.', {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec) },
        });
      }
      current.count += 1;
      rateLimitStore.set(rlKey, current);
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return new NextResponse('file zorunlu', { status: 400 });

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return new NextResponse('Sadece JPG, PNG veya WEBP dosyası yüklenebilir.', { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return new NextResponse(`Dosya ${MAX_FILE_SIZE_MB}MB altında olmalı.`, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const payload = Buffer.from(bytes);
    if (!isAllowedImageBuffer(file.type, payload)) {
      return new NextResponse('Dosya içeriği geçerli bir görsel değil.', { status: 400 });
    }

    const objectPath = `public/${authData.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${getFileExtension(file.type)}`;

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { error: uploadError } = await serviceClient
      .storage
      .from('chorister-profiles')
      .upload(objectPath, payload, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return new NextResponse(uploadError.message, { status: 400 });
    }

    const { data } = serviceClient.storage.from('chorister-profiles').getPublicUrl(objectPath);
    return NextResponse.json({ publicUrl: data.publicUrl, path: objectPath });
  } catch (err: any) {
    return new NextResponse(err?.message || 'Upload failed', { status: 500 });
  }
}
