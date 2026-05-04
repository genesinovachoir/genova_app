'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Megaphone,
  Music4,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';

import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';

type NotificationKind =
  | 'announcement'
  | 'assignment'
  | 'assignment_submission'
  | 'rehearsal'
  | 'repertoire_assignment'
  | 'assignment_reviewed'
  | 'profile_change_reviewed';

interface MainNotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  href: string;
  createdAt: string;
  status?: 'approved' | 'rejected';
}

interface AssignmentRow {
  id: string;
  title: string;
  created_at: string;
  deadline: string | null;
}

interface RehearsalRow {
  id: string;
  title: string;
  date: string;
  start_time: string;
  location: string;
  created_at: string;
}

interface RepertoireSongRow {
  id: string;
  title: string;
}

interface ProfileChangeRequestRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  created_at: string;
  reject_reason: string | null;
}

interface AssignmentSubmissionNotificationRow {
  id: string;
  assignment_id: string;
  member_id: string;
  submitted_at: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
}

interface ChoirMemberNameRow {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

const MAX_ITEMS = 18;
const STORAGE_KEY_PREFIX = 'main_notifications_last_seen_at:';
const EMPTY_NOTIFICATIONS: MainNotificationItem[] = [];

function getNotificationsQueryKey(memberId: string | null | undefined, scopeKey: string) {
  return ['main', 'notifications', memberId ?? 'guest', scopeKey] as const;
}

function toDateSafe(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toUnreadComparableTimestamp(value: string) {
  const parsed = toDateSafe(value)?.getTime();
  if (!parsed) {
    return 0;
  }
  return parsed;
}

function formatRelativeTime(value: string) {
  const then = toDateSafe(value);
  if (!then) {
    return 'az önce';
  }

  const nowMs = Date.now();
  const diffMs = nowMs - then.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) {
    return 'az önce';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} dk önce`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour} sa önce`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) {
    return `${diffDay} gün önce`;
  }

  return then.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
  });
}

function formatDateLabel(value: string | null) {
  const date = toDateSafe(value);
  if (!date) {
    return null;
  }

  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
  });
}

async function fetchSubmissionNotifications(params: {
  canReviewSubmissions: boolean;
  isChef: boolean;
  reviewerVoiceGroup: string | null;
}) {
  const { canReviewSubmissions, isChef, reviewerVoiceGroup } = params;
  if (!canReviewSubmissions) {
    return [];
  }

  let submissionsQuery = supabase
    .from('assignment_submissions')
    .select('id, assignment_id, member_id, submitted_at, status')
    .order('submitted_at', { ascending: false })
    .limit(12);

  if (!isChef) {
    if (!reviewerVoiceGroup) {
      submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      const { data: groupMembers, error: groupMembersError } = await supabase
        .from('choir_members')
        .select('id')
        .eq('voice_group', reviewerVoiceGroup)
        .eq('is_active', true);
      if (groupMembersError) {
        throw groupMembersError;
      }

      const groupMemberIds = (groupMembers ?? []).map((member) => member.id);
      if (groupMemberIds.length === 0) {
        submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      } else {
        submissionsQuery = submissionsQuery.in('member_id', groupMemberIds);
      }
    }
  }

  const { data, error } = await submissionsQuery;
  if (error) {
    throw error;
  }
  return (data ?? []) as AssignmentSubmissionNotificationRow[];
}

async function fetchMainNotifications(params: {
  memberId: string;
  includeProfileChangeReviews: boolean;
  canReviewSubmissions: boolean;
  isChef: boolean;
  reviewerVoiceGroup: string | null;
}) {
  const { memberId, includeProfileChangeReviews, canReviewSubmissions, isChef, reviewerVoiceGroup } = params;
  const [
    announcementsResult,
    assignmentTargetsResult,
    rehearsalInviteesResult,
    songAssignmentsResult,
    submissionReviewsResult,
    profileRequestsResult,
    submissionNotifications,
  ] = await Promise.all([
    supabase
      .from('announcements')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('assignment_targets')
      .select('assignment_id')
      .eq('member_id', memberId)
      .limit(16),
    supabase
      .from('rehearsal_invitees')
      .select('rehearsal_id')
      .eq('member_id', memberId)
      .limit(16),
    supabase
      .from('song_assignments')
      .select('song_id, part_name, assigned_at')
      .eq('member_id', memberId)
      .order('assigned_at', { ascending: false })
      .limit(10),
    supabase
      .from('assignment_submissions')
      .select('id, assignment_id, status, approved_at')
      .eq('member_id', memberId)
      .in('status', ['approved', 'rejected'])
      .order('approved_at', { ascending: false })
      .limit(10),
    includeProfileChangeReviews
      ? supabase
          .from('profile_change_requests')
          .select('id, status, reviewed_at, created_at, reject_reason')
          .eq('member_id', memberId)
          .in('status', ['approved', 'rejected'])
          .order('reviewed_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
    fetchSubmissionNotifications({ canReviewSubmissions, isChef, reviewerVoiceGroup }),
  ]);

  if (announcementsResult.error) {
    throw announcementsResult.error;
  }
  if (assignmentTargetsResult.error) {
    throw assignmentTargetsResult.error;
  }
  if (rehearsalInviteesResult.error) {
    throw rehearsalInviteesResult.error;
  }
  if (songAssignmentsResult.error) {
    throw songAssignmentsResult.error;
  }
  if (submissionReviewsResult.error) {
    throw submissionReviewsResult.error;
  }
  if (profileRequestsResult.error) {
    throw profileRequestsResult.error;
  }

  const assignmentIds = Array.from(
    new Set([
      ...((assignmentTargetsResult.data ?? []).map((row) => row.assignment_id).filter(Boolean) as string[]),
      ...((submissionReviewsResult.data ?? []).map((row) => row.assignment_id).filter(Boolean) as string[]),
      ...submissionNotifications.map((row) => row.assignment_id).filter(Boolean),
    ]),
  );

  const rehearsalIds = Array.from(
    new Set(((rehearsalInviteesResult.data ?? []).map((row) => row.rehearsal_id).filter(Boolean) as string[])),
  );

  const repertoireSongIds = Array.from(
    new Set(((songAssignmentsResult.data ?? []).map((row) => row.song_id).filter(Boolean) as string[])),
  );

  const submissionMemberIds = Array.from(
    new Set(submissionNotifications.map((row) => row.member_id).filter(Boolean)),
  );

  const [assignmentsResult, rehearsalsResult, repertoireSongsResult, submissionMembersResult] = await Promise.all([
    assignmentIds.length > 0
      ? supabase
          .from('assignments')
          .select('id, title, created_at, deadline')
          .in('id', assignmentIds)
      : Promise.resolve({ data: [], error: null }),
    rehearsalIds.length > 0
      ? supabase
          .from('rehearsals')
          .select('id, title, date, start_time, location, created_at')
          .in('id', rehearsalIds)
      : Promise.resolve({ data: [], error: null }),
    repertoireSongIds.length > 0
      ? supabase
          .from('repertoire')
          .select('id, title')
          .in('id', repertoireSongIds)
      : Promise.resolve({ data: [], error: null }),
    submissionMemberIds.length > 0
      ? supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group')
          .in('id', submissionMemberIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (assignmentsResult.error) {
    throw assignmentsResult.error;
  }
  if (rehearsalsResult.error) {
    throw rehearsalsResult.error;
  }
  if (repertoireSongsResult.error) {
    throw repertoireSongsResult.error;
  }
  if (submissionMembersResult.error) {
    throw submissionMembersResult.error;
  }

  const assignmentMap = new Map(
    ((assignmentsResult.data ?? []) as AssignmentRow[]).map((assignment) => [assignment.id, assignment]),
  );
  const rehearsalMap = new Map(
    ((rehearsalsResult.data ?? []) as RehearsalRow[]).map((rehearsal) => [rehearsal.id, rehearsal]),
  );
  const repertoireMap = new Map(
    ((repertoireSongsResult.data ?? []) as RepertoireSongRow[]).map((song) => [song.id, song]),
  );
  const submissionMemberMap = new Map(
    ((submissionMembersResult.data ?? []) as ChoirMemberNameRow[]).map((member) => [member.id, member]),
  );

  const items: MainNotificationItem[] = [];

  for (const row of announcementsResult.data ?? []) {
    items.push({
      id: `announcement:${row.id}`,
      kind: 'announcement',
      title: 'Yeni duyuru',
      description: row.title ?? 'Duyuru güncellendi.',
      href: `/announcements/${row.id}`,
      createdAt: row.created_at,
    });
  }

  for (const row of assignmentTargetsResult.data ?? []) {
    const assignment = assignmentMap.get(row.assignment_id);
    if (!assignment) {
      continue;
    }
    const deadlineLabel = formatDateLabel(assignment.deadline);
    items.push({
      id: `assignment:${assignment.id}`,
      kind: 'assignment',
      title: 'Yeni ödev atandı',
      description: deadlineLabel
        ? `${assignment.title} · Son teslim ${deadlineLabel}`
        : assignment.title,
      href: `/odevler/${assignment.id}?aid=${assignment.id}`,
      createdAt: assignment.created_at,
    });
  }

  for (const row of rehearsalInviteesResult.data ?? []) {
    const rehearsal = rehearsalMap.get(row.rehearsal_id);
    if (!rehearsal) {
      continue;
    }
    items.push({
      id: `rehearsal:${rehearsal.id}`,
      kind: 'rehearsal',
      title: 'Prova daveti',
      description: `${rehearsal.title} · ${rehearsal.location}`,
      href: `/devamsizlik?date=${encodeURIComponent(rehearsal.date)}`,
      createdAt: rehearsal.created_at,
    });
  }

  for (const row of songAssignmentsResult.data ?? []) {
    const song = repertoireMap.get(row.song_id);
    if (!song) {
      continue;
    }
    const partLabel = row.part_name?.trim();
    const createdAt = row.assigned_at ?? new Date().toISOString();
    items.push({
      id: `repertoire:${row.song_id}:${partLabel ?? 'all'}`,
      kind: 'repertoire_assignment',
      title: 'Yeni repertuvar ataması',
      description: partLabel ? `${song.title} · ${partLabel}` : song.title,
      href: `/repertuvar/${row.song_id}`,
      createdAt,
    });
  }

  for (const row of submissionNotifications) {
    const assignment = assignmentMap.get(row.assignment_id);
    if (!assignment) {
      continue;
    }
    const submitter = submissionMemberMap.get(row.member_id);
    const submitterName = submitter
      ? `${submitter.first_name} ${submitter.last_name}`.trim()
      : 'Bir korist';
    const createdAt = row.submitted_at ?? assignment.created_at;
    items.push({
      id: `assignment_submission:${row.id}:${createdAt}`,
      kind: 'assignment_submission',
      title: row.status === 'pending' ? 'Yeni ödev teslimi' : 'Ödev teslimi',
      description: `${submitterName} · ${assignment.title}`,
      href: `/odevler/${assignment.id}?aid=${assignment.id}&mid=${row.member_id}`,
      createdAt,
    });
  }

  for (const row of submissionReviewsResult.data ?? []) {
    const reviewStatus = row.status === 'approved' || row.status === 'rejected' ? row.status : null;
    if (!reviewStatus) {
      continue;
    }
    const assignment = assignmentMap.get(row.assignment_id);
    if (!assignment) {
      continue;
    }
    const reviewedAt = row.approved_at ?? assignment.created_at;
    items.push({
      id: `assignment_review:${row.id}`,
      kind: 'assignment_reviewed',
      title: reviewStatus === 'approved' ? 'Ödevin onaylandı' : 'Ödevin reddedildi',
      description: assignment.title,
      href: `/odevler/${assignment.id}?aid=${assignment.id}`,
      createdAt: reviewedAt,
      status: reviewStatus,
    });
  }

  for (const row of (profileRequestsResult.data ?? []) as ProfileChangeRequestRow[]) {
    const decisionStatus = row.status === 'approved' ? 'approved' : 'rejected';
    const reviewedAt = row.reviewed_at ?? row.created_at;
    items.push({
      id: `profile_change:${row.id}:${row.status}`,
      kind: 'profile_change_reviewed',
      title: decisionStatus === 'approved' ? 'Profil talebin onaylandı' : 'Profil talebin reddedildi',
      description:
        decisionStatus === 'rejected' && row.reject_reason
          ? `Sebep: ${row.reject_reason}`
          : 'Profil değişikliği sonucu yayınlandı.',
      href: '/profil/degisiklikler',
      createdAt: reviewedAt,
      status: decisionStatus,
    });
  }

  items.sort((first, second) => {
    const firstTime = toDateSafe(first.createdAt)?.getTime() ?? 0;
    const secondTime = toDateSafe(second.createdAt)?.getTime() ?? 0;
    return secondTime - firstTime;
  });

  return items.slice(0, MAX_ITEMS);
}

function getItemIcon(kind: NotificationKind) {
  if (kind === 'announcement') return Megaphone;
  if (kind === 'assignment') return ClipboardList;
  if (kind === 'assignment_submission') return ClipboardList;
  if (kind === 'rehearsal') return CalendarDays;
  if (kind === 'repertoire_assignment') return Music4;
  if (kind === 'assignment_reviewed') return CheckCircle2;
  return UserRoundCheck;
}

function getIconClassName(item: MainNotificationItem) {
  if (item.kind === 'announcement') {
    return 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]';
  }
  if (item.kind === 'assignment_reviewed' || item.kind === 'profile_change_reviewed') {
    if (item.status === 'rejected') {
      return 'border-[var(--status-rejected-border)] bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)]';
    }
    return 'border-[var(--status-approved-border)] bg-[var(--status-approved-bg)] text-[var(--status-approved-text)]';
  }
  return 'border-[var(--color-border)] bg-white/5 text-[var(--color-text-high)]';
}

export function MainNotificationsBell() {
  const { member, isAdmin, isSectionLeader, isChorist } = useAuth();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [seenAtByMember, setSeenAtByMember] = useState<Record<string, number>>({});

  const memberId = member?.id ?? null;
  const isChef = isAdmin();
  const canReviewSubmissions = isChef || isSectionLeader();
  const reviewerVoiceGroup = isChef ? null : member?.voice_group ?? null;
  const notificationScopeKey = isChef
    ? 'chef'
    : canReviewSubmissions
      ? `leader:${reviewerVoiceGroup ?? 'none'}`
      : 'member';
  const storageKey = memberId ? `${STORAGE_KEY_PREFIX}${memberId}` : null;

  const persistedLastSeenAt = useMemo(() => {
    if (!storageKey || typeof window === 'undefined') {
      return 0;
    }
    const stored = window.localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }, [storageKey]);

  const lastSeenAt = memberId ? (seenAtByMember[memberId] ?? persistedLastSeenAt) : 0;

  const notificationsQuery = useQuery({
    queryKey: getNotificationsQueryKey(memberId, notificationScopeKey),
    queryFn: () =>
      fetchMainNotifications({
        memberId: memberId!,
        includeProfileChangeReviews: isChorist(),
        canReviewSubmissions,
        isChef,
        reviewerVoiceGroup,
      }),
    enabled: Boolean(memberId),
    staleTime: 45_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!memberId) {
      return;
    }

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: getNotificationsQueryKey(memberId, notificationScopeKey) });
    };

    const channel = supabase
      .channel(`main-notifications:${memberId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, invalidate)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignment_targets', filter: `member_id=eq.${memberId}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rehearsal_invitees', filter: `member_id=eq.${memberId}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'song_assignments', filter: `member_id=eq.${memberId}` },
        invalidate,
      );

    if (canReviewSubmissions) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions' }, invalidate);
    } else {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignment_submissions', filter: `member_id=eq.${memberId}` },
        invalidate,
      );
    }

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profile_change_requests', filter: `member_id=eq.${memberId}` },
        invalidate,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canReviewSubmissions, memberId, notificationScopeKey, queryClient]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const items = notificationsQuery.data ?? EMPTY_NOTIFICATIONS;
  const unreadCount = useMemo(() => {
    if (!lastSeenAt) {
      return items.length;
    }
    return items.filter((item) => {
      const time = toUnreadComparableTimestamp(item.createdAt);
      return time > lastSeenAt;
    }).length;
  }, [items, lastSeenAt]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Bildirimler"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((current) => {
            const next = !current;
            if (
              next &&
              memberId &&
              storageKey &&
              typeof window !== 'undefined'
            ) {
              const now = Date.now();
              window.localStorage.setItem(storageKey, String(now));
              setSeenAtByMember((previous) => ({ ...previous, [memberId]: now }));
            }
            return next;
          });
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-all hover:scale-[1.03] hover:bg-[var(--color-accent)] hover:text-[var(--color-background)] active:scale-95"
      >
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full border border-[var(--color-background)] bg-[var(--color-accent)] px-1 text-[0.55rem] font-bold leading-none text-[var(--color-background)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+4.75rem)] z-[90] w-auto sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.65rem)] sm:w-[23rem] sm:max-w-[calc(100vw-1rem)]"
          >
            <div className="glass-panel border-[var(--color-border-strong)] bg-[color-mix(in_srgb,var(--color-panel-bg)_96%,black_8%)] backdrop-blur-2xl supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--color-panel-bg)_94%,black_10%)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <p className="font-serif text-[0.98rem] tracking-[-0.02em] text-[var(--color-text-high)]">Bildirimler</p>
                {unreadCount > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">
                    {unreadCount} yeni
                  </span>
                ) : null}
              </div>

              {notificationsQuery.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
                </div>
              ) : notificationsQuery.isError ? (
                <div className="px-4 py-5 text-xs text-rose-300">Bildirimler yüklenemedi.</div>
              ) : items.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--color-text-medium)]">
                  Şu an için yeni bildirim yok.
                </div>
              ) : (
                <div className="no-scrollbar max-h-[24rem] overflow-y-auto px-2 py-2">
                  {items.map((item) => {
                    const Icon = getItemIcon(item.kind);
                    const isUnread = toUnreadComparableTimestamp(item.createdAt) > lastSeenAt;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className="group block rounded-[10px] border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-border)] hover:bg-white/5"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border ${getIconClassName(item)}`}>
                            {item.kind === 'assignment_reviewed' && item.status === 'rejected' ? (
                              <XCircle size={14} />
                            ) : (
                              <Icon size={15} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="line-clamp-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-high)]">
                                {item.title}
                              </p>
                              <span className="shrink-0 text-[0.62rem] text-[var(--color-text-medium)]">
                                {formatRelativeTime(item.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[0.74rem] leading-relaxed text-[var(--color-text-medium)]">
                              {item.description}
                            </p>
                          </div>
                          {isUnread ? (
                            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                          ) : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
