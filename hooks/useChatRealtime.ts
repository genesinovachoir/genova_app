'use client';

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useChatStore } from '@/store/useChatStore';
import type { ChatMessage, ChatMessageType } from '@/lib/chat';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Manages Supabase Realtime subscriptions for chat:
 * - Postgres Changes on chat_messages → new messages
 * - Broadcast → typing indicators
 * - Presence → online users in room
 */
export function useChatRealtime(memberId: string | null, roomId: string | null) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const {
    addMessage,
    setTypingUsers,
    typingUsers,
    activeRoomId,
    incrementUnread,
  } = useChatStore();

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
        // Sender info will be fetched asynchronously
        sender: null,
      };

      // Fetch sender info
      void supabase
        .from('choir_members')
        .select('id, first_name, last_name, photo_url')
        .eq('id', senderId)
        .single()
        .then(({ data }) => {
          if (data) {
            newMessage.sender = data;
          }
          addMessage(msgRoomId, newMessage);
        });

      // Increment unread if not the active room
      if (msgRoomId !== activeRoomId) {
        incrementUnread(msgRoomId);
      }
    },
    [memberId, addMessage, activeRoomId, incrementUnread]
  );

  // Subscribe to room channel for Postgres Changes + Broadcast + Presence
  useEffect(() => {
    if (!memberId || !roomId) return;

    // Clean up previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`chat:${roomId}`, {
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

    // 2. Broadcast — typing indicators
    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const typingMemberId = payload.payload?.member_id as string;
      if (!typingMemberId || typingMemberId === memberId) return;

      const current = typingUsers[roomId] ?? [];
      if (!current.includes(typingMemberId)) {
        setTypingUsers(roomId, [...current, typingMemberId]);
      }

      // Clear typing after 3 seconds
      if (typingTimeoutsRef.current[typingMemberId]) {
        clearTimeout(typingTimeoutsRef.current[typingMemberId]);
      }
      typingTimeoutsRef.current[typingMemberId] = setTimeout(() => {
        const updated = (useChatStore.getState().typingUsers[roomId] ?? []).filter(
          (id) => id !== typingMemberId
        );
        setTypingUsers(roomId, updated);
        delete typingTimeoutsRef.current[typingMemberId];
      }, 3000);
    });

    // 3. Presence — track online users
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const onlineIds = Object.keys(state);
      useChatStore.getState().setOnlineUsers(onlineIds);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ member_id: memberId, online_at: new Date().toISOString() });
      }
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      // Clear all typing timeouts
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, roomId, handleNewMessage]);

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
  const { addMessage, incrementUnread, activeRoomId } = useChatStore();

  useEffect(() => {
    if (!memberId || roomIds.length === 0) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel('chat:global');

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
        if (!roomIds.includes(msgRoomId)) return;
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
        };

        void supabase
          .from('choir_members')
          .select('id, first_name, last_name, photo_url')
          .eq('id', senderId)
          .single()
          .then(({ data }) => {
            if (data) newMessage.sender = data;
            // Only add to store if not on that room's page already
            if (msgRoomId !== activeRoomId) {
              addMessage(msgRoomId, newMessage);
              incrementUnread(msgRoomId);
            }
          });
      }
    );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, roomIds.join(',')]);
}
