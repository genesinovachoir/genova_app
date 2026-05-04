'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Plus, X, Smile, BarChart3, Image as ImageIcon } from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, onTyping, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [showExtras, setShowExtras] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const { replyingTo, setReplyingTo } = useChatStore();

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
    if (onTyping && !typingThrottleRef.current) {
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
    setReplyingTo(null);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend, setReplyingTo]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter to send, Shift+Enter for new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-background)]">
      {/* Reply preview */}
      <AnimatePresence>
        {replyingTo && (
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
        {/* Extras button */}
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

        {/* Textarea */}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Mesaj yaz..."
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text-high)] placeholder:text-[var(--color-text-low)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            style={{ maxHeight: '120px' }}
          />
        </div>

        {/* Send button */}
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-md transition-opacity disabled:opacity-30"
        >
          <Send size={17} className="ml-0.5" />
        </motion.button>
      </div>

      {/* Extras panel */}
      <AnimatePresence>
        {showExtras && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[var(--color-border)]"
          >
            <div className="flex items-center justify-around px-4 py-3">
              {[
                { icon: ImageIcon, label: 'Fotoğraf', color: '#4CAF50' },
                { icon: Smile, label: 'Çıkartma', color: '#FF9800' },
                { icon: BarChart3, label: 'Anket', color: '#2196F3' },
              ].map(({ icon: Icon, label, color }) => (
                <button
                  key={label}
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
    </div>
  );
}
