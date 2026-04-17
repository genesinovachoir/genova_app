import { supabase, type RepertoireFile } from '@/lib/supabase';

interface CachedDriveUrl {
  url: string;
  expiresAt: number;
}

const driveUrlCache = new Map<string, CachedDriveUrl>();

function getCacheKey(driveFileId: string, fileName: string | null | undefined, mimeType: string | null | undefined) {
  return `${driveFileId}:${fileName ?? ''}:${mimeType ?? ''}`;
}

export async function getProtectedDriveFileUrl(file: Pick<RepertoireFile, 'drive_file_id' | 'file_name' | 'mime_type'>) {
  if (!file.drive_file_id) {
    return null;
  }

  const cacheKey = getCacheKey(file.drive_file_id, file.file_name, file.mime_type);
  const cached = driveUrlCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 30_000) {
    return cached.url;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
  }

  const response = await fetch('/api/drive-file-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      driveFileId: file.drive_file_id,
      fileName: file.file_name,
      mimeType: file.mime_type,
    }),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || 'Dosya erişim bağlantısı oluşturulamadı.');
  }

  const payload = (await response.json()) as { url: string; expiresAt: number };
  driveUrlCache.set(cacheKey, payload);
  return payload.url;
}
