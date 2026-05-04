'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Link2, Loader2, MessageCircle } from 'lucide-react';
import { fetchRoomLinks } from '@/lib/chat';
import type { ChatRoomLink } from '@/lib/chat';

interface LinksPanelProps {
  roomId: string;
  onGoToMessage: (messageId: string) => void;
}

function formatLinkDate(value: string): string {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LinksPanel({ roomId, onGoToMessage }: LinksPanelProps) {
  const [links, setLinks] = useState<ChatRoomLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadLinks() {
      try {
        const data = await fetchRoomLinks(roomId);
        setLinks(data);
      } catch (err) {
        console.error('Failed to load room links:', err);
      } finally {
        setIsLoading(false);
      }
    }
    void loadLinks();
  }, [roomId]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <Link2 size={32} className="mb-2 text-[var(--color-text-low)] opacity-50" />
        <p className="text-sm text-[var(--color-text-low)]">
          Bu odada henüz bağlantı paylaşılmadı.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {links.map((link) => (
        <div
          key={link.id}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-[var(--color-text-high)]">
              {link.domain}
            </span>
            <span className="shrink-0 text-[0.65rem] text-[var(--color-text-low)]">
              {formatLinkDate(link.created_at)}
            </span>
          </div>

          <p className="mb-3 line-clamp-2 break-all text-xs text-[var(--color-text-medium)]">
            {link.url}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] py-2 text-xs font-medium text-[var(--color-text-medium)] transition-colors hover:bg-[var(--color-surface)]"
            >
              <ExternalLink size={13} />
              Aç
            </a>
            <button
              onClick={() => onGoToMessage(link.message_id)}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent-soft)] py-2 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
            >
              <MessageCircle size={13} />
              Mesaja Git
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
