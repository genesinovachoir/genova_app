'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import { useChatGlobalRealtime } from '@/hooks/useChatRealtime';
import { fetchChatRooms } from '@/lib/chat';
import { readCachedChatRooms, writeCachedChatRooms } from '@/lib/chat-cache';
import { ChatRoomList } from '@/components/chat/ChatRoomList';
import { CreateRoomModal } from '@/components/chat/CreateRoomModal';

export default function ChatPage() {
  const { member } = useAuth();
  const { rooms, setRooms } = useChatStore();

  const roomsQuery = useQuery({
    queryKey: ['chat', 'rooms', member?.id ?? 'guest'],
    queryFn: async () => {
      if (!member?.id) return [];
      const data = await fetchChatRooms(member.id);
      writeCachedChatRooms(member.id, data);
      return data;
    },
    enabled: Boolean(member?.id),
    initialData: () => member?.id ? readCachedChatRooms(member.id) ?? undefined : undefined,
    staleTime: 15_000,
    gcTime: 24 * 60 * 60_000,
  });

  useEffect(() => {
    if (roomsQuery.data) {
      setRooms(roomsQuery.data);
    }
  }, [roomsQuery.data, setRooms]);

  // Global realtime for room list updates
  const visibleRooms = roomsQuery.data ?? rooms;
  const roomIds = useMemo(() => visibleRooms.map((r) => r.id), [visibleRooms]);
  useChatGlobalRealtime(member?.id ?? null, roomIds);
  const isLoading = !roomsQuery.data && roomsQuery.isPending;

  return (
    <div className="flex min-h-screen flex-col pb-28 pt-16">
      {/* Page title */}
      <div className="px-4 pb-2 pt-4">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-high)]">
          Sohbet
        </h1>
        <p className="mt-0.5 text-sm text-[var(--color-text-low)]">
          Koristlerle gerçek zamanlı sohbet
        </p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2
            className="animate-spin text-[var(--color-accent)]"
            size={28}
          />
        </div>
      ) : (
        <ChatRoomList />
      )}

      <CreateRoomModal />
    </div>
  );
}
