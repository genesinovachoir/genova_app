'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Plus,
  X,
  Smile,
  BarChart3,
  Image as ImageIcon,
  Pencil,
  Loader2,
} from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import { fetchLinkPreview, normalizeChatUrl, URL_REGEX } from '@/lib/chat';
import type { ChatMessage, LinkPreviewData } from '@/lib/chat';
import { LinkPreviewCard } from './LinkPreviewCard';

interface MessageInputProps {
  onSend: (content: string, linkPreview?: LinkPreviewData | null) => void;
  onTyping?: () => void;
  disabled?: boolean;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  onImageSelect?: (files: File[]) => void;
  onPollCreate?: () => void;
  onStickerOpen?: () => void;
}

export function MessageInput({
  onSend,
  onTyping,
  disabled,
  editingMessage,
  onCancelEdit,
  onImageSelect,
  onPollCreate,
  onStickerOpen,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [showExtras, setShowExtras] = useState(false);
  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null);
  const [isPreviewDismissed, setIsPreviewDismissed] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const previewDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastDetectedUrl = useRef<string | null>(null);
  const dismissedUrlRef = useRef<string | null>(null);
  const { replyingTo, setReplyingTo } = useChatStore();

  const extractFirstUrl = useCallback((value: string): string | null => {
    URL_REGEX.lastIndex = 0;
    const matches = value.match(URL_REGEX);
    if (!matches || matches.length === 0) return null;
    for (const candidate of matches) {
      const normalized = normalizeChatUrl(candidate);
      if (normalized) return normalized;
    }
    return null;
  }, []);

  // When entering edit mode, populate the textarea with existing content
  useEffect(() => {
    const editContent = editingMessage?.content;
    if (!editContent) return;

    const timer = setTimeout(() => {
      setText(editContent);
      textareaRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [editingMessage?.content]);

  useEffect(() => {
    if (replyingTo) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [replyingTo, textareaRef]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }

    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;
    const schedulePreviewState = (callback: () => void) => {
      stateTimer = setTimeout(() => {
        if (isCancelled) return;
        callback();
      }, 0);
    };
    const cleanupPreviewTimers = () => {
      isCancelled = true;
      if (stateTimer) clearTimeout(stateTimer);
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };

    if (editingMessage) {
      schedulePreviewState(() => {
        setLinkPreview(null);
        setIsPreviewLoading(false);
      });
      return cleanupPreviewTimers;
    }

    const detectedUrl = extractFirstUrl(text);
    if (!detectedUrl) {
      schedulePreviewState(() => {
        setLinkPreview(null);
        setIsPreviewLoading(false);
        setIsPreviewDismissed(false);
      });
      dismissedUrlRef.current = null;
      lastDetectedUrl.current = null;
      return cleanupPreviewTimers;
    }

    if (dismissedUrlRef.current && dismissedUrlRef.current !== detectedUrl) {
      schedulePreviewState(() => {
        setIsPreviewDismissed(false);
      });
      dismissedUrlRef.current = null;
      lastDetectedUrl.current = null;
    }

    if (dismissedUrlRef.current === detectedUrl || isPreviewDismissed) {
      return;
    }

    if (lastDetectedUrl.current === detectedUrl) {
      return;
    }

    schedulePreviewState(() => {
      setIsPreviewLoading(true);
    });

    previewDebounceRef.current = setTimeout(() => {
      void fetchLinkPreview(detectedUrl)
        .then((preview) => {
          if (isCancelled) return;
          setLinkPreview(preview);
        })
        .catch(() => {
          if (isCancelled) return;
          setLinkPreview(null);
        })
        .finally(() => {
          if (isCancelled) return;
          setIsPreviewLoading(false);
          lastDetectedUrl.current = detectedUrl;
        });
    }, 500);

    return cleanupPreviewTimers;
  }, [text, editingMessage, extractFirstUrl, isPreviewDismissed]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);

    // Throttle typing indicator (send every 2 seconds max)
    if (onTyping && !typingThrottleRef.current && !editingMessage) {
      onTyping();
      typingThrottleRef.current = setTimeout(() => {
        typingThrottleRef.current = null;
      }, 2000);
    }
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed, isPreviewDismissed ? null : linkPreview);
    setText('');
    setShowExtras(false);
    setLinkPreview(null);
    setIsPreviewLoading(false);
    setIsPreviewDismissed(false);
    lastDetectedUrl.current = null;
    dismissedUrlRef.current = null;

    if (!editingMessage) {
      setReplyingTo(null);
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [
    text,
    disabled,
    onSend,
    setReplyingTo,
    editingMessage,
    linkPreview,
    isPreviewDismissed,
  ]);

  const handleCancelEdit = useCallback(() => {
    setText('');
    onCancelEdit?.();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [onCancelEdit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter to send, Shift+Enter for new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Escape to cancel edit
    if (e.key === 'Escape' && editingMessage) {
      handleCancelEdit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onImageSelect) {
      if (files.length > 5) {
        alert('En fazla 5 fotoğraf seçebilirsiniz.');
        onImageSelect(files.slice(0, 5));
      } else {
        onImageSelect(files);
      }
      setShowExtras(false);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const isEditing = !!editingMessage;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-background)]">
      {/* Edit mode indicator */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
              <Pencil size={14} className="text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-500">
                  Mesajı Düzenle
                </p>
                <p className="truncate text-xs text-[var(--color-text-low)]">
                  {editingMessage?.content}
                </p>
              </div>
              <button
                onClick={handleCancelEdit}
                className="shrink-0 rounded-full p-1 text-[var(--color-text-low)] hover:bg-[var(--color-surface-hover)]"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply preview */}
      <AnimatePresence>
        {replyingTo && !isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
              <div className="h-8 w-0.5 rounded-full bg-[var(--color-accent)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[var(--color-accent)]">
                  {replyingTo.sender?.first_name ?? 'Bilinmeyen'}
                </p>
                <p className="truncate text-xs text-[var(--color-text-low)]">
                  {replyingTo.content ?? '📷 Medya'}
                </p>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="shrink-0 rounded-full p-1 text-[var(--color-text-low)] hover:bg-[var(--color-surface-hover)]"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link preview */}
      <AnimatePresence>
        {!isEditing && (isPreviewLoading || linkPreview) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {isPreviewLoading ? (
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text-low)]">
                <Loader2 size={14} className="animate-spin" />
                <span>Bağlantı önizlemesi yükleniyor...</span>
              </div>
            ) : linkPreview ? (
              <LinkPreviewCard
                preview={linkPreview}
                variant="input"
                onDismiss={() => {
                  const detectedUrl = extractFirstUrl(text);
                  const urlToDismiss = linkPreview.url || detectedUrl;
                  if (urlToDismiss) dismissedUrlRef.current = urlToDismiss;
                  setIsPreviewDismissed(true);
                  setLinkPreview(null);
                  setIsPreviewLoading(false);
                }}
              />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="flex items-end gap-2 px-3 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
        {/* Extras button (hidden in edit mode) */}
        {!isEditing && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowExtras(!showExtras)}
            className={`mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
              showExtras
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-low)] hover:bg-[var(--color-surface)]'
            }`}
          >
            <Plus
              size={20}
              className={`transition-transform ${showExtras ? 'rotate-45' : ''}`}
            />
          </motion.button>
        )}

        {/* Textarea */}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isEditing ? 'Mesajı düzenle...' : 'Mesaj yaz...'}
            disabled={disabled}
            rows={1}
            className={`w-full resize-none rounded-2xl border bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:outline-none focus:ring-1 disabled:opacity-50 ${
              isEditing
                ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-400'
                : 'border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-[var(--color-accent)]'
            }`}
            style={{ maxHeight: '120px' }}
          />
        </div>

        {/* Send button */}
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className={`mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-opacity disabled:opacity-30 ${
            isEditing ? 'bg-amber-500' : 'bg-[var(--color-accent)]'
          }`}
        >
          {isEditing ? (
            <Pencil size={16} />
          ) : (
            <Send size={17} className="ml-0.5" />
          )}
        </motion.button>
      </div>

      {/* Extras panel */}
      <AnimatePresence>
        {showExtras && !isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[var(--color-border)]"
          >
            <div className="flex items-center justify-around px-4 py-3">
              <button
                onClick={handleOpenFilePicker}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: '#4CAF5020' }}
                >
                  <ImageIcon size={22} style={{ color: '#4CAF50' }} />
                </div>
                <span className="text-[0.65rem] font-medium text-[var(--color-text-medium)]">
                  Fotoğraf
                </span>
              </button>

              <button
                onClick={onStickerOpen}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: '#FF980020' }}
                >
                  <Smile size={22} style={{ color: '#FF9800' }} />
                </div>
                <span className="text-[0.65rem] font-medium text-[var(--color-text-medium)]">
                  Çıkartma
                </span>
              </button>

              <button
                onClick={onPollCreate}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: '#2196F320' }}
                >
                  <BarChart3 size={22} style={{ color: '#2196F3' }} />
                </div>
                <span className="text-[0.65rem] font-medium text-[var(--color-text-medium)]">
                  Anket
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input for photos */}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileSelect}
      />
    </div>
  );
}
