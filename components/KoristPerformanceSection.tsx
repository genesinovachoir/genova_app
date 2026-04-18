'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ChevronRight, Loader2, Users, CalendarDays, ClipboardCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  loadPerformanceOverview,
  PERFORMANCE_ROOT_QUERY_KEY,
  getPerformanceScopeLabel,
} from '@/lib/korist-performance';

function formatPercent(value: number) {
  return `%${Math.max(0, Math.min(100, Math.round(value)))}`;
}

function MetricTile({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4">
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="font-serif text-[1.7rem] leading-none tracking-[-0.05em] text-[var(--color-text-high)]">{formatPercent(percent)}</span>
        <span className="rounded-full border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[0.6rem] uppercase tracking-[0.14em] text-[var(--color-text-medium)]">
          {detail}
        </span>
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
  const scopeLabel = getPerformanceScopeLabel(member, isAdmin(), isSectionLeader());

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28 }}
      className="glass-panel p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="page-kicker">Korist Kartları</span>
          <h3 className="mt-4 font-serif text-2xl tracking-[-0.05em]">{scopeLabel}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-medium)]">
            Koristlerin prova, ödev ve devamlılık özetleri tek yerde. Karttan detay profiline geçebilirsin.
          </p>
        </div>

        <Link
          href="/koristler"
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-3.5 py-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)] transition-colors hover:bg-[rgba(192,178,131,0.18)]"
        >
          Kartları aç
          <ChevronRight size={14} />
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Genel prova katılımı"
          percent={summary.attendance_percent}
          detail={`${summary.attended_rehearsals}/${summary.total_rehearsals}`}
        />
        <MetricTile
          label="Genel ödev yapma"
          percent={summary.homework_percent}
          detail={`${summary.approved_assignments}/${summary.total_assignments}`}
        />
        <MetricTile
          label="Genel devamlılık"
          percent={summary.continuity_percent}
          detail={`${summary.member_count} korist`}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.65rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">
        <span className="status-pill !min-h-0 !rounded-full !px-3 !py-1 !text-[0.58rem]">Tüm özetler sade görünümde</span>
        <span>Detay sayfasında tek tek kartlar açılır.</span>
      </div>
    </motion.section>
  );
}
