import type { RepertoireFile } from '@/lib/supabase';

const OFFLINE_SETTINGS_STORAGE_KEY = 'genova.repertoire.offline.v1';
const OFFLINE_DRIVE_ROUTE_PREFIX = '/offline-drive/';
const SERVICE_WORKER_MESSAGE_TIMEOUT_MS = 180_000;
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

interface OfflineSongSettingsRow {
  enabled?: boolean;
  version?: string | null;
  lastSyncedAt?: number | null;
}

type OfflineSongSettingsStore = Record<string, OfflineSongSettingsRow>;

export interface OfflineSongSettings {
  enabled: boolean;
  version: string | null;
  lastSyncedAt: number | null;
}

export interface OfflineSyncFileInput {
  driveFileId: string;
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface OfflineSyncResult {
  ok: true;
  cachedCount: number;
  removedCount: number;
  syncedAt: number;
}

interface ServiceWorkerSuccessResponse<T> {
  ok: true;
  payload: T;
}

interface ServiceWorkerErrorResponse {
  ok: false;
  error?: string;
}

function isBrowserEnvironment() {
  return typeof window !== 'undefined';
}

export function isRepertoireOfflineSupported() {
  if (!isBrowserEnvironment() || IS_DEVELOPMENT) {
    return false;
  }

  return (
    'serviceWorker' in navigator &&
    'caches' in window &&
    'localStorage' in window &&
    typeof navigator.serviceWorker.register === 'function'
  );
}

function readSettingsStore(): OfflineSongSettingsStore {
  if (!isBrowserEnvironment()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(OFFLINE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as OfflineSongSettingsStore;
  } catch {
    return {};
  }
}

function writeSettingsStore(next: OfflineSongSettingsStore) {
  if (!isBrowserEnvironment()) {
    return;
  }

  window.localStorage.setItem(OFFLINE_SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

export function getOfflineSongSettings(songId: string): OfflineSongSettings {
  const store = readSettingsStore();
  const row = store[songId];

  return {
    enabled: Boolean(row?.enabled),
    version: typeof row?.version === 'string' ? row.version : null,
    lastSyncedAt: typeof row?.lastSyncedAt === 'number' ? row.lastSyncedAt : null,
  };
}

export function setOfflineSongEnabled(songId: string, enabled: boolean) {
  const store = readSettingsStore();
  const previous = store[songId] ?? {};
  store[songId] = {
    ...previous,
    enabled,
  };
  writeSettingsStore(store);
}

export function markOfflineSongSynced(songId: string, version: string, syncedAt = Date.now()) {
  const store = readSettingsStore();
  const previous = store[songId] ?? {};

  store[songId] = {
    ...previous,
    enabled: true,
    version,
    lastSyncedAt: syncedAt,
  };

  writeSettingsStore(store);
}

export function clearOfflineSongSyncState(songId: string) {
  const store = readSettingsStore();
  const previous = store[songId] ?? {};

  store[songId] = {
    ...previous,
    enabled: false,
    version: null,
    lastSyncedAt: null,
  };

  writeSettingsStore(store);
}

export function buildOfflineSongVersion(files: Array<Pick<RepertoireFile, 'drive_file_id' | 'updated_at' | 'file_size_bytes' | 'file_name' | 'mime_type'>>) {
  return files
    .filter((file) => Boolean(file.drive_file_id))
    .map((file) => [
      file.drive_file_id,
      file.updated_at ?? '',
      file.file_size_bytes ?? '',
      file.file_name ?? '',
      file.mime_type ?? '',
    ].join('|'))
    .sort((a, b) => a.localeCompare(b))
    .join('||');
}

export function getOfflineDriveFileUrl(file: Pick<RepertoireFile, 'drive_file_id'> | null | undefined) {
  if (!file?.drive_file_id) {
    return null;
  }

  return `${OFFLINE_DRIVE_ROUTE_PREFIX}${encodeURIComponent(file.drive_file_id)}`;
}

async function getMessagingServiceWorker(): Promise<ServiceWorker> {
  if (!isRepertoireOfflineSupported()) {
    throw new Error('Bu cihaz offline repertuvar desteğini sunmuyor.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  const readyRegistration = registration.active ? registration : await navigator.serviceWorker.ready;

  return (
    readyRegistration.active ??
    readyRegistration.waiting ??
    readyRegistration.installing ??
    navigator.serviceWorker.controller ??
    (() => {
      throw new Error('Service worker aktif değil. Sayfayı yenileyip tekrar deneyin.');
    })()
  );
}

async function sendMessageToServiceWorker<T>(message: unknown): Promise<T> {
  const target = await getMessagingServiceWorker();

  return new Promise<T>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      reject(new Error('Offline işlem zaman aşımına uğradı.'));
    }, SERVICE_WORKER_MESSAGE_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<ServiceWorkerSuccessResponse<T> | ServiceWorkerErrorResponse>) => {
      window.clearTimeout(timer);
      const response = event.data;

      if (response?.ok) {
        resolve(response.payload);
        return;
      }

      reject(new Error(response?.error || 'Service worker isteği başarısız oldu.'));
    };

    target.postMessage(message, [channel.port2]);
  });
}

export async function syncSongFilesForOffline(songId: string, files: OfflineSyncFileInput[]) {
  return sendMessageToServiceWorker<OfflineSyncResult>({
    type: 'OFFLINE_CACHE_SONG_FILES',
    payload: {
      songId,
      files,
    },
  });
}

export async function removeOfflineSongFiles(songId: string) {
  return sendMessageToServiceWorker<{ removedCount: number }>({
    type: 'OFFLINE_REMOVE_SONG_FILES',
    payload: {
      songId,
    },
  });
}
