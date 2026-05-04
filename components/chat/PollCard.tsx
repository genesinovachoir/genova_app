'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Check, Users } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchPollData, votePoll, removePollVote } from '@/lib/chat';
import type { ChatPoll, ChatPollVote } from '@/lib/chat';

interface PollCardProps {
  messageId: string;
  isOwn: boolean;
}

export function PollCard({ messageId, isOwn }: PollCardProps) {
  const { member } = useAuth();
  const [poll, setPoll] = useState<ChatPoll | null>(null);
  const [votes, setVotes] = useState<(ChatPollVote & { choir_members?: { first_name: string; last_name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    void fetchPollData(messageId)
      .then(({ poll: p, votes: v }) => {
        setPoll(p);
        setVotes(v);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [messageId]);

  const totalVotes = votes.length;

  const myVotes = useMemo(
    () => votes.filter((v) => v.member_id === member?.id).map((v) => v.option_id),
    [votes, member?.id]
  );

  const hasVoted = myVotes.length > 0;

  const optionVoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of votes) {
      counts[v.option_id] = (counts[v.option_id] ?? 0) + 1;
    }
    return counts;
  }, [votes]);

  const handleVote = useCallback(
    async (optionId: string) => {
      if (!member?.id || !poll || voting) return;

      setVoting(true);
      try {
        if (myVotes.includes(optionId)) {
          // Remove vote
          await removePollVote(poll.id, member.id, optionId);
          setVotes((prev) =>
            prev.filter(
              (v) =>
                !(v.member_id === member.id && v.option_id === optionId)
            )
          );
        } else {
          // If not multiple choice, remove existing vote first
          if (!poll.is_multiple_choice && myVotes.length > 0) {
            for (const existingOptId of myVotes) {
              await removePollVote(poll.id, member.id, existingOptId);
            }
            setVotes((prev) =>
              prev.filter((v) => v.member_id !== member.id)
            );
          }

          await votePoll(poll.id, member.id, optionId);
          setVotes((prev) => [
            ...prev,
            {
              id: `temp-${Date.now()}`,
              poll_id: poll.id,
              member_id: member.id,
              option_id: optionId,
              created_at: new Date().toISOString(),
              choir_members: {
                first_name: member.first_name,
                last_name: member.last_name,
              },
            },
          ]);
        }
      } catch (err) {
        console.error('Vote failed:', err);
      } finally {
        setVoting(false);
      }
    },
    [member, poll, myVotes, voting]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <BarChart3 size={16} className="animate-pulse text-blue-400" />
        <span className="text-xs text-[var(--color-text-low)]">
          Anket yükleniyor...
        </span>
      </div>
    );
  }

  if (!poll) return null;

  return (
    <div className="min-w-[200px] py-1">
      {/* Question */}
      <p
        className={`mb-2 text-sm font-semibold leading-snug ${
          isOwn ? 'text-white' : 'text-[var(--color-text-high)]'
        }`}
      >
        📊 {poll.question}
      </p>

      {/* Options */}
      <div className="flex flex-col gap-1.5">
        {poll.options_json.map((opt) => {
          const count = optionVoteCounts[opt.id] ?? 0;
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = myVotes.includes(opt.id);

          return (
            <button
              key={opt.id}
              onClick={() => void handleVote(opt.id)}
              disabled={voting}
              className={`relative overflow-hidden rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all ${
                isOwn
                  ? isSelected
                    ? 'border-white/40 bg-white/25'
                    : 'border-white/20 bg-white/10 hover:bg-white/15'
                  : isSelected
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {/* Progress bar background */}
              {hasVoted && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className={`absolute inset-y-0 left-0 ${
                    isOwn
                      ? 'bg-white/10'
                      : isSelected
                        ? 'bg-blue-100'
                        : 'bg-[var(--color-surface-hover)]'
                  }`}
                />
              )}

              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {isSelected && (
                    <Check
                      size={14}
                      className={
                        isOwn ? 'text-white' : 'text-blue-500'
                      }
                    />
                  )}
                  <span
                    className={
                      isOwn
                        ? 'text-white'
                        : 'text-[var(--color-text-high)]'
                    }
                  >
                    {opt.text}
                  </span>
                </div>
                {hasVoted && (
                  <span
                    className={`shrink-0 text-[0.65rem] font-bold ${
                      isOwn
                        ? 'text-white/70'
                        : 'text-[var(--color-text-medium)]'
                    }`}
                  >
                    {percent}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className={`mt-2 flex items-center gap-1.5 text-[0.6rem] ${
          isOwn ? 'text-white/50' : 'text-[var(--color-text-low)]'
        }`}
      >
        <Users size={10} />
        <span>
          {totalVotes} oy
          {poll.is_multiple_choice && ' · Çoklu seçim'}
          {poll.is_anonymous && ' · Anonim'}
        </span>
      </div>
    </div>
  );
}
