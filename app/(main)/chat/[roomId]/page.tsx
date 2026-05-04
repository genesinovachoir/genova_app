'use client';

import { use } from 'react';
import { ChatRoom } from '@/components/chat/ChatRoom';

export default function ChatRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  return <ChatRoom roomId={roomId} />;
}
