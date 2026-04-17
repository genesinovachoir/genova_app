'use client';

import type { ImgHTMLAttributes, ReactNode } from 'react';

import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';
import type { RepertoireFile } from '@/lib/supabase';

interface ProtectedDriveImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  file: Pick<RepertoireFile, 'drive_file_id' | 'file_name' | 'mime_type'> | null | undefined;
  fallback?: ReactNode;
}

export function ProtectedDriveImage({ file, fallback = null, alt = '', ...props }: ProtectedDriveImageProps) {
  const { url } = useProtectedDriveFileUrl(file);

  if (!file?.drive_file_id || !url) {
    return <>{fallback}</>;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={url} alt={alt} />;
}
