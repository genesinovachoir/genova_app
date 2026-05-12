'use client';

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { createRealtimeTopic } from '@/lib/realtime';
import { useChatStore } from '@/store/useChatStore';
import type { ChatMessage, ChatMessageType, ChatReaction, ChatRoom } from '@/lib/chat';
import type { RealtimeChannel } from '@supabase/supabase-js';

function removeChatChannel(channel: RealtimeChannel) {
  return supabase.removeChannel(channel).catch((err) => {
    console.error('Failed to remove chat realtime channel:', err);
  });
}

async function removeExistingChannelsForTopic(topic: string) {
  const realtimeTopic = `realtime:${topic}`;
  const existingChannels = supabase
    .getChannels()
    .filter((channel) => channel.topic === realtimeTopic);

  await Promise.all(existingChannels.map(removeChatChannel));
}

/**
 * Manages Supabase Realtime subscriptions for chat:
 * - Postgres Changes on chat_messages → new/updated messages
 * - Postgres Changes on chat_reactions → reaction add/remove
 * - Broadcast → typing indicators + read receipts
 * - Presence → online users in room
 */
export function useChatRealtime(memberId: string | null, roomId: string | null) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  // Removed useChatStore subscription variables to prevent re-renders

  // Handle incoming new messages from Postgres Changes
  const handleNewMessage = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const msg = payload.new;
      const msgRoomId = msg.room_id as string;
      const senderId = msg.sender_id as string;

      // Skip own messages (handled by optimistic UI)
      if (senderId === memberId) return;

      // Build ChatMessage from the raw payload
      const newMessage: ChatMessage = {
        id: msg.id as string,
        room_id: msgRoomId,
        sender_id: senderId,
        content: (msg.content as string) ?? null,
        message_type: (msg.message_type as ChatMessageType) ?? 'text',
        reply_to_id: (msg.reply_to_id as string) ?? null,
        metadata_json: (msg.metadata_json as Record<string, unknown>) ?? {},
        is_edited: (msg.is_edited as boolean) ?? false,
        is_deleted: (msg.is_deleted as boolean) ?? false,
        created_at: msg.created_at as string,
        updated_at: msg.updated_at as string,
        sender: null,
        reactions: [],
      };

      // Fetch sender info and reply_to info if needed
      const fetchDetails = async () => {
        try {
          const [senderRes, replyRes] = await Promise.all([
            supabase
              .from('choir_members')
              .select('id, first_name, last_name, photo_url')
              .eq('id', senderId)
              .single(),
            msg.reply_to_id
              ? supabase
                  .from('chat_messages')
                  .select(`
                    id, content, sender_id,
                    choir_members!chat_messages_sender_id_fkey (first_name, last_name)
                  `)
                  .eq('id', msg.reply_to_id)
                  .single()
              : Promise.resolve({ data: null }),
          ]);

          if (senderRes.data) {
            newMessage.sender = senderRes.data;
          }
          if (replyRes.data) {
            newMessage.reply_to = replyRes.data as any;
          }

          useChatStore.getState().addMessage(msgRoomId, newMessage);
        } catch (err) {
          console.error('Error fetching message details:', err);
          // Still add the message even if details fetch fails
          useChatStore.getState().addMessage(msgRoomId, newMessage);
        }
      };

      void fetchDetails();

      // Increment unread if not the active room
      const state = useChatStore.getState();
      if (msgRoomId !== state.activeRoomId) {
        state.incrementUnread(msgRoomId);
      }
    },
    [memberId]
  );

  // Handle message updates (edit/delete)
  const handleMessageUpdate = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const msg = payload.new;
      const msgRoomId = msg.room_id as string;
      const msgId = msg.id as string;

      useChatStore.getState().updateMessage(msgRoomId, msgId, {
        content: (msg.content as string) ?? null,
        is_edited: (msg.is_edited as boolean) ?? false,
        is_deleted: (msg.is_deleted as boolean) ?? false,
        metadata_json: (msg.metadata_json as Record<string, unknown>) ?? {},
        updated_at: msg.updated_at as string,
      });
    },
    []
  );

  // Handle new reactions
  const handleNewReaction = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const r = payload.new;
      const messageId = r.message_id as string;
      const rMemberId = r.member_id as string;

      // Skip own reactions (already optimistically added)
      if (rMemberId === memberId) return;

      // Fetch member name for the reaction
      void supabase
        .from('choir_members')
        .select('first_name, last_name, photo_url')
        .eq('id', rMemberId)
        .single()
        .then(({ data }) => {
          const reaction: ChatReaction = {
            id: r.id as string,
            message_id: messageId,
            member_id: rMemberId,
            emoji: r.emoji as string,
            created_at: r.created_at as string,
            choir_members: data ?? null,
          };

          // We need to figure out the roomId for this message
          // Check all rooms in the store
          const state = useChatStore.getState();
          for (const [rId, msgs] of Object.entries(state.messagesByRoom)) {
            if (msgs.some((m) => m.id === messageId)) {
              state.addReactionToMessage(rId, messageId, reaction);
              break;
            }
          }
        });
    },
    [memberId]
  );

  // Handle reaction deletions
  const handleDeleteReaction = useCallback(
    (payload: { old: Record<string, unknown> }) => {
      const r = payload.old;
      const reactionId = r.id as string;
      const messageId = r.message_id as string;
      const rMemberId = r.member_id as string;

      // Skip own reactions (already optimistically removed)
      if (rMemberId === memberId) return;

      const state = useChatStore.getState();
      for (const [rId, msgs] of Object.entries(state.messagesByRoom)) {
        if (msgs.some((m) => m.id === messageId)) {
          state.removeReactionFromMessage(rId, messageId, reactionId);
          break;
        }
      }
    },
    [memberId]
  );

  // Subscribe to room channel
  useEffect(() => {
    if (!memberId || !roomId) return;

    let isCancelled = false;
    let channel: RealtimeChannel | null = null;
    const topic = `chat:${roomId}`;

    const setupChannel = async () => {
      if (channelRef.current) {
        const previousChannel = channelRef.current;
        channelRef.current = null;
        await removeChatChannel(previousChannel);
      }

      await removeExistingChannelsForTopic(topic);
      if (isCancelled) return;

      channel = supabase.channel(topic, {
        config: { presence: { key: memberId } },
      });

      // 1. Postgres Changes — new messages in this room
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        handleNewMessage
      );

      // 2. Postgres Changes — message updates (edit/delete)
      channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        handleMessageUpdate
      );

      // 3. Postgres Changes — new reactions
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_reactions',
        },
        handleNewReaction
      );

      // 4. Postgres Changes — deleted reactions
      channel.on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_reactions',
        },
        handleDeleteReaction
      );

      // 5. Broadcast — typing indicators
      channel.on('broadcast', { event: 'typing' }, (payload) => {
        if (isCancelled) return;
        const typingMemberId = payload.payload?.member_id as string;
        if (!typingMemberId || typingMemberId === memberId) return;

        const state = useChatStore.getState();
        const current = state.typingUsers[roomId] ?? [];
        if (!current.includes(typingMemberId)) {
          state.setTypingUsers(roomId, [...current, typingMemberId]);
        }

        // Clear typing after 3 seconds
        if (typingTimeoutsRef.current[typingMemberId]) {
          clearTimeout(typingTimeoutsRef.current[typingMemberId]);
        }
        typingTimeoutsRef.current[typingMemberId] = setTimeout(() => {
          const state = useChatStore.getState();
          const updated = (
            state.typingUsers[roomId] ?? []
          ).filter((id) => id !== typingMemberId);
          state.setTypingUsers(roomId, updated);
          delete typingTimeoutsRef.current[typingMemberId];
        }, 3000);
      });

      // 6. Broadcast — read receipts
      channel.on('broadcast', { event: 'read_receipt' }, (payload) => {
        if (isCancelled) return;
        const readerMemberId = payload.payload?.member_id as string;
        if (!readerMemberId || readerMemberId === memberId) return;

        // Mark all own messages in this room as 'read'
        const state = useChatStore.getState();
        const msgs = state.messagesByRoom[roomId] ?? [];
        for (const msg of msgs) {
          if (msg.sender_id === memberId) {
            state.setMessageStatus(roomId, msg.id, 'read');
          }
        }
      });

      // 7. Presence — track online users
      channel.on('presence', { event: 'sync' }, () => {
        if (isCancelled || !channel) return;
        const state = channel.presenceState();
        const onlineIds = Object.keys(state);
        useChatStore.getState().setOnlineUsers(onlineIds);
      });

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          if (isCancelled || !channel) return;
          await channel.track({
            member_id: memberId,
            online_at: new Date().toISOString(),
          });

          if (isCancelled) return;
          // Broadcast read receipt when entering room
          channel.send({
            type: 'broadcast',
            event: 'read_receipt',
            payload: { member_id: memberId },
          });
        }
      });

      channelRef.current = channel;
    };

    void setupChannel();

    return () => {
      isCancelled = true;
      if (channel) {
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
        void removeChatChannel(channel);
      } else if (channelRef.current) {
        const previousChannel = channelRef.current;
        channelRef.current = null;
        void removeChatChannel(previousChannel);
      }
      // Clear all typing timeouts
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
    };
  }, [memberId, roomId, handleNewMessage, handleMessageUpdate, handleNewReaction, handleDeleteReaction]);

  // Send typing indicator
  const sendTyping = useCallback(() => {
    if (!channelRef.current || !memberId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { member_id: memberId },
    });
  }, [memberId]);

  return { sendTyping };
}

/**
 * Global subscription: Listen for new messages across ALL rooms
 * (used on chat list page for real-time room list updates)
 */
export function useChatGlobalRealtime(memberId: string | null, roomIds: string[]) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    roomIdsRef.current = new Set(roomIds);
  }, [roomIds]);

  const hasRooms = roomIds.length > 0;

  useEffect(() => {
    if (!memberId || !hasRooms) return;

    if (channelRef.current) {
      void removeChatChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(createRealtimeTopic('chat:global'));

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const msg = payload.new;
        const msgRoomId = msg.room_id as string;
        const senderId = msg.sender_id as string;

        // Only process if we're a member of this room
        if (!roomIdsRef.current.has(msgRoomId)) return;
        // Skip own messages
        if (senderId === memberId) return;

        const newMessage: ChatMessage = {
          id: msg.id as string,
          room_id: msgRoomId,
          sender_id: senderId,
          content: (msg.content as string) ?? null,
          message_type: (msg.message_type as ChatMessageType) ?? 'text',
          reply_to_id: null,
          metadata_json: {},
          is_edited: false,
          is_deleted: false,
          created_at: msg.created_at as string,
          updated_at: msg.updated_at as string,
          sender: null,
          reactions: [],
        };

        void supabase
          .from('choir_members')
          .select('id, first_name, last_name, photo_url')
          .eq('id', senderId)
          .single()
          .then(({ data }) => {
            if (data) newMessage.sender = data;
            // Only add to store if not on that room's page already
            const state = useChatStore.getState();
            if (msgRoomId !== state.activeRoomId) {
              state.addMessage(msgRoomId, newMessage);
              state.incrementUnread(msgRoomId);
            }
          });
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_rooms',
      },
      (payload) => {
        const updatedRoom = payload.new;
        const updatedRoomId = updatedRoom.id as string;
        if (!roomIdsRef.current.has(updatedRoomId)) return;

        const updates: Partial<ChatRoom> = {
          name: (updatedRoom.name as string) ?? '',
          description: (updatedRoom.description as string | null) ?? null,
          type: (updatedRoom.type as 'general' | 'voice_group' | 'custom' | 'dm') ?? 'custom',
          avatar_url: (updatedRoom.avatar_url as string | null) ?? null,
          is_archived: (updatedRoom.is_archived as boolean) ?? false,
          updated_at: (updatedRoom.updated_at as string) ?? new Date().toISOString(),
        };

        if (typeof updatedRoom.slug === 'string') {
          updates.slug = updatedRoom.slug;
        }

        useChatStore.getState().updateRoom(updatedRoomId, updates);
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_room_members',
        filter: `member_id=eq.${memberId}`,
      },
      (payload) => {
        const updatedMembership = payload.new;
        const updatedRoomId = updatedMembership.room_id as string;
        if (!roomIdsRef.current.has(updatedRoomId)) return;

        useChatStore.getState().updateRoomMembership(updatedRoomId, {
          last_read_at: (updatedMembership.last_read_at as string | null) ?? null,
          notifications_enabled: (updatedMembership.notifications_enabled as boolean) ?? true,
          hidden_at: (updatedMembership.hidden_at as string | null) ?? null,
        });
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_room_members',
        filter: `member_id=eq.${memberId}`,
      },
      (payload) => {
        const removedRoomId = payload.old.room_id as string | undefined;
        if (!removedRoomId) return;
        useChatStore.getState().removeRoom(removedRoomId);
      }
    );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void removeChatChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [memberId, hasRooms]);
}
