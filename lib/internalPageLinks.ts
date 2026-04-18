export interface SlugSource {
  id: string;
  title: string | null;
  created_at?: string | null;
}

export interface SlugEntry<T extends SlugSource = SlugSource> {
  item: T;
  slug: string;
  baseSlug: string;
}

export interface SlugLookup<T extends SlugSource = SlugSource> {
  entries: SlugEntry<T>[];
  slugById: Map<string, string>;
  itemBySlug: Map<string, T>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

function replaceTurkishChars(input: string): string {
  return input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_CHAR_MAP[char] ?? char);
}

export function slugifyPathSegment(value: string | null | undefined, fallback = 'sayfa'): string {
  const normalized = replaceTurkishChars((value ?? '').trim())
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

export function normalizeInternalPath(path: string | null | undefined): string | null {
  const raw = (path ?? '').trim();
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;

  const cleaned = raw
    .replace(/\/{2,}/g, '/')
    .replace(/[?#].*$/g, '')
    .replace(/\/+$/g, '');
  const normalized = cleaned === '' ? '/' : cleaned;

  if (!/^\/[a-z0-9/_-]*$/i.test(normalized)) {
    return null;
  }
  return normalized.toLowerCase();
}

export function isUuidLike(value: string | null | undefined): boolean {
  return UUID_PATTERN.test((value ?? '').trim());
}

export function buildStableSlugEntries<T extends SlugSource>(items: T[], fallback = 'sayfa'): SlugEntry<T>[] {
  const sorted = [...items].sort((a, b) => {
    const titleCompare = (a.title ?? '').localeCompare(b.title ?? '', 'tr', { sensitivity: 'base' });
    if (titleCompare !== 0) return titleCompare;
    const createdCompare = (a.created_at ?? '').localeCompare(b.created_at ?? '');
    if (createdCompare !== 0) return createdCompare;
    return a.id.localeCompare(b.id);
  });

  const counts = new Map<string, number>();

  return sorted.map((item) => {
    const baseSlug = slugifyPathSegment(item.title, fallback);
    const seen = (counts.get(baseSlug) ?? 0) + 1;
    counts.set(baseSlug, seen);

    return {
      item,
      baseSlug,
      slug: seen === 1 ? baseSlug : `${baseSlug}-${seen}`,
    };
  });
}

export function createSlugLookup<T extends SlugSource>(items: T[], fallback = 'sayfa'): SlugLookup<T> {
  const entries = buildStableSlugEntries(items, fallback);
  const slugById = new Map<string, string>();
  const itemBySlug = new Map<string, T>();

  for (const entry of entries) {
    slugById.set(entry.item.id, entry.slug);
    itemBySlug.set(entry.slug, entry.item);
  }

  return {
    entries,
    slugById,
    itemBySlug,
  };
}

export function getRepertoirePath(song: Pick<SlugSource, 'id' | 'title'>, slugById?: Map<string, string>): string {
  const slug = slugById?.get(song.id) ?? slugifyPathSegment(song.title, 'sarki');
  return `/repertuvar/${slug}`;
}

export function getAssignmentPath(assignment: Pick<SlugSource, 'id' | 'title'>, slugById?: Map<string, string>): string {
  const slug = slugById?.get(assignment.id) ?? slugifyPathSegment(assignment.title, 'odev');
  return `/odevler/${slug}`;
}

export function getLastPageLabel(path: string): string {
  const normalized = normalizeInternalPath(path) ?? '/';
  if (normalized === '/') return 'Ana Sayfa';
  const lastSegment = normalized.split('/').filter(Boolean).at(-1) ?? '';
  const withSpaces = lastSegment.replace(/[-_]+/g, ' ');
  return withSpaces
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ');
}
