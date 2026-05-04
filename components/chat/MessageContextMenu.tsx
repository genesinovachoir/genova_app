'use client';

import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Reply, Copy, Pencil, Trash2, X, Info, Star, StarOff } from 'lucide-react';
import type { ChatMessage } from '@/lib/chat';

const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

interface MessageContextMenuProps {
  message: ChatMessage | null;
  isOwn: boolean;
  position: { x: number; y: number } | null;
  isStarred?: boolean;
  onClose: () => void;
  onReply: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage, type: 'me' | 'everyone') => void;
  onCopy: (message: ChatMessage) => void;
  onInfo: (message: ChatMessage) => void;
  onToggleStar?: (message: ChatMessage) => void;
}

export function MessageContextMenu({
  message,
  isOwn,
  position,
  isStarred,
  onClose,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onCopy,
  onInfo,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = message !== null && position !== null;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use timeout to prevent immediate close from the same touch that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('touchstart', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleReact = useCallback(
    (emoji: string) => {
      if (message) {
        onReact(message, emoji);
        onClose();
      }
    },
    [message, onReact, onClose]
  );

  const handleAction = useCallback(
    (action: 'reply' | 'copy' | 'edit' | 'delete_me' | 'delete_everyone' | 'info' | 'star') => {
      if (!message) return;
      switch (action) {
        case 'reply':
          onReply(message);
          break;
        case 'copy':
          onCopy(message);
          break;
        case 'edit':
          onEdit(message);
          break;
        case 'delete_me':
          onDelete(message, 'me');
          break;
        case 'delete_everyone':
          onDelete(message, 'everyone');
          break;
        case 'info':
          onInfo(message);
          break;
        case 'star':
          onToggleStar?.(message);
          break;
      }
      onClose();
    },
    [message, onReply, onCopy, onEdit, onDelete, onInfo, onToggleStar, onClose]
  );

  const isUnderOneHour = message ? (new Date().getTime() - new Date(message.created_at).getTime() < 60 * 60 * 1000) : false;

  // Calculate position so menu doesn't overflow screen
  const getMenuStyle = () => {
    if (!position) return {};
    const menuWidth = 260;
    const menuHeight = 200;
    let x = position.x - menuWidth / 2;
    let y = position.y - menuHeight - 10;

    // Clamp to viewport
    if (x < 12) x = 12;
    if (x + menuWidth > window.innerWidth - 12) x = window.innerWidth - menuWidth - 12;
    if (y < 12) y = position.y + 20; // Show below if no room above

    return { left: x, top: y };
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] bg-black/20 backdrop-blur-[2px]"
          />

          {/* Menu */}
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            className="fixed z-[201] w-[260px] overflow-hidden rounded-2xl bg-[var(--color-background)] shadow-2xl"
            style={{
              ...getMenuStyle(),
              border: '1px solid var(--color-border)',
            }}
          >
            {/* Quick Emoji Row */}
            <div className="flex items-center justify-around border-b border-[var(--color-border)] px-3 py-2.5">
              {QUICK_EMOJIS.map((emoji) => (
                <motion.button
                  key={emoji}
                  whileTap={{ scale: 1.4 }}
                  onClick={() => handleReact(emoji)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition-colors hover:bg-[var(--color-surface)]"
                >
                  {emoji}
                </motion.button>
              ))}
            </div>

            {/* Actions */}
            <div className="py-1">
              <ContextMenuItem
                icon={Reply}
                label="Yanıtla"
                onClick={() => handleAction('reply')}
              />
              <ContextMenuItem
                icon={isStarred ? StarOff : Star}
                label={isStarred ? "Yıldızı Kaldır" : "Yıldızla"}
                onClick={() => handleAction('star')}
              />
              {isOwn && (
                <ContextMenuItem
                  icon={Info}
                  label="Bilgi"
                  onClick={() => handleAction('info')}
                />
              )}
              {message?.content && (
                <ContextMenuItem
                  icon={Copy}
                  label="Kopyala"
                  onClick={() => handleAction('copy')}
                />
              )}
              {isOwn && message?.message_type === 'text' && !message?.is_deleted && isUnderOneHour && (
                <ContextMenuItem
                  icon={Pencil}
                  label="Düzenle"
                  onClick={() => handleAction('edit')}
                />
              )}
              {isOwn && !message?.is_deleted && isUnderOneHour && (
                <ContextMenuItem
                  icon={Trash2}
                  label="Herkesten Sil"
                  onClick={() => handleAction('delete_everyone')}
                  destructive
                />
              )}
              {!message?.is_deleted && (
                <ContextMenuItem
                  icon={Trash2}
                  label="Benden Sil"
                  onClick={() => handleAction('delete_me')}
                  destructive
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function ContextMenuItem({
  icon: Icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--color-surface)] ${
        destructive
          ? 'text-red-500'
          : 'text-[var(--color-text-high)]'
      }`}
    >
      <Icon size={18} className={destructive ? 'text-red-500' : 'text-[var(--color-text-medium)]'} />
      <span className="font-medium">{label}</span>
    </button>
  );
}
