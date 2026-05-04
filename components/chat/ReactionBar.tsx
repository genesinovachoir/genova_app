'use client';

import { motion } from 'motion/react';
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
  const grouped = reactions.reduce<Record<string, { count: number; hasOwn: boolean; members: string[] }>>(
    (acc, r) => {
      if (!acc[r.emoji]) {
        acc[r.emoji] = { count: 0, hasOwn: false, members: [] };
      }
      acc[r.emoji].count++;
      if (r.member_id === currentMemberId) acc[r.emoji].hasOwn = true;
      const name = r.choir_members
        ? `${r.choir_members.first_name} ${r.choir_members.last_name}`
        : '';
      if (name) acc[r.emoji].members.push(name);
      return acc;
    },
    {}
  );

  return (
    <div className="mt-0.5 flex flex-wrap gap-1 px-1">
      {Object.entries(grouped).map(([emoji, data]) => (
        <motion.button
          key={emoji}
          whileTap={{ scale: 1.15 }}
          onClick={() => onReactionClick(emoji)}
          title={data.members.join(', ')}
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
  );
}
