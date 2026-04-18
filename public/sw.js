const OFFLINE_FILE_CACHE = 'genova-offline-repertoire-files-v1';
const OFFLINE_META_CACHE = 'genova-offline-repertoire-meta-v1';
const OFFLINE_FILE_KEY_PREFIX = '/__offline__/repertoire/files/';
const OFFLINE_SONG_KEY_PREFIX = '/__offline__/repertoire/songs/';
const OFFLINE_DRIVE_ROUTE_PREFIX = '/offline-drive/';
const DRIVE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function getFileCacheRequest(driveFileId) {
  return new Request(`${self.location.origin}${OFFLINE_FILE_KEY_PREFIX}${encodeURIComponent(driveFileId)}`);
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
  }
}

async function serveOfflineDriveFile(driveFileId, method) {
  if (!driveFileId || !DRIVE_FILE_ID_PATTERN.test(driveFileId)) {
    return new Response('Geçersiz offline dosya kimliği.', { status: 400 });
  }

  const fileCache = await caches.open(OFFLINE_FILE_CACHE);
  const cachedResponse = await fileCache.match(getFileCacheRequest(driveFileId));

  if (!cachedResponse) {
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
      headers: cachedResponse.headers,
    });
  }

  return cachedResponse;
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
    body: data.body || 'Yeni bir bildiriminiz var.',
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    vibrate: [100, 50, 100],
    data: {
      ...(data.data || {}),
      url: data.url || '/',
      dateOfArrival: Date.now(),
    },
  };

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
