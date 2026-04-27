import {
  normalizeRepertoireSongs,
  RepertoireSong,
  RepertoireSongRow,
  RepertoireTag,
  supabase,
} from '@/lib/supabase';
import {
  getRepertoireCatalogCacheScope,
  readRepertoireCatalogCache,
  type RepertoireCatalogData,
  type RepertoireRoleScope,
  writeRepertoireCatalogCache,
} from '@/lib/repertuvar/cache';

interface RepertoireCacheVersionRow {
  version: number | string;
  updated_at: string | null;
}

export const REPERTOIRE_QUERY_ROOT_KEY = ['repertoire'] as const;
export const REPERTOIRE_CATALOG_QUERY_ROOT_KEY = ['repertoire', 'catalog'] as const;

export function getRepertoireCatalogQueryKey(memberId: string | null | undefined, roleScope: RepertoireRoleScope) {
  return [...REPERTOIRE_CATALOG_QUERY_ROOT_KEY, memberId ?? 'anonymous', roleScope] as const;
}

async function fetchCatalogVersion(): Promise<{ version: number | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from('repertoire_cache_versions')
    .select('version, updated_at')
    .eq('scope', 'catalog')
    .maybeSingle();

  if (error) {
    // Backwards compatible fallback for environments where the migration has not run yet.
    return { version: null, updatedAt: null };
  }

  const row = data as RepertoireCacheVersionRow | null;
  const parsedVersion = typeof row?.version === 'string'
    ? Number(row.version)
    : row?.version;
  return {
    version: typeof parsedVersion === 'number' && Number.isFinite(parsedVersion) ? parsedVersion : null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function fetchRepertoireRows(): Promise<RepertoireSong[]> {
  const { data, error } = await supabase
    .from('repertoire')
    .select(`
      id, title, composer, drive_folder_id, is_visible, created_at,
      repertoire_files (
        id, song_id, file_name, file_type, partition_label, drive_file_id,
        drive_web_view_link, drive_download_link, mime_type, file_size_bytes,
        created_at, updated_at, uploaded_by
      ),
      repertoire_song_tags (
        tag_id,
        repertoire_tags ( id, name, color, created_by, created_at )
      )
    `)
    .order('title');

  if (error) {
    throw new Error(error.message);
  }

  return normalizeRepertoireSongs(data as RepertoireSongRow[] | null)
    .filter((song) => Boolean(song.drive_folder_id));
}

async function fetchRepertoireTags(): Promise<RepertoireTag[]> {
  const { data, error } = await supabase
    .from('repertoire_tags')
    .select('id, name, color, created_by, created_at')
    .order('created_at');

  if (error) {
    return [];
  }

  return (data ?? []) as RepertoireTag[];
}

async function fetchMemberAssignments(memberId: string | null | undefined) {
  if (!memberId) {
    return {
      userParts: {},
      assignedSongIds: [],
    };
  }

  const { data, error } = await supabase
    .from('song_assignments')
    .select('song_id, part_name')
    .eq('member_id', memberId);

  if (error) {
    throw new Error(error.message);
  }

  const userParts = (data ?? []).reduce((acc, row) => {
    if (row.part_name) {
      acc[row.song_id] = row.part_name;
    }
    return acc;
  }, {} as Record<string, string>);

  return {
    userParts,
    assignedSongIds: Array.from(new Set((data ?? []).map((row) => row.song_id))),
  };
}

export async function fetchRepertoireCatalog(
  memberId: string | null | undefined,
  versionInfo?: { version: number | null; updatedAt: string | null },
): Promise<RepertoireCatalogData> {
  const [songs, tags, assignments] = await Promise.all([
    fetchRepertoireRows(),
    fetchRepertoireTags(),
    fetchMemberAssignments(memberId),
  ]);

  return {
    version: versionInfo?.version ?? null,
    versionUpdatedAt: versionInfo?.updatedAt ?? null,
    cachedAt: Date.now(),
    songs,
    tags,
    userParts: assignments.userParts,
    assignedSongIds: assignments.assignedSongIds,
  };
}

export async function loadRepertoireCatalog({
  memberId,
  roleScope,
}: {
  memberId: string | null | undefined;
  roleScope: RepertoireRoleScope;
}): Promise<RepertoireCatalogData> {
  const scope = getRepertoireCatalogCacheScope(memberId, roleScope);
  const cached = readRepertoireCatalogCache(scope);
  const versionInfo = await fetchCatalogVersion();

  if (
    cached &&
    versionInfo.version !== null &&
    cached.version === versionInfo.version
  ) {
    return cached;
  }

  const fresh = await fetchRepertoireCatalog(memberId, versionInfo);
  writeRepertoireCatalogCache(scope, fresh);
  return fresh;
}
