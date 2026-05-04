'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Cake,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  Loader2,
  Mail,
  Phone,
  School2,
  XCircle,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/richText';
import { useBackOrHome } from '@/hooks/useBackOrHome';
import {
  loadPerformanceMemberDetail,
  PERFORMANCE_ROOT_QUERY_KEY,
  type PerformanceHomeworkEntry,
  type PerformanceRehearsalEntry,
  type PerformanceMemberDetail,
} from '@/lib/korist-performance';

const DAY_LABELS = ['PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CMT', 'PAZ'];

function getTodayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toLocalDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }).toUpperCase();
}

function toDateKey(dateStr: string) {
  return dateStr.slice(0, 10);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(`${dateStr.slice(0, 10)}T12:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatShortDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(`${dateStr.slice(0, 10)}T12:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
  });
}

function formatPercent(value: number | null | undefined) {
  if (value == null) {
    return '—';
  }
  return `%${Math.max(0, Math.min(100, Math.round(value)))}`;
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || 'K';
}

function MemberAvatar({ detail }: { detail: PerformanceMemberDetail }) {
  const [imgError, setImgError] = useState(false);
  const member = detail.member;

  return (
    <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#b48600] text-3xl font-serif font-medium text-[var(--color-background)] shadow-[0_0_24px_rgba(192,178,131,0.28)] ring-[3px] ring-[var(--color-panel-bg)]">
      {member.photo_url && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.photo_url}
          alt={`${member.first_name} ${member.last_name}`}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        getInitials(member.first_name, member.last_name)
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[var(--color-text-medium)]">
        {icon}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-[0.6rem] uppercase tracking-wider text-[var(--color-text-medium)]">{label}</span>
        <span className={`truncate text-[0.88rem] font-medium ${value ? 'text-[var(--color-text-high)]' : 'text-[var(--color-text-medium)] opacity-30 italic'}`}>
          {value || 'Belirtilmemiş'}
        </span>
      </div>
    </div>
  );
}

function HomeworkStatusPill({ status }: { status: PerformanceHomeworkEntry['status'] }) {
  const className =
    status === 'approved'
      ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : status === 'pending'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : status === 'rejected'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          : 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]';

  const label =
    status === 'approved'
      ? 'Tamamlandı'
      : status === 'pending'
        ? 'Bekliyor'
        : status === 'rejected'
          ? 'Reddedildi'
          : 'Eksik';

  return <span className={`status-pill !min-h-0 !rounded-full !px-3 !py-1 !text-[0.58rem] ${className}`}>{label}</span>;
}

function RehearsalDayCell({
  day,
  isSelected,
  onClick,
}: {
  day: CalendarDay;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`aspect-square rounded-lg transition-all active:scale-90 ${dayBgClass(day)} ${isSelected ? 'ring-2 ring-white/50 ring-offset-1 ring-offset-black' : ''}`}
    >
      <div className="flex h-full flex-col items-center justify-center gap-0.5">
        <span className={`text-[0.72rem] font-bold leading-none ${day.status === 'attended' ? 'text-black' : 'text-[var(--color-text-high)]'}`}>
          {String(day.dayNum).padStart(2, '0')}
        </span>
        {day.rehearsal ? (
          <span className="inline-flex h-[10px] items-center justify-center leading-none">
            {day.status === 'attended' ? <CheckCircle2 size={8} className="text-black" /> : null}
            {day.status === 'pending' ? <Clock size={8} className="text-[#C0B283]" /> : null}
            {day.status === 'missed' ? <XCircle size={8} className="text-rose-400" /> : null}
            {day.status === 'future' ? <span className="inline-block h-1 w-1 rounded-full bg-[var(--color-accent)]" /> : null}
          </span>
        ) : null}
      </div>
    </button>
  );
}

interface CalendarDay {
  date: string;
  dayNum: number;
  isToday: boolean;
  isFuture: boolean;
  rehearsal: PerformanceRehearsalEntry | null;
  status: PerformanceRehearsalEntry['status'] | 'no-rehearsal';
}

function dayBgClass(day: CalendarDay) {
  if (!day.date) return 'bg-transparent';
  if (!day.rehearsal) {
    return day.isToday
      ? 'bg-white/6 ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-black shadow-[0_0_10px_rgba(192,178,131,0.25)]'
      : day.isFuture
        ? 'bg-white/4 opacity-40'
        : 'bg-white/4';
  }

  switch (day.status) {
    case 'attended':
      return 'bg-[var(--color-accent)]';
    case 'pending':
      return 'border border-[#9A8455]/50 bg-[#9A8455]/20';
    case 'missed':
      return 'border border-rose-500/40 bg-rose-500/15';
    case 'future':
      return day.isToday
        ? 'border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-black'
        : 'border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] opacity-50';
    default:
      return 'bg-white/4';
  }
}

function buildCalendarDays(currentMonth: Date, rehearsals: PerformanceRehearsalEntry[], todayStr: string) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const mondayBasedOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rehearsalMap = new Map<string, PerformanceRehearsalEntry>();

  for (const entry of rehearsals) {
    const key = toDateKey(entry.rehearsal?.date ?? '');
    if (key) {
      rehearsalMap.set(key, entry);
    }
  }

  const days: CalendarDay[] = [];
  for (let i = 0; i < mondayBasedOffset; i += 1) {
    days.push({ date: '', dayNum: 0, isToday: false, isFuture: false, rehearsal: null, status: 'no-rehearsal' });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = toLocalDateStr(year, month, day);
    const rehearsal = rehearsalMap.get(dateKey) ?? null;
    const isToday = dateKey === todayStr;
    const isFuture = dateKey > todayStr;
    days.push({
      date: dateKey,
      dayNum: day,
      isToday,
      isFuture,
      rehearsal,
      status: rehearsal?.status ?? 'no-rehearsal',
    });
  }

  while (days.length % 7 !== 0) {
    days.push({ date: '', dayNum: 0, isToday: false, isFuture: false, rehearsal: null, status: 'no-rehearsal' });
  }

  return days;
}

function HomeworkCard({ item }: { item: PerformanceHomeworkEntry }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-[1rem] tracking-[-0.04em] text-[var(--color-text-high)]">{item.assignment.title}</p>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">
            {item.assignment.deadline ? formatShortDate(item.assignment.deadline) : 'Son tarih yok'}
          </p>
        </div>
        <HomeworkStatusPill status={item.status} />
      </div>

      <div className="mt-3 space-y-2 text-sm text-[var(--color-text-medium)]">
        {item.submission ? (
          <p>
            Teslim: <span className="text-[var(--color-text-high)]">{item.submission.file_name}</span>
          </p>
        ) : (
          <p>Henüz teslim edilmedi.</p>
        )}
        {item.submission?.submission_note ? (
          <p className="text-[0.85rem] leading-6 text-[var(--color-text-high)] opacity-85">{item.submission.submission_note}</p>
        ) : null}
        {item.submission?.reviewer_note ? (
          <p className="text-[0.85rem] leading-6 text-[var(--color-text-high)] opacity-85">{item.submission.reviewer_note}</p>
        ) : null}
      </div>
    </div>
  );
}

function MetricBox({
  label,
  percent,
  counts,
  note,
}: {
  label: string;
  percent: number | null;
  counts: string;
  note?: string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4">
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="font-serif text-[1.8rem] leading-none tracking-[-0.05em] text-[var(--color-text-high)]">{formatPercent(percent)}</span>
        <span className="text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">{counts}</span>
      </div>
      {note ? <p className="mt-2 text-xs leading-5 text-[var(--color-text-medium)]">{note}</p> : null}
    </div>
  );
}

export default function KoristDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const queryClient = useQueryClient();
  const { member: currentMember, isAdmin, isSectionLeader } = useAuth();
  const handleBack = useBackOrHome();

  const memberId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const privileged = isAdmin() || isSectionLeader();
  const todayStr = useMemo(() => getTodayString(), []);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: [...PERFORMANCE_ROOT_QUERY_KEY, 'detail', memberId, currentMember?.id ?? null, isAdmin(), isSectionLeader(), currentMember?.voice_group ?? null],
    queryFn: () => loadPerformanceMemberDetail(currentMember, memberId, isAdmin(), isSectionLeader()),
    enabled: Boolean(memberId && currentMember?.id && privileged),
  });

  useEffect(() => {
    if (!privileged || !currentMember?.id) {
      return;
    }

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: PERFORMANCE_ROOT_QUERY_KEY });
    };

    const channel = supabase
      .channel(`korist-detail:${currentMember.id}`)
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
  }, [currentMember?.id, privileged, queryClient]);

  const detail = detailQuery.data ?? null;

  const calendarDays = useMemo(() => {
    if (!detail) {
      return [];
    }
    return buildCalendarDays(currentMonth, detail.rehearsals, todayStr);
  }, [currentMonth, detail, todayStr]);

  const resolvedSelectedDate = useMemo(() => {
    if (!detail || calendarDays.length === 0) {
      return null;
    }

    const currentMonthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    if (selectedDate?.startsWith(currentMonthKey)) {
      return selectedDate;
    }

    return calendarDays.find((day) => Boolean(day.rehearsal))?.date ?? null;
  }, [calendarDays, currentMonth, detail, selectedDate]);

  const selectedDay = calendarDays.find((day) => day.date === resolvedSelectedDate) ?? null;
  const selectedRehearsal = selectedDay?.rehearsal ?? null;

  if (!privileged) {
    return (
      <main className="page-shell pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div className="glass-panel p-6 text-sm text-[var(--color-text-medium)]">
          Bu alan yalnızca şef ve partisyon şefleri için kullanılabilir.
        </div>
      </main>
    );
  }

  if (detailQuery.isError) {
    return (
      <main className="page-shell space-y-6 pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>
        <div className="glass-panel p-6 text-sm text-rose-300">Korist detayı yüklenemedi.</div>
      </main>
    );
  }

  if (detailQuery.isPending) {
    return (
      <main className="page-shell flex min-h-[50vh] items-center justify-center pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page-shell space-y-6 pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>
        <div className="glass-panel p-6 text-sm text-[var(--color-text-medium)]">Bu korist kapsamda bulunamadı.</div>
      </main>
    );
  }

  const member = detail.member;
  const showHomeworkMetrics = detail.show_homework_metrics;
  const continuityFormula = showHomeworkMetrics
    ? `${member.attended_rehearsals} prova + ${member.approved_assignments ?? 0} ödev / ${member.total_rehearsals} prova + ${member.total_assignments ?? 0} ödev`
    : null;
  const approvedHomework = showHomeworkMetrics ? detail.homework.filter((item) => item.status === 'approved') : [];
  const openHomework = showHomeworkMetrics ? detail.homework.filter((item) => item.status !== 'approved') : [];
  const pendingHomeworkCount = showHomeworkMetrics ? detail.homework.filter((item) => item.status === 'pending').length : 0;
  const rejectedHomeworkCount = showHomeworkMetrics ? detail.homework.filter((item) => item.status === 'rejected').length : 0;
  const missingHomeworkCount = showHomeworkMetrics ? detail.homework.filter((item) => item.status === 'missing').length : 0;
  const contentGridClass = showHomeworkMetrics ? 'grid gap-6 lg:grid-cols-[1.1fr_0.9fr]' : 'grid gap-6';

  return (
    <main className="page-shell space-y-6 pb-28 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>

      </div>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 sm:p-7"
      >
        <div className="flex flex-col gap-7">
          <div className="flex items-center gap-5">
            <MemberAvatar detail={detail} />
            <div className="min-w-0">
              <span className="page-kicker">Korist Performansı</span>
              <h1 className="mt-2 font-serif text-[1.6rem] tracking-[-0.04em] text-[var(--color-text-high)] sm:text-[2rem]">
                {member.first_name} {member.last_name}
              </h1>
            </div>
          </div>

          <div className="grid gap-x-8 gap-y-4 border-t border-[var(--color-border)] pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow icon={<Mail size={15} />} label="E-posta" value={member.email} />
            <InfoRow icon={<Phone size={15} />} label="Telefon" value={member.phone} />
            <InfoRow icon={<Cake size={15} />} label="Doğum Tarihi" value={formatDate(member.birth_date)} />
            <InfoRow icon={<CalendarDays size={15} />} label="Katılım Tarihi" value={formatDate(member.join_date)} />
            <InfoRow icon={<School2 size={15} />} label="Okul" value={member.school_name} />
            <InfoRow icon={<GraduationCap size={15} />} label="Bölüm" value={member.department_name} />
          </div>
        </div>
      </motion.section>

      <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--color-border)] border border-[var(--color-border)] rounded-[12px] bg-white/4 overflow-hidden">
        {showHomeworkMetrics ? (
          <>
            <div className="flex flex-col items-center justify-center px-6 py-5 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">PROVA KATILIMI</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(member.attendance_percent)}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center px-6 py-5 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">ÖDEV BAŞARISI</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(member.homework_percent)}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center px-6 py-5 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">GENEL DEVAMLILIK</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(member.continuity_percent)}
              </span>
            </div>
          </>
        ) : (
          <div className="col-span-3">
            <div className="flex flex-col items-center justify-center px-6 py-5 text-center">
              <span className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)] opacity-70">NORMAL DEVAMLILIK</span>
              <span className="mt-2 font-serif text-[1.8rem] font-medium leading-none tracking-[-0.04em] text-[var(--color-text-high)]">
                {formatPercent(member.attendance_percent)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className={contentGridClass}>
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-5 sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="page-kicker">Prova Takvimi</span>
              <h2 className="mt-3 font-serif text-2xl tracking-[-0.05em]">{monthLabel(currentMonth)}</h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() - 1, 1))}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-90"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + 1, 1))}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-90"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 grid grid-cols-7">
              {DAY_LABELS.map((label) => (
                <div key={label} className="py-1 text-center text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)]">
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, index) => {
                if (!day.date) {
                  return <div key={`empty-${index}`} className="aspect-square" />;
                }

                const isSelected = selectedDate === day.date;
                return (
                  <RehearsalDayCell
                    key={day.date}
                    day={day}
                    isSelected={isSelected}
                    onClick={() => setSelectedDate(isSelected ? null : day.date)}
                  />
                );
              })}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {selectedDay ? (
              <motion.div
                key={selectedDay.date}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="mt-4 rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg tracking-[-0.04em] text-[var(--color-text-high)]">
                      {new Date(`${selectedDay.date}T12:00:00`).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        weekday: 'long',
                      })}
                    </h3>
                    {selectedRehearsal ? (
                      <p className="mt-1 text-sm text-[var(--color-text-medium)]">{selectedRehearsal.rehearsal?.title}</p>
                    ) : null}
                  </div>
                  {selectedRehearsal ? (
                    <span className="status-pill !min-h-0 !rounded-full !px-3 !py-1 !text-[0.58rem]">
                      {selectedDay.status === 'attended'
                        ? 'Onaylandı'
                        : selectedDay.status === 'pending'
                          ? 'Onay bekleniyor'
                          : selectedDay.status === 'missed'
                            ? 'Katılmadı'
                            : 'Yaklaşan'}
                    </span>
                  ) : (
                    <span className="status-pill !min-h-0 !rounded-full !px-3 !py-1 !text-[0.58rem]">Prova yok</span>
                  )}
                </div>

                {selectedRehearsal ? (
                  <div className="mt-4 space-y-2 text-sm text-[var(--color-text-medium)]">
                    <p>🕐 {selectedRehearsal.rehearsal?.start_time.slice(0, 5)}</p>
                    <p>📍 {selectedRehearsal.rehearsal?.location}</p>
                    {selectedRehearsal.rehearsal?.notes ? (
                      <div
                        className="prose mt-3 max-w-none text-[var(--color-text-high)] opacity-90 [--tw-prose-body:var(--color-text-high)] [--tw-prose-headings:var(--color-text-high)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-text-high)] [--tw-prose-bullets:var(--color-text-medium)] [--tw-prose-quotes:var(--color-text-high)] [--tw-prose-code:var(--color-text-high)] [--tw-prose-hr:var(--color-border)] prose-p:my-0.5 prose-p:text-[14px] prose-p:leading-[1.4]"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(selectedRehearsal.rehearsal.notes) }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--color-text-medium)]">Bu gün için prova kaydı yok.</p>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.section>

        {showHomeworkMetrics ? (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="glass-panel p-5 sm:p-6">
              <span className="page-kicker">Ödevler</span>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-3">
                  <p className="text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">Tamamlanan</p>
                  <p className="mt-2 font-serif text-2xl tracking-[-0.05em]">{approvedHomework.length}</p>
                </div>
                <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-3">
                  <p className="text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">Bekleyen</p>
                  <p className="mt-2 font-serif text-2xl tracking-[-0.05em]">{pendingHomeworkCount}</p>
                </div>
                <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-3">
                  <p className="text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">Reddedilen</p>
                  <p className="mt-2 font-serif text-2xl tracking-[-0.05em]">{rejectedHomeworkCount}</p>
                </div>
                <div className="rounded-[10px] border border-[var(--color-border)] bg-white/4 p-3">
                  <p className="text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-text-medium)]">Eksik</p>
                  <p className="mt-2 font-serif text-2xl tracking-[-0.05em]">{missingHomeworkCount}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="glass-panel p-5 sm:p-6">
                <span className="page-kicker">Tamamlananlar</span>
                <div className="mt-4 space-y-3">
                  {approvedHomework.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-medium)]">Henüz tamamlanan ödev yok.</p>
                  ) : (
                    approvedHomework.map((item) => <HomeworkCard key={item.assignment.id} item={item} />)
                  )}
                </div>
              </div>

              <div className="glass-panel p-5 sm:p-6">
                <span className="page-kicker">Eksikler ve bekleyenler</span>
                <div className="mt-4 space-y-3">
                  {openHomework.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-medium)]">Eksik ödev yok.</p>
                  ) : (
                    openHomework.map((item) => <HomeworkCard key={item.assignment.id} item={item} />)
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        ) : null}
      </div>
    </main>
  );
}
