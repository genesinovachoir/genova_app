'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search } from 'lucide-react';

// Pre-defined sticker-style emojis organized in packs
const STICKER_PACKS = [
  {
    name: 'Duygular',
    icon: '😊',
    stickers: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘',
      '😗', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗',
      '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶',
    ],
  },
  {
    name: 'Hareketler',
    icon: '👋',
    stickers: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏',
      '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
      '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛',
      '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪',
    ],
  },
  {
    name: 'Müzik',
    icon: '🎵',
    stickers: [
      '🎵', '🎶', '🎼', '🎹', '🥁', '🎸', '🎺', '🎻',
      '🪗', '🎤', '🎧', '📯', '🔔', '🎙️', '🎚️', '🎛️',
      '🎭', '🎬', '🎯', '🏆', '🥇', '🥈', '🥉', '🎪',
      '🎨', '🖼️', '🎰', '🎲', '♟️', '🧩', '🎮', '🕹️',
    ],
  },
  {
    name: 'Kalpler',
    icon: '❤️',
    stickers: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💟', '♥️', '🫶', '💑', '💏', '💋',
      '🌹', '🌺', '🌸', '🌻', '🌷', '💐', '🎀', '✨',
    ],
  },
  {
    name: 'Yiyecek',
    icon: '🍕',
    stickers: [
      '🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚',
      '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥖', '🥨',
      '🧀', '🥗', '🥙', '🌮', '🌯', '🥪', '🍱', '🍣',
      '☕', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂',
    ],
  },
];

interface StickerPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export function StickerPicker({ isOpen, onClose, onSelect }: StickerPickerProps) {
  const [activePack, setActivePack] = useState(0);
  const [search, setSearch] = useState('');

  const currentStickers = useMemo(() => {
    if (search.trim()) {
      // When searching, show all stickers (emoji search is limited, just filter packs)
      return STICKER_PACKS.flatMap((p) => p.stickers);
    }
    return STICKER_PACKS[activePack]?.stickers ?? [];
  }, [activePack, search]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-t-3xl bg-[var(--color-background)] pb-[env(safe-area-inset-bottom,16px)]"
          style={{ maxHeight: '50dvh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="text-sm font-bold text-[var(--color-text-high)]">
              Çıkartmalar
            </h3>
            <button
              onClick={onClose}
              className="rounded-full p-1 hover:bg-[var(--color-surface)]"
            >
              <X size={18} className="text-[var(--color-text-medium)]" />
            </button>
          </div>

          {/* Pack tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3 py-1.5 scrollbar-hide">
            {STICKER_PACKS.map((pack, idx) => (
              <button
                key={pack.name}
                onClick={() => {
                  setActivePack(idx);
                  setSearch('');
                }}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activePack === idx && !search
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-medium)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <span className="text-base">{pack.icon}</span>
                <span className="hidden sm:inline">{pack.name}</span>
              </button>
            ))}
          </div>

          {/* Grid */}
          <div
            className="grid grid-cols-8 gap-1 overflow-y-auto px-3 py-2"
            style={{ maxHeight: 'calc(50dvh - 100px)' }}
          >
            {currentStickers.map((emoji, idx) => (
              <motion.button
                key={`${emoji}-${idx}`}
                whileTap={{ scale: 1.3 }}
                onClick={() => {
                  onSelect(emoji);
                  onClose();
                }}
                className="flex h-11 w-full items-center justify-center rounded-lg text-2xl transition-colors hover:bg-[var(--color-surface)]"
              >
                {emoji}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
