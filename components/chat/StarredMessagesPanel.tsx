'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { StarOff, MessageCircle, Loader2 } from 'lucide-react';
import { fetchStarredMessages, unstarMessage } from '@/lib/chat';
import type { ChatMessage } from '@/lib/chat';
import { useAuth } from '@/components/AuthProvider';

interface StarredMessagesPanelProps {
  roomId: string;
  onGoToMessage: (messageId: string) => void;
}

export function StarredMessagesPanel({ roomId, onGoToMessage }: StarredMessagesPanelProps) {
  const { member } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadStarred() {
      if (!member?.id) return;
      try {
        const data = await fetchStarredMessages(member.id, roomId);
        setMessages(data);
      } catch (err) {
        console.error('Failed to load starred messages:', err);
      } finally {
        setIsLoading(false);
      }
    }
    void loadStarred();
  }, [member?.id, roomId]);

  const handleUnstar = async (messageId: string) => {
    if (!member?.id) return;
    try {
      await unstarMessage(messageId, member.id);
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      console.error('Failed to unstar:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex p-8 justify-center">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex p-8 flex-col items-center justify-center text-center">
        <StarOff size={32} className="text-[var(--color-text-low)] mb-2 opacity-50" />
        <p className="text-sm text-[var(--color-text-low)]">
          Henüz yıldızlı mesajınız yok.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg) => {
        const senderName = msg.choir_members?.first_name || 'Bilinmeyen';
        const dateStr = new Date(msg.created_at).toLocaleDateString('tr-TR', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        // Snippet of content
        let snippet = msg.content;
        if (msg.message_type === 'image') snippet = '📷 Fotoğraf';
        if (msg.message_type === 'sticker') snippet = '🖼️ Çıkartma';
        if (msg.message_type === 'poll') snippet = '📊 Anket';

        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--color-text-high)]">{senderName}</span>
                <span className="text-[0.65rem] text-[var(--color-text-low)]">{dateStr}</span>
              </div>
              <button
                onClick={() => handleUnstar(msg.id)}
                className="text-amber-400 p-1 hover:bg-black/5 rounded-full transition-colors"
                title="Yıldızı Kaldır"
              >
                <StarOff size={14} />
              </button>
            </div>
            
            <p className="text-sm text-[var(--color-text-medium)] line-clamp-2 mb-3">
              {snippet}
            </p>
            
            <button
              onClick={() => onGoToMessage(msg.id)}
              className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-[var(--color-accent-soft)] py-2 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
            >
              <MessageCircle size={14} />
              Mesaja Git
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
