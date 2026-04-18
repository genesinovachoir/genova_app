/**
 * lib/drive.ts
 * Google Drive Edge Function için frontend helper katmanı.
 * Tüm Drive işlemleri bu dosya üzerinden yapılır.
 */

import { supabase, DriveFolderResult, RepertoireFile, AssignmentSubmission } from './supabase';

// Dosyayı base64 string'e çevir (browser-safe)
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // "data:mime/type;base64,..." kısmını atla
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Edge Function çağrı yardımcısı (JWT otomatik eklenir)
async function getDriveErrorMessage(action: string, error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') {
    return `Drive işlemi başarısız oldu (${action}).`;
  }

  const maybeError = error as { message?: string; name?: string; context?: unknown };
  const context = maybeError.context;

  if (context instanceof Response) {
    let details = '';

    try {
      const raw = await context.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; message?: string };
          details = parsed.error || parsed.message || raw;
        } catch {
          details = raw;
        }
      }
    } catch {
      details = '';
    }

    const suffix = details ? `: ${details}` : '';
    return `Drive function hatasi (${action}, HTTP ${context.status})${suffix}`;
  }

  return maybeError.message || `Drive işlemi başarısız oldu (${action}).`;
}

async function callDrive<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('drive-manager-v2', {
    body: { action, ...payload },
  });
  if (error) {
    throw new Error(await getDriveErrorMessage(action, error));
  }
  return data as T;
}

async function uploadSubmissionViaApi(
  assignmentId: string,
  file: File,
  note?: string,
): Promise<AssignmentSubmission> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Oturum doğrulanamadı. Lütfen tekrar giriş yapın.');
  }

  const formData = new FormData();
  formData.set('assignmentId', assignmentId);
  formData.set('file', file);
  if (note?.trim()) {
    formData.set('note', note.trim());
  }

  const response = await fetch('/api/assignment-submissions/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Ödev teslimi yüklenemedi.');
  }

  const payload = (await response.json()) as { submission?: AssignmentSubmission };
  if (!payload.submission) {
    throw new Error('Teslim yanıtı geçersiz.');
  }

  return payload.submission;
}

// =============================================
// REPERTUVAR FONKSİYONLAR
// =============================================

/**
 * Yeni şarkı için Drive'da klasör oluştur.
 * Dönen folder_id DB'deki repertoire.drive_folder_id'ye kaydedilir.
 */
export async function initSongFolder(songId: string, songTitle: string): Promise<DriveFolderResult> {
  return callDrive<DriveFolderResult>('init_song_folder', {
    song_id: songId,
    song_title: songTitle,
  });
}

/**
 * Şarkıya dosya yükle (PDF, MIDI vb.)
 * @param songId - repertoire.id
 * @param driveFolderId - repertoire.drive_folder_id
 * @param file - Kullanıcının seçtiği dosya
 * @param fileType - 'sheet' | 'midi' | 'audio' | 'other'
 * @param partitionLabel - "Bass 1", "Tenor 1", null (sheet için)
 */
export async function uploadSongFile(
  songId: string,
  driveFolderId: string,
  file: File,
  fileType: 'sheet' | 'midi' | 'audio' | 'other',
  partitionLabel?: string
): Promise<RepertoireFile> {
  const base64 = await fileToBase64(file);
  const res = await callDrive<{ file: RepertoireFile }>('upload_song_file', {
    song_id: songId,
    drive_folder_id: driveFolderId,
    file_name: file.name,
    mime_type: file.type || detectMimeType(file.name),
    file_data_base64: base64,
    file_type: fileType,
    partition_label: partitionLabel ?? null,
  });
  return res.file;
}

/**
 * Şarkı dosyasını sil (sadece Şef)
 */
export async function deleteRepertoireFile(driveFileId: string, repertoireFileId: string): Promise<void> {
  await callDrive('delete_file', {
    drive_file_id: driveFileId,
    repertoire_file_id: repertoireFileId,
  });
}

/**
 * Drive'daki herhangi bir dosya/klasörü sil.
 * Google Drive API tarafında klasörler de "file" olarak silinebildiği için ortak endpoint kullanılır.
 */
export async function deleteDriveObject(driveFileId: string): Promise<void> {
  await callDrive('delete_file', {
    drive_file_id: driveFileId,
  });
}

// =============================================
// ÖDEV FONKSİYONLAR
// =============================================

/**
 * Yeni ödev için Drive'da klasör hiyerarşisi oluştur.
 * Ödevler/CreatorName/AssignmentTitle/
 */
export async function initAssignmentFolder(
  assignmentId: string,
  assignmentTitle: string
): Promise<DriveFolderResult> {
  return callDrive<DriveFolderResult>('init_assignment_folder', {
    assignment_id: assignmentId,
    assignment_title: assignmentTitle,
  });
}

/**
 * Korist ödev teslimi yükle.
 * Drive'da: Ödevler/Creator/Assignment/MemberName/ altına kaydeder.
 */
export async function uploadSubmission(
  assignmentId: string,
  file: File,
  note?: string
): Promise<AssignmentSubmission> {
  return uploadSubmissionViaApi(assignmentId, file, note);
}

// =============================================
// GENEL DOSYA YARDIMCILARI
// =============================================

/**
 * Bir Drive klasörünün içeriğini listele
 */
export async function listDriveFolder(folderId: string) {
  return callDrive<{
    files: { id: string; name: string; mimeType: string; webViewLink: string; webContentLink: string }[]
  }>('list_files', { folder_id: folderId });
}

/**
 * Drive dosya bilgisini getir
 */
export async function getDriveFile(fileId: string) {
  return callDrive<{
    file: { id: string; name: string; webViewLink: string; webContentLink: string; mimeType: string; size: string }
  }>('get_file', { file_id: fileId });
}

/**
 * Dosya boyutunu okunabilir formata çevir
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * MIME type dedüksiyon (dosya adından)
 */
export function detectMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    mid: 'audio/midi',
    midi: 'audio/midi',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

/**
 * Dosya tipine göre ikon sınıfı
 */
export function getFileTypeIcon(fileType: string, mimeType?: string | null): string {
  if (fileType === 'sheet') return 'file-text';
  if (fileType === 'midi' || mimeType?.includes('midi')) return 'music-2';
  if (mimeType?.includes('audio')) return 'mic';
  return 'file';
}

/**
 * İzin verilen dosya uzantıları
 */
export const ALLOWED_SHEET_TYPES = ['.pdf'];
export const ALLOWED_MIDI_TYPES = ['.mid', '.midi'];
export const ALLOWED_AUDIO_TYPES = ['.mp3'];
export const ALLOWED_SUBMISSION_TYPES = [...ALLOWED_MIDI_TYPES, ...ALLOWED_AUDIO_TYPES, '.pdf'];
