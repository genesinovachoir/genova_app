'use client';

import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Archive, Bell, BellOff, EyeOff, Info, LogOut } from 'lucide-react';
import type { ChatRoom } from '@/lib/chat';

interface RoomListContextMenuProps {
  room: ChatRoom | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onOpenInfo: (room: ChatRoom) => void;
  onToggleNotifications: (room: ChatRoom) => void;
  onHideForMe: (room: ChatRoom) => void;
  onLeaveRoom: (room: ChatRoom) => void;
  onArchiveRoom: (room: ChatRoom) => void;
}

export function RoomListContextMenu({
  room,
  position,
  onClose,
  onOpenInfo,
  onToggleNotifications,
  onHideForMe,
  onLeaveRoom,
  onArchiveRoom,
}: RoomListContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = room !== null && position !== null;

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside);
    }, 80);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose]);

  const getMenuStyle = useCallback(() => {
    if (!position) return {};
    const menuWidth = 240;
    const menuHeight = 280;
    let x = position.x - menuWidth / 2;
    let y = position.y - menuHeight - 12;

    if (x < 12) x = 12;
    if (x + menuWidth > window.innerWidth - 12) x = window.innerWidth - menuWidth - 12;
    if (y < 12) y = position.y + 18;

    return { left: x, top: y };
  }, [position]);

  const handleAction = useCallback(
    (action: 'info' | 'toggle_notifications' | 'hide' | 'leave' | 'archive') => {
      if (!room) return;
      if (action === 'info') onOpenInfo(room);
      if (action === 'toggle_notifications') onToggleNotifications(room);
      if (action === 'hide') onHideForMe(room);
      if (action === 'leave') onLeaveRoom(room);
      if (action === 'archive') onArchiveRoom(room);
      onClose();
    },
    [onArchiveRoom, onClose, onHideForMe, onLeaveRoom, onOpenInfo, onToggleNotifications, room]
  );

  const notificationsEnabled = room?.my_membership?.notifications_enabled ?? true;
  const canArchive = room?.type === 'custom' && room?.my_membership?.role === 'admin';
  const canLeave = room?.type !== 'dm';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="room-list-context-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[210] bg-black/20 backdrop-blur-[1px]"
        />
      )}
      {isOpen && room && (
        <motion.div
          key="room-list-context-content"
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 8 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="fixed z-[211] w-[240px] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl"
          style={getMenuStyle()}
        >
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="truncate text-sm font-semibold text-[var(--color-text-high)]">{room.name}</p>
          </div>

          <div className="py-1.5">
            <ContextItem
              icon={Info}
              label="Bilgi"
              onClick={() => handleAction('info')}
            />
            <ContextItem
              icon={notificationsEnabled ? BellOff : Bell}
              label={notificationsEnabled ? 'Sessize Al' : 'Sesi Aç'}
              onClick={() => handleAction('toggle_notifications')}
            />
            <ContextItem
              icon={EyeOff}
              label="Benden Sil"
              onClick={() => handleAction('hide')}
            />
            {canLeave && (
              <ContextItem
                icon={LogOut}
                label="Odadan Ayrıl"
                onClick={() => handleAction('leave')}
                destructive
              />
            )}
            {canArchive && (
              <ContextItem
                icon={Archive}
                label="Grubu Sil"
                onClick={() => handleAction('archive')}
                destructive
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ContextItem({
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
        destructive ? 'text-red-500' : 'text-[var(--color-text-high)]'
      }`}
    >
      <Icon size={18} className={destructive ? 'text-red-500' : 'text-[var(--color-text-medium)]'} />
      <span className="font-medium">{label}</span>
    </button>
  );
}
