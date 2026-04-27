import type { RepertoireSong, RepertoireTag } from '@/lib/supabase';

export type RepertoireRoleScope = 'chef' | 'leader' | 'chorist';

export interface RepertoireCatalogData {
  version: number | null;
  versionUpdatedAt: string | null;
  cachedAt: number;
  songs: RepertoireSong[];
  tags: RepertoireTag[];
  userParts: Record<string, string>;
  assignedSongIds: string[];
}

const REPERTOIRE_CATALOG_CACHE_PREFIX = 'genova.repertoire.catalog.v2';
const LEGACY_REPERTOIRE_CACHE_PREFIXES = [
  'genova.repertoire.catalog.v1',
];

function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getRepertoireRoleScope(isChef: boolean, isSectionLeader: boolean): RepertoireRoleScope {
  if (isChef) return 'chef';
  if (isSectionLeader) return 'leader';
  return 'chorist';
}

export function getRepertoireCatalogCacheScope(memberId: string | null | undefined, roleScope: RepertoireRoleScope) {
  return `${memberId ?? 'anonymous'}:${roleScope}`;
}

function getCatalogStorageKey(scope: string) {
  return `${REPERTOIRE_CATALOG_CACHE_PREFIX}:${scope}`;
}

function isCatalogData(value: unknown): value is RepertoireCatalogData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RepertoireCatalogData>;
  return (
    Array.isArray(candidate.songs) &&
    Array.isArray(candidate.tags) &&
    Array.isArray(candidate.assignedSongIds) &&
    typeof candidate.userParts === 'object' &&
    candidate.userParts !== null
  );
}

export function readRepertoireCatalogCache(scope: string): RepertoireCatalogData | null {
  if (!isBrowserEnvironment()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getCatalogStorageKey(scope));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isCatalogData(parsed)) {
      return null;
    }

    return {
      ...parsed,
      version: typeof parsed.version === 'number' ? parsed.version : null,
      versionUpdatedAt: typeof parsed.versionUpdatedAt === 'string' ? parsed.versionUpdatedAt : null,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeRepertoireCatalogCache(scope: string, data: RepertoireCatalogData) {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    window.localStorage.setItem(getCatalogStorageKey(scope), JSON.stringify(data));
  } catch {
    // Storage can be unavailable or full; React Query memory cache still works.
  }
}

export function updateRepertoireCatalogCache(
  scope: string,
  updater: (current: RepertoireCatalogData | null) => RepertoireCatalogData | null,
) {
  const next = updater(readRepertoireCatalogCache(scope));
  if (!next || !isBrowserEnvironment()) {
    return next;
  }

  writeRepertoireCatalogCache(scope, next);
  return next;
}

export function clearRepertoireMetadataCaches() {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    const prefixes = [REPERTOIRE_CATALOG_CACHE_PREFIX, ...LEGACY_REPERTOIRE_CACHE_PREFIXES];
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}
