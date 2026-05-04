'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MoreVertical, Loader2, ChevronDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { supabase } from '@/lib/supabase';
import {
  fetchMessages,
  sendMessage,
  sendMultiImageMessage,
  markRoomAsRead,
  fetchRoomMembers,
  fetchReactionsForMessages,
  addReaction,
  removeReaction,
  editMessage,
  deleteMessage,
  deleteMessageForMe,
  createPollMessage,
  starMessage,
  unstarMessage,
  fetchStarredMessages,
} from '@/lib/chat';
import type { ChatMessage, ChatRoomMember, LinkPreviewData } from '@/lib/chat';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { MessageContextMenu } from './MessageContextMenu';
import { RoomInfoDrawer } from './RoomInfoDrawer';
import { CreatePollModal } from './CreatePollModal';
import { StickerPicker } from './StickerPicker';
import { ImageGalleryViewer } from './ImageGalleryViewer';
import { MessageInfoModal } from './MessageInfoModal';

interface ChatRoomProps {
  slug: string;
}

type RoomReferenceRow = {
  id: string;
  slug: string | null;
};

type RoomMembershipRow = {
  room_id: string;
  chat_rooms: RoomReferenceRow | RoomReferenceRow[] | null;
};

function extractRoomReference(row: RoomMembershipRow | null): RoomReferenceRow | null {
  if (!row) return null;
  if (Array.isArray(row.chat_rooms)) {
    return row.chat_rooms[0] ?? null;
  }
  return row.chat_rooms ?? null;
}

export function ChatRoom({ slug }: ChatRoomProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { member, isLoading: isAuthLoading } = useAuth();
  const setActiveRoomId = useChatStore((state) => state.setActiveRoomId);
  const setRoomInfoOpen = useChatStore((state) => state.setRoomInfoOpen);
  
  // Specific selectors to avoid full-store re-renders
  const messagesByRoom = useChatStore((state) => state.messagesByRoom);
  const rooms = useChatStore((state) => state.rooms);
  const typingUsers = useChatStore((state) => state.typingUsers);
  const onlineUsers = useChatStore((state) => state.onlineUsers);
  const starredMessageIds = useChatStore((state) => state.starredMessageIds);
  const contextMenuMessage = useChatStore((state) => state.contextMenuMessage);
  const contextMenuPosition = useChatStore((state) => state.contextMenuPosition);
  const editingMessage = useChatStore((state) => state.editingMessage);
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const setReplyingTo = useChatStore((state) => state.setReplyingTo);

  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(null);
  const [isResolvingRoom, setIsResolvingRoom] = useState(true);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [roomMembers, setRoomMembers] = useState<ChatRoomMember[]>([]);
  const [isPollModalOpen, setIsPollModalOpen] = useState(false);
  const [isStickerOpen, setIsStickerOpen] = useState(false);
  const [infoMessage, setInfoMessage] = useState<ChatMessage | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Gallery state
  const [galleryImages, setGalleryImages] = useState<ChatMessage[]>([]);
  const [galleryIndex, setGalleryIndex] = useState<number>(0);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialLoad = useRef(true);

  const roomId = resolvedRoomId;
  const messages = roomId ? messagesByRoom[roomId] ?? [] : [];
  const room = roomId ? rooms.find((r) => r.id === roomId) : undefined;
  const { sendTyping } = useChatRealtime(member?.id ?? null, roomId);

  useEffect(() => {
    let cancelled = false;

    const resolveRoomId = async () => {
      setIsResolvingRoom(true);
      setRoomNotFound(false);
      setResolvedRoomId(null);

      const fromStore = useChatStore
        .getState()
        .rooms.find((r) => r.slug === slug || r.id === slug);
      if (fromStore) {
        if (!cancelled) {
          setResolvedRoomId(fromStore.id);
          if (fromStore.slug && fromStore.slug !== slug) {
            router.replace(`/chat/${fromStore.slug}`);
          }
          setIsResolvingRoom(false);
        }
        return;
      }

      if (isAuthLoading) return;

      if (!member?.id) {
        if (!cancelled) {
          setRoomNotFound(true);
          setIsResolvingRoom(false);
        }
        return;
      }

      try {
        const membershipSelect = 'room_id, chat_rooms!inner(id, slug)';

        const { data: membershipBySlug, error: slugError } = await supabase
          .from('chat_room_members')
          .select(membershipSelect)
          .eq('member_id', member.id)
          .eq('chat_rooms.slug', slug)
          .maybeSingle();

        if (slugError && slugError.code !== 'PGRST116') throw slugError;

        const roomBySlug = extractRoomReference(
          (membershipBySlug as RoomMembershipRow | null) ?? null
        );

        if (roomBySlug?.id) {
          if (!cancelled) {
            setResolvedRoomId(roomBySlug.id as string);
            const canonicalSlug = roomBySlug.slug as string | null;
            if (canonicalSlug && canonicalSlug !== slug) {
              router.replace(`/chat/${canonicalSlug}`);
            }
            setIsResolvingRoom(false);
          }
          return;
        }

        const { data: membershipById, error: idError } = await supabase
          .from('chat_room_members')
          .select(membershipSelect)
          .eq('member_id', member.id)
          .eq('room_id', slug)
          .maybeSingle();

        if (idError && idError.code !== 'PGRST116') throw idError;

        const roomById = extractRoomReference(
          (membershipById as RoomMembershipRow | null) ?? null
        );

        if (!cancelled) {
          if (roomById?.id) {
            setResolvedRoomId(roomById.id as string);
            const canonicalSlug = roomById.slug as string | null;
            if (canonicalSlug && canonicalSlug !== slug) {
              router.replace(`/chat/${canonicalSlug}`);
            }
          } else {
            setResolvedRoomId(null);
            setRoomNotFound(true);
          }
          setIsResolvingRoom(false);
        }
      } catch (err) {
        console.error('Failed to resolve room slug:', err);
        if (!cancelled) {
          setResolvedRoomId(null);
          setRoomNotFound(true);
          setIsResolvingRoom(false);
        }
      }
    };

    void resolveRoomId();

    return () => {
      cancelled = true;
    };
  }, [slug, router, member?.id, isAuthLoading]);

  useEffect(() => {
    if (!roomId) return;
    setActiveRoomId(roomId);
    return () => setActiveRoomId(null);
  }, [roomId, setActiveRoomId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (searchParams.get('info') !== '1') return;
    setRoomInfoOpen(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('info');
    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextUrl);
  }, [pathname, router, searchParams, setRoomInfoOpen]);

  // Load initial messages + reactions
  useEffect(() => {
    if (!member?.id || !roomId) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const [msgs, members] = await Promise.all([
          fetchMessages(roomId),
          fetchRoomMembers(roomId),
        ]);
        const reversedMsgs = msgs.reverse();

        const msgIds = reversedMsgs.map((m) => m.id);
        const [reactionsMap, starredData] = await Promise.all([
          fetchReactionsForMessages(msgIds),
          fetchStarredMessages(member.id, roomId)
        ]);
        
        const msgsWithReactions = reversedMsgs.map((m) => ({
          ...m,
          reactions: reactionsMap[m.id] ?? [],
        }));

        useChatStore.getState().setMessages(roomId, msgsWithReactions);
        useChatStore.getState().setStarredMessageIds(starredData.map((m: any) => m.id));
        setRoomMembers(members);
        setHasMore(msgs.length >= 40);
        await markRoomAsRead(roomId, member.id);
        useChatStore.getState().clearUnread(roomId);

        // Broadcast read receipt
        // (handled via realtime broadcast to notify other users)
      } catch (err) {
        console.error('Load failed:', err);
      } finally {
        setIsLoading(false);
        initialLoad.current = true;
      }
    };
    void load();
  }, [roomId, member?.id]);

  // Scroll to bottom
  const lastMessageId = messages[messages.length - 1]?.id;
  const lastMessageSenderId = messages[messages.length - 1]?.sender_id;

  useEffect(() => {
    if (initialLoad.current && lastMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      initialLoad.current = false;
    } else if (lastMessageId) {
      if (lastMessageSenderId === member?.id) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const c = scrollRef.current;
        if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 150)
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [lastMessageId, lastMessageSenderId, member?.id]);

  // Load more handler
  const handleLoadMore = useCallback(async () => {
    if (!roomId || isLoadingMore || !hasMore || messages.length === 0) return;
    setIsLoadingMore(true);
    const prevH = scrollRef.current?.scrollHeight ?? 0;
    try {
      const older = await fetchMessages(roomId, {
        before: messages[0].created_at,
      });
      if (older.length < 40) setHasMore(false);
      if (older.length > 0) {
        // Fetch reactions for older messages
        const msgIds = older.map((m) => m.id);
        const reactionsMap = await fetchReactionsForMessages(msgIds);
        const olderWithReactions = older
          .reverse()
          .map((m) => ({ ...m, reactions: reactionsMap[m.id] ?? [] }));

        useChatStore.getState().prependMessages(roomId, olderWithReactions);
        requestAnimationFrame(() => {
          if (scrollRef.current)
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevH;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, messages, roomId]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onScroll = () => {
      if (c.scrollTop < 100) void handleLoadMore();
      
      const distanceFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
      setShowScrollButton(distanceFromBottom > 200);
    };
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => c.removeEventListener('scroll', onScroll);
  }, [handleLoadMore]);

  // Send message (or update if editing)
  const handleSend = useCallback(
    async (content: string, linkPreview?: LinkPreviewData | null) => {
      if (!member?.id || !roomId) return;

      // If editing, update the existing message
      if (editingMessage) {
        const msgId = editingMessage.id;
        try {
          await editMessage(msgId, content);
          useChatStore.getState().updateMessage(roomId, msgId, {
            content,
            is_edited: true,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error('Edit failed:', err);
        }
        setEditingMessage(null);
        return;
      }

      // Normal send with optimistic UI
      const replyTo = useChatStore.getState().replyingTo;
      const metadataJson = linkPreview ? { link_preview: linkPreview } : {};
      const tempId = `temp-${Date.now()}`;
      const opt: ChatMessage = {
        id: tempId,
        room_id: roomId,
        sender_id: member.id,
        content,
        message_type: 'text',
        reply_to_id: replyTo?.id ?? null,
        reply_to: replyTo
          ? {
              id: replyTo.id,
              content: replyTo.content,
              sender_id: replyTo.sender_id,
              choir_members: replyTo.sender
                ? {
                    first_name: replyTo.sender.first_name,
                    last_name: replyTo.sender.last_name,
                  }
                : null,
            }
          : null,
        metadata_json: metadataJson,
        is_edited: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sender: {
          id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          photo_url: member.photo_url ?? null,
        },
      };
      useChatStore.getState().addMessage(roomId, opt);
      setReplyingTo(null);
      try {
        const real = await sendMessage(roomId, member.id, content, {
          replyToId: replyTo?.id ?? null,
          metadataJson,
        });
        useChatStore
          .getState()
          .updateMessage(roomId, tempId, {
            id: real.id,
            created_at: real.created_at,
            reply_to: real.reply_to ?? opt.reply_to,
          });
      } catch {
        useChatStore
          .getState()
          .updateMessage(roomId, tempId, {
            metadata_json: { _failed: true },
          });
      }
    },
    [member, roomId, editingMessage, setEditingMessage]
  );

  // Image upload handler
  const handleImageSelect = useCallback(
    async (files: File[]) => {
      if (!member?.id || !roomId || files.length === 0) return;
      const replyTo = useChatStore.getState().replyingTo;
      const tempId = `temp-${Date.now()}`;
      
      const objectUrls = files.map(f => URL.createObjectURL(f));
      
      // Optimistic UI: show a placeholder bubble immediately
      const opt: ChatMessage = {
        id: tempId,
        room_id: roomId,
        sender_id: member.id,
        content: null,
        message_type: 'image',
        reply_to_id: replyTo?.id ?? null,
        reply_to: replyTo
          ? {
              id: replyTo.id,
              content: replyTo.content,
              sender_id: replyTo.sender_id,
              choir_members: replyTo.sender
                ? {
                    first_name: replyTo.sender.first_name,
                    last_name: replyTo.sender.last_name,
                  }
                : null,
            }
          : null,
        metadata_json: { urls: objectUrls },
        is_edited: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sender: {
          id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          photo_url: member.photo_url ?? null,
        },
      };
      useChatStore.getState().addMessage(roomId, opt);
      setReplyingTo(null);
      try {
        const real = await sendMultiImageMessage(roomId, member.id, files, {
          replyToId: replyTo?.id ?? null,
        });
        useChatStore.getState().updateMessage(roomId, tempId, {
          id: real.id,
          metadata_json: real.metadata_json,
          created_at: real.created_at,
        });
        
        // Revoke object urls to free memory
        objectUrls.forEach(url => window.URL.revokeObjectURL(url));
      } catch (err) {
        console.error('Failed to send images:', err);
        useChatStore.getState().removeOptimisticMessage(roomId, tempId);
      }
    },
    [member, roomId]
  );

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    if (msg.content) {
      void navigator.clipboard.writeText(msg.content);
    }
  }, []);

  const handleDeleteMessage = useCallback(
    async (msg: ChatMessage, type: 'me' | 'everyone') => {
      if (!roomId) return;
      const confirmText = type === 'me' 
        ? 'Bu mesajı kendinizden silmek istediğinize emin misiniz?' 
        : 'Bu mesajı herkesten silmek istediğinize emin misiniz?';
        
      if (!window.confirm(confirmText)) return;
      
      try {
        if (type === 'everyone') {
          await deleteMessage(msg.id);
          useChatStore.getState().updateMessage(roomId, msg.id, {
            is_deleted: true,
            content: null,
            metadata_json: {},
          });
        } else if (type === 'me' && member?.id) {
          await deleteMessageForMe(msg.id, member.id);
          const currentMetadata = msg.metadata_json || {};
          const deletedFor = Array.isArray(currentMetadata.deleted_for) ? [...currentMetadata.deleted_for] : [];
          deletedFor.push(member.id);
          useChatStore.getState().updateMessage(roomId, msg.id, {
            metadata_json: {
              ...currentMetadata,
              deleted_for: deletedFor,
            }
          });
        }
      } catch (err) {
        console.error('Delete failed:', err);
      }
    },
    [roomId, member?.id]
  );

  const handleReactionToggle = useCallback(
    async (messageId: string, emoji: string) => {
      if (!member?.id || !roomId) return;
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;

      const userReacted = msg.reactions?.some(
        (r) => r.member_id === member.id && r.emoji === emoji
      );

      try {
        if (userReacted) {
          await removeReaction(messageId, member.id, emoji);
          useChatStore.getState().removeReactionFromMessage(roomId, messageId, msg.reactions?.find(r => r.member_id === member.id && r.emoji === emoji)?.id ?? '');
        } else {
          await addReaction(messageId, member.id, emoji);
          useChatStore.getState().addReactionToMessage(roomId, messageId, {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            member_id: member.id,
            emoji,
            created_at: new Date().toISOString(),
            choir_members: {
              first_name: member.first_name,
              last_name: member.last_name,
              photo_url: member.photo_url ?? null,
            },
          });
        }
      } catch (err) {
        console.error('Reaction failed:', err);
      }
    },
    [member?.id, messages, roomId]
  );

  const handleToggleStar = useCallback(async (msg: ChatMessage) => {
    if (!member?.id) return;
    const isStarred = useChatStore.getState().starredMessageIds.includes(msg.id);
    if (isStarred) {
      await unstarMessage(msg.id, member.id);
      useChatStore.getState().removeStarredMessageId(msg.id);
    } else {
      await starMessage(msg.id, member.id);
      useChatStore.getState().addStarredMessageId(msg.id);
    }
  }, [member?.id]);

  const handleGoToMessage = useCallback((messageId: string) => {
    const event = new CustomEvent('scrollToMessage', { detail: messageId });
    window.dispatchEvent(event);
  }, []);

  const handleImageClick = useCallback((msg: ChatMessage, imageIndex: number) => {
    const images = messages.filter(m => m.message_type === 'image');
    
    const flattened: ChatMessage[] = [];
    images.forEach(im => {
      const meta = im.metadata_json as any;
      if (meta?.urls && Array.isArray(meta.urls)) {
        meta.urls.forEach((url: string, idx: number) => {
          flattened.push({ ...im, metadata_json: { url, originalIndex: idx } });
        });
      } else if (meta?.url) {
        flattened.push(im);
      }
    });

    let foundIndex = 0;
    const targetUrl = Array.isArray((msg.metadata_json as any)?.urls) 
      ? (msg.metadata_json as any).urls[imageIndex] 
      : (msg.metadata_json as any)?.url;
      
    const idx = flattened.findIndex(f => (f.metadata_json as any)?.url === targetUrl);
    if (idx !== -1) foundIndex = idx;
    
    setGalleryImages(flattened);
    setGalleryIndex(foundIndex);
    setIsGalleryOpen(true);
  }, [messages]);

  // Grouped messages by date
  const grouped = useMemo(() => {
    const g: { date: string; msgs: ChatMessage[] }[] = [];
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const last = g[g.length - 1];
      if (last && last.date === d) last.msgs.push(m);
      else g.push({ date: d, msgs: [m] });
    }
    return g;
  }, [messages]);

  const typingInRoom = roomId ? typingUsers[roomId] ?? [] : [];
  const typingText = useMemo(() => {
    if (typingInRoom.length === 0) return null;
    const names = typingInRoom
      .map(
        (id) =>
          roomMembers.find((rm) => rm.member_id === id)?.choir_members
            ?.first_name
      )
      .filter(Boolean);
    if (names.length === 1) return `${names[0]} yazıyor...`;
    return `${names.length} kişi yazıyor...`;
  }, [typingInRoom, roomMembers]);

  const onlineCount = useMemo(
    () =>
      roomMembers.filter((m) =>
        onlineUsers.includes(m.member_id)
      ).length,
    [roomMembers, onlineUsers]
  );

  const roomName = useMemo(() => {
    if (room?.type === 'dm') {
      const other = roomMembers.find((m) => m.member_id !== member?.id);
      if (other?.choir_members)
        return `${other.choir_members.first_name} ${other.choir_members.last_name}`;
    }
    return room?.name ?? 'Sohbet';
  }, [room, roomMembers, member?.id]);

  if (isResolvingRoom) {
    return (
      <div className="fixed inset-0 z-40 flex h-[100dvh] items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
      </div>
    );
  }

  if (!roomId || roomNotFound) {
    return (
      <div className="fixed inset-0 z-40 flex h-[100dvh] flex-col items-center justify-center gap-4 bg-[var(--color-background)] px-6 text-center">
        <p className="text-sm text-[var(--color-text-medium)]">Sohbet bulunamadı.</p>
        <button
          onClick={() => router.push('/chat')}
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          Sohbet listesine dön
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] flex-col bg-[var(--color-background)]">
      {/* Header */}
      <div className="relative z-50 flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => router.push('/chat')}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--color-text-high)] hover:bg-[var(--color-surface)]"
        >
          <ArrowLeft size={22} className="pointer-events-none" />
        </motion.button>
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => setRoomInfoOpen(true)}
        >
          <h1 className="truncate text-base font-bold text-[var(--color-text-high)]">
            {roomName}
          </h1>
          <p className="text-[0.65rem] text-[var(--color-text-low)]">
            {typingText ? (
              <span className="text-[var(--color-accent)]">{typingText}</span>
            ) : onlineCount > 0 ? (
              `${onlineCount} çevrimiçi · ${roomMembers.length} üye`
            ) : (
              `${roomMembers.length} üye`
            )}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setRoomInfoOpen(true)}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--color-text-medium)] hover:bg-[var(--color-surface)]"
        >
          <MoreVertical size={20} className="pointer-events-none" />
        </motion.button>
      </div>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full w-full overflow-y-auto">
          {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2
              className="animate-spin text-[var(--color-accent)]"
              size={28}
            />
          </div>
        ) : (
          <div className="py-2">
            {isLoadingMore && (
              <div className="flex justify-center py-3">
                <Loader2
                  className="animate-spin text-[var(--color-text-low)]"
                  size={20}
                />
              </div>
            )}
            {grouped.map((g) => (
              <div key={g.date}>
                <div className="flex justify-center py-3">
                  <span className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[0.65rem] font-medium text-[var(--color-text-low)] shadow-sm">
                    {g.date}
                  </span>
                </div>
                {g.msgs.map((msg, idx) => {
                  const isOwn = msg.sender_id === member?.id;
                  const prev = idx > 0 ? g.msgs[idx - 1] : null;
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={isOwn}
                      showSender={
                        !isOwn && prev?.sender_id !== msg.sender_id
                      }
                      currentMemberId={member?.id ?? ''}
                      onLongPress={(m, pos) => useChatStore.getState().openContextMenu(m, pos)}
                      onReactionToggle={handleReactionToggle}
                      onReply={(m) => setReplyingTo(m)}
                      onImageClick={handleImageClick}
                      isStarred={starredMessageIds.includes(msg.id)}
                    />
                  );
                })}
              </div>
            ))}
            <AnimatePresence>
              {typingText && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-6 py-2"
                >
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-low)]"
                        animate={{ y: [0, -4, 0] }}
                        transition={{
                          duration: 0.6,
                          repeat: Infinity,
                          delay: i * 0.15,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[0.7rem] text-[var(--color-text-low)]">
                    {typingText}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
        </div>
        
        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-background)] shadow-md border border-[var(--color-border)] text-[var(--color-text-high)] hover:bg-[var(--color-surface)]"
            >
              <ChevronDown size={20} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <MessageInput
        onSend={handleSend}
        onTyping={sendTyping}
        disabled={isLoading}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        onImageSelect={handleImageSelect}
        onPollCreate={() => setIsPollModalOpen(true)}
        onStickerOpen={() => setIsStickerOpen(true)}
      />

      {/* Context Menu */}
      <MessageContextMenu
        message={contextMenuMessage}
        isOwn={contextMenuMessage?.sender_id === member?.id}
        position={contextMenuPosition}
        isStarred={!!contextMenuMessage && starredMessageIds.includes(contextMenuMessage.id)}
        onClose={useChatStore.getState().closeContextMenu}
        onReply={(m) => setReplyingTo(m)}
        onReact={(m, emoji) => void handleReactionToggle(m.id, emoji)}
        onEdit={(m) => setEditingMessage(m)}
        onDelete={handleDeleteMessage}
        onCopy={handleCopyMessage}
        onInfo={(m) => setInfoMessage(m)}
        onToggleStar={handleToggleStar}
      />

      {/* Message Info Modal */}
      <AnimatePresence>
        {infoMessage && (
          <MessageInfoModal
            messageId={infoMessage.id}
            onClose={() => setInfoMessage(null)}
          />
        )}
      </AnimatePresence>

      {/* Gallery Viewer */}
      {isGalleryOpen && (
        <ImageGalleryViewer
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setIsGalleryOpen(false)}
          onGoToMessage={handleGoToMessage}
        />
      )}

      {/* Room Info Drawer */}
      <RoomInfoDrawer
        roomId={roomId}
        roomMembers={roomMembers}
        onMembersChange={setRoomMembers}
        onGoToMessage={handleGoToMessage}
      />

      {/* Poll Creation Modal */}
      <CreatePollModal
        isOpen={isPollModalOpen}
        onClose={() => setIsPollModalOpen(false)}
        onSubmit={async (data) => {
          if (!member?.id || !roomId) return;
          try {
            const { message } = await createPollMessage(
              roomId,
              member.id,
              data.question,
              data.options,
              {
                isAnonymous: data.isAnonymous,
                isMultipleChoice: data.isMultipleChoice,
              }
            );
            useChatStore.getState().addMessage(roomId, message);
          } catch (err) {
            console.error('Poll creation failed:', err);
          }
        }}
      />

      {/* Sticker Picker */}
      <StickerPicker
        isOpen={isStickerOpen}
        onClose={() => setIsStickerOpen(false)}
        onSelect={async (emoji) => {
          if (!member?.id || !roomId) return;
          const tempId = `temp-${Date.now()}`;
          const replyTo = useChatStore.getState().replyingTo;
          const opt: ChatMessage = {
            id: tempId,
            room_id: roomId,
            sender_id: member.id,
            content: emoji,
            message_type: 'sticker',
            reply_to_id: replyTo?.id ?? null,
            reply_to: replyTo
              ? {
                  id: replyTo.id,
                  content: replyTo.content,
                  sender_id: replyTo.sender_id,
                  choir_members: replyTo.sender
                    ? {
                        first_name: replyTo.sender.first_name,
                        last_name: replyTo.sender.last_name,
                      }
                    : null,
                }
              : null,
            metadata_json: { emoji },
            is_edited: false,
            is_deleted: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sender: {
              id: member.id,
              first_name: member.first_name,
              last_name: member.last_name,
              photo_url: member.photo_url ?? null,
            },
          };
          useChatStore.getState().addMessage(roomId, opt);
          setReplyingTo(null);

          try {
            const real = await sendMessage(roomId, member.id, emoji, {
              messageType: 'sticker',
              metadataJson: { emoji },
              replyToId: replyTo?.id ?? null,
            });
            useChatStore.getState().updateMessage(roomId, tempId, {
              id: real.id,
              created_at: real.created_at,
            });
          } catch (err) {
            console.error('Sticker send failed:', err);
            useChatStore.getState().updateMessage(roomId, tempId, {
              metadata_json: { _failed: true },
            });
          }
        }}
      />
    </div>
  );
}
