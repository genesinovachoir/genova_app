'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Loader2,
  Mail,
  Phone,
  Search,
  Users,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  loadPerformanceOverview,
  PERFORMANCE_ROOT_QUERY_KEY,
  VOICE_GROUP_ORDER,
  normalizePerformanceSearchQuery,
  type PerformanceRosterMember,
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
        <h4 className="font-serif text-[0.95rem] tracking-[-0.04em] text-[var(--color-text-high)]">
          {summary.groupName}
        </h4>
        <span className="text-[0.58rem] font-bold text-[var(--color-text-medium)] opacity-50">
          {summary.member_count} Kişi
        </span>
      </div>

      <div className={`mt-3 grid gap-2 ${summary.show_homework_metrics ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="flex flex-col">
          <span className="text-[0.52rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">PROVA</span>
          <span className="font-serif text-[0.95rem] text-[var(--color-text-high)]">{formatPercent(summary.attendance_percent)}</span>
        </div>
        {summary.show_homework_metrics && (
          <div className="flex flex-col">
            <span className="text-[0.52rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">ÖDEV</span>
            <span className="font-serif text-[0.95rem] text-[var(--color-text-high)]">{formatPercent(summary.homework_percent)}</span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[0.52rem] font-bold uppercase tracking-wider text-[var(--color-text-medium)] opacity-70">SKOR</span>
          <span className="font-serif text-[0.95rem] text-[var(--color-text-high)]">{formatPercent(generalScore)}</span>
        </div>
      </div>
    </div>
  );
}

function getInitials(member: PerformanceRosterMember) {
  const first = member.first_name?.[0] ?? '';
  const last = member.last_name?.[0] ?? '';
  return `${first}${last}`.toUpperCase() || 'K';
}

function MemberAvatar({ member }: { member: PerformanceRosterMember }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-sm font-serif font-medium text-[var(--color-accent)]">
      {member.photo_url && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.photo_url}
          alt={`${member.first_name} ${member.last_name}`}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        getInitials(member)
      )}
    </div>
  );
}

function MetricBadge({
  label,
  percent,
}: {
  label: string;
  percent: number | null;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] bg-black/15 px-3 py-2">
      <p className="text-[0.55rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)]">{label}</p>
      <p className="mt-1 font-serif text-[1.1rem] leading-none tracking-[-0.04em] text-[var(--color-text-high)]">{formatPercent(percent)}</p>
    </div>
  );
}

function MemberCard({
  member,
  defaultShowHomeworkMetrics,
}: {
  member: PerformanceRosterMember;
  defaultShowHomeworkMetrics: boolean;
}) {
  const showHomeworkMetrics = defaultShowHomeworkMetrics && member.show_homework_metrics;
  const voiceGroupLabel = member.voice_group ?? 'Şef';

  return (
    <Link href={`/koristler/${member.id}`} className="block">
      <motion.article
        whileTap={{ scale: 0.99 }}
        className="glass-panel py-3 px-4 transition-colors hover:border-[var(--color-border-strong)]"
      >
        <div className="flex items-start gap-4">
          <MemberAvatar member={member} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-serif text-[0.98rem] tracking-[-0.04em] text-[var(--color-text-high)]">
                  {member.first_name} {member.last_name}
                </h3>
                <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">
                  {voiceGroupLabel}
                  {member.sub_voice_group && member.sub_voice_group !== member.voice_group ? ` · ${member.sub_voice_group}` : ''}
                </p>
              </div>

              <span className="status-pill shrink-0 !min-h-0 !rounded-full !px-2.5 !py-0.5 !text-[0.55rem]">
                Kart
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-[var(--color-text-medium)]">
              <span className="inline-flex items-center gap-1.5">
                <Phone size={11} />
                {member.phone ?? 'Telefon yok'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Mail size={11} />
                {member.email ?? 'E-posta yok'}
              </span>
            </div>

            <div className={`mt-3 grid gap-2 ${showHomeworkMetrics ? 'grid-cols-3' : 'grid-cols-1'}`}>
              {showHomeworkMetrics ? (
                <>
                  <MetricBadge label="Prova" percent={member.attendance_percent} />
                  <MetricBadge label="Ödev" percent={member.homework_percent} />
                  <MetricBadge label="Devam" percent={member.continuity_percent} />
                </>
              ) : (
                <MetricBadge label="Normal devamlılık" percent={member.attendance_percent} />
              )}
            </div>
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

export default function KoristlerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member, isAdmin, isSectionLeader } = useAuth();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

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
      .channel(`koristler-overview:${member.id}`)
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

  const overview = overviewQuery.data ?? null;
  const members = useMemo(() => overview?.members ?? [], [overview]);

  const filteredMembers = useMemo(() => {
    const normalized = normalizePerformanceSearchQuery(deferredSearch);
    if (!normalized) {
      return members;
    }
    return members.filter((row) => row.search_text.includes(normalized));
  }, [deferredSearch, members]);

  const groupedMembers = useMemo(() => {
    const resolveVoiceGroup = (row: PerformanceRosterMember) => row.voice_group?.trim() || 'Şef';
    const voiceGroups = [...new Set(filteredMembers.map((row) => resolveVoiceGroup(row)))];
    const orderedGroups = [
      ...VOICE_GROUP_ORDER.filter((voice) => voiceGroups.includes(voice)),
      ...voiceGroups.filter((voice) => !VOICE_GROUP_ORDER.includes(voice as (typeof VOICE_GROUP_ORDER)[number])),
    ];

    return orderedGroups.map((voiceGroup) => ({
      voiceGroup,
      members: filteredMembers.filter((row) => resolveVoiceGroup(row) === voiceGroup),
    }));
  }, [filteredMembers]);

  if (!privileged) {
    return (
      <main className="page-shell pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div className="glass-panel p-6 text-sm text-[var(--color-text-medium)]">
          Bu alan yalnızca şef ve partisyon şefleri için kullanılabilir.
        </div>
      </main>
    );
  }

  if (overviewQuery.isError) {
    return (
      <main className="page-shell space-y-6 pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
          >
            <ArrowLeft size={18} />
            <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
          </button>
        </div>
        <div className="glass-panel p-6 text-sm text-rose-300">Korist kartları yüklenemedi.</div>
      </main>
    );
  }

  if (overviewQuery.isPending || !overview) {
    return (
      <main className="page-shell flex min-h-[50vh] items-center justify-center pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
      </main>
    );
  }

  const showHomeworkMetrics = overview.show_homework_metrics;
  const scopeTag = `(${overview.summary.member_count} KORİST)`;

  return (
    <main className="page-shell space-y-6 pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
          >
            <ArrowLeft size={18} />
            <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
          </button>

        </div>

        <div className="mt-7 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-col gap-1.5">
              <span className="page-kicker">
                {isSectionLeader() && !isAdmin() && member?.voice_group
                  ? `${member.voice_group.toUpperCase()} PERFORMANSI`
                  : 'KORO PERFORMANSI'
                }
              </span>
              {!(isSectionLeader() && !isAdmin()) && (
                <span className="pl-[2.3rem] text-[0.58rem] font-bold uppercase tracking-[0.28em] text-[var(--color-accent)] opacity-60">
                  {scopeTag}
                </span>
              )}
            </div>
          </div>
          <div className="hidden shrink-0 items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4 sm:flex">
            <Users className="text-[var(--color-accent)]" size={22} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 divide-x divide-[var(--color-border-strong)]/30">
          {showHomeworkMetrics ? (
            <>
              <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">PROVA KATILIMI</span>
                <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                  {formatPercent(overview.summary.attendance_percent)}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">ÖDEV BAŞARISI</span>
                <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                  {formatPercent(overview.summary.homework_percent)}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center px-2 py-2 text-center">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">GENEL DEVAMLILIK</span>
                <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                  {formatPercent(overview.summary.continuity_percent)}
                </span>
              </div>
            </>
          ) : (
            <div className="col-span-3">
              <div className="flex flex-col items-center justify-center py-2 text-center">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">NORMAL DEVAMLILIK</span>
                <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                  {formatPercent(overview.summary.attendance_percent)}
                </span>
              </div>
            </div>
          )}
        </div>

        {isAdmin() ? (
          <div className="mt-6">
            <span className="page-kicker">Partisyon Kartları</span>
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

        <label className="mt-4 block">
          <span className="mb-2 block text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
            Arama
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tüm bilgiler ile arama yapılabilir"
              className="editorial-input themed-search-input !pl-11 placeholder:text-[13px]"
            />
          </div>
        </label>
      </motion.section>

      <div className="space-y-5">
        {filteredMembers.length === 0 ? (
          <div className="glass-panel p-6 text-sm text-[var(--color-text-medium)]">Aradığın korist bulunamadı.</div>
        ) : (
          groupedMembers.map(({ voiceGroup, members: grouped }) => (
            <motion.section
              key={voiceGroup}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="font-serif text-xl tracking-[-0.04em]">{voiceGroup}</h2>
                <span className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                  {grouped.length} kişi
                </span>
              </div>

              <div className="space-y-3">
                {grouped.map((memberRow) => (
                  <MemberCard key={memberRow.id} member={memberRow} defaultShowHomeworkMetrics={showHomeworkMetrics} />
                ))}
              </div>
            </motion.section>
          ))
        )}
      </div>
    </main>
  );
}
