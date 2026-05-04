'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart3, Check, Users, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { fetchPollData, votePoll, removePollVote } from '@/lib/chat';
import type { ChatPoll, ChatPollVote } from '@/lib/chat';

interface PollCardProps {
  messageId: string;
  isOwn: boolean;
}

type VoteWithMember = ChatPollVote & { choir_members?: { first_name: string; last_name: string; photo_url: string | null } };

export function PollCard({ messageId, isOwn }: PollCardProps) {
  const { member } = useAuth();
  const [poll, setPoll] = useState<ChatPoll | null>(null);
  const [votes, setVotes] = useState<VoteWithMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [showVotersOptionId, setShowVotersOptionId] = useState<string | null>(null);
  const pollIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initial fetch
  useEffect(() => {
    void fetchPollData(messageId)
      .then(({ poll: p, votes: v }) => {
        setPoll(p);
        pollIdRef.current = p?.id ?? null;
        setVotes(v);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [messageId]);

  // Realtime subscription for poll votes
  useEffect(() => {
    if (!pollIdRef.current && !poll?.id) return;
    const currentPollId = poll?.id ?? pollIdRef.current;
    if (!currentPollId) return;

    const channel = supabase
      .channel(`poll-votes-${currentPollId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_poll_votes',
          filter: `poll_id=eq.${currentPollId}`,
        },
        (payload) => {
          const newVote = payload.new as VoteWithMember;
          setVotes((prev) => {
            // Avoid duplicates (optimistic update may already have it)
            if (prev.some((v) => v.member_id === newVote.member_id && v.option_id === newVote.option_id)) {
              return prev;
            }
            // If not multiple choice, remove any other votes by this user
            const filtered = poll?.is_multiple_choice ? prev : prev.filter((v) => v.member_id !== newVote.member_id);
            return [...filtered, newVote];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_poll_votes',
          filter: `poll_id=eq.${currentPollId}`,
        },
        (payload) => {
          const deleted = payload.old as VoteWithMember;
          setVotes((prev) =>
            prev.filter(
              (v) => !(v.member_id === deleted.member_id && v.option_id === deleted.option_id)
            )
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [poll?.id]);

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
                photo_url: member.photo_url ?? null,
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
    <>
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
          const optionVotes = votes.filter((v) => v.option_id === opt.id);
          const count = optionVotes.length;
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = myVotes.includes(opt.id);

          const handleTouchStart = (e: React.TouchEvent) => {
            e.stopPropagation(); // Prevent message context menu
            longPressTimerRef.current = setTimeout(() => {
              if (!poll.is_anonymous && optionVotes.length > 0) {
                setShowVotersOptionId(opt.id);
              }
            }, 400); // 400ms long press
          };

          const handleTouchEnd = (e: React.TouchEvent) => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
            }
          };

          return (
            <button
              key={opt.id}
              onClick={(e) => {
                e.stopPropagation();
                void handleVote(opt.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent message context menu
                if (!poll.is_anonymous && optionVotes.length > 0) {
                  setShowVotersOptionId(opt.id);
                }
              }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
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
              {totalVotes > 0 && (
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
                
                <div className="flex items-center gap-2">
                  {/* Avatars */}
                  {!poll.is_anonymous && optionVotes.length > 0 && (
                    <div 
                      className="flex -space-x-1.5 mr-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVotersOptionId(opt.id);
                      }}
                    >
                      {optionVotes.slice(0, 3).map((v) => (
                        <div key={v.member_id} className={`h-4 w-4 rounded-full ring-1 ${isOwn ? 'ring-white/20' : 'ring-[var(--color-background)]'} overflow-hidden bg-[var(--color-surface-hover)] flex items-center justify-center`}>
                          {v.choir_members?.photo_url ? (
                            <img src={v.choir_members.photo_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className={`text-[0.45rem] font-bold ${isOwn ? 'text-white' : 'text-[var(--color-text-high)]'}`}>
                              {v.choir_members?.first_name?.[0] || '?'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {totalVotes > 0 && (
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
      
      {/* Voter List Modal */}
      <AnimatePresence>
        {showVotersOptionId && (
          <VoterListModal
            activeOptionId={showVotersOptionId}
            onOptionChange={setShowVotersOptionId}
            options={poll.options_json}
            votes={votes}
            onClose={() => setShowVotersOptionId(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function VoterListModal({
  activeOptionId,
  onOptionChange,
  options,
  votes,
  onClose
}: {
  activeOptionId: string;
  onOptionChange: (id: string) => void;
  options: { id: string; text: string }[];
  votes: VoteWithMember[];
  onClose: () => void;
}) {
  const activeVotes = votes.filter(v => v.option_id === activeOptionId);

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
              Anket Sonuçları
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
            {options.map((opt) => {
              const count = votes.filter(v => v.option_id === opt.id).length;
              const isActive = activeOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onOptionChange(opt.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[var(--color-accent)] text-white shadow-md'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-medium)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="truncate max-w-[80px]">{opt.text}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] ${
                    isActive ? 'bg-white/20' : 'bg-[var(--color-border)]'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {activeVotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 opacity-50">
              <Users size={32} className="mb-2 text-[var(--color-text-low)]" />
              <p className="text-sm text-[var(--color-text-low)]">Henüz oy veren yok</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {activeVotes.map((v) => (
                <div key={v.member_id} className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--color-surface)]">
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center border border-[var(--color-border)]">
                    {v.choir_members?.photo_url ? (
                      <img src={v.choir_members.photo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-[var(--color-accent)]">
                        {v.choir_members?.first_name?.[0] || '?'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                      {v.choir_members?.first_name} {v.choir_members?.last_name}
                    </p>
                    <p className="text-[0.65rem] text-[var(--color-text-low)]">
                      {new Date(v.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
