'use client';

import { useRef, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { Check, CheckCheck, Clock } from 'lucide-react';
import type { ChatMessage } from '@/lib/chat';
import { ReactionBar } from './ReactionBar';
import { PollCard } from './PollCard';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showSender: boolean;
  currentMemberId: string;
  onLongPress?: (message: ChatMessage, position: { x: number; y: number }) => void;
  onReactionToggle?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

type MessageStatus = 'pending' | 'sent' | 'read';

function MessageStatusIcon({ status, isOwn }: { status: MessageStatus; isOwn: boolean }) {
  if (!isOwn) return null;

  switch (status) {
    case 'pending':
      return <Clock size={12} className="text-white/50" />;
    case 'sent':
      return <CheckCheck size={14} className="text-white/60" />;
    case 'read':
      return <CheckCheck size={14} className="text-blue-300" />;
    default:
      return <Check size={13} className="text-white/60" />;
  }
}

export function MessageBubble({
  message,
  isOwn,
  showSender,
  currentMemberId,
  onLongPress,
  onReactionToggle,
  onReply,
}: MessageBubbleProps) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      longPressTimer.current = setTimeout(() => {
        if (touchStartPos.current) {
          onLongPress?.(message, touchStartPos.current);
        }
      }, 400);
    },
    [message, onLongPress]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Cancel long press if finger moves too much
    if (longPressTimer.current && touchStartPos.current) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Desktop right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onLongPress?.(message, { x: e.clientX, y: e.clientY });
    },
    [message, onLongPress]
  );

  const senderName = useMemo(() => {
    if (!message.sender) return 'Bilinmeyen';
    return `${message.sender.first_name} ${message.sender.last_name}`;
  }, [message.sender]);

  const senderInitial = message.sender?.first_name?.[0] ?? '?';

  // Message status from metadata
  const messageStatus: MessageStatus = useMemo(() => {
    if (message.id.startsWith('temp-')) return 'pending';
    const meta = message.metadata_json as Record<string, unknown>;
    if (meta?._status === 'read') return 'read';
    if (meta?._failed) return 'pending';
    return 'sent';
  }, [message.id, message.metadata_json]);

  if (message.is_deleted) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-4 py-0.5`}>
        <div className="rounded-2xl bg-[var(--color-surface)] px-4 py-2 opacity-50">
          <p className="text-xs italic text-[var(--color-text-low)]">
            🚫 Bu mesaj silindi
          </p>
        </div>
      </div>
    );
  }

  if (message.message_type === 'system') {
    return (
      <div className="flex justify-center px-4 py-2">
        <div className="rounded-full bg-[var(--color-surface)] px-4 py-1.5">
          <p className="text-center text-xs text-[var(--color-text-low)]">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-[2px]`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={handleContextMenu}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: isOwn ? 0.2 : 0, right: isOwn ? 0 : 0.2 }}
      onDragEnd={(e, info) => {
        if (isOwn && info.offset.x < -30) {
          onReply?.(message);
        } else if (!isOwn && info.offset.x > 30) {
          onReply?.(message);
        }
      }}
    >
      {/* Avatar for other users */}
      {!isOwn && showSender && (
        <div className="mr-2 mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)]">
          {message.sender?.photo_url ? (
            <img
              src={message.sender.photo_url}
              alt={senderName}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span className="text-xs font-bold text-[var(--color-accent)]">
              {senderInitial}
            </span>
          )}
        </div>
      )}
      {!isOwn && !showSender && <div className="mr-2 w-7 shrink-0" />}

      {/* Bubble + Reactions wrapper */}
      <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Bubble */}
        <div
          className={`relative ${
            message.message_type === 'sticker'
              ? ''
              : `rounded-2xl px-3 py-2 ${
                  isOwn
                    ? 'rounded-br-md bg-[var(--color-accent)] text-white'
                    : 'rounded-bl-md bg-[var(--color-surface)] text-[var(--color-text-high)]'
                }`
          }`}
          style={{
            boxShadow: message.message_type === 'sticker'
              ? 'none'
              : isOwn
                ? '0 1px 3px rgba(0,0,0,0.15)'
                : '0 1px 2px rgba(0,0,0,0.06)',
          }}
        >
          {/* Sender name (group chats) */}
          {!isOwn && showSender && (
            <p className="mb-0.5 text-[0.7rem] font-semibold text-[var(--color-accent)]">
              {senderName}
            </p>
          )}

          {/* Reply preview */}
          {message.reply_to && (
            <div
              className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 ${
                isOwn
                  ? 'border-white/50 bg-white/15'
                  : 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
              }`}
            >
              <p
                className={`truncate text-[0.65rem] font-medium ${
                  isOwn ? 'text-white/80' : 'text-[var(--color-accent)]'
                }`}
              >
                {message.reply_to.choir_members?.first_name ?? 'Bilinmeyen'}
              </p>
              <p
                className={`truncate text-[0.65rem] ${
                  isOwn ? 'text-white/60' : 'text-[var(--color-text-low)]'
                }`}
              >
                {message.reply_to.content ?? '📷 Medya'}
              </p>
            </div>
          )}

          {/* Content */}
          {message.message_type === 'text' && (
            <p className="whitespace-pre-wrap break-words text-[0.88rem] leading-snug">
              {message.content}
            </p>
          )}

          {message.message_type === 'image' && (
            <div className="overflow-hidden rounded-xl">
              <img
                src={(message.metadata_json?.url as string) ?? ''}
                alt="Paylaşılan resim"
                className="max-h-64 w-full object-cover"
                loading="lazy"
              />
              {message.content && (
                <p className="mt-1 whitespace-pre-wrap break-words text-[0.88rem] leading-snug">
                  {message.content}
                </p>
              )}
            </div>
          )}

          {message.message_type === 'sticker' && (
            <div className="flex items-center justify-center py-1">
              {(message.metadata_json?.emoji as string) ? (
                <span className="text-7xl">{message.metadata_json.emoji as string}</span>
              ) : (
                <img
                  src={(message.metadata_json?.url as string) ?? ''}
                  alt="Çıkartma"
                  className="h-32 w-32 object-contain"
                  loading="lazy"
                />
              )}
            </div>
          )}

          {message.message_type === 'poll' && (
            <PollCard messageId={message.id} isOwn={isOwn} />
          )}

          {/* Time + Status */}
          <div
            className={`mt-0.5 flex items-center justify-end gap-1 ${
              isOwn ? 'text-white/60' : 'text-[var(--color-text-low)]'
            }`}
          >
            {message.is_edited && (
              <span className="text-[0.6rem]">düzenlendi</span>
            )}
            <span className="text-[0.6rem]">
              {formatMessageTime(message.created_at)}
            </span>
            <MessageStatusIcon status={messageStatus} isOwn={isOwn} />
          </div>
        </div>

        {/* Reaction Bar */}
        {message.reactions && message.reactions.length > 0 && (
          <ReactionBar
            reactions={message.reactions}
            currentMemberId={currentMemberId}
            onReactionClick={(emoji) => onReactionToggle?.(message.id, emoji)}
          />
        )}
      </div>
    </motion.div>
  );
}
