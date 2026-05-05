const ASSIGNMENT_CACHE_PREFIX = 'genova.assignments.v1';

interface AssignmentCacheEnvelope<T> {
  cachedAt: number;
  data: T;
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getAssignmentCacheKey(...parts: Array<string | null | undefined>) {
  return `${ASSIGNMENT_CACHE_PREFIX}:${parts.map((part) => part ?? 'none').join(':')}`;
}

export function readAssignmentCache<T>(key: string): T | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssignmentCacheEnvelope<T>>;
    return typeof parsed.cachedAt === 'number' && 'data' in parsed ? parsed.data as T : null;
  } catch {
    return null;
  }
}

export function writeAssignmentCache<T>(key: string, data: T) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Cache writes are opportunistic; React Query memory cache still works.
  }
}

export function clearAssignmentCaches() {
  if (!canUseLocalStorage()) return;

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(ASSIGNMENT_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}
