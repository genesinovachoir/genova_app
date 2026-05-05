'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { ChatReaction } from '@/lib/chat';

interface ReactionBarProps {
  reactions: ChatReaction[];
  currentMemberId: string;
  onReactionClick: (emoji: string) => void;
}

/** Groups reactions by emoji and renders them as small pills under a message bubble */
export function ReactionBar({ reactions, currentMemberId, onReactionClick }: ReactionBarProps) {
  const [showMembersEmoji, setShowMembersEmoji] = useState<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const grouped = reactions.reduce<Record<string, { count: number; hasOwn: boolean; members: { first_name: string; last_name: string; photo_url: string | null }[] }>>(
    (acc, r) => {
      if (!acc[r.emoji]) {
        acc[r.emoji] = { count: 0, hasOwn: false, members: [] };
      }
      acc[r.emoji].count++;
      if (r.member_id === currentMemberId) acc[r.emoji].hasOwn = true;
      const memberObj = r.choir_members
        ? {
            first_name: r.choir_members.first_name,
            last_name: r.choir_members.last_name,
            photo_url: r.choir_members.photo_url,
          }
        : null;

      if (memberObj) acc[r.emoji].members.push(memberObj);
      return acc;
    },
    {} as Record<
      string,
      {
        count: number;
        hasOwn: boolean;
        members: { first_name: string; last_name: string; photo_url: string | null }[];
      }
    >
  );

  return (
    <>
      <div className="mt-0.5 flex flex-wrap gap-1 px-1">
      {Object.entries(grouped).map(([emoji, data]) => (
        <motion.button
          key={emoji}
          whileTap={{ scale: 1.15 }}
          onClick={(e) => {
            e.stopPropagation();
            onReactionClick(emoji);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMembersEmoji(emoji);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            longPressTimerRef.current = setTimeout(() => {
              setShowMembersEmoji(emoji);
            }, 400);
          }}
          onTouchEnd={() => {
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
          }}
          onTouchMove={() => {
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
          }}
          title={data.members.map(m => m.first_name).join(', ')}
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs transition-colors ${
            data.hasOwn
              ? 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]'
              : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          <span className="text-sm">{emoji}</span>
          {data.count > 1 && (
            <span
              className={`text-[0.65rem] font-semibold ${
                data.hasOwn
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-medium)]'
              }`}
            >
              {data.count}
            </span>
          )}
        </motion.button>
      ))}
    </div>
      
      {/* Reaction List Modal */}
      <AnimatePresence>
        {showMembersEmoji && (
          <ReactionListModal
            activeEmoji={showMembersEmoji}
            onEmojiChange={setShowMembersEmoji}
            groupedReactions={grouped}
            onClose={() => setShowMembersEmoji(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ReactionListModal({
  activeEmoji,
  onEmojiChange,
  groupedReactions,
  onClose
}: {
  activeEmoji: string;
  onEmojiChange: (emoji: string) => void;
  groupedReactions: Record<string, { count: number; members: { first_name: string; last_name: string; photo_url: string | null }[] }>;
  onClose: () => void;
}) {
  const members = groupedReactions[activeEmoji]?.members || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[var(--color-background)] overflow-hidden shadow-2xl"
      >
        <div className="border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-semibold text-sm text-[var(--color-text-high)]">
              Tepki Verenler
            </h3>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-[var(--color-surface)] transition-colors"
            >
              <X size={18} className="text-[var(--color-text-medium)]" />
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto px-4 pb-2 no-scrollbar">
            {Object.entries(groupedReactions).map(([emoji, data]) => (
              <button
                key={emoji}
                onClick={() => onEmojiChange(emoji)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  activeEmoji === emoji
                    ? 'bg-[var(--color-accent)] text-white shadow-md'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-medium)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="text-base">{emoji}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] ${
                  activeEmoji === emoji ? 'bg-white/20' : 'bg-[var(--color-border)]'
                }`}>
                  {data.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          <div className="flex flex-col gap-1">
            {members.map((m, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--color-surface)]">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center border border-[var(--color-border)]">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-[var(--color-accent)]">
                      {m.first_name?.[0] || '?'}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-[var(--color-text-high)]">
                  {m.first_name} {m.last_name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
