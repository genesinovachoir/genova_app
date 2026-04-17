import { createSupabaseServiceClient } from '@/lib/server/supabase-auth';

interface MemberContext {
  memberId: string | null;
  isChef: boolean;
  isSectionLeader: boolean;
}

export interface AuthorizedDriveFile {
  driveFileId: string;
  fileName: string | null;
  mimeType: string | null;
  kind: 'repertoire' | 'assignment_submission';
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
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (!member) {
    return { memberId: null, isChef: false, isSectionLeader: false };
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
  };
}

async function authorizeRepertoireFile(driveFileId: string, memberContext: MemberContext): Promise<AuthorizedDriveFile | null> {
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

  const canAccess = Boolean(song && (song.is_visible || memberContext.isChef));
  if (!canAccess) {
    return null;
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
    .select('drive_file_id, file_name, mime_type, member_id')
    .eq('drive_file_id', driveFileId)
    .maybeSingle();

  if (!submission) {
    return null;
  }

  const canAccess = memberContext.isChef || memberContext.isSectionLeader || submission.member_id === memberContext.memberId;
  if (!canAccess) {
    return null;
  }

  return {
    driveFileId,
    fileName: submission.file_name,
    mimeType: submission.mime_type,
    kind: 'assignment_submission',
  };
}

export async function authorizeDriveFileAccess(authUserId: string, driveFileId: string): Promise<AuthorizedDriveFile | null> {
  const memberContext = await loadMemberContext(authUserId);
  if (!memberContext.memberId) {
    return null;
  }

  return (await authorizeRepertoireFile(driveFileId, memberContext)) ?? (await authorizeAssignmentSubmission(driveFileId, memberContext));
}
