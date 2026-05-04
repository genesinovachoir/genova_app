'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Plus, Users, MessageCircle, Hash,
  ChevronRight, User,
} from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import { useAuth } from '@/components/AuthProvider';
import type { ChatRoom } from '@/lib/chat';

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'şimdi';
  if (diffMins < 60) return `${diffMins}dk`;
  if (diffHours < 24) return `${diffHours}sa`;
  if (diffDays < 7) {
    const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    return days[date.getDay()];
  }
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function getMessagePreview(room: ChatRoom): string {
  if (!room.last_message) return 'Henüz mesaj yok';
  if (room.last_message.is_deleted) return '🚫 Bu mesaj silindi';

  const senderName = room.last_message.sender
    ? `${room.last_message.sender.first_name}: `
    : '';

  switch (room.last_message.message_type) {
    case 'image':
      return `${senderName}📷 Fotoğraf`;
    case 'sticker':
      return `${senderName}🎨 Çıkartma`;
    case 'poll':
      return `${senderName}📊 Anket`;
    case 'system':
      return room.last_message.content ?? 'Sistem mesajı';
    default:
      return `${senderName}${room.last_message.content ?? ''}`;
  }
}

function getRoomIcon(room: ChatRoom) {
  if (room.type === 'dm') return User;
  if (room.type === 'general') return Users;
  if (room.type === 'voice_group') return MessageCircle;
  return Hash;
}

function getRoomDisplayName(room: ChatRoom, memberId: string | undefined): string {
  if (room.type === 'dm' && room.last_message?.sender) {
    // For DM, show the other person's name
    if (room.last_message.sender.id !== memberId) {
      return `${room.last_message.sender.first_name} ${room.last_message.sender.last_name}`;
    }
  }
  return room.name;
}

export function ChatRoomList() {
  const router = useRouter();
  const { member } = useAuth();
  const { rooms, setCreateRoomOpen, onlineUsers } = useChatStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRooms = useMemo(() => {
    if (!searchQuery.trim()) return rooms;
    const q = searchQuery.toLowerCase();
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }, [rooms, searchQuery]);

  const handleRoomClick = (roomId: string) => {
    router.push(`/chat/${roomId}`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Search + New Room */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-low)]"
            size={16}
          />
          <input
            type="text"
            placeholder="Sohbet ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-4 text-sm text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setCreateRoomOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)] text-white shadow-md"
        >
          <Plus size={20} />
        </motion.button>
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto px-2">
        <AnimatePresence initial={false}>
          {filteredRooms.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <MessageCircle
                className="mb-3 text-[var(--color-text-low)]"
                size={40}
                strokeWidth={1.2}
              />
              <p className="text-sm text-[var(--color-text-medium)]">
                {searchQuery ? 'Sonuç bulunamadı' : 'Henüz sohbet yok'}
              </p>
            </motion.div>
          ) : (
            filteredRooms.map((room, index) => {
              const Icon = getRoomIcon(room);
              const displayName = getRoomDisplayName(room, member?.id);
              const preview = getMessagePreview(room);
              const timeStr = room.last_message
                ? formatRelativeTime(room.last_message.created_at)
                : '';
              const hasUnread = (room.unread_count ?? 0) > 0;

              // Check if any room member is online
              const hasOnlineMember =
                room.type !== 'general' &&
                onlineUsers.some(
                  (id) => id !== member?.id
                );

              return (
                <motion.button
                  key={room.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => handleRoomClick(room.id)}
                  className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.98]"
                >
                  {/* Avatar */}
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)]">
                    {room.avatar_url ? (
                      <img
                        src={room.avatar_url}
                        alt={displayName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <Icon
                        size={22}
                        className="text-[var(--color-accent)]"
                      />
                    )}
                    {/* Online indicator */}
                    {hasOnlineMember && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[var(--color-background)] bg-green-500" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[0.94rem] ${
                          hasUnread
                            ? 'font-bold text-[var(--color-text-high)]'
                            : 'font-medium text-[var(--color-text-high)]'
                        }`}
                      >
                        {displayName}
                      </span>
                      <span
                        className={`shrink-0 text-[0.7rem] ${
                          hasUnread
                            ? 'font-semibold text-[var(--color-accent)]'
                            : 'text-[var(--color-text-low)]'
                        }`}
                      >
                        {timeStr}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`truncate text-[0.8rem] ${
                          hasUnread
                            ? 'font-medium text-[var(--color-text-medium)]'
                            : 'text-[var(--color-text-low)]'
                        }`}
                      >
                        {preview}
                      </p>
                      {hasUnread && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[0.65rem] font-bold text-white">
                          {room.unread_count! > 99 ? '99+' : room.unread_count}
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronRight
                    size={16}
                    className="shrink-0 text-[var(--color-text-low)] opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </motion.button>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
