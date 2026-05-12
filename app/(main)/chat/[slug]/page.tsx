'use client';

import { use } from 'react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { SwipeBack } from '@/components/SwipeBack';

export default function ChatRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <SwipeBack fallback="/chat">
      <ChatRoom slug={slug} />
    </SwipeBack>
  );
}
