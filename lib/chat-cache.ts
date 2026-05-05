import type { ChatMessage, ChatRoom, ChatRoomMember } from '@/lib/chat';

const CHAT_ROOMS_CACHE_PREFIX = 'genova.chat.rooms.v1';
const CHAT_ROOM_SNAPSHOT_CACHE_PREFIX = 'genova.chat.room-snapshot.v1';
const CHAT_PENDING_MESSAGES_CACHE_PREFIX = 'genova.chat.pending-messages.v1';
const MAX_CACHED_MESSAGES = 120;

interface ChatRoomSnapshot {
  messages: ChatMessage[];
  roomMembers: ChatRoomMember[];
  starredMessageIds: string[];
  hasMore: boolean;
  cachedAt: number;
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson<T>(key: string): T | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache writes are best-effort; live data remains the source of truth.
  }
}

function removeJson(key: string) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

function getRoomsCacheKey(memberId: string) {
  return `${CHAT_ROOMS_CACHE_PREFIX}:${memberId}`;
}

function getRoomSnapshotCacheKey(memberId: string, roomId: string) {
  return `${CHAT_ROOM_SNAPSHOT_CACHE_PREFIX}:${memberId}:${roomId}`;
}

function getPendingMessagesCacheKey(memberId: string, roomId: string) {
  return `${CHAT_PENDING_MESSAGES_CACHE_PREFIX}:${memberId}:${roomId}`;
}

function isChatRoomArray(value: unknown): value is ChatRoom[] {
  return Array.isArray(value) && value.every((room) => (
    room &&
    typeof room === 'object' &&
    typeof (room as Partial<ChatRoom>).id === 'string' &&
    typeof (room as Partial<ChatRoom>).name === 'string'
  ));
}

function isMessageArray(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.every((message) => (
    message &&
    typeof message === 'object' &&
    typeof (message as Partial<ChatMessage>).id === 'string' &&
    typeof (message as Partial<ChatMessage>).room_id === 'string'
  ));
}

function isRoomMemberArray(value: unknown): value is ChatRoomMember[] {
  return Array.isArray(value);
}

function normalizeSnapshot(value: unknown): ChatRoomSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ChatRoomSnapshot>;
  if (!isMessageArray(candidate.messages)) return null;

  return {
    messages: candidate.messages,
    roomMembers: isRoomMemberArray(candidate.roomMembers) ? candidate.roomMembers : [],
    starredMessageIds: Array.isArray(candidate.starredMessageIds)
      ? candidate.starredMessageIds.filter((id): id is string => typeof id === 'string')
      : [],
    hasMore: Boolean(candidate.hasMore),
    cachedAt: typeof candidate.cachedAt === 'number' ? candidate.cachedAt : Date.now(),
  };
}

export function mergeChatMessages(...groups: Array<ChatMessage[] | null | undefined>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  for (const group of groups) {
    for (const message of group ?? []) {
      byId.set(message.id, {
        ...byId.get(message.id),
        ...message,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aTime = Date.parse(a.created_at ?? '') || 0;
    const bTime = Date.parse(b.created_at ?? '') || 0;
    return aTime - bTime;
  });
}

export function readCachedChatRooms(memberId: string): ChatRoom[] | null {
  const value = readJson<unknown>(getRoomsCacheKey(memberId));
  return isChatRoomArray(value) ? value : null;
}

export function writeCachedChatRooms(memberId: string, rooms: ChatRoom[]) {
  writeJson(getRoomsCacheKey(memberId), rooms);
}

export function readCachedRoomSnapshot(memberId: string, roomId: string): ChatRoomSnapshot | null {
  return normalizeSnapshot(readJson<unknown>(getRoomSnapshotCacheKey(memberId, roomId)));
}

export function writeCachedRoomSnapshot(
  memberId: string,
  roomId: string,
  snapshot: Omit<ChatRoomSnapshot, 'cachedAt'>,
) {
  writeJson(getRoomSnapshotCacheKey(memberId, roomId), {
    ...snapshot,
    messages: snapshot.messages.slice(-MAX_CACHED_MESSAGES),
    cachedAt: Date.now(),
  });
}

export function readPendingRoomMessages(memberId: string, roomId: string): ChatMessage[] {
  const value = readJson<unknown>(getPendingMessagesCacheKey(memberId, roomId));
  return isMessageArray(value) ? value : [];
}

export function upsertPendingRoomMessage(memberId: string, roomId: string, message: ChatMessage) {
  const pending = readPendingRoomMessages(memberId, roomId);
  const next = mergeChatMessages(
    pending.filter((item) => item.id !== message.id),
    [message],
  );
  writeJson(getPendingMessagesCacheKey(memberId, roomId), next);
}

export function removePendingRoomMessage(memberId: string, roomId: string, messageId: string) {
  const next = readPendingRoomMessages(memberId, roomId).filter((message) => message.id !== messageId);
  if (next.length === 0) {
    removeJson(getPendingMessagesCacheKey(memberId, roomId));
    return;
  }
  writeJson(getPendingMessagesCacheKey(memberId, roomId), next);
}

export function markPendingRoomMessageFailed(memberId: string, roomId: string, messageId: string) {
  const next = readPendingRoomMessages(memberId, roomId).map((message) => (
    message.id === messageId
      ? { ...message, metadata_json: { ...message.metadata_json, _status: 'failed', _failed: true } }
      : message
  ));
  writeJson(getPendingMessagesCacheKey(memberId, roomId), next);
}

export function clearChatCaches() {
  if (!canUseLocalStorage()) return;

  try {
    const prefixes = [
      CHAT_ROOMS_CACHE_PREFIX,
      CHAT_ROOM_SNAPSHOT_CACHE_PREFIX,
      CHAT_PENDING_MESSAGES_CACHE_PREFIX,
    ];
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
