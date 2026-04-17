import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// Supabase Edge Function helper — JWT otomatik eklenir
export async function callDriveFunction<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('drive-manager-v2', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  return data as T;
}

export type UserRole = 'Şef' | 'Partisyon Şefi' | 'Korist';
export type FileType = 'sheet' | 'midi' | 'audio' | 'other';

export interface ChoirMember {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
  sub_voice_group: string | null;
  auth_user_id: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  photo_url?: string | null;
  birth_date?: string | null;
  join_date?: string | null;
  school_id?: string | null;
  department_id?: string | null;
  favorite_song_id?: string | null;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  spotify_url?: string | null;
  tiktok_url?: string | null;
  x_url?: string | null;
  // Joined/computed from related tables
  school_name?: string | null;
  department_name?: string | null;
  favorite_song_title?: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  description: string;
  icon: string;
  link_url: string | null;
  link_label: string | null;
  image_url: string | null;
  created_by: string;
  created_at: string;
  choir_members?: { first_name: string; last_name: string };
}

export interface Rehearsal {
  id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  title: string;
  location: string;
  notes: string | null;
  collect_attendance: boolean;
  attendance_note: string | null;
  created_by: string | null;
}

export interface Attendance {
  id: string;
  rehearsal_id: string;
  member_id: string;
  status: 'pending' | 'approved' | 'rejected';
  checked_in_at: string;
  approved_by: string | null;
  approved_at: string | null;
  choir_members?: { first_name: string; last_name: string; voice_group: string | null };
}

// =============================================
// Drive entegrasyonu tipleri
// =============================================

export interface RepertoireSong {
  id: string;
  title: string;
  composer: string | null;
  drive_folder_id: string | null;
  is_visible: boolean;
  created_at: string;
  files?: RepertoireFile[];
  tags?: RepertoireTag[];
  assigned?: boolean; // Korist için: bu şarkı kendisine atanmış mı?
}

export interface RepertoireSongRow extends RepertoireSong {
  repertoire_files?: RepertoireFile[];
  repertoire_song_tags?: Array<{
    tag_id: string;
    repertoire_tags?: RepertoireTag | RepertoireTag[] | null;
  }>;
}

export function normalizeRepertoireSong(song: RepertoireSongRow): RepertoireSong {
  const tagsFromJoin = (song.repertoire_song_tags ?? [])
    .map((row) => {
      if (!row.repertoire_tags) {
        return null;
      }
      return Array.isArray(row.repertoire_tags)
        ? row.repertoire_tags[0] ?? null
        : row.repertoire_tags;
    })
    .filter((tag): tag is RepertoireTag => Boolean(tag));

  return {
    ...song,
    files: song.files ?? song.repertoire_files ?? [],
    tags: song.tags ?? tagsFromJoin,
  };
}

export function normalizeRepertoireSongs(songs: RepertoireSongRow[] | null | undefined): RepertoireSong[] {
  return (songs ?? []).map(normalizeRepertoireSong);
}

export interface RepertoireFile {
  id: string;
  song_id: string;
  file_name: string;
  file_type: FileType;
  partition_label: string | null; // 'Bass 1', 'Tenor 1', 'Soprano', 'Tutti', null (sheet için)
  drive_file_id: string;
  drive_web_view_link: string | null;
  drive_download_link: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepertoirePdfAnnotationRow {
  id: string;
  song_id: string;
  repertoire_file_id: string;
  page_number: number;
  layer_type: 'personal' | 'shared_voice_group' | 'shared_all';
  owner_member_id: string | null;
  target_voice_group: string | null;
  annotations_json: unknown;
  schema_version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepertoireSongComment {
  id: string;
  song_id: string;
  content_html: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  choir_members?: { first_name: string; last_name: string; photo_url: string | null } | null;
}

export interface RepertoireTag {
  id: string;
  name: string;
  color: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RepertoireSongTag {
  song_id: string;
  tag_id: string;
}

export interface SongAssignment {
  id: string;
  song_id: string;
  member_id: string;
  assigned_by: string | null;
  assigned_at: string;
  part_name?: string | null;
  choir_members?: { first_name: string; last_name: string; voice_group: string | null };
  repertoire?: { title: string; composer: string | null };
}

export interface Assignment {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  target_voice_group: string | null;
  drive_folder_id: string | null;
  created_by: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  choir_members?: { first_name: string; last_name: string };
  submission?: AssignmentSubmission | null; // Mevcut kullanıcının teslimi
  submission_count?: number; // Şef için toplam teslim sayısı
}

export interface AssignmentSubmission {
  id: string;
  assignment_id: string;
  member_id: string;
  drive_file_id: string;
  drive_web_view_link: string | null;
  drive_download_link: string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  drive_member_folder_id: string | null;
  submitted_at: string;
  updated_at: string;
  choir_members?: { first_name: string; last_name: string; voice_group: string | null };
}

// Drive action payload tipleri
export interface DriveUploadResult {
  file_id: string;
  web_view_link: string;
  download_link: string;
  name: string;
  size: number;
}

export interface DriveFolderResult {
  folder_id: string;
  folder_name: string;
  web_view_link: string;
}
