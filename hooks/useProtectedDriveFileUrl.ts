'use client';

import { useEffect, useState } from 'react';

import { getProtectedDriveFileUrl } from '@/lib/drive-file-url';
import {
  buildRuntimeDriveFileVersion,
  cacheRuntimeDriveFile,
  getOfflineDriveFileUrl,
  getRuntimeDriveFileCacheStatus,
  isRepertoireRuntimeCacheSupported,
} from '@/lib/repertuvar/offline';
import type { RepertoireFile } from '@/lib/supabase';

type DriveFileUrlInput = Pick<RepertoireFile, 'drive_file_id'> &
  Partial<Pick<RepertoireFile, 'file_name' | 'mime_type' | 'updated_at' | 'file_size_bytes'>>;

export function useProtectedDriveFileUrl(file: DriveFileUrlInput | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [isStaleLocal, setIsStaleLocal] = useState(false);
  const driveFileId = file?.drive_file_id;
  const fileName = file?.file_name;
  const mimeType = file?.mime_type;
  const updatedAt = file?.updated_at;
  const fileSizeBytes = file?.file_size_bytes;

  useEffect(() => {
    let cancelled = false;

    async function loadUrl() {
      if (!driveFileId) {
        setUrl(null);
        setError(null);
        setLoading(false);
        setIsLocal(false);
        setIsStaleLocal(false);
        return;
      }

      const fileDescriptor = {
        drive_file_id: driveFileId,
        file_name: fileName ?? '',
        mime_type: mimeType ?? null,
        updated_at: updatedAt,
        file_size_bytes: fileSizeBytes ?? null,
      };
      const runtimeVersion = buildRuntimeDriveFileVersion(fileDescriptor);
      const localUrl = getOfflineDriveFileUrl(fileDescriptor, runtimeVersion);
      const runtimeSupported = isRepertoireRuntimeCacheSupported();
      const online = typeof navigator === 'undefined' ? true : navigator.onLine;
      let localFallbackUrl: string | null = null;
      let localFallbackStale = false;

      try {
        setLoading(true);
        setError(null);

        if (runtimeSupported && localUrl) {
          try {
            const status = await getRuntimeDriveFileCacheStatus(driveFileId, runtimeVersion);
            if (!cancelled && status.cached) {
              localFallbackUrl = localUrl;
              localFallbackStale = status.stale;
              setUrl(localUrl);
              setIsLocal(true);
              setIsStaleLocal(status.stale);
            }

            if (status.cached && (!status.stale || !online)) {
              return;
            }
          } catch {
            // Runtime cache is opportunistic; token flow remains the source of truth.
          }
        }

        if (!online) {
          if (!cancelled) {
            setUrl(null);
            setIsLocal(false);
            setIsStaleLocal(false);
            setError('Bu dosya local cachete bulunamadı ve internet bağlantısı yok.');
          }
          return;
        }

        const nextUrl = await getProtectedDriveFileUrl({
          drive_file_id: driveFileId,
          file_name: fileName ?? '',
          mime_type: mimeType ?? null,
        });

        if (cancelled) {
          return;
        }

        setUrl(nextUrl);
        setIsLocal(false);
        setIsStaleLocal(false);

        if (runtimeSupported && nextUrl && runtimeVersion) {
          void cacheRuntimeDriveFile({
            driveFileId,
            url: nextUrl,
            version: runtimeVersion,
            fileName: fileName ?? null,
            mimeType: mimeType ?? null,
          }).catch(() => {
            // Runtime cache failures should not block viewing the file.
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          if (localFallbackUrl) {
            setUrl(localFallbackUrl);
            setIsLocal(true);
            setIsStaleLocal(localFallbackStale);
            setError('Güncel dosya alınamadı; son local kopya gösteriliyor.');
          } else {
            setUrl(null);
            setIsLocal(false);
            setIsStaleLocal(false);
            setError(loadError instanceof Error ? loadError.message : 'Dosya erişim bağlantısı oluşturulamadı.');
          }
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
  }, [driveFileId, fileName, mimeType, updatedAt, fileSizeBytes]);

  return { url, loading, error, isLocal, isStaleLocal };
}
