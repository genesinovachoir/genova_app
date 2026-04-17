'use client';

import { useEffect, useState } from 'react';

import { getProtectedDriveFileUrl } from '@/lib/drive-file-url';
import type { RepertoireFile } from '@/lib/supabase';

export function useProtectedDriveFileUrl(file: Pick<RepertoireFile, 'drive_file_id' | 'file_name' | 'mime_type'> | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driveFileId = file?.drive_file_id;
  const fileName = file?.file_name;
  const mimeType = file?.mime_type;

  useEffect(() => {
    let cancelled = false;

    async function loadUrl() {
      if (!driveFileId) {
        setUrl(null);
        setError(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const nextUrl = await getProtectedDriveFileUrl({
          drive_file_id: driveFileId,
          file_name: fileName ?? '',
          mime_type: mimeType ?? null,
        });
        if (!cancelled) {
          setUrl(nextUrl);
        }
      } catch (loadError) {
        if (!cancelled) {
          setUrl(null);
          setError(loadError instanceof Error ? loadError.message : 'Dosya erişim bağlantısı oluşturulamadı.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUrl();

    return () => {
      cancelled = true;
    };
  }, [driveFileId, fileName, mimeType]);

  return { url, loading, error };
}
