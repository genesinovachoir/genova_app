'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, Clock, XCircle, Loader2, RotateCcw, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Rehearsal, type Attendance } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { EventFormModal } from '@/components/EventFormModal';
import { useToast } from '@/components/ToastProvider';

const DAY_LABELS = ['PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CMT', 'PAZ'];

type DayStatus = 'attended' | 'pending' | 'missed' | 'no-rehearsal' | 'future';
type AttendanceRecordStatus = 'pending' | 'approved' | 'rejected';
type ManualAttendanceStatus = 'approved' | 'rejected' | 'clear';

interface RehearsalWithInviteeCount extends Rehearsal {
  inviteeCount: number;
}

interface CalendarDay {
  date: string;
  dayNum: number;
  isToday: boolean;
  isFuture: boolean;
  rehearsal: RehearsalWithInviteeCount | null;
  attendanceStatus: DayStatus;
}

interface PendingAttendance {
  id: string;
  member_id: string;
  rehearsal_id: string;
  status: string;
  checked_in_at: string;
  choir_members: {
    first_name: string;
    last_name: string;
    voice_group: string | null;
  };
  rehearsals: {
    date: string;
    title: string;
  };
}

interface RehearsalParticipant {
  member_id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
  sub_voice_group: string | null;
  attendance_id: string | null;
  status: AttendanceRecordStatus | null;
  checked_in_at: string | null;
}

async function getAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Oturum doğrulanamadı. Lütfen tekrar giriş yapın.');
  }

  return sessionData.session.access_token;
}

async function postJsonWithAuth<T>(url: string, payload: Record<string, unknown>) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `İstek başarısız (${response.status})`);
  }

  return (await response.json()) as T;
}

function toLocalDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getTodayString() {
  const now = new Date();
  return toLocalDateStr(now.getFullYear(), now.getMonth(), now.getDate());
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }).toUpperCase();
}

async function fetchMonthData(memberId: string, currentMonth: Date) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startStr = toLocalDateStr(year, month, 1);
  const endStr = toLocalDateStr(year, month, lastDay);

  const { data: rehearsalRows, error: rehearsalError } = await supabase
    .from('rehearsals')
    .select('*')
    .gte('date', startStr)
    .lte('date', endStr);

  if (rehearsalError) {
    throw rehearsalError;
  }

  const rehearsals = (rehearsalRows ?? []) as Rehearsal[];
  const rehearsalIds = rehearsals.map((rehearsal) => rehearsal.id);

  let inviteeCountMap = new Map<string, number>();
  let myInvitedRehearsalIds = new Set<string>();
  let myAttendance: Attendance[] = [];

  if (rehearsalIds.length > 0) {
    const { data: inviteeRows, error: inviteeError } = await supabase
      .from('rehearsal_invitees')
      .select('rehearsal_id, member_id')
      .in('rehearsal_id', rehearsalIds);

    if (inviteeError) {
      throw inviteeError;
    }

    inviteeCountMap = (inviteeRows ?? []).reduce((map, row) => {
      map.set(row.rehearsal_id, (map.get(row.rehearsal_id) ?? 0) + 1);
      if (row.member_id === memberId) myInvitedRehearsalIds.add(row.rehearsal_id);
      return map;
    }, new Map<string, number>());
  }

  if (rehearsalIds.length > 0) {
    const { data: attendanceRows, error: attendanceError } = await supabase
      .from('attendance')
      .select('*')
      .eq('member_id', memberId)
      .in('rehearsal_id', rehearsalIds);

    if (attendanceError) {
      throw attendanceError;
    }

    myAttendance = (attendanceRows ?? []) as Attendance[];
  }

  return {
    rehearsals: rehearsals.map((rehearsal) => ({
      ...rehearsal,
      inviteeCount: inviteeCountMap.get(rehearsal.id) ?? 0,
    })),
    myAttendance,
    myInvitedRehearsalIds,
  };
}

async function fetchPendingApprovals() {
  const { data, error } = await supabase.rpc('get_pending_approvals');

  if (error) {
    throw error;
  }

  return (data ?? []).map((row: any) => ({
    id: row.attendance_id,
    member_id: row.member_id,
    rehearsal_id: row.rehearsal_id,
    status: row.status,
    checked_in_at: row.checked_in_at,
    choir_members: {
      first_name: row.member_first_name,
      last_name: row.member_last_name,
      voice_group: row.member_voice_group,
    },
    rehearsals: {
      date: row.rehearsal_date,
      title: row.rehearsal_title,
    },
  })) as PendingAttendance[];
}

async function fetchRehearsalParticipants(
  rehearsalId: string,
  options: { isAdmin: boolean; voiceGroup: string | null },
) {
  const { data: inviteeRows, error: inviteeError } = await supabase
    .from('rehearsal_invitees')
    .select('member_id')
    .eq('rehearsal_id', rehearsalId);

  if (inviteeError) {
    throw inviteeError;
  }

  const invitedMemberIds = Array.from(new Set((inviteeRows ?? []).map((row) => row.member_id).filter(Boolean)));
  if (invitedMemberIds.length === 0) {
    return [] as RehearsalParticipant[];
  }

  if (!options.isAdmin && !options.voiceGroup) {
    return [] as RehearsalParticipant[];
  }

  let membersQuery = supabase
    .from('choir_members')
    .select('id, first_name, last_name, voice_group, sub_voice_group')
    .in('id', invitedMemberIds)
    .order('voice_group')
    .order('first_name');

  if (!options.isAdmin) {
    membersQuery = membersQuery.eq('voice_group', options.voiceGroup);
  }

  const { data: members, error: membersError } = await membersQuery;
  if (membersError) {
    throw membersError;
  }

  const visibleMemberIds = (members ?? []).map((memberRow) => memberRow.id);
  if (visibleMemberIds.length === 0) {
    return [] as RehearsalParticipant[];
  }

  const { data: attendanceRows, error: attendanceError } = await supabase
    .from('attendance')
    .select('id, member_id, status, checked_in_at')
    .eq('rehearsal_id', rehearsalId)
    .in('member_id', visibleMemberIds);

  if (attendanceError) {
    throw attendanceError;
  }

  const attendanceByMemberId = new Map(
    (attendanceRows ?? []).map((attendance) => [attendance.member_id, attendance]),
  );

  return (members ?? []).map((memberRow) => {
    const attendance = attendanceByMemberId.get(memberRow.id);
    return {
      member_id: memberRow.id,
      first_name: memberRow.first_name,
      last_name: memberRow.last_name,
      voice_group: memberRow.voice_group,
      sub_voice_group: memberRow.sub_voice_group,
      attendance_id: attendance?.id ?? null,
      status: (attendance?.status as AttendanceRecordStatus | undefined) ?? null,
      checked_in_at: attendance?.checked_in_at ?? null,
    };
  }) as RehearsalParticipant[];
}

async function fetchContinuityInfo(memberId: string) {
  const { data, error } = await supabase.rpc('get_member_continuity_info', { p_member_id: memberId });
  if (error) {
    throw error;
  }
  return data?.[0] as {
    total_rehearsals: number;
    attended_rehearsals: number;
    total_assignments: number;
    approved_assignments: number;
    continuity_coefficient: number;
  } | null;
}

export default function DevamsizlikPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { member, isAdmin, isSectionLeader } = useAuth();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editRehearsal, setEditRehearsal] = useState<Rehearsal | null>(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);

  const todayStr = useMemo(() => getTodayString(), []);
  const canApprove = isAdmin() || isSectionLeader();
  const canManageAdmin = isAdmin();
  const canManageSectionLeader = isSectionLeader();
  const canManage = canManageAdmin || canManageSectionLeader;
  const monthKey = `${currentMonth.getFullYear()}-${currentMonth.getMonth()}`;

  const monthDataQuery = useQuery({
    queryKey: ['devamsizlik', 'month', member?.id, monthKey],
    queryFn: () => fetchMonthData(member!.id, currentMonth),
    enabled: Boolean(member?.id),
  });

  const pendingQuery = useQuery({
    queryKey: ['devamsizlik', 'pending', member?.id],
    queryFn: fetchPendingApprovals,
    enabled: Boolean(member?.id && canApprove),
  });

  const continuityQuery = useQuery({
    queryKey: ['devamsizlik', 'continuity', member?.id],
    queryFn: () => fetchContinuityInfo(member!.id),
    enabled: Boolean(member?.id),
  });

  useEffect(() => {
    if (!member?.id) {
      return;
    }

    const channel = supabase
      .channel(`devamsizlik:${member.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rehearsals' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rehearsal_invitees' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [member?.id, queryClient]);

  const approveMutation = useMutation({
    mutationFn: async (attendanceId: string) => {
      const { error } = await supabase
        .from('attendance')
        .update({ status: 'approved', approved_by: member!.id, approved_at: new Date().toISOString() })
        .eq('id', attendanceId);

      if (error) {
        throw error;
      }

      return attendanceId;
    },
    onMutate: async (attendanceId) => {
      await queryClient.cancelQueries({ queryKey: ['devamsizlik', 'pending', member?.id] });
      const previousPending = queryClient.getQueryData<PendingAttendance[]>(['devamsizlik', 'pending', member?.id]);
      queryClient.setQueryData<PendingAttendance[]>(['devamsizlik', 'pending', member?.id], (current = []) =>
        current.filter((attendance) => attendance.id !== attendanceId),
      );
      return { previousPending };
    },
    onError: (error, _attendanceId, context) => {
      if (context?.previousPending) {
        queryClient.setQueryData(['devamsizlik', 'pending', member?.id], context.previousPending);
      }
      toast.error(error instanceof Error ? error.message : 'Onay işlemi başarısız.', 'Devamsızlık');
    },
    onSuccess: () => {
      toast.success('Katılım onaylandı.');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
      await queryClient.invalidateQueries({ queryKey: ['devamsizlik', 'pending', member?.id] });
    },
  });

  const manualAttendanceMutation = useMutation({
    mutationFn: async (input: { rehearsalId: string; memberId: string; status: ManualAttendanceStatus }) => {
      await postJsonWithAuth<{ ok: true }>('/api/rehearsals/attendance/update', {
        rehearsal_id: input.rehearsalId,
        member_id: input.memberId,
        status: input.status,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Katılım durumu güncellenemedi.', 'Katılım');
    },
    onSuccess: () => {
      toast.success('Katılım durumu güncellendi.');
      setSelectedParticipantId(null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const rehearsals = monthDataQuery.data?.rehearsals;
  const myAttendance = monthDataQuery.data?.myAttendance;
  const myInvitedRehearsalIds = monthDataQuery.data?.myInvitedRehearsalIds;
  const pendingAttendances = pendingQuery.data ?? [];
  const continuity = continuityQuery.data;

  const calendarDays = useMemo<CalendarDay[]>(() => {
    const monthRehearsals = rehearsals ?? [];
    const monthAttendance = myAttendance ?? [];
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const rehearsalMap = new Map(monthRehearsals.map((rehearsal) => [rehearsal.date, rehearsal]));
    const attendanceMap = new Map(monthAttendance.map((attendance) => [attendance.rehearsal_id, attendance]));
    const days: CalendarDay[] = [];

    for (let index = 0; index < firstDayOfWeek; index += 1) {
      days.push({ date: '', dayNum: 0, isToday: false, isFuture: false, rehearsal: null, attendanceStatus: 'no-rehearsal' });
    }

    for (let day = 1; day <= lastDay; day += 1) {
      const dateStr = toLocalDateStr(year, month, day);
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      
      let rehearsal = rehearsalMap.get(dateStr) ?? null;
      if (rehearsal) {
        let isVisible = false;
        if (canManageAdmin) isVisible = true;
        else if (canManageSectionLeader && rehearsal.created_by === member?.id) isVisible = true;
        else if (myInvitedRehearsalIds?.has(rehearsal.id)) isVisible = true;
        
        if (!isVisible) {
          rehearsal = null;
        }
      }

      const attendance = rehearsal ? attendanceMap.get(rehearsal.id) ?? null : null;

      let attendanceStatus: DayStatus = 'no-rehearsal';
      if (rehearsal?.collect_attendance) {
        if (isFuture) {
          attendanceStatus = 'future';
        } else if (isToday && !attendance) {
          attendanceStatus = 'future';
        } else if (attendance?.status === 'approved') {
          attendanceStatus = 'attended';
        } else if (attendance?.status === 'pending') {
          attendanceStatus = 'pending';
        } else if (attendance?.status === 'rejected') {
          attendanceStatus = 'missed';
        } else if (!isFuture && !isToday) {
          attendanceStatus = 'missed';
        } else {
          attendanceStatus = 'future';
        }
      }

      days.push({
        date: dateStr,
        dayNum: day,
        isToday,
        isFuture,
        rehearsal,
        attendanceStatus,
      });
    }

    return days;
  }, [canManageAdmin, canManageSectionLeader, currentMonth, member?.id, myAttendance, myInvitedRehearsalIds, rehearsals, todayStr]);

  const selectedDay = useMemo(
    () => calendarDays.find((day) => day.date === selectedDate) ?? null,
    [calendarDays, selectedDate],
  );

  const selectedRehearsalId = selectedDay?.rehearsal?.id ?? null;
  const participantsQuery = useQuery({
    queryKey: ['devamsizlik', 'participants', selectedRehearsalId, canManageAdmin, member?.voice_group],
    queryFn: () => fetchRehearsalParticipants(selectedRehearsalId!, {
      isAdmin: canManageAdmin,
      voiceGroup: member?.voice_group ?? null,
    }),
    enabled: Boolean(canApprove && selectedRehearsalId),
  });

  const loading = monthDataQuery.isPending || (canApprove && pendingQuery.isPending);
  const hasQueryError = monthDataQuery.isError || pendingQuery.isError;
  const approvingId = approveMutation.isPending ? approveMutation.variables : null;
  const participants = participantsQuery.data ?? [];
  const manualAttendanceVariables = manualAttendanceMutation.variables;

  const navigateMonth = (delta: number) => {
    setCurrentMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + delta, 1));
    setSelectedDate(null);
    setSelectedParticipantId(null);
  };

  function dayBgClass(day: CalendarDay) {
    if (!day.date) return 'bg-transparent';
    if (!day.rehearsal || !day.rehearsal.collect_attendance) {
      return day.isToday
        ? 'bg-white/6 ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-black shadow-[0_0_10px_rgba(192,178,131,0.25)]'
        : day.isFuture
          ? 'bg-white/4 opacity-40'
          : 'bg-white/4';
    }
    switch (day.attendanceStatus) {
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

  function participantStatusLabel(status: AttendanceRecordStatus | null) {
    if (status === 'approved') return 'Katıldı';
    if (status === 'pending') return 'Onay bekliyor';
    if (status === 'rejected') return 'Katılmadı';
    return 'Katılım yok';
  }

  function participantStatusClass(status: AttendanceRecordStatus | null) {
    if (status === 'approved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [.light_&]:text-emerald-700';
    if (status === 'pending') return 'border-[#9A8455]/40 bg-[#9A8455]/15 text-[#C0B283] [.light_&]:text-[#4f3b12]';
    if (status === 'rejected') return 'border-rose-500/30 bg-rose-500/10 text-rose-300 [.light_&]:text-rose-700';
    return 'border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)]';
  }

  function updateParticipantAttendance(memberId: string, status: ManualAttendanceStatus) {
    if (!selectedRehearsalId) {
      return;
    }

    manualAttendanceMutation.mutate({
      rehearsalId: selectedRehearsalId,
      memberId,
      status,
    });
  }

  return (
    <main className="min-h-screen bg-[var(--color-background)] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-background)]/90 px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)] backdrop-blur-sm">
        <button
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-95"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>
        <div>
          <span className="page-kicker">Devam Çizelgesi</span>
          <h1 className="mt-2 font-serif text-3xl tracking-[-0.05em]">Takvim</h1>
        </div>
      </div>

      <div className="space-y-6 px-5 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl tracking-[-0.04em]">{monthLabel(currentMonth)}</h2>
          <div className="flex gap-2">
            <button onClick={() => navigateMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-90">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => navigateMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/4 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-90">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
          </div>
        ) : hasQueryError ? (
          <div className="glass-panel p-5 text-sm text-rose-300">
            Devamsızlık verileri yüklenemedi. Lütfen tekrar deneyin.
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-2 text-xs opacity-70">
                {monthDataQuery.error?.message || pendingQuery.error?.message}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="glass-panel p-4">
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
                  const hasRehearsal = Boolean(day.rehearsal?.collect_attendance);

                  return (
                    <button
                      key={day.date}
                      onClick={() => {
                        setSelectedDate(isSelected ? null : day.date);
                        setSelectedParticipantId(null);
                      }}
                      className={`aspect-square rounded-lg transition-all active:scale-90 ${dayBgClass(day)} ${isSelected ? 'ring-2 ring-white/50 ring-offset-1 ring-offset-black' : ''}`}
                    >
                      <div className="flex h-full flex-col items-center justify-center gap-0.5">
                        <span className={`text-[0.72rem] font-bold leading-none ${day.attendanceStatus === 'attended' ? 'text-black' : 'text-[var(--color-text-high)]'}`}>
                          {String(day.dayNum).padStart(2, '0')}
                        </span>
                        {hasRehearsal ? (
                          <span className="inline-flex h-[10px] items-center justify-center leading-none">
                            {day.attendanceStatus === 'attended' ? <CheckCircle2 size={8} className="text-black" /> : null}
                            {day.attendanceStatus === 'pending' ? <Clock size={8} className="text-[#C0B283]" /> : null}
                            {day.attendanceStatus === 'missed' ? <XCircle size={8} className="text-rose-400" /> : null}
                            {day.attendanceStatus === 'future' ? <span className="inline-block h-1 w-1 rounded-full bg-[var(--color-accent)]" /> : null}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <AnimatePresence>
              {selectedDate && selectedDay ? (
                <motion.div
                  key={selectedDate}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  className="glass-panel space-y-3 p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-serif text-lg tracking-[-0.04em]">
                        {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'long',
                          weekday: 'long',
                        })}
                        {selectedDay.rehearsal ? ` · ${selectedDay.rehearsal.title}` : ''}
                      </h3>
                    </div>
                    {(() => {
                      if (!canManage) return null;
                      if (selectedDay.rehearsal) {
                        const canEdit = canManageAdmin || (canManageSectionLeader && selectedDay.rehearsal.created_by === member?.id);
                        if (!canEdit) return null;
                      }
                      return (
                        <button
                          onClick={() => {
                            setEditRehearsal(selectedDay.rehearsal);
                            setShowEventForm(true);
                          }}
                          className="shrink-0 rounded-[6px] border border-[var(--color-border)] bg-white/4 px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-accent)] active:scale-95"
                        >
                          {selectedDay.rehearsal ? 'Düzenle' : 'Oluştur'}
                        </button>
                      );
                    })()}
                  </div>

                  {selectedDay.rehearsal ? (
                    <div className="space-y-1.5 text-sm text-[var(--color-text-medium)]">
                      <p>
                        🕐 {selectedDay.rehearsal.start_time.slice(0, 5)}
                        {selectedDay.rehearsal.end_time ? ` — ${selectedDay.rehearsal.end_time.slice(0, 5)}` : ''}
                      </p>
                      <p>📍 {selectedDay.rehearsal.location}</p>
                      {selectedDay.rehearsal.collect_attendance ? (
                        <p className="pt-1 text-[0.72rem] uppercase tracking-[0.12em]">
                          Durum:{' '}
                          <span
                            className={
                              selectedDay.attendanceStatus === 'attended'
                                ? 'text-[var(--color-accent)]'
                                : selectedDay.attendanceStatus === 'pending'
                                  ? 'text-[#C0B283]'
                                  : selectedDay.attendanceStatus === 'missed'
                                    ? 'text-rose-400'
                                    : 'text-[var(--color-text-medium)]'
                            }
                          >
                            {selectedDay.attendanceStatus === 'attended'
                              ? 'Onaylandı'
                              : selectedDay.attendanceStatus === 'pending'
                                ? 'Onay bekleniyor'
                                : selectedDay.attendanceStatus === 'missed'
                                  ? 'Katılmadınız'
                                  : `Davetli: ${selectedDay.rehearsal.inviteeCount || '—'}`}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedDay.rehearsal && canApprove ? (
                    <div className="border-t border-[var(--color-border)] pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="page-kicker">Katılımcılar</span>
                        <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-medium)]">
                          <Users size={13} />
                          {participantsQuery.isPending ? '—' : participants.length}
                        </span>
                      </div>

                      {participantsQuery.isPending ? (
                        <div className="flex justify-center py-5">
                          <Loader2 className="animate-spin text-[var(--color-accent)]" size={18} />
                        </div>
                      ) : participantsQuery.isError ? (
                        <div className="rounded-[8px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                          Katılımcılar yüklenemedi.
                        </div>
                      ) : participants.length === 0 ? (
                        <div className="rounded-[8px] border border-[var(--color-border)] bg-white/4 px-3 py-3 text-sm text-[var(--color-text-medium)]">
                          Katılımcı bulunamadı.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {participants.map((participant) => {
                            const isExpanded = selectedParticipantId === participant.member_id;
                            const isUpdatingParticipant = manualAttendanceMutation.isPending && manualAttendanceVariables?.memberId === participant.member_id;
                            const updatingStatus = isUpdatingParticipant ? manualAttendanceVariables?.status : null;

                            return (
                              <div key={participant.member_id} className="rounded-[8px] border border-[var(--color-border)] bg-white/4">
                                <button
                                  type="button"
                                  onClick={() => setSelectedParticipantId(isExpanded ? null : participant.member_id)}
                                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {participant.first_name} {participant.last_name}
                                    </p>
                                    <p className="mt-0.5 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-medium)]">
                                      {participant.sub_voice_group ?? participant.voice_group ?? '—'}
                                    </p>
                                  </div>
                                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-[0.1em] ${participantStatusClass(participant.status)}`}>
                                    {participantStatusLabel(participant.status)}
                                  </span>
                                </button>

                                <AnimatePresence initial={false}>
                                  {isExpanded ? (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] p-3">
                                        <button
                                          type="button"
                                          onClick={() => updateParticipantAttendance(participant.member_id, 'approved')}
                                          disabled={manualAttendanceMutation.isPending || participant.status === 'approved'}
                                          className="flex items-center justify-center gap-1.5 rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-emerald-300 transition-all active:scale-95 disabled:opacity-45 [.light_&]:text-emerald-700"
                                        >
                                          {updatingStatus === 'approved' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                          Katıldı
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => updateParticipantAttendance(participant.member_id, 'rejected')}
                                          disabled={manualAttendanceMutation.isPending || participant.status === 'rejected'}
                                          className="flex items-center justify-center gap-1.5 rounded-[6px] border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-rose-300 transition-all active:scale-95 disabled:opacity-45 [.light_&]:text-rose-700"
                                        >
                                          {updatingStatus === 'rejected' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                          Katılmadı
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => updateParticipantAttendance(participant.member_id, 'clear')}
                                          disabled={manualAttendanceMutation.isPending || !participant.status}
                                          className="flex items-center justify-center gap-1.5 rounded-[6px] border border-[var(--color-border)] bg-white/4 px-2 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-medium)] transition-all hover:text-[var(--color-text-high)] active:scale-95 disabled:opacity-45"
                                        >
                                          {updatingStatus === 'clear' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                          Kaldır
                                        </button>
                                      </div>
                                    </motion.div>
                                  ) : null}
                                </AnimatePresence>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {canApprove && pendingAttendances.length > 0 ? (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div className="glass-panel p-5">
                  <span className="page-kicker mb-4 block">Bekleyen Onaylar</span>
                  <div className="space-y-2">
                    {pendingAttendances.map((attendance) => (
                      <div key={attendance.id} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--color-border)] bg-white/4 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">
                            {attendance.choir_members.first_name} {attendance.choir_members.last_name}
                          </p>
                          <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-medium)]">
                            {attendance.choir_members.voice_group}
                          </p>
                        </div>
                        <button
                          onClick={() => approveMutation.mutate(attendance.id)}
                          disabled={approveMutation.isPending}
                          className="flex items-center gap-1.5 rounded-[6px] bg-[var(--color-accent)] px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
                        >
                          {approvingId === attendance.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          Onayla
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </>
        )}
      </div>

      {canManage ? (
        <EventFormModal
          open={showEventForm}
          onClose={() => {
            setShowEventForm(false);
            setEditRehearsal(null);
          }}
          onSaved={async () => {
            setShowEventForm(false);
            setEditRehearsal(null);
            await queryClient.invalidateQueries({ queryKey: ['devamsizlik'] });
          }}
          rehearsal={editRehearsal}
          defaultDate={selectedDate ?? undefined}
        />
      ) : null}
    </main>
  );
}
