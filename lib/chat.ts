import { supabase } from '@/lib/supabase';

// =============================================
// Type Definitions
// =============================================

export type ChatRoomType = 'general' | 'voice_group' | 'custom' | 'dm';
export type ChatMessageType = 'text' | 'image' | 'sticker' | 'poll' | 'system';
export type ChatRoomMemberRole = 'admin' | 'member';

export interface ChatRoom {
  id: string;
  name: string;
  description: string | null;
  type: ChatRoomType;
  created_by: string | null;
  avatar_url: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // Joined/computed
  member_count?: number;
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
  choir_members?: { first_name: string; last_name: string } | null;
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

// =============================================
// Query Functions
// =============================================

const MESSAGES_PER_PAGE = 40;

/** Fetch rooms the current member belongs to, with last message */
export async function fetchChatRooms(memberId: string) {
  // Get rooms + membership
  const { data: memberships, error: membershipError } = await supabase
    .from('chat_room_members')
    .select(`
      id, room_id, nickname, role, last_read_at, notifications_enabled,
      chat_rooms (
        id, name, description, type, created_by, avatar_url,
        is_archived, created_at, updated_at
      )
    `)
    .eq('member_id', memberId)
    .order('joined_at', { ascending: true });

  if (membershipError) throw membershipError;

  const rooms: ChatRoom[] = [];
  for (const m of memberships ?? []) {
    const room = m.chat_rooms as unknown as ChatRoom;
    if (!room || room.is_archived) continue;

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
      my_membership: {
        id: m.id,
        room_id: room.id,
        member_id: memberId,
        nickname: m.nickname,
        role: m.role as ChatRoomMemberRole,
        joined_at: '',
        last_read_at: m.last_read_at,
        notifications_enabled: m.notifications_enabled,
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
    metadata_json: (msg.metadata_json ?? {}) as Record<string, unknown>,
    message_type: msg.message_type as ChatMessageType,
  })) as ChatMessage[];
}

/** Fetch room members */
export async function fetchRoomMembers(roomId: string) {
  const { data, error } = await supabase
    .from('chat_room_members')
    .select(`
      id, room_id, member_id, nickname, role, joined_at, last_read_at, notifications_enabled,
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
      )
    `)
    .single();

  if (error) throw error;
  return {
    ...data,
    sender: (data.choir_members as unknown as ChatMessage['sender']),
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
) {
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
          .select('id, type')
          .eq('id', dm.room_id)
          .eq('type', 'dm')
          .maybeSingle();
        if (room) return room.id;
      }
    }
  }

  const { data: room, error: roomError } = await supabase
    .from('chat_rooms')
    .insert({
      name,
      description: options?.description ?? null,
      type,
      created_by: createdBy,
      avatar_url: options?.avatarUrl ?? null,
    })
    .select()
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

  return room.id as string;
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
      choir_members (first_name, last_name)
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

// =============================================
// Phase 2: Room Management
// =============================================

/** Update room details (admin only) */
export async function updateRoom(
  roomId: string,
  updates: { name?: string; description?: string; avatar_url?: string }
) {
  const { error } = await supabase
    .from('chat_rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
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

/** Leave a room (current user) */
export async function leaveRoom(roomId: string, memberId: string) {
  return removeMember(roomId, memberId);
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
      choir_members (first_name, last_name)
    `)
    .eq('poll_id', poll.id);

  if (votesError) throw votesError;

  return {
    poll: {
      ...poll,
      options_json: poll.options_json as { id: string; text: string }[],
    } as ChatPoll,
    votes: (votes ?? []) as unknown as (ChatPollVote & { choir_members?: { first_name: string; last_name: string } })[],
  };
}
