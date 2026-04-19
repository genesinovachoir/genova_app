'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Loader2, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  loadPerformanceOverview,
  PERFORMANCE_ROOT_QUERY_KEY,
} from '@/lib/korist-performance';

function formatPercent(value: number | null | undefined) {
  if (value == null) {
    return '—';
  }
  return `%${Math.max(0, Math.min(100, Math.round(value)))}`;
}

function calculateGeneralScore(
  attendancePercent: number | null | undefined,
  homeworkPercent: number | null | undefined,
  showHomeworkMetrics: boolean,
) {
  const attendance = Math.max(0, Math.min(100, attendancePercent ?? 0));
  if (!showHomeworkMetrics) {
    return attendance;
  }
  const homework = Math.max(0, Math.min(100, homeworkPercent ?? 0));
  return (attendance + homework * 0.5) / 1.5;
}

function VoiceGroupStatCard({
  summary,
}: {
  summary: {
    groupName: string;
    member_count: number;
    attendance_percent: number;
    homework_percent: number | null;
    show_homework_metrics: boolean;
  };
}) {
  const generalScore = calculateGeneralScore(
    summary.attendance_percent,
    summary.homework_percent,
    summary.show_homework_metrics,
  );

  return (
    <div className="min-w-[140px] flex-1 rounded-[10px] border border-[var(--color-border)] bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.05]">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-serif text-[1rem] tracking-[-0.04em] text-[var(--color-text-high)]">
          {summary.groupName}
        </h4>
        <span className="text-[0.58rem] font-bold text-[var(--color-text-medium)] opacity-50">
          {summary.member_count} Kişi
        </span>
      </div>

      <div className={`mt-3 grid gap-2 ${summary.show_homework_metrics ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="flex flex-col">
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">PROVA</span>
          <span className="font-serif text-[1rem] text-[var(--color-text-high)]">{formatPercent(summary.attendance_percent)}</span>
        </div>
        {summary.show_homework_metrics && (
          <div className="flex flex-col">
            <span className="text-[0.55rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">ÖDEV</span>
            <span className="font-serif text-[1rem] text-[var(--color-text-high)]">{formatPercent(summary.homework_percent)}</span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">SKOR</span>
          <span className="font-serif text-[1rem] text-[var(--color-text-high)]">{formatPercent(generalScore)}</span>
        </div>
      </div>
    </div>
  );
}

export function KoristPerformanceSection() {
  const { member, isAdmin, isSectionLeader } = useAuth();
  const queryClient = useQueryClient();
  const privileged = isAdmin() || isSectionLeader();

  const overviewQuery = useQuery({
    queryKey: [...PERFORMANCE_ROOT_QUERY_KEY, 'overview', member?.id ?? null, isAdmin(), isSectionLeader(), member?.voice_group ?? null],
    queryFn: () => loadPerformanceOverview(member, isAdmin(), isSectionLeader()),
    enabled: Boolean(member?.id && privileged),
  });

  useEffect(() => {
    if (!privileged || !member?.id) {
      return;
    }

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: PERFORMANCE_ROOT_QUERY_KEY });
    };

    const channel = supabase
      .channel(`korist-performance:${member.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choir_members' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rehearsals' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rehearsal_invitees' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choir_member_roles' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_targets' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions' }, invalidate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [member?.id, privileged, queryClient]);

  if (!privileged) {
    return null;
  }

  if (overviewQuery.isError) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="page-kicker">Korist Kartları</span>
            <h3 className="mt-4 font-serif text-2xl tracking-[-0.05em]">Performans verisi alınamadı</h3>
          </div>
          <div className="icon-chip shrink-0">
            <Users size={18} />
          </div>
        </div>
        <p className="mt-4 text-sm text-[var(--color-text-medium)]">Korist performans özeti şu an yüklenemiyor.</p>
      </motion.section>
    );
  }

  if (overviewQuery.isPending || !overviewQuery.data) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel flex items-center justify-center p-6 sm:p-7"
      >
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={22} />
      </motion.section>
    );
  }

  const overview = overviewQuery.data;
  const summary = overview.summary;
  const showHomeworkMetrics = overview.show_homework_metrics;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28 }}
      className="glass-panel p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="page-kicker">
            {isSectionLeader() && !isAdmin() && member?.voice_group
              ? `${member.voice_group} Kartları`
              : 'Korist Kartları'
            }
          </span>
        </div>

        <Link
          href="/koristler"
          className="mt-1 text-xs uppercase tracking-widest text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-accent)]"
        >
          Genişlet
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--color-border-strong)]/30">
        {showHomeworkMetrics ? (
          <>
            <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">PROVA KATILIMI</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(summary.attendance_percent)}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">ÖDEV BAŞARISI</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(summary.homework_percent)}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">GENEL DEVAMLILIK</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(summary.continuity_percent)}
              </span>
            </div>
          </>
        ) : (
          <div className="col-span-3">
            <div className="flex flex-col items-center justify-center py-2 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">Normal devamlılık</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(summary.attendance_percent)}
              </span>
            </div>
          </div>
        )}
      </div>

      {isAdmin() ? (
        <div className="mt-6">
          <span className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-60">Partisyon Özeti</span>
          {overview.groupSummaries.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-text-medium)]">Bu kapsam için partisyon verisi bulunamadı.</p>
          ) : (
            <div className="mt-4 flex gap-4 overflow-x-auto pb-4 scrollbar-hide sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
              {overview.groupSummaries.map((gs) => (
                <VoiceGroupStatCard key={gs.groupName} summary={gs} />
              ))}
            </div>
          )}
        </div>
      ) : null}


    </motion.section>
  );
}
