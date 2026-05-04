'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import { useChatGlobalRealtime } from '@/hooks/useChatRealtime';
import { fetchChatRooms } from '@/lib/chat';
import { ChatRoomList } from '@/components/chat/ChatRoomList';
import { CreateRoomModal } from '@/components/chat/CreateRoomModal';

export default function ChatPage() {
  const { member } = useAuth();
  const { rooms, setRooms } = useChatStore();
  const [isLoading, setIsLoading] = useState(true);

  // Load rooms
  useEffect(() => {
    if (!member?.id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchChatRooms(member.id);
        setRooms(data);
      } catch (err) {
        console.error('Failed to load chat rooms:', err);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [member?.id, setRooms]);

  // Global realtime for room list updates
  const roomIds = rooms.map((r) => r.id);
  useChatGlobalRealtime(member?.id ?? null, roomIds);

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
