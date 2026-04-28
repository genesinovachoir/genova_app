export const PROFILE_CHANGE_KEYS = [
  'email',
  'phone',
  'birth_date',
  'school_id',
  'department_id',
  'linkedin_url',
  'instagram_url',
  'youtube_url',
  'spotify_url',
  'photo_url',
] as const;

export type ProfileChangeKey = (typeof PROFILE_CHANGE_KEYS)[number];
export type ProfileChangeValue = string | null;
export type ProfileChangeMap = Partial<Record<ProfileChangeKey, ProfileChangeValue>>;

const PROFILE_CHANGE_KEY_SET = new Set<string>(PROFILE_CHANGE_KEYS);

export function isProfileChangeKey(key: string): key is ProfileChangeKey {
  return PROFILE_CHANGE_KEY_SET.has(key);
}

export function normalizeProfileChangeValue(value: unknown): ProfileChangeValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeProfileChanges(raw: unknown): ProfileChangeMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: ProfileChangeMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isProfileChangeKey(key)) {
      continue;
    }

    const normalized = normalizeProfileChangeValue(value);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }

  return result;
}

export function getProfileChangeKeys(changes: ProfileChangeMap): ProfileChangeKey[] {
  return PROFILE_CHANGE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(changes, key));
}

export function haveSameProfileChangeKeys(first: ProfileChangeMap, second: ProfileChangeMap) {
  const firstKeys = getProfileChangeKeys(first);
  const secondKeys = getProfileChangeKeys(second);

  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every((key) => secondKeys.includes(key));
}

export function haveOverlappingProfileChangeKeys(first: ProfileChangeMap, second: ProfileChangeMap) {
  const secondKeys = new Set(getProfileChangeKeys(second));
  return getProfileChangeKeys(first).some((key) => secondKeys.has(key));
}

export function pickProfileChangeValues(source: Record<string, unknown>, keys: readonly ProfileChangeKey[]): ProfileChangeMap {
  const result: ProfileChangeMap = {};

  for (const key of keys) {
    const normalized = normalizeProfileChangeValue(source[key]);
    result[key] = normalized === undefined ? null : normalized;
  }

  return result;
}

export function removeUnchangedProfileValues(changes: ProfileChangeMap, currentValues: ProfileChangeMap): ProfileChangeMap {
  const result: ProfileChangeMap = {};

  for (const key of getProfileChangeKeys(changes)) {
    if ((changes[key] ?? null) !== (currentValues[key] ?? null)) {
      result[key] = changes[key] ?? null;
    }
  }

  return result;
}

export function toProfileChangePayload(changes: ProfileChangeMap): Record<string, ProfileChangeValue> {
  return Object.fromEntries(getProfileChangeKeys(changes).map((key) => [key, changes[key] ?? null]));
}
