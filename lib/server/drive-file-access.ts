import { createSupabaseServiceClient } from '@/lib/server/supabase-auth';

interface MemberContext {
  memberId: string | null;
  isChef: boolean;
  isSectionLeader: boolean;
  voiceGroup: string | null;
}

export interface AuthorizedDriveFile {
  driveFileId: string;
  fileName: string | null;
  mimeType: string | null;
  kind: 'repertoire' | 'repertoire_comment_audio' | 'assignment_submission';
  storageBucket?: string | null;
  storagePath?: string | null;
}

const STORAGE_LINK_PREFIX = 'storage://';

function parseStorageLocation(rawValue: string | null | undefined): { bucket: string; path: string } | null {
  if (!rawValue || !rawValue.startsWith(STORAGE_LINK_PREFIX)) {
    return null;
  }

  const withoutPrefix = rawValue.slice(STORAGE_LINK_PREFIX.length);
  const firstSlashIndex = withoutPrefix.indexOf('/');
  if (firstSlashIndex <= 0 || firstSlashIndex === withoutPrefix.length - 1) {
    return null;
  }

  const bucket = withoutPrefix.slice(0, firstSlashIndex);
  const path = withoutPrefix.slice(firstSlashIndex + 1);

  if (!bucket || !path) {
    return null;
  }

  return { bucket, path };
}

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR');
}

async function loadMemberContext(authUserId: string): Promise<MemberContext> {
  const serviceClient = createSupabaseServiceClient();
  const { data: member } = await serviceClient
    .from('choir_members')
    .select('id, voice_group')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (!member) {
    return { memberId: null, isChef: false, isSectionLeader: false, voiceGroup: null };
  }

  const { data: roles } = await serviceClient
    .from('choir_member_roles')
    .select('roles(name)')
    .eq('member_id', member.id);

  const normalizedRoles = new Set(
    (roles ?? [])
      .map((entry: { roles?: { name?: string } | { name?: string }[] | null }) => {
        const rawRole = Array.isArray(entry.roles) ? entry.roles[0]?.name : entry.roles?.name;
        return rawRole ? normalizeRoleName(rawRole) : null;
      })
      .filter((value): value is string => Boolean(value)),
  );

  return {
    memberId: member.id,
    isChef: normalizedRoles.has('sef'),
    isSectionLeader: normalizedRoles.has('partisyon sefi') || normalizedRoles.has('sef'),
    voiceGroup: (member as { voice_group?: string | null }).voice_group ?? null,
  };
}

async function authorizeRepertoireFile(driveFileId: string, memberContext: MemberContext): Promise<AuthorizedDriveFile | null> {
  if (!memberContext.memberId) {
    return null;
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: repertoireFile } = await serviceClient
    .from('repertoire_files')
    .select('drive_file_id, file_name, mime_type, song_id')
    .eq('drive_file_id', driveFileId)
    .maybeSingle();

  if (!repertoireFile) {
    return null;
  }

  const { data: song } = await serviceClient
    .from('repertoire')
    .select('is_visible')
    .eq('id', repertoireFile.song_id)
    .maybeSingle();

  if (!song) {
    return null;
  }

  const isPrivilegedMember = memberContext.isChef || memberContext.isSectionLeader;
  if (!song.is_visible && !isPrivilegedMember) {
    return null;
  }

  if (!isPrivilegedMember) {
    const { data: assignment } = await serviceClient
      .from('song_assignments')
      .select('song_id')
      .eq('song_id', repertoireFile.song_id)
      .eq('member_id', memberContext.memberId)
      .limit(1)
      .maybeSingle();

    if (!assignment) {
      return null;
    }
  }

  return {
    driveFileId,
    fileName: repertoireFile.file_name,
    mimeType: repertoireFile.mime_type,
    kind: 'repertoire',
  };
}

async function authorizeAssignmentSubmission(driveFileId: string, memberContext: MemberContext): Promise<AuthorizedDriveFile | null> {
  if (!memberContext.memberId) {
    return null;
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: submission } = await serviceClient
    .from('assignment_submissions')
    .select('drive_file_id, file_name, mime_type, member_id, drive_download_link')
    .eq('drive_file_id', driveFileId)
    .maybeSingle();

  if (!submission) {
    return null;
  }

  let canAccess = memberContext.isChef || submission.member_id === memberContext.memberId;
  if (!canAccess && memberContext.isSectionLeader && memberContext.voiceGroup) {
    const { data: targetMember } = await serviceClient
      .from('choir_members')
      .select('voice_group')
      .eq('id', submission.member_id)
      .maybeSingle();
    canAccess = Boolean(targetMember?.voice_group && targetMember.voice_group === memberContext.voiceGroup);
  }
  if (!canAccess) {
    return null;
  }

  const storageLocation = parseStorageLocation(submission.drive_download_link);

  return {
    driveFileId,
    fileName: submission.file_name,
    mimeType: submission.mime_type,
    kind: 'assignment_submission',
    storageBucket: storageLocation?.bucket ?? null,
    storagePath: storageLocation?.path ?? null,
  };
}

async function authorizeRepertoireCommentAudio(
  driveFileId: string,
  memberContext: MemberContext,
): Promise<AuthorizedDriveFile | null> {
  if (!memberContext.memberId) {
    return null;
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: comment } = await serviceClient
    .from('repertoire_song_comments')
    .select('audio_drive_file_id, audio_file_name, audio_mime_type, target_voice_group')
    .eq('audio_drive_file_id', driveFileId)
    .maybeSingle();

  if (!comment?.audio_drive_file_id) {
    return null;
  }

  const canAccess =
    memberContext.isChef ||
    comment.target_voice_group === null ||
    (Boolean(memberContext.voiceGroup) && comment.target_voice_group === memberContext.voiceGroup);
  if (!canAccess) {
    return null;
  }

  return {
    driveFileId,
    fileName: comment.audio_file_name ?? null,
    mimeType: comment.audio_mime_type ?? null,
    kind: 'repertoire_comment_audio',
  };
}

export async function authorizeDriveFileAccess(authUserId: string, driveFileId: string): Promise<AuthorizedDriveFile | null> {
  const memberContext = await loadMemberContext(authUserId);
  if (!memberContext.memberId) {
    return null;
  }

  return (
    (await authorizeRepertoireFile(driveFileId, memberContext)) ??
    (await authorizeRepertoireCommentAudio(driveFileId, memberContext)) ??
    (await authorizeAssignmentSubmission(driveFileId, memberContext))
  );
}
