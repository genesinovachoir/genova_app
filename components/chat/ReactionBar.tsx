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

  const [showMembersEmoji, setShowMembersEmoji] = useState<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  return (
    <>
      <div className="mt-0.5 flex flex-wrap gap-1 px-1">
      {Object.entries(grouped).map(([emoji, data]) => (
        <motion.button
          key={emoji}
          whileTap={{ scale: 1.15 }}
          onClick={() => onReactionClick(emoji)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMembersEmoji(emoji);
          }}
          onTouchStart={() => {
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
            emoji={showMembersEmoji}
            members={grouped[showMembersEmoji]?.members || []}
            onClose={() => setShowMembersEmoji(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ReactionListModal({
  emoji,
  members,
  onClose
}: {
  emoji: string;
  members: { first_name: string; last_name: string; photo_url: string | null }[];
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[var(--color-background)] overflow-hidden shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="font-semibold text-sm text-[var(--color-text-high)] flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            <span>Tepki Verenler ({members.length})</span>
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
          >
            <X size={16} className="text-[var(--color-text-medium)]" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {members.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--color-text-low)]">Kimse tepki vermemiş</p>
          ) : (
            members.map((m, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[var(--color-surface)]">
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-[var(--color-accent)]">
                      {m.first_name?.[0] || '?'}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-[var(--color-text-high)]">
                  {m.first_name} {m.last_name}
                </span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
