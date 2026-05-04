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
} from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import type { ChatMessage } from '@/lib/chat';

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  onImageSelect?: (file: File) => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const { replyingTo, setReplyingTo } = useChatStore();

  // When entering edit mode, populate the textarea with existing content
  useEffect(() => {
    if (editingMessage?.content) {
      setText(editingMessage.content);
      // Focus the textarea
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [editingMessage]);

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

    onSend(trimmed);
    setText('');
    setShowExtras(false);

    if (!editingMessage) {
      setReplyingTo(null);
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend, setReplyingTo, editingMessage]);

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
    const file = e.target.files?.[0];
    if (file && onImageSelect) {
      onImageSelect(file);
      setShowExtras(false);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

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
              {[
                {
                  icon: ImageIcon,
                  label: 'Fotoğraf',
                  color: '#4CAF50',
                  onClick: () => fileInputRef.current?.click(),
                },
                {
                  icon: Smile,
                  label: 'Çıkartma',
                  color: '#FF9800',
                  onClick: onStickerOpen,
                },
                {
                  icon: BarChart3,
                  label: 'Anket',
                  color: '#2196F3',
                  onClick: onPollCreate,
                },
              ].map(({ icon: Icon, label, color, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <Icon size={22} style={{ color }} />
                  </div>
                  <span className="text-[0.65rem] font-medium text-[var(--color-text-medium)]">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input for photos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
