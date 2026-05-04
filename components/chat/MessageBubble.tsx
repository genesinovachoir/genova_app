'use client';

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check, CheckCheck, Clock, Star, Trash2 } from 'lucide-react';
import type { ChatMessage, LinkPreviewData } from '@/lib/chat';
import { ReactionBar } from './ReactionBar';
import { PollCard } from './PollCard';
import { LinkPreviewCard } from './LinkPreviewCard';
import { formatWhatsApp } from '@/lib/formatText';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showSender: boolean;
  currentMemberId: string;
  onLongPress?: (message: ChatMessage, position: { x: number; y: number }) => void;
  onReactionToggle?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
  onImageClick?: (message: ChatMessage, imageIndex: number) => void;
  isStarred?: boolean;
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

function parseLinkPreview(value: unknown): LinkPreviewData | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== 'string' || typeof record.domain !== 'string') {
    return null;
  }
  return {
    url: record.url,
    domain: record.domain,
    title: typeof record.title === 'string' ? record.title : null,
    description: typeof record.description === 'string' ? record.description : null,
    image: typeof record.image === 'string' ? record.image : null,
    favicon: typeof record.favicon === 'string' ? record.favicon : null,
  };
}

export function MessageBubble({
  message,
  isOwn,
  showSender,
  currentMemberId,
  onLongPress,
  onReactionToggle,
  onReply,
  onImageClick,
  isStarred = false,
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
  const linkPreview = useMemo(
    () => parseLinkPreview((message.metadata_json as Record<string, unknown> | null)?.link_preview),
    [message.metadata_json]
  );

  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    const handleScrollToMessage = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail === message.id) {
        // Find the element and scroll
        const element = document.getElementById(`message-${message.id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Trigger highlight
          setIsHighlighted(true);
          setTimeout(() => setIsHighlighted(false), 1800);
        }
      }
    };

    window.addEventListener('scrollToMessage', handleScrollToMessage);
    return () => window.removeEventListener('scrollToMessage', handleScrollToMessage);
  }, [message.id]);

  const [isRevealed, setIsRevealed] = useState(() => {
    if (typeof window === 'undefined' || message.message_type !== 'image') {
      return false;
    }
    return localStorage.getItem(`revealed-${message.id}`) === 'true';
  });

  const handleImageClick = async (index: number, url: string) => {
    if (!isRevealed) {
      localStorage.setItem(`revealed-${message.id}`, 'true');
      setIsRevealed(true);

      // Keep the original reveal/download behavior for media messages.
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `photo-${message.id}-${index}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(objectUrl);
      } catch (err) {
        console.error('Auto download failed', err);
      }
    }

    // Defer the image click to allow state to settle
    setTimeout(() => {
      onImageClick?.(message, index);
    }, 50);
  };

  if (message.is_deleted) {
    return (
      <div id={`message-${message.id}`} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-1 opacity-60`}>
        <div className="flex items-center gap-1.5 rounded-2xl bg-[var(--color-surface)] px-3 py-1.5 border border-[var(--color-border)]">
          <Trash2 size={14} className="text-[var(--color-text-low)]" />
          <p className="text-[0.8rem] font-semibold italic text-[var(--color-text-low)]">
            Bu mesaj silindi
          </p>
        </div>
      </div>
    );
  }

  if (message.message_type === 'system') {
    return (
      <div id={`message-${message.id}`} className="flex justify-center px-4 py-2">
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
      id={`message-${message.id}`}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-1`}
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
      <div className={`max-w-[80%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Bubble */}
        <div
          className={`relative rounded-3xl ${
            message.message_type === 'image' || message.message_type === 'sticker'
              ? 'bg-transparent shadow-none'
              : isOwn
                ? 'rounded-tr-sm bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dark)] px-3 py-2 text-white shadow-md'
                : 'rounded-tl-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text-high)] shadow-sm'
          } ${
            isHighlighted
              ? 'animate-[message-highlight-glow_1.5s_ease-out]'
              : ''
          }`}
        >
          {/* Sender name (group chats) */}
          {!isOwn && showSender && (
            <p className="mb-1 text-[0.7rem] font-semibold text-[var(--color-accent)]">
              {senderName}
            </p>
          )}

          {/* Reply preview */}
          {(() => {
            const replyRaw = message.reply_to as ChatMessage['reply_to'] | ChatMessage['reply_to'][] | null | undefined;
            const replyData = Array.isArray(replyRaw) ? replyRaw[0] : replyRaw;
            if (!replyData || (!replyData.content && !replyData.choir_members)) return null;
            
            return (
              <div
                className={`mb-2 rounded-lg border-l-2 px-2 py-1 cursor-pointer transition-colors ${
                  isOwn
                    ? 'border-white/50 bg-white/15 hover:bg-white/25'
                    : 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/20'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  // Dispatch a custom event or call a prop to scroll to message
                  const event = new CustomEvent('scrollToMessage', { detail: replyData.id });
                  window.dispatchEvent(event);
                }}
              >
                <p
                  className={`truncate text-[0.65rem] font-medium ${
                    isOwn ? 'text-white/80' : 'text-[var(--color-accent)]'
                  }`}
                >
                  {replyData.choir_members?.first_name ?? 'Bilinmeyen'}
                </p>
                <p
                  className={`truncate text-[0.65rem] ${
                    isOwn ? 'text-white/60' : 'text-[var(--color-text-low)]'
                  }`}
                >
                  {replyData.content ?? '📷 Medya'}
                </p>
              </div>
            );
          })()}

          {/* Content */}
          {message.message_type === 'text' && (
            <>
              <p className="whitespace-pre-wrap break-words text-[0.88rem] leading-snug">
                {formatWhatsApp(message.content ?? '', {
                  linkClassName: isOwn
                    ? 'text-white underline underline-offset-2'
                    : 'text-[var(--color-accent)] underline underline-offset-2',
                })}
              </p>
              {linkPreview && (
                <LinkPreviewCard preview={linkPreview} variant="bubble" isOwn={isOwn} />
              )}
            </>
          )}

          {message.message_type === 'image' && (() => {
            const meta = message.metadata_json as Record<string, unknown> | undefined;
            let urls: string[] = [];
            if (meta) {
              if (Array.isArray(meta.urls)) urls = meta.urls as string[];
              else if (typeof meta.url === 'string') urls = [meta.url];
            }
            if (urls.length === 0) return null;

            // Compute grid layout
            let gridClass = 'grid-cols-1';
            if (urls.length === 2 || urls.length === 4) gridClass = 'grid-cols-2';
            else if (urls.length >= 3) gridClass = 'grid-cols-3';

            return (
              <div className="overflow-hidden rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm p-1">
                <div className={`grid gap-1 ${gridClass}`}>
                  {urls.slice(0, 5).map((url, i) => {
                    const isLastAndMore = urls.length > 5 && i === 4;
                    // For 3 items, make first item take 2 rows/cols if we wanted, but let's keep it simple: grid-cols-3 and items span 1.
                    // To be more WhatsApp like, 3 items is usually 1 top full width, 2 bottom.
                    // We'll use a standard aspect-square for all for simplicity unless it's a single image.
                    const aspectClass = urls.length === 1 ? 'aspect-auto max-h-64' : 'aspect-square';
                    
                    return (
                      <div 
                        key={i} 
                        className={`relative cursor-pointer overflow-hidden rounded-lg ${aspectClass} ${urls.length === 3 && i === 0 ? 'col-span-3' : ''}`} 
                        onClick={() => handleImageClick(i, url)}
                      >
                        <img
                          src={url}
                          alt="Paylaşılan resim"
                          className={`h-full w-full object-cover transition-all duration-300 ${!isRevealed ? 'blur-xl scale-110' : ''}`}
                          loading="lazy"
                        />
                        {!isRevealed && (urls.length === 1 || i === 0) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="bg-black/50 text-white text-[10px] sm:text-xs px-2 py-1 rounded-full font-medium backdrop-blur-md">
                              Görmek için dokun
                            </span>
                          </div>
                        )}
                        {isLastAndMore && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <span className="text-white font-bold text-xl">+{urls.length - 4}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {message.content && (
                  <p className={`mt-2 mb-1 px-2 whitespace-pre-wrap break-words text-[0.88rem] leading-snug ${isOwn ? 'text-[var(--color-text-high)]' : 'text-[var(--color-text-high)]'}`}>
                    {message.content}
                  </p>
                )}
              </div>
            );
          })()}

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

          {isStarred && (
            <div className="mt-0.5 flex justify-end">
              <Star size={10} className="fill-amber-400 text-amber-400" />
            </div>
          )}
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
