import { supabase } from '@/lib/supabase';
import { uploadChatImage } from '@/lib/drive';

// =============================================
// Type Definitions
// =============================================

export type ChatRoomType = 'general' | 'voice_group' | 'custom' | 'dm';
export type ChatMessageType = 'text' | 'image' | 'sticker' | 'poll' | 'system' | 'file';
export type ChatRoomMemberRole = 'admin' | 'member';

export interface ChatRoomMemberPreview {
  member_id: string;
  first_name: string;
  photo_url: string | null;
}

export interface ChatRoom {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: ChatRoomType;
  created_by: string | null;
  avatar_url: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // Joined/computed
  member_count?: number;
  members_preview?: ChatRoomMemberPreview[];
  last_message?: ChatMessage | null;
  unread_count?: number;
  my_membership?: ChatRoomMember | null;
}

export interface ChatRoomMember {
  id: string;
  room_id: string;
  member_id: string;
  nickname: string | null;
  role: ChatRoomMemberRole;
  joined_at: string;
  last_read_at: string | null;
  notifications_enabled: boolean;
  hidden_at: string | null;
  // Joined
  choir_members?: {
    id: string;
    first_name: string;
    last_name: string;
    photo_url: string | null;
    voice_group: string | null;
  } | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  message_type: ChatMessageType;
  reply_to_id: string | null;
  metadata_json: Record<string, unknown>;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  sender?: {
    id: string;
    first_name: string;
    last_name: string;
    photo_url: string | null;
  } | null;
  reply_to?: {
    id: string;
    content: string | null;
    sender_id: string;
    choir_members?: { first_name: string; last_name: string } | null;
  } | null;
  reactions?: ChatReaction[];
}

export interface ChatMessageStatus {
  id: string;
  message_id: string;
  member_id: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface ChatReaction {
  id: string;
  message_id: string;
  member_id: string;
  emoji: string;
  created_at: string;
  choir_members?: { first_name: string; last_name: string; photo_url: string | null } | null;
}

export interface ChatPoll {
  id: string;
  message_id: string;
  question: string;
  options_json: PollOption[];
  is_anonymous: boolean;
  is_multiple_choice: boolean;
  closes_at: string | null;
  created_at: string;
}

export interface PollOption {
  id: string;
  text: string;
}

export interface ChatPollVote {
  id: string;
  poll_id: string;
  member_id: string;
  option_id: string;
  created_at: string;
}

export interface ChatNotificationPreferences {
  id: string;
  member_id: string;
  global_chat_notifications: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatRoomLink {
  id: string;
  message_id: string;
  url: string;
  domain: string;
  created_at: string;
  sender_name: string;
}

export interface ChatRoomFile {
  id: string;
  message_id: string;
  name: string;
  url: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
  sender_name: string;
}

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  domain: string;
}

// =============================================
// Query Functions
// =============================================

const MESSAGES_PER_PAGE = 40;
export const URL_REGEX =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?/gi;
const DOMAIN_URL_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?$/i;
const FILE_EXTENSION_REGEX = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|zip|rar|7z|mp3|wav|m4a|aac|ogg|flac|mp4|mov|avi|mkv)$/i;
const MAX_CHAT_SLUG_LENGTH = 80;
const TURKISH_CHAR_MAP: Record<string, string> = {
  ş: 's',
  Ş: 'S',
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ü: 'u',
  Ü: 'U',
  ö: 'o',
  Ö: 'O',
  ı: 'i',
  İ: 'I',
};

type FileCandidate = {
  url: string;
  name?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
};

function applySlugSuffix(baseSlug: string, suffix: number): string {
  const suffixText = `-${suffix}`;
  const maxBaseLength = Math.max(1, MAX_CHAT_SLUG_LENGTH - suffixText.length);
  return `${baseSlug.slice(0, maxBaseLength)}${suffixText}`;
}

export function generateSlug(name: string): string {
  const transliterated = name
    .split('')
    .map((char) => TURKISH_CHAR_MAP[char] ?? char)
    .join('');

  const slug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_CHAT_SLUG_LENGTH);

  return slug || 'oda';
}

export async function resolveUniqueSlug(
  baseSlug: string,
  options?: { excludeRoomId?: string }
): Promise<string> {
  const normalizedBase = generateSlug(baseSlug);
  let slug = normalizedBase;
  let suffix = 2;

  while (true) {
    const { data: isAvailable, error } = await supabase.rpc('check_slug_available', {
      p_slug: slug,
      p_exclude_room_id: options?.excludeRoomId ?? null,
    });

    if (error) throw error;

    if (isAvailable) {
      return slug;
    }

    slug = applySlugSuffix(normalizedBase, suffix);
    suffix += 1;
  }
}

type DmNameRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

function sortDmMembers(a: DmNameRow, b: DmNameRow): number {
  const aName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
  const bName = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim();
  return aName.localeCompare(bName, 'tr');
}

function buildDmSlugPart(member: DmNameRow, includeLastName: boolean, fallbackIndex: number): string {
  const first = generateSlug(member.first_name ?? '');
  const last = includeLastName ? generateSlug(member.last_name ?? '') : '';
  const parts = [first, last].filter(Boolean);
  if (parts.length > 0) return parts.join('-');
  return `uye${fallbackIndex}`;
}

async function generateDmSlug(createdBy: string, otherMemberId: string): Promise<string> {
  const { data, error } = await supabase
    .from('choir_members')
    .select('id, first_name, last_name')
    .in('id', [createdBy, otherMemberId]);

  if (error) throw error;

  const rows = (data ?? []) as DmNameRow[];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const members = [createdBy, otherMemberId]
    .map((id) => rowById.get(id))
    .filter((row): row is DmNameRow => Boolean(row))
    .sort(sortDmMembers);

  if (members.length !== 2) {
    return resolveUniqueSlug('dm-sohbet');
  }

  const firstNameBase = generateSlug(
    `dm-${members
      .map((member, index) => buildDmSlugPart(member, false, index + 1))
      .join('-')}`
  );
  const firstNameCandidate = await resolveUniqueSlug(firstNameBase);
  if (firstNameCandidate === firstNameBase) {
    return firstNameCandidate;
  }

  const fullNameBase = generateSlug(
    `dm-${members
      .map((member, index) => buildDmSlugPart(member, true, index + 1))
      .join('-')}`
  );

  if (fullNameBase === firstNameBase) {
    return firstNameCandidate;
  }

  return resolveUniqueSlug(fullNameBase);
}

function normalizeReplyRelation(rawReply: unknown): ChatMessage['reply_to'] {
  const replyTo = Array.isArray(rawReply) ? rawReply[0] : rawReply;
  if (!replyTo || typeof replyTo !== 'object') return null;
  return replyTo as ChatMessage['reply_to'];
}

export function normalizeChatUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;!?]+$/g, '');
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : DOMAIN_URL_REGEX.test(trimmed)
      ? `https://${trimmed}`
      : null;

  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) ?? [];
  const urls = new Set<string>();
  for (const match of matches) {
    const url = normalizeChatUrl(match);
    if (url) urls.add(url);
  }
  return Array.from(urls);
}

function collectUrls(value: unknown, urls: Set<string>, depth = 0): void {
  if (value == null || depth > 4) return;

  if (typeof value === 'string') {
    const url = normalizeChatUrl(value);
    if (url) urls.add(url);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls, depth + 1);
    return;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrls(item, urls, depth + 1);
    }
  }
}

function extractUrlsFromMetadata(metadata: Record<string, unknown> | null | undefined): string[] {
  if (!metadata) return [];
  const urls = new Set<string>();
  collectUrls(metadata, urls);
  return Array.from(urls);
}

function getSenderName(row: { choir_members?: { first_name?: string | null; last_name?: string | null } | null }): string {
  const first = row.choir_members?.first_name?.trim() ?? '';
  const last = row.choir_members?.last_name?.trim() ?? '';
  return `${first} ${last}`.trim() || 'Bilinmeyen';
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'bilinmiyor';
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function inferFileName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const raw = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
    return raw || 'Dosya';
  } catch {
    return 'Dosya';
  }
}

/**
 * Fetch Open Graph link preview data from Edge Function
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  const { data, error } = await supabase.functions.invoke('link-preview', {
    body: { url },
  });

  if (error) {
    throw new Error(error.message);
  }

  const preview = (data ?? {}) as Partial<LinkPreviewData>;
  if (!preview.url || !preview.domain) {
    throw new Error('Link preview verisi eksik');
  }

  return {
    url: preview.url,
    title: preview.title ?? null,
    description: preview.description ?? null,
    image: preview.image ?? null,
    favicon: preview.favicon ?? null,
    domain: preview.domain,
  };
}

function isLikelyFileUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return FILE_EXTENSION_REGEX.test(pathname);
  } catch {
    return false;
  }
}

function collectFileCandidates(value: unknown, out: FileCandidate[], depth = 0): void {
  if (value == null || depth > 4) return;

  if (Array.isArray(value)) {
    for (const item of value) collectFileCandidates(item, out, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const keys = [
    'file_url',
    'url',
    'download_url',
    'web_view_link',
    'web_content_link',
  ];

  const urlCandidates = new Set<string>();
  for (const key of keys) {
    const valueAtKey = record[key];
    if (typeof valueAtKey === 'string') {
      const url = normalizeChatUrl(valueAtKey);
      if (url) urlCandidates.add(url);
    }
  }

  for (const key of ['file_urls', 'urls', 'web_view_links', 'web_content_links']) {
    const valueAtKey = record[key];
    if (!Array.isArray(valueAtKey)) continue;
    for (const item of valueAtKey) {
      if (typeof item !== 'string') continue;
      const url = normalizeChatUrl(item);
      if (url) urlCandidates.add(url);
    }
  }

  const hasFileMetadata =
    typeof record.file_name === 'string' ||
    typeof record.filename === 'string' ||
    typeof record.mime_type === 'string' ||
    typeof record.file_mime_type === 'string' ||
    record.file_size != null ||
    record.size != null;

  for (const url of urlCandidates) {
    if (!hasFileMetadata && !isLikelyFileUrl(url)) continue;
    out.push({
      url,
      name: (record.file_name as string | undefined) ?? (record.filename as string | undefined) ?? (record.name as string | undefined) ?? null,
      size_bytes: parseNumber(record.file_size ?? record.size),
      mime_type: (record.file_mime_type as string | undefined) ?? (record.mime_type as string | undefined) ?? null,
    });
  }

  for (const item of Object.values(record)) {
    collectFileCandidates(item, out, depth + 1);
  }
}

/** Fetch rooms the current member belongs to, with last message */
export async function fetchChatRooms(memberId: string) {
  // Get rooms + membership
  const { data: memberships, error: membershipError } = await supabase
    .from('chat_room_members')
    .select(`
      id, room_id, nickname, role, last_read_at, notifications_enabled, hidden_at,
      chat_rooms (
        id, name, slug, description, type, created_by, avatar_url,
        is_archived, created_at, updated_at
      )
    `)
    .eq('member_id', memberId)
    .order('joined_at', { ascending: true });

  if (membershipError) throw membershipError;

  const roomIds = (memberships ?? [])
    .map((m) => (typeof m.room_id === 'string' ? m.room_id : null))
    .filter((roomId): roomId is string => roomId !== null);

  const membersPreviewByRoom = new Map<string, ChatRoomMemberPreview[]>();
  if (roomIds.length > 0) {
    const { data: roomMembers, error: roomMembersError } = await supabase
      .from('chat_room_members')
      .select(`
        room_id, member_id,
        choir_members (first_name, photo_url)
      `)
      .in('room_id', roomIds)
      .order('joined_at', { ascending: true });

    if (roomMembersError) throw roomMembersError;

    for (const row of roomMembers ?? []) {
      const roomId = typeof row.room_id === 'string' ? row.room_id : null;
      const memberIdFromRow = typeof row.member_id === 'string' ? row.member_id : null;
      if (!roomId || !memberIdFromRow) continue;

      const memberRelation = row.choir_members as
        | { first_name?: string | null; photo_url?: string | null }
        | Array<{ first_name?: string | null; photo_url?: string | null }>
        | null;
      const memberProfile = Array.isArray(memberRelation) ? memberRelation[0] : memberRelation;

      const preview: ChatRoomMemberPreview = {
        member_id: memberIdFromRow,
        first_name: memberProfile?.first_name?.trim() || 'Üye',
        photo_url: memberProfile?.photo_url ?? null,
      };

      const existing = membersPreviewByRoom.get(roomId);
      if (!existing) {
        membersPreviewByRoom.set(roomId, [preview]);
        continue;
      }
      if (!existing.some((item) => item.member_id === preview.member_id)) {
        existing.push(preview);
      }
    }
  }

  const rooms: ChatRoom[] = [];
  for (const m of memberships ?? []) {
    const roomRelation = m.chat_rooms as
      | (Omit<ChatRoom, 'slug'> & { slug: string | null })
      | Array<Omit<ChatRoom, 'slug'> & { slug: string | null }>
      | null;
    const roomRow = Array.isArray(roomRelation) ? roomRelation[0] : roomRelation;
    if (!roomRow || roomRow.is_archived) continue;

    const room: ChatRoom = {
      ...roomRow,
      slug: roomRow.slug ?? generateSlug(roomRow.name),
    };

    // Get last message for this room
    const { data: lastMsgArr } = await supabase
      .from('chat_messages')
      .select(`
        id, content, message_type, sender_id, created_at, is_deleted,
        choir_members!chat_messages_sender_id_fkey (first_name, last_name)
      `)
      .eq('room_id', room.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastMsg = lastMsgArr?.[0] ?? null;

    // Count unread messages
    let unreadCount = 0;
    if (m.last_read_at) {
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', room.id)
        .gt('created_at', m.last_read_at)
        .neq('sender_id', memberId);
      unreadCount = count ?? 0;
    } else {
      // Never read — count all messages not by self
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', room.id)
        .neq('sender_id', memberId);
      unreadCount = count ?? 0;
    }

    // Member count
    const { count: memberCount } = await supabase
      .from('chat_room_members')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id);

    rooms.push({
      ...room,
      last_message: lastMsg
        ? {
            id: lastMsg.id,
            room_id: room.id,
            sender_id: lastMsg.sender_id,
            content: lastMsg.content,
            message_type: lastMsg.message_type as ChatMessageType,
            reply_to_id: null,
            metadata_json: {},
            is_edited: false,
            is_deleted: lastMsg.is_deleted,
            created_at: lastMsg.created_at,
            updated_at: lastMsg.created_at,
            sender: (lastMsg.choir_members as unknown as ChatMessage['sender']),
          }
        : null,
      unread_count: unreadCount,
      member_count: memberCount ?? 0,
      members_preview: membersPreviewByRoom.get(room.id) ?? [],
      my_membership: {
        id: m.id,
        room_id: room.id,
        member_id: memberId,
        nickname: m.nickname,
        role: m.role as ChatRoomMemberRole,
        joined_at: '',
        last_read_at: m.last_read_at,
        notifications_enabled: m.notifications_enabled,
        hidden_at: m.hidden_at,
      },
    });
  }

  // Sort by last message time (most recent first)
  rooms.sort((a, b) => {
    const aTime = a.last_message?.created_at ?? a.created_at;
    const bTime = b.last_message?.created_at ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return rooms;
}

/** Fetch messages for a room (paginated, newest first) */
export async function fetchMessages(
  roomId: string,
  options?: { before?: string; limit?: number }
) {
  const limit = options?.limit ?? MESSAGES_PER_PAGE;
  let query = supabase
    .from('chat_messages')
    .select(`
      id, room_id, sender_id, content, message_type, reply_to_id,
      metadata_json, is_edited, is_deleted, created_at, updated_at,
      choir_members!chat_messages_sender_id_fkey (
        id, first_name, last_name, photo_url
      ),
      reply_to:chat_messages!reply_to_id (
        id, content, sender_id,
        choir_members!chat_messages_sender_id_fkey (first_name, last_name)
      )
    `)
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options?.before) {
    query = query.lt('created_at', options.before);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Map sender
  return (data ?? []).map((msg) => ({
    ...msg,
    sender: (msg.choir_members as unknown as ChatMessage['sender']),
    reply_to: normalizeReplyRelation(msg.reply_to),
    metadata_json: (msg.metadata_json ?? {}) as Record<string, unknown>,
    message_type: msg.message_type as ChatMessageType,
  })) as ChatMessage[];
}

/** Fetch room members */
export async function fetchRoomMembers(roomId: string) {
  const { data, error } = await supabase
    .from('chat_room_members')
    .select(`
      id, room_id, member_id, nickname, role, joined_at, last_read_at, notifications_enabled, hidden_at,
      choir_members (id, first_name, last_name, photo_url, voice_group)
    `)
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ChatRoomMember[];
}

/** Send a text message */
export async function sendMessage(
  roomId: string,
  senderId: string,
  content: string,
  options?: {
    messageType?: ChatMessageType;
    replyToId?: string | null;
    metadataJson?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      room_id: roomId,
      sender_id: senderId,
      content,
      message_type: options?.messageType ?? 'text',
      reply_to_id: options?.replyToId ?? null,
      metadata_json: options?.metadataJson ?? {},
    })
    .select(`
      id, room_id, sender_id, content, message_type, reply_to_id,
      metadata_json, is_edited, is_deleted, created_at, updated_at,
      choir_members!chat_messages_sender_id_fkey (
        id, first_name, last_name, photo_url
      ),
      reply_to:chat_messages!reply_to_id (
        id, content, sender_id,
        choir_members!chat_messages_sender_id_fkey (first_name, last_name)
      )
    `)
    .single();

  if (error) throw error;
  return {
    ...data,
    sender: (data.choir_members as unknown as ChatMessage['sender']),
    reply_to: normalizeReplyRelation((data as { reply_to?: unknown }).reply_to),
    metadata_json: (data.metadata_json ?? {}) as Record<string, unknown>,
    message_type: data.message_type as ChatMessageType,
  } as ChatMessage;
}

/** Create a new chat room */
export async function createRoom(
  name: string,
  createdBy: string,
  memberIds: string[],
  options?: {
    description?: string;
    type?: ChatRoomType;
    avatarUrl?: string;
  }
): Promise<{ id: string; slug: string }> {
  const type = options?.type ?? 'custom';

  // For DM rooms, check if one already exists between these two members
  if (type === 'dm' && memberIds.length === 1) {
    const otherMemberId = memberIds[0];
    const { data: existingDms } = await supabase
      .from('chat_room_members')
      .select('room_id')
      .eq('member_id', createdBy)
      .in(
        'room_id',
        (
          await supabase
            .from('chat_room_members')
            .select('room_id')
            .eq('member_id', otherMemberId)
        ).data?.map((d) => d.room_id) ?? []
      );

    if (existingDms && existingDms.length > 0) {
      // Check if any of these rooms is a DM
      for (const dm of existingDms) {
        const { data: room } = await supabase
          .from('chat_rooms')
          .select('id, type, slug')
          .eq('id', dm.room_id)
          .eq('type', 'dm')
          .maybeSingle();
        if (room) {
          return {
            id: room.id as string,
            slug: (room.slug as string | null) ?? generateSlug(name),
          };
        }
      }
    }
  }

  const slug =
    type === 'dm' && memberIds.length === 1
      ? await generateDmSlug(createdBy, memberIds[0])
      : await resolveUniqueSlug(generateSlug(name));

  const { data: room, error: roomError } = await supabase
    .from('chat_rooms')
    .insert({
      name,
      slug,
      description: options?.description ?? null,
      type,
      created_by: createdBy,
      avatar_url: options?.avatarUrl ?? null,
    })
    .select('id, slug')
    .single();

  if (roomError) throw roomError;

  // Add creator as admin
  const allMembers = [
    { room_id: room.id, member_id: createdBy, role: 'admin' as const },
    ...memberIds
      .filter((id) => id !== createdBy)
      .map((id) => ({
        room_id: room.id,
        member_id: id,
        role: 'member' as const,
      })),
  ];

  const { error: membersError } = await supabase
    .from('chat_room_members')
    .insert(allMembers);

  if (membersError) throw membersError;

  return {
    id: room.id as string,
    slug: room.slug as string,
  };
}

/** Update last_read_at for the current member in a room */
export async function markRoomAsRead(roomId: string, memberId: string) {
  const { error } = await supabase
    .from('chat_room_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('member_id', memberId);

  if (error) throw error;
}

/** Add a reaction to a message */
export async function addReaction(
  messageId: string,
  memberId: string,
  emoji: string
) {
  const { error } = await supabase
    .from('chat_reactions')
    .upsert(
      { message_id: messageId, member_id: memberId, emoji },
      { onConflict: 'message_id,member_id,emoji' }
    );
  if (error) throw error;
}

/** Remove a reaction from a message */
export async function removeReaction(
  messageId: string,
  memberId: string,
  emoji: string
) {
  const { error } = await supabase
    .from('chat_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('member_id', memberId)
    .eq('emoji', emoji);
  if (error) throw error;
}

/** Fetch reactions for messages */
export async function fetchReactionsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return {};

  const { data, error } = await supabase
    .from('chat_reactions')
    .select(`
      id, message_id, member_id, emoji, created_at,
      choir_members (first_name, last_name, photo_url)
    `)
    .in('message_id', messageIds);

  if (error) throw error;

  // Group by message_id
  const grouped: Record<string, ChatReaction[]> = {};
  for (const r of data ?? []) {
    if (!grouped[r.message_id]) grouped[r.message_id] = [];
    grouped[r.message_id].push({
      ...r,
      choir_members: (r.choir_members as unknown as ChatReaction['choir_members']),
    });
  }
  return grouped;
}

/** Fetch detailed read/delivered status for a message */
export async function fetchMessageStatuses(messageId: string) {
  const { data, error } = await supabase
    .from('chat_message_status')
    .select(`
      delivered_at, read_at,
      choir_members (first_name, last_name, photo_url)
    `)
    .eq('message_id', messageId);

  if (error) throw error;
  return data as unknown as {
    delivered_at: string | null;
    read_at: string | null;
    choir_members: { first_name: string; last_name: string; photo_url: string | null };
  }[];
}

/** Get or create DM room */
export async function getOrCreateDm(
  currentMemberId: string,
  otherMemberId: string,
  otherMemberName: string
) {
  return createRoom(
    otherMemberName,
    currentMemberId,
    [otherMemberId],
    { type: 'dm' }
  );
}

// =============================================
// Phase 2: Message Edit / Delete
// =============================================

/** Edit a message (only own messages, text only) */
export async function editMessage(messageId: string, newContent: string) {
  const { error } = await supabase
    .from('chat_messages')
    .update({
      content: newContent,
      is_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', messageId);

  if (error) throw error;
}

/** Soft-delete a message (only own messages) */
export async function deleteMessage(messageId: string) {
  const { error } = await supabase
    .from('chat_messages')
    .update({
      is_deleted: true,
      content: null,
      metadata_json: {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', messageId);

  if (error) throw error;
}

/** Soft-delete a message for current user only */
export async function deleteMessageForMe(messageId: string, memberId: string) {
  const { data, error: fetchErr } = await supabase
    .from('chat_messages')
    .select('metadata_json')
    .eq('id', messageId)
    .single();
    
  if (fetchErr) throw fetchErr;
  
  const currentMetadata = (data.metadata_json as Record<string, any>) || {};
  const deletedFor = Array.isArray(currentMetadata.deleted_for) ? currentMetadata.deleted_for : [];
  
  if (!deletedFor.includes(memberId)) {
    deletedFor.push(memberId);
  }
  
  const { error: updateErr } = await supabase
    .from('chat_messages')
    .update({
      metadata_json: {
        ...currentMetadata,
        deleted_for: deletedFor
      }
    })
    .eq('id', messageId);
    
  if (updateErr) throw updateErr;
}

// =============================================
// Phase 2: Room Management
// =============================================

/** Update room details (admin only) */
export async function updateRoom(
  roomId: string,
  updates: { name?: string; description?: string; avatar_url?: string; is_archived?: boolean }
) {
  const payload: {
    name?: string;
    description?: string;
    avatar_url?: string;
    is_archived?: boolean;
    slug?: string;
    updated_at: string;
  } = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.name === 'string' && updates.name.trim().length > 0) {
    payload.slug = await resolveUniqueSlug(generateSlug(updates.name), { excludeRoomId: roomId });
  }

  const { error } = await supabase
    .from('chat_rooms')
    .update(payload)
    .eq('id', roomId);

  if (error) throw error;
}

/** Remove a member from a room */
export async function removeMember(roomId: string, memberId: string) {
  const { error } = await supabase
    .from('chat_room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('member_id', memberId);

  if (error) throw error;
}

/** Toggle notification preference for current member in a room */
export async function setRoomNotifications(roomId: string, memberId: string, enabled: boolean) {
  const { error } = await supabase
    .from('chat_room_members')
    .update({ notifications_enabled: enabled })
    .eq('room_id', roomId)
    .eq('member_id', memberId);

  if (error) throw error;
}

/** Hide room from current member until a newer message arrives */
export async function hideRoomForMe(roomId: string, memberId: string) {
  const { error } = await supabase
    .from('chat_room_members')
    .update({ hidden_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('member_id', memberId);

  if (error) throw error;
}

/** Leave a room (current user) */
export async function leaveRoom(roomId: string, memberId: string) {
  return removeMember(roomId, memberId);
}

/** Archive room for everyone (admin-only flow on UI) */
export async function archiveRoomForEveryone(roomId: string) {
  await updateRoom(roomId, { is_archived: true });
}

/** Update a member's role (admin only) */
export async function updateMemberRole(roomId: string, memberId: string, role: ChatRoomMemberRole) {
  const { error } = await supabase
    .from('chat_room_members')
    .update({ role })
    .eq('room_id', roomId)
    .eq('member_id', memberId);

  if (error) throw error;
}

/** Update room avatar — uploads to Google Drive */
export async function updateRoomAvatar(roomId: string, file: File) {
  const { public_url } = await uploadChatImage(roomId, file);
  await updateRoom(roomId, { avatar_url: public_url });
  return public_url;
}

/** Add members to an existing room */
export async function addMembersToRoom(roomId: string, memberIds: string[]) {
  const rows = memberIds.map((id) => ({
    room_id: roomId,
    member_id: id,
    role: 'member' as const,
  }));

  const { error } = await supabase
    .from('chat_room_members')
    .insert(rows);

  if (error) throw error;
}

// =============================================
// Phase 2: Poll Functions
// =============================================

/** Create a poll attached to a message */
export async function createPollMessage(
  roomId: string,
  senderId: string,
  question: string,
  options: { id: string; text: string }[],
  settings: { isAnonymous?: boolean; isMultipleChoice?: boolean }
) {
  // First create the message
  const msg = await sendMessage(roomId, senderId, `📊 ${question}`, {
    messageType: 'poll',
    metadataJson: { question },
  });

  // Then create the poll
  const { data: poll, error } = await supabase
    .from('chat_polls')
    .insert({
      message_id: msg.id,
      question,
      options_json: options,
      is_anonymous: settings.isAnonymous ?? false,
      is_multiple_choice: settings.isMultipleChoice ?? false,
    })
    .select()
    .single();

  if (error) throw error;
  return { message: msg, poll };
}

/** Vote on a poll option */
export async function votePoll(pollId: string, memberId: string, optionId: string) {
  const { error } = await supabase
    .from('chat_poll_votes')
    .upsert(
      { poll_id: pollId, member_id: memberId, option_id: optionId },
      { onConflict: 'poll_id,member_id,option_id' }
    );
  if (error) throw error;
}

/** Remove a vote from a poll */
export async function removePollVote(pollId: string, memberId: string, optionId: string) {
  const { error } = await supabase
    .from('chat_poll_votes')
    .delete()
    .eq('poll_id', pollId)
    .eq('member_id', memberId)
    .eq('option_id', optionId);
  if (error) throw error;
}

/** Upload photos to Google Drive and send them as an image message */
export async function sendImageMessage(
  roomId: string,
  senderId: string,
  files: File[],
  options?: { replyToId?: string | null }
) {
  if (!files || files.length === 0) throw new Error('No files provided');
  if (files.length > 5) throw new Error('Maximum 5 files allowed');

  const uploadPromises = files.map(async (file) => {
    const result = await uploadChatImage(roomId, file);
    return {
      url: result.public_url,
      web_view_link: result.web_view_link,
      web_content_link: result.web_content_link,
      drive_file_id: result.file_id,
    };
  });

  const uploadedFiles = await Promise.all(uploadPromises);

  // Single file: backward-compatible format; multiple: use arrays
  const metadataJson =
    uploadedFiles.length === 1
      ? {
          url: uploadedFiles[0].url,
          web_view_link: uploadedFiles[0].web_view_link,
          drive_file_id: uploadedFiles[0].drive_file_id,
        }
      : {
          urls: uploadedFiles.map((f) => f.url),
          web_view_links: uploadedFiles.map((f) => f.web_view_link),
          drive_file_ids: uploadedFiles.map((f) => f.drive_file_id),
        };

  return sendMessage(roomId, senderId, '', {
    messageType: 'image',
    replyToId: options?.replyToId ?? null,
    metadataJson,
  });
}

/** Alias used in ChatRoom.tsx — same behaviour as sendImageMessage */
export const sendMultiImageMessage = sendImageMessage;

// =============================================
// Phase 3: Gallery & Starred Messages
// =============================================

export async function starMessage(messageId: string, memberId: string) {
  const { error } = await supabase
    .from('chat_starred_messages')
    .insert({ message_id: messageId, member_id: memberId });
  if (error) throw error;
}

export async function unstarMessage(messageId: string, memberId: string) {
  const { error } = await supabase
    .from('chat_starred_messages')
    .delete()
    .eq('message_id', messageId)
    .eq('member_id', memberId);
  if (error) throw error;
}

export async function fetchStarredMessages(memberId: string, roomId?: string) {
  let query = supabase
    .from('chat_starred_messages')
    .select(`
      message_id,
      chat_messages!inner (
        id, content, message_type, metadata_json, created_at, room_id,
        choir_members!chat_messages_sender_id_fkey (first_name, last_name, photo_url)
      )
    `)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (roomId) {
    query = query.eq('chat_messages.room_id', roomId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data.map(d => d.chat_messages) as unknown as ChatMessage[];
}

export async function fetchRoomMedia(roomId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`
      id, content, message_type, metadata_json, created_at,
      choir_members!chat_messages_sender_id_fkey (first_name, last_name, photo_url)
    `)
    .eq('room_id', roomId)
    .eq('message_type', 'image')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as unknown as ChatMessage[];
}

export async function fetchRoomLinks(roomId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`
      id, room_id, content, message_type, metadata_json, created_at,
      choir_members!chat_messages_sender_id_fkey (first_name, last_name)
    `)
    .eq('room_id', roomId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) throw error;

  const links: ChatRoomLink[] = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    const textUrls = extractUrlsFromText(row.content as string | null);
    const metadataUrls =
      row.message_type === 'image'
        ? []
        : extractUrlsFromMetadata((row.metadata_json ?? {}) as Record<string, unknown>);
    const allUrls = Array.from(new Set([...textUrls, ...metadataUrls]));

    for (const url of allUrls) {
      const dedupeKey = `${row.id}::${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      links.push({
        id: dedupeKey,
        message_id: row.id as string,
        url,
        domain: getDomain(url),
        created_at: row.created_at as string,
        sender_name: getSenderName(row as { choir_members?: { first_name?: string | null; last_name?: string | null } | null }),
      });
    }
  }

  return links;
}

export async function fetchRoomFiles(roomId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`
      id, room_id, content, message_type, metadata_json, created_at,
      choir_members!chat_messages_sender_id_fkey (first_name, last_name)
    `)
    .eq('room_id', roomId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) throw error;

  const files: ChatRoomFile[] = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    const messageType = row.message_type as ChatMessageType;
    if (messageType === 'image' || messageType === 'sticker' || messageType === 'poll' || messageType === 'system') {
      continue;
    }

    const fromMetadata: FileCandidate[] = [];
    collectFileCandidates((row.metadata_json ?? {}) as Record<string, unknown>, fromMetadata);

    const fromText = extractUrlsFromText(row.content as string | null)
      .filter((url) => isLikelyFileUrl(url))
      .map((url) => ({ url, name: null, size_bytes: null, mime_type: null }) satisfies FileCandidate);

    const candidates = [...fromMetadata, ...fromText];

    for (const candidate of candidates) {
      if (!candidate.url) continue;
      const dedupeKey = `${row.id}::${candidate.url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      files.push({
        id: dedupeKey,
        message_id: row.id as string,
        name: (candidate.name && candidate.name.trim()) || inferFileName(candidate.url),
        url: candidate.url,
        size_bytes: candidate.size_bytes ?? null,
        mime_type: candidate.mime_type ?? null,
        created_at: row.created_at as string,
        sender_name: getSenderName(row as { choir_members?: { first_name?: string | null; last_name?: string | null } | null }),
      });
    }
  }

  return files;
}

/** Fetch poll data with votes */
export async function fetchPollData(messageId: string) {
  const { data: poll, error: pollError } = await supabase
    .from('chat_polls')
    .select('*')
    .eq('message_id', messageId)
    .single();

  if (pollError) throw pollError;

  const { data: votes, error: votesError } = await supabase
    .from('chat_poll_votes')
    .select(`
      id, poll_id, member_id, option_id, created_at,
      choir_members (first_name, last_name, photo_url)
    `)
    .eq('poll_id', poll.id);

  if (votesError) throw votesError;

  return {
    poll: {
      ...poll,
      options_json: poll.options_json as { id: string; text: string }[],
    } as ChatPoll,
    votes: (votes ?? []) as unknown as (ChatPollVote & { choir_members?: { first_name: string; last_name: string; photo_url: string | null } })[],
  };
}
