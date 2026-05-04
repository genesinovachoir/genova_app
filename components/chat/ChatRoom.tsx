'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MoreVertical, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { fetchMessages, sendMessage, markRoomAsRead, fetchRoomMembers } from '@/lib/chat';
import type { ChatMessage, ChatRoomMember } from '@/lib/chat';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';

interface ChatRoomProps { roomId: string; }

export function ChatRoom({ roomId }: ChatRoomProps) {
  const router = useRouter();
  const { member } = useAuth();
  const store = useChatStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [roomMembers, setRoomMembers] = useState<ChatRoomMember[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialLoad = useRef(true);

  const messages = store.messagesByRoom[roomId] ?? [];
  const room = store.rooms.find((r) => r.id === roomId);
  const { sendTyping } = useChatRealtime(member?.id ?? null, roomId);

  useEffect(() => { store.setActiveRoomId(roomId); return () => store.setActiveRoomId(null); }, [roomId]);

  // Load initial messages
  useEffect(() => {
    if (!member?.id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const [msgs, members] = await Promise.all([fetchMessages(roomId), fetchRoomMembers(roomId)]);
        store.setMessages(roomId, msgs.reverse());
        setRoomMembers(members);
        setHasMore(msgs.length >= 40);
        await markRoomAsRead(roomId, member.id);
        store.clearUnread(roomId);
      } catch (err) { console.error('Load failed:', err); }
      finally { setIsLoading(false); initialLoad.current = true; }
    };
    void load();
  }, [roomId, member?.id]);

  // Scroll to bottom
  useEffect(() => {
    if (initialLoad.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      initialLoad.current = false;
    } else if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.sender_id === member?.id) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const c = scrollRef.current;
        if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 150)
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, member?.id]);

  // Load more handler
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || messages.length === 0) return;
    setIsLoadingMore(true);
    const prevH = scrollRef.current?.scrollHeight ?? 0;
    try {
      const older = await fetchMessages(roomId, { before: messages[0].created_at });
      if (older.length < 40) setHasMore(false);
      if (older.length > 0) {
        store.prependMessages(roomId, older.reverse());
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevH;
        });
      }
    } catch (err) { console.error(err); }
    finally { setIsLoadingMore(false); }
  }, [isLoadingMore, hasMore, messages, roomId]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onScroll = () => { if (c.scrollTop < 100) void handleLoadMore(); };
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => c.removeEventListener('scroll', onScroll);
  }, [handleLoadMore]);

  // Send
  const handleSend = useCallback(async (content: string) => {
    if (!member?.id) return;
    const replyTo = useChatStore.getState().replyingTo;
    const tempId = `temp-${Date.now()}`;
    const opt: ChatMessage = {
      id: tempId, room_id: roomId, sender_id: member.id, content,
      message_type: 'text', reply_to_id: replyTo?.id ?? null, metadata_json: {},
      is_edited: false, is_deleted: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      sender: { id: member.id, first_name: member.first_name, last_name: member.last_name, photo_url: member.photo_url ?? null },
    };
    store.addMessage(roomId, opt);
    store.setReplyingTo(null);
    try {
      const real = await sendMessage(roomId, member.id, content, { replyToId: replyTo?.id ?? null });
      useChatStore.getState().updateMessage(roomId, tempId, { id: real.id, created_at: real.created_at });
    } catch { useChatStore.getState().updateMessage(roomId, tempId, { metadata_json: { _failed: true } }); }
  }, [member, roomId]);

  // Grouped messages by date
  const grouped = useMemo(() => {
    const g: { date: string; msgs: ChatMessage[] }[] = [];
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      const last = g[g.length - 1];
      if (last && last.date === d) last.msgs.push(m); else g.push({ date: d, msgs: [m] });
    }
    return g;
  }, [messages]);

  const typingInRoom = store.typingUsers[roomId] ?? [];
  const typingText = useMemo(() => {
    if (typingInRoom.length === 0) return null;
    const names = typingInRoom.map(id => roomMembers.find(rm => rm.member_id === id)?.choir_members?.first_name).filter(Boolean);
    if (names.length === 1) return `${names[0]} yazıyor...`;
    return `${names.length} kişi yazıyor...`;
  }, [typingInRoom, roomMembers]);

  const onlineCount = useMemo(() => roomMembers.filter(m => store.onlineUsers.includes(m.member_id)).length, [roomMembers, store.onlineUsers]);

  const roomName = useMemo(() => {
    if (room?.type === 'dm') {
      const other = roomMembers.find(m => m.member_id !== member?.id);
      if (other?.choir_members) return `${other.choir_members.first_name} ${other.choir_members.last_name}`;
    }
    return room?.name ?? 'Sohbet';
  }, [room, roomMembers, member?.id]);

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => router.push('/chat')} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-high)] hover:bg-[var(--color-surface)]">
          <ArrowLeft size={22} />
        </motion.button>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => store.setRoomInfoOpen(true)}>
          <h1 className="truncate text-base font-bold text-[var(--color-text-high)]">{roomName}</h1>
          <p className="text-[0.65rem] text-[var(--color-text-low)]">
            {typingText ? <span className="text-[var(--color-accent)]">{typingText}</span>
              : onlineCount > 0 ? `${onlineCount} çevrimiçi · ${roomMembers.length} üye` : `${roomMembers.length} üye`}
          </p>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => store.setRoomInfoOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-medium)] hover:bg-[var(--color-surface)]">
          <MoreVertical size={20} />
        </motion.button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-[var(--color-accent)]" size={28} /></div>
        ) : (
          <div className="py-2">
            {isLoadingMore && <div className="flex justify-center py-3"><Loader2 className="animate-spin text-[var(--color-text-low)]" size={20} /></div>}
            {grouped.map(g => (
              <div key={g.date}>
                <div className="flex justify-center py-3">
                  <span className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[0.65rem] font-medium text-[var(--color-text-low)] shadow-sm">{g.date}</span>
                </div>
                {g.msgs.map((msg, idx) => {
                  const isOwn = msg.sender_id === member?.id;
                  const prev = idx > 0 ? g.msgs[idx - 1] : null;
                  return <MessageBubble key={msg.id} message={msg} isOwn={isOwn} showSender={!isOwn && prev?.sender_id !== msg.sender_id} onReply={m => store.setReplyingTo(m)} onLongPress={m => store.setReplyingTo(m)} />;
                })}
              </div>
            ))}
            <AnimatePresence>
              {typingText && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 px-6 py-2">
                  <div className="flex gap-0.5">{[0,1,2].map(i => <motion.div key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-low)]" animate={{ y: [0,-4,0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i*0.15 }} />)}</div>
                  <span className="text-[0.7rem] text-[var(--color-text-low)]">{typingText}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      <MessageInput onSend={handleSend} onTyping={sendTyping} disabled={isLoading} />
    </div>
  );
}
