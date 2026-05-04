'use client';

import { use } from 'react';
import { ChatRoom } from '@/components/chat/ChatRoom';

export default function ChatRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <ChatRoom slug={slug} />;
}
