const OFFLINE_FILE_CACHE = 'genova-offline-repertoire-files-v1';
const OFFLINE_META_CACHE = 'genova-offline-repertoire-meta-v1';
const RUNTIME_FILE_CACHE = 'genova-runtime-drive-files-v1';
const RUNTIME_META_CACHE = 'genova-runtime-drive-meta-v1';
const OFFLINE_FILE_KEY_PREFIX = '/__offline__/repertoire/files/';
const OFFLINE_SONG_KEY_PREFIX = '/__offline__/repertoire/songs/';
const RUNTIME_FILE_KEY_PREFIX = '/__runtime__/drive/files/';
const RUNTIME_FILE_META_KEY_PREFIX = '/__runtime__/drive/meta/';
const OFFLINE_DRIVE_ROUTE_PREFIX = '/offline-drive/';
const DRIVE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const RUNTIME_CACHE_MAX_BYTES = 300 * 1024 * 1024;

function getFileCacheRequest(driveFileId) {
  return new Request(`${self.location.origin}${OFFLINE_FILE_KEY_PREFIX}${encodeURIComponent(driveFileId)}`);
}

function getRuntimeFileCacheRequest(driveFileId) {
  return new Request(`${self.location.origin}${RUNTIME_FILE_KEY_PREFIX}${encodeURIComponent(driveFileId)}`);
}

function getRuntimeFileMetaRequest(driveFileId) {
  return new Request(`${self.location.origin}${RUNTIME_FILE_META_KEY_PREFIX}${encodeURIComponent(driveFileId)}.json`);
}

function getSongManifestRequest(songId) {
  return new Request(`${self.location.origin}${OFFLINE_SONG_KEY_PREFIX}${encodeURIComponent(songId)}.json`);
}

function readBodyJsonSafely(response) {
  if (!response) {
    return null;
  }

  return response.json().catch(() => null);
}

async function readSongManifest(songId) {
  const metaCache = await caches.open(OFFLINE_META_CACHE);
  const response = await metaCache.match(getSongManifestRequest(songId));
  const payload = await readBodyJsonSafely(response);
  if (!payload || !Array.isArray(payload.fileIds)) {
    return null;
  }

  return {
    songId,
    fileIds: payload.fileIds.filter((fileId) => typeof fileId === 'string'),
  };
}

async function writeSongManifest(songId, fileIds) {
  const metaCache = await caches.open(OFFLINE_META_CACHE);
  const payload = {
    songId,
    fileIds,
    syncedAt: Date.now(),
  };

  await metaCache.put(
    getSongManifestRequest(songId),
    new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }),
  );

  return payload.syncedAt;
}

async function removeOfflineSongFiles(songId) {
  const fileCache = await caches.open(OFFLINE_FILE_CACHE);
  const metaCache = await caches.open(OFFLINE_META_CACHE);
  const manifest = await readSongManifest(songId);
  const existingFileIds = manifest?.fileIds ?? [];

  await Promise.all(
    existingFileIds.map((fileId) => fileCache.delete(getFileCacheRequest(fileId))),
  );

  await metaCache.delete(getSongManifestRequest(songId));

  return { removedCount: existingFileIds.length };
}

async function readRuntimeFileMeta(driveFileId) {
  const metaCache = await caches.open(RUNTIME_META_CACHE);
  const response = await metaCache.match(getRuntimeFileMetaRequest(driveFileId));
  const payload = await readBodyJsonSafely(response);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return {
    driveFileId,
    version: typeof payload.version === 'string' ? payload.version : null,
    cachedAt: typeof payload.cachedAt === 'number' ? payload.cachedAt : null,
    sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : null,
    fileName: typeof payload.fileName === 'string' ? payload.fileName : null,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
  };
}

async function writeRuntimeFileMeta(driveFileId, meta) {
  const metaCache = await caches.open(RUNTIME_META_CACHE);
  const payload = {
    driveFileId,
    version: meta.version,
    cachedAt: meta.cachedAt,
    sizeBytes: meta.sizeBytes,
    fileName: meta.fileName ?? null,
    mimeType: meta.mimeType ?? null,
  };

  await metaCache.put(
    getRuntimeFileMetaRequest(driveFileId),
    new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }),
  );
}

function makeRuntimeStatus(meta, expectedVersion, cached) {
  return {
    cached,
    stale: cached && Boolean(expectedVersion) && meta?.version !== expectedVersion,
    version: meta?.version ?? null,
    cachedAt: meta?.cachedAt ?? null,
    sizeBytes: meta?.sizeBytes ?? null,
  };
}

async function getRuntimeDriveFileStatus(payload) {
  const driveFileId = typeof payload?.driveFileId === 'string' ? payload.driveFileId : '';
  const version = typeof payload?.version === 'string' ? payload.version : '';
  if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId)) {
    throw new Error('Geçersiz Drive dosya kimliği.');
  }

  const fileCache = await caches.open(RUNTIME_FILE_CACHE);
  const metaCache = await caches.open(RUNTIME_META_CACHE);
  const cachedResponse = await fileCache.match(getRuntimeFileCacheRequest(driveFileId));
  const meta = await readRuntimeFileMeta(driveFileId);

  if (!cachedResponse) {
    await metaCache.delete(getRuntimeFileMetaRequest(driveFileId));
    return makeRuntimeStatus(null, version, false);
  }

  return makeRuntimeStatus(meta, version, true);
}

async function enforceRuntimeCacheLimit() {
  const fileCache = await caches.open(RUNTIME_FILE_CACHE);
  const metaCache = await caches.open(RUNTIME_META_CACHE);
  const metaRequests = await metaCache.keys();
  const entries = [];

  for (const request of metaRequests) {
    const response = await metaCache.match(request);
    const payload = await readBodyJsonSafely(response);
    const driveFileId = typeof payload?.driveFileId === 'string' ? payload.driveFileId : '';
    if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId)) {
      await metaCache.delete(request);
      continue;
    }

    entries.push({
      driveFileId,
      cachedAt: typeof payload.cachedAt === 'number' ? payload.cachedAt : 0,
      sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : 0,
      request,
    });
  }

  let totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (totalBytes <= RUNTIME_CACHE_MAX_BYTES) {
    return;
  }

  entries.sort((a, b) => a.cachedAt - b.cachedAt);
  for (const entry of entries) {
    if (totalBytes <= RUNTIME_CACHE_MAX_BYTES) {
      break;
    }

    await Promise.all([
      fileCache.delete(getRuntimeFileCacheRequest(entry.driveFileId)),
      metaCache.delete(entry.request),
    ]);
    totalBytes -= entry.sizeBytes;
  }
}

async function cacheRuntimeDriveFile(payload) {
  const driveFileId = typeof payload?.driveFileId === 'string' ? payload.driveFileId : '';
  const url = typeof payload?.url === 'string' ? payload.url : '';
  const version = typeof payload?.version === 'string' ? payload.version : '';
  const fileName = typeof payload?.fileName === 'string' ? payload.fileName : null;
  const mimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : null;

  if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId) || !url || !version) {
    throw new Error('Runtime önbellek için geçersiz dosya bilgisi.');
  }

  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`${fileName || driveFileId} runtime önbelleğe alınamadı (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');

  const fileCache = await caches.open(RUNTIME_FILE_CACHE);
  await fileCache.put(
    getRuntimeFileCacheRequest(driveFileId),
    new Response(buffer, {
      status: 200,
      headers,
    }),
  );

  const meta = {
    version,
    cachedAt: Date.now(),
    sizeBytes: buffer.byteLength,
    fileName,
    mimeType,
  };
  await writeRuntimeFileMeta(driveFileId, meta);
  await enforceRuntimeCacheLimit();

  return makeRuntimeStatus(meta, version, true);
}

async function clearRuntimeDriveFileCache() {
  const fileCache = await caches.open(RUNTIME_FILE_CACHE);
  const keys = await fileCache.keys();
  await Promise.all([
    caches.delete(RUNTIME_FILE_CACHE),
    caches.delete(RUNTIME_META_CACHE),
  ]);

  return { removedCount: keys.length };
}

async function cacheSongFilesForOffline(payload) {
  const songId = typeof payload?.songId === 'string' ? payload.songId : '';
  if (!songId) {
    throw new Error('Geçersiz şarkı kimliği.');
  }

  if (!Array.isArray(payload?.files) || payload.files.length === 0) {
    throw new Error('Önbelleğe alınacak dosya bulunamadı.');
  }

  const dedupedFiles = [];
  const seen = new Set();

  payload.files.forEach((file) => {
    const driveFileId = typeof file?.driveFileId === 'string' ? file.driveFileId : '';
    const url = typeof file?.url === 'string' ? file.url : '';

    if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId) || !url || seen.has(driveFileId)) {
      return;
    }

    seen.add(driveFileId);
    dedupedFiles.push({
      driveFileId,
      url,
      fileName: typeof file?.fileName === 'string' ? file.fileName : null,
    });
  });

  if (dedupedFiles.length === 0) {
    throw new Error('Uygun offline dosyası bulunamadı.');
  }

  const fileCache = await caches.open(OFFLINE_FILE_CACHE);
  const previousManifest = await readSongManifest(songId);
  const nextFileIds = [];

  for (const file of dedupedFiles) {
    const response = await fetch(file.url, {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`${file.fileName || file.driveFileId} indirilemedi (${response.status}).`);
    }

    await fileCache.put(getFileCacheRequest(file.driveFileId), response.clone());
    nextFileIds.push(file.driveFileId);
  }

  const nextSet = new Set(nextFileIds);
  const previousFileIds = previousManifest?.fileIds ?? [];
  const staleFileIds = previousFileIds.filter((fileId) => !nextSet.has(fileId));

  if (staleFileIds.length > 0) {
    await Promise.all(staleFileIds.map((fileId) => fileCache.delete(getFileCacheRequest(fileId))));
  }

  const syncedAt = await writeSongManifest(songId, nextFileIds);

  return {
    ok: true,
    cachedCount: nextFileIds.length,
    removedCount: staleFileIds.length,
    syncedAt,
  };
}

function postMessageToPort(port, payload) {
  if (!port) {
    return;
  }

  port.postMessage(payload);
}

async function handleServiceWorkerMessage(event) {
  const message = event.data;
  const replyPort = event.ports?.[0];

  if (!replyPort || !message || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'OFFLINE_CACHE_SONG_FILES') {
    try {
      const result = await cacheSongFilesForOffline(message.payload);
      postMessageToPort(replyPort, { ok: true, payload: result });
    } catch (error) {
      postMessageToPort(replyPort, {
        ok: false,
        error: error instanceof Error ? error.message : 'Offline önbellek işlemi başarısız oldu.',
      });
    }
    return;
  }

  if (message.type === 'OFFLINE_REMOVE_SONG_FILES') {
    try {
      const songId = typeof message?.payload?.songId === 'string' ? message.payload.songId : '';
      if (!songId) {
        throw new Error('Geçersiz şarkı kimliği.');
      }
      const result = await removeOfflineSongFiles(songId);
      postMessageToPort(replyPort, { ok: true, payload: result });
    } catch (error) {
      postMessageToPort(replyPort, {
        ok: false,
        error: error instanceof Error ? error.message : 'Offline dosyalar kaldırılırken hata oluştu.',
      });
    }
    return;
  }

  if (message.type === 'RUNTIME_GET_DRIVE_FILE_STATUS') {
    try {
      const result = await getRuntimeDriveFileStatus(message.payload);
      postMessageToPort(replyPort, { ok: true, payload: result });
    } catch (error) {
      postMessageToPort(replyPort, {
        ok: false,
        error: error instanceof Error ? error.message : 'Runtime dosya durumu okunamadı.',
      });
    }
    return;
  }

  if (message.type === 'RUNTIME_CACHE_DRIVE_FILE') {
    try {
      const result = await cacheRuntimeDriveFile(message.payload);
      postMessageToPort(replyPort, { ok: true, payload: result });
    } catch (error) {
      postMessageToPort(replyPort, {
        ok: false,
        error: error instanceof Error ? error.message : 'Runtime dosya önbelleği başarısız oldu.',
      });
    }
    return;
  }

  if (message.type === 'RUNTIME_CLEAR_DRIVE_FILE_CACHE') {
    try {
      const result = await clearRuntimeDriveFileCache();
      postMessageToPort(replyPort, { ok: true, payload: result });
    } catch (error) {
      postMessageToPort(replyPort, {
        ok: false,
        error: error instanceof Error ? error.message : 'Runtime dosya önbelleği temizlenemedi.',
      });
    }
  }
}

async function serveOfflineDriveFile(driveFileId, method) {
  if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId)) {
    return new Response('Geçersiz offline dosya kimliği.', { status: 400 });
  }

  const fileCache = await caches.open(OFFLINE_FILE_CACHE);
  const cachedResponse = await fileCache.match(getFileCacheRequest(driveFileId));

  if (cachedResponse) {
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: cachedResponse.headers,
      });
    }

    return cachedResponse;
  }

  const runtimeFileCache = await caches.open(RUNTIME_FILE_CACHE);
  const runtimeCachedResponse = await runtimeFileCache.match(getRuntimeFileCacheRequest(driveFileId));

  if (!runtimeCachedResponse) {
    return new Response('Bu dosya offline önbellekte bulunamadı.', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: runtimeCachedResponse.headers,
    });
  }

  return runtimeCachedResponse;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  event.waitUntil(handleServiceWorkerMessage(event));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (!requestUrl.pathname.startsWith(OFFLINE_DRIVE_ROUTE_PREFIX)) {
    return;
  }

  const encodedId = requestUrl.pathname.slice(OFFLINE_DRIVE_ROUTE_PREFIX.length);
  const driveFileId = decodeURIComponent(encodedId);

  event.respondWith(serveOfflineDriveFile(driveFileId, request.method));
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let data = {};
  try {
    data = event.data.json();
  } catch (error) {
    data = { title: event.data.text() };
  }

  const options = {
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    vibrate: [100, 50, 100],
    data: {
      ...(data.data || {}),
      url: data.url || '/',
      dateOfArrival: Date.now(),
    },
  };

  if (typeof data.body === 'string' && data.body.trim()) {
    options.body = data.body;
  }

  const title = data.title || 'Genova Korist';
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';
  const urlToOpen = new URL(targetUrl, self.location.origin).href;

  const promiseChain = clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((windowClients) => {
      for (const windowClient of windowClients) {
        if (windowClient.url === urlToOpen) {
          return windowClient.focus();
        }
      }

      const sameOriginClient = windowClients.find((windowClient) =>
        windowClient.url.startsWith(self.location.origin),
      );

      if (sameOriginClient) {
        sameOriginClient.navigate(urlToOpen);
        return sameOriginClient.focus();
      }

      return clients.openWindow(urlToOpen);
    });

  event.waitUntil(promiseChain);
});
