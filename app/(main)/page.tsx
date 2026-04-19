'use client';

import type { ElementType } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import {
  ChevronRight,
  Loader2,
  XCircle,
  CheckCircle2,
  Megaphone,
  CalendarDays,
  FileText,
  Music4,
  AlertTriangle,
  Star,
  Info,
  Heart,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { LottieIcon } from '@/components/LottieIcon';
import { KoristPerformanceSection } from '@/components/KoristPerformanceSection';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { supabase, type Announcement, type Attendance, type Rehearsal } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/richText';

const ICON_MAP: Record<string, ElementType> = {
  megaphone: Megaphone,
  calendar: CalendarDays,
  file: FileText,
  music: Music4,
  alert: AlertTriangle,
  star: Star,
  info: Info,
  heart: Heart,
};

const DASHBOARD_ANNOUNCEMENTS_KEY = ['dashboard', 'announcements'] as const;

type AttendanceState = 'idle' | 'pending' | 'approved' | 'rejected';

interface TodayRehearsalData {
  rehearsal: Rehearsal | null;
  attendanceState: AttendanceState;
}

interface AttendanceStats {
  attendedCount: number;
  missedCount: number;
  totalRehearsals: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

function toTimeStr(time: string) {
  return time.slice(0, 5);
}

function getTodayString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, choir_members(first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    throw error;
  }

  return (data ?? []) as Announcement[];
}

async function fetchTodayRehearsal(memberId: string, todayStr: string): Promise<TodayRehearsalData> {
  const { data: rehearsal, error: rehearsalError } = await supabase
    .from('rehearsals')
    .select('*')
    .eq('date', todayStr)
    .eq('collect_attendance', true)
    .maybeSingle();

  if (rehearsalError) {
    throw rehearsalError;
  }

  if (!rehearsal) {
    return { rehearsal: null, attendanceState: 'idle' };
  }

  const { data: invite, error: inviteError } = await supabase
    .from('rehearsal_invitees')
    .select('id')
    .eq('rehearsal_id', rehearsal.id)
    .eq('member_id', memberId)
    .maybeSingle();

  if (inviteError) {
    throw inviteError;
  }

  if (!invite) {
    return { rehearsal: null, attendanceState: 'idle' };
  }

  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('status')
    .eq('rehearsal_id', rehearsal.id)
    .eq('member_id', memberId)
    .maybeSingle();

  if (attendanceError) {
    throw attendanceError;
  }

  return {
    rehearsal: rehearsal as Rehearsal,
    attendanceState: (attendance?.status as AttendanceState | undefined) ?? 'idle',
  };
}

async function fetchAttendanceStats(memberId: string, todayStr: string): Promise<AttendanceStats> {
  const { data: rehearsals, error: rehearsalsError } = await supabase
    .from('rehearsals')
    .select('id')
    .eq('collect_attendance', true)
    .lte('date', todayStr);

  if (rehearsalsError) {
    throw rehearsalsError;
  }

  const allRehearsalIds = (rehearsals ?? []).map((rehearsal) => rehearsal.id);
  
  if (allRehearsalIds.length === 0) {
    return {
      attendedCount: 0,
      missedCount: 0,
      totalRehearsals: 0,
    };
  }

  const { data: invitees, error: inviteeError } = await supabase
    .from('rehearsal_invitees')
    .select('rehearsal_id')
    .eq('member_id', memberId)
    .in('rehearsal_id', allRehearsalIds);

  if (inviteeError) {
    throw inviteeError;
  }

  const rehearsalIds = (invitees ?? []).map(i => i.rehearsal_id);
  const totalRehearsals = rehearsalIds.length;

  if (totalRehearsals === 0) {
    return {
      attendedCount: 0,
      missedCount: 0,
      totalRehearsals: 0,
    };
  }

  const { data: approvedAttendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('rehearsal_id')
    .eq('member_id', memberId)
    .eq('status', 'approved')
    .in('rehearsal_id', rehearsalIds);

  if (attendanceError) {
    throw attendanceError;
  }

  const attendedCount = new Set((approvedAttendance ?? []).map((row) => row.rehearsal_id)).size;

  return {
    attendedCount,
    missedCount: Math.max(0, totalRehearsals - attendedCount),
    totalRehearsals,
  };
}

export default function Dashboard() {
  const { member, isAdmin, isSectionLeader } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const dragX = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [maxDrag, setMaxDrag] = useState(200);

  const fillWidth = useTransform(dragX, (x) => {
    const thumbW = thumbRef.current?.offsetWidth || 56;
    return `${thumbW + Math.max(0, typeof x === 'number' ? x : 0)}px`;
  });

  const todayStr = useMemo(() => getTodayString(new Date()), []);

  const announcementsQuery = useQuery({
    queryKey: DASHBOARD_ANNOUNCEMENTS_KEY,
    queryFn: fetchAnnouncements,
  });

  const todayRehearsalQuery = useQuery({
    queryKey: ['dashboard', 'todayRehearsal', member?.id, todayStr],
    queryFn: () => fetchTodayRehearsal(member!.id, todayStr),
    enabled: Boolean(member?.id),
  });

  const todayRehearsal = todayRehearsalQuery.data?.rehearsal ?? null;
  const attendanceState = todayRehearsalQuery.data?.attendanceState ?? 'idle';

  useEffect(() => {
    if (!containerRef.current || !thumbRef.current) return;
    
    const updateSize = () => {
      if (containerRef.current && thumbRef.current) {
        setMaxDrag(containerRef.current.offsetWidth - thumbRef.current.offsetWidth);
      }
    };
    
    updateSize();
    
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, [todayRehearsal, attendanceState]);

  const statsQuery = useQuery({
    queryKey: ['dashboard', 'attendanceStats', member?.id, todayStr],
    queryFn: () => fetchAttendanceStats(member!.id, todayStr),
    enabled: Boolean(member?.id),
  });

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-announcements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_ANNOUNCEMENTS_KEY });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!member?.id) {
      return;
    }

    const invalidateAttendance = () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'todayRehearsal', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'attendanceStats', member.id] });
    };

    const channel = supabase
      .channel(`dashboard:${member.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance',
          filter: `member_id=eq.${member.id}`,
        },
        invalidateAttendance,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rehearsals' }, invalidateAttendance)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rehearsal_invitees',
          filter: `member_id=eq.${member.id}`,
        },
        invalidateAttendance,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [member?.id, queryClient]);

  const attendanceMutation = useMutation({
    mutationFn: async () => {
      if (!member?.id || !todayRehearsalQuery.data?.rehearsal) {
        throw new Error('Prova bilgisi bulunamadı.');
      }

      const autoApprove = isAdmin() || isSectionLeader();
      const nextStatus: AttendanceState = autoApprove ? 'approved' : 'pending';
      const payload: {
        rehearsal_id: string;
        member_id: string;
        status: AttendanceState;
        approved_by?: string;
        approved_at?: string;
      } = {
        rehearsal_id: todayRehearsalQuery.data.rehearsal.id,
        member_id: member.id,
        status: nextStatus,
      };

      if (autoApprove) {
        payload.approved_by = member.id;
        payload.approved_at = new Date().toISOString();
      }

      const { error } = await supabase.from('attendance').upsert(payload, { onConflict: 'rehearsal_id,member_id' });

      if (error) {
        throw error;
      }

      return nextStatus;
    },
    onMutate: async () => {
      if (!member?.id) {
        return undefined;
      }

      const todayKey = ['dashboard', 'todayRehearsal', member.id, todayStr] as const;
      const statsKey = ['dashboard', 'attendanceStats', member.id, todayStr] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: todayKey }),
        queryClient.cancelQueries({ queryKey: statsKey }),
      ]);

      const previousToday = queryClient.getQueryData<TodayRehearsalData>(todayKey);
      const previousStats = queryClient.getQueryData<AttendanceStats>(statsKey);
      const nextStatus: AttendanceState = isAdmin() || isSectionLeader() ? 'approved' : 'pending';

      if (previousToday?.rehearsal) {
        queryClient.setQueryData<TodayRehearsalData>(todayKey, {
          ...previousToday,
          attendanceState: nextStatus,
        });
      }

      if (nextStatus === 'approved' && previousStats && previousToday?.attendanceState === 'idle') {
        queryClient.setQueryData<AttendanceStats>(statsKey, {
          ...previousStats,
          attendedCount: Math.min(previousStats.totalRehearsals, previousStats.attendedCount + 1),
          missedCount: Math.max(0, previousStats.missedCount - 1),
        });
      }

      return { previousToday, previousStats };
    },
    onError: (error, _variables, context) => {
      if (member?.id) {
        const todayKey = ['dashboard', 'todayRehearsal', member.id, todayStr] as const;
        const statsKey = ['dashboard', 'attendanceStats', member.id, todayStr] as const;

        if (context?.previousToday) {
          queryClient.setQueryData(todayKey, context.previousToday);
        }
        if (context?.previousStats) {
          queryClient.setQueryData(statsKey, context.previousStats);
        }
      }

      animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 20 });
      toast.error(error instanceof Error ? error.message : 'Katılım kaydedilemedi.', 'Katılım');
    },
    onSuccess: () => {
      animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 20 });
    },
    onSettled: async () => {
      if (!member?.id) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'todayRehearsal', member.id] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'attendanceStats', member.id] }),
      ]);
    },
  });

  const announcements = announcementsQuery.data ?? [];
  const { attendedCount, missedCount, totalRehearsals } = statsQuery.data ?? {
    attendedCount: 0,
    missedCount: 0,
    totalRehearsals: 0,
  };

  const rawAttendancePercent = totalRehearsals > 0 ? Math.round((attendedCount / totalRehearsals) * 100) : 0;
  const attendancePercent = Number.isFinite(rawAttendancePercent)
    ? Math.max(0, Math.min(100, rawAttendancePercent))
    : 0;
  const circumference = 289;
  const dashOffset = circumference - (circumference * attendancePercent) / 100;

  const handleSwipeConfirm = () => {
    if (!member?.id || !todayRehearsal || attendanceState !== 'idle' || attendanceMutation.isPending) {
      animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 20 });
      return;
    }

    attendanceMutation.mutate();
  };

  return (
    <main className="page-shell space-y-6 sm:space-y-8">
      <div className="grid gap-6">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-panel p-6 sm:p-7"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="page-kicker">Duyurular</span>
            <div className="flex items-center gap-3">
              <Link href="/announcements" className="text-xs uppercase tracking-widest text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-high)]">
                Tümü
              </Link>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {announcementsQuery.isPending ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
              </div>
            ) : announcementsQuery.isError ? (
              <div className="rounded-[4px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                Duyurular yüklenemedi.
              </div>
            ) : announcements.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--color-text-medium)]">Henüz duyuru yok.</p>
            ) : (
              announcements.map((announcement) => {
                const Icon = ICON_MAP[announcement.icon] ?? Megaphone;
                return (
                  <Link href={`/announcements/${announcement.id}`} key={announcement.id} className="block">
                    <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-3 transition-colors active:scale-[0.98] hover:bg-white/5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0 flex flex-1 flex-col">
                          <p className="line-clamp-2 font-serif text-[15px] leading-tight tracking-[-0.03em]">{announcement.title}</p>
                          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-medium)]">{formatDate(announcement.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </motion.section>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="glass-panel p-6 sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="page-kicker">Devam Çizelgesi</span>
              <h3 className="mt-4 font-serif text-2xl tracking-[-0.05em]">Genel devamlılık</h3>
            </div>
            <Link
              href="/devamsizlik"
              className="mt-1 text-xs uppercase tracking-widest text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-accent)]"
            >
              Genişlet
            </Link>
          </div>

          <div className="mt-4 flex items-center justify-between gap-6">
            <div className="space-y-3 text-sm text-[var(--color-text-medium)]">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                <p className="whitespace-nowrap">
                  Gelinen prova: <span className="font-bold text-[var(--color-text-high)]">{attendedCount}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-rose-400" />
                <p className="whitespace-nowrap">
                  Gelinmeyen prova: <span className="font-bold text-[var(--color-text-high)]">{missedCount}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sky-300" />
                <p className="whitespace-nowrap">
                  Kritik eşik: <span className="font-bold text-[var(--color-text-high)]">%75</span>
                </p>
              </div>
              {statsQuery.isError ? (
                <p className="pt-1 text-xs text-rose-300">Devam verisi güncellenemedi.</p>
              ) : null}
            </div>

            <div className="relative h-28 w-28 shrink-0">
              <svg className="h-full w-full -rotate-90">
                <circle className="text-white/8 [.light_&]:text-black/8" cx="56" cy="56" fill="transparent" r="46" stroke="currentColor" strokeWidth="6" />
                <circle
                  className="text-[var(--color-accent)] transition-all duration-700"
                  cx="56"
                  cy="56"
                  fill="transparent"
                  r="46"
                  stroke="currentColor"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <div className="-mt-1 flex flex-col items-center justify-center text-center">
                  <span className="font-serif text-[22px] font-bold leading-none tracking-[-0.05em]">%{attendancePercent}</span>
                  <span className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-high)] opacity-85 leading-tight">Devamlılık</span>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {!todayRehearsalQuery.isPending && todayRehearsal ? (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="glass-panel p-6 sm:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="page-kicker">Katılım Komutu</span>
                <h3 className="mt-4 font-serif text-2xl tracking-[-0.05em]">{todayRehearsal.title}</h3>
              </div>
              <span className="status-pill">
                {toTimeStr(todayRehearsal.start_time)} • {todayRehearsal.location}
              </span>
            </div>

            <div className={`mt-6 grid gap-4 ${todayRehearsal.notes ? 'lg:grid-cols-[0.78fr_1.22fr]' : ''}`}>
              {todayRehearsal.notes ? (
                <div className="rounded-[4px] border border-[var(--color-border)] bg-white/4 p-4">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)]">Not</p>
                  <div
                    className="prose mt-3 max-w-none text-[var(--color-text-high)] opacity-90 [--tw-prose-body:var(--color-text-high)] [--tw-prose-headings:var(--color-text-high)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-text-high)] [--tw-prose-bullets:var(--color-text-medium)] [--tw-prose-quotes:var(--color-text-high)] [--tw-prose-code:var(--color-text-high)] [--tw-prose-hr:var(--color-border)] prose-p:my-0.5 prose-p:text-[14px] prose-p:leading-[1.4] prose-ul:list-disc prose-ol:list-decimal prose-li:my-0.5 prose-a:text-[var(--color-accent)] prose-img:my-2 prose-img:max-h-[30vh] prose-img:w-full prose-img:rounded-[8px] prose-img:border prose-img:border-[var(--color-border)] prose-img:object-cover"
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(todayRehearsal.notes) }}
                  />
                </div>
              ) : null}

              <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                <div ref={containerRef} className="group relative h-14 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-solid)] sm:h-16">
                  {attendanceState === 'idle' ? (
                    <motion.div
                      className="absolute bottom-0 left-0 top-0 z-10 rounded-full bg-[var(--color-accent)]"
                      style={{ width: fillWidth }}
                    />
                  ) : null}

                  <AnimatePresence mode="wait">
                    {attendanceState === 'idle' ? (
                      <motion.div
                        key="idle-text"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center pl-[3.5rem] pr-2 text-center sm:pl-[4rem]"
                      >
                        <span className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)] sm:text-[0.72rem]">
                          Katılımı onaylamak için sürükle
                        </span>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {attendanceState === 'idle' ? (
                    <motion.div
                      ref={thumbRef}
                      style={{ x: dragX }}
                      drag="x"
                      dragConstraints={{ left: 0, right: maxDrag }}
                      dragElastic={0}
                      dragMomentum={false}
                      onDragEnd={() => {
                        if (dragX.get() >= maxDrag * 0.8) {
                          handleSwipeConfirm();
                        } else {
                          animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 20 });
                        }
                      }}
                      className="group/thumb relative z-20 flex h-full w-14 shrink-0 cursor-grab items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg active:cursor-grabbing sm:w-16"
                    >
                      <ChevronRight className="transition-transform duration-200 group-active/thumb:scale-75" size={24} strokeWidth={2.4} />
                    </motion.div>
                  ) : null}

                  <AnimatePresence mode="wait">
                    {attendanceState === 'pending' ? (
                      <motion.div
                        key="pending"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-surface-solid)]"
                      >
                        <div className="flex items-center gap-3">
                          <Loader2 className="animate-spin text-[var(--color-accent)]" size={18} />
                          <span className="whitespace-nowrap font-serif text-base italic tracking-[-0.04em] text-[var(--color-accent)] sm:text-lg">
                            Onay bekleniyor...
                          </span>
                        </div>
                      </motion.div>
                    ) : null}
                    {attendanceState === 'approved' ? (
                      <motion.div
                        key="approved"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-accent-soft)]"
                      >
                        <div className="flex items-center gap-1">
                          <LottieIcon path="/lottie/Success.json" fallback={CheckCircle2} size={36} isActive stopAtHalf interactive={false} />
                          <motion.span
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.3 }}
                            className="whitespace-nowrap font-serif text-base font-medium tracking-[-0.04em] text-[var(--color-accent)] sm:text-lg"
                          >
                            Onaylandı
                          </motion.span>
                        </div>
                      </motion.div>
                    ) : null}
                    {attendanceState === 'rejected' ? (
                      <motion.div
                        key="rejected"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 z-30 flex items-center justify-center bg-rose-500/10"
                      >
                        <div className="flex items-center gap-2">
                          <XCircle className="text-rose-500" size={20} />
                          <span className="whitespace-nowrap font-serif text-base tracking-[-0.04em] text-rose-500 sm:text-lg">
                            Reddedildi
                          </span>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.section>
        ) : todayRehearsalQuery.isPending ? (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="glass-panel flex min-h-[220px] items-center justify-center p-6 sm:p-7"
          >
            <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
          </motion.section>
        ) : todayRehearsalQuery.isError ? (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="glass-panel flex min-h-[220px] items-center justify-center p-6 text-center text-sm text-rose-300 sm:p-7"
          >
            Bugünün prova bilgisi alınamadı.
          </motion.section>
        ) : null}
      </div>

      <KoristPerformanceSection />
    </main>
  );
}
