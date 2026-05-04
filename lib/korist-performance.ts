import type { Attendance, Assignment, AssignmentSubmission, ChoirMember, Rehearsal } from './supabase';
import { supabase } from './supabase';
import { getRoleDisplayLabel } from './role-labels';

export const PERFORMANCE_ROOT_QUERY_KEY = ['korist-performance'] as const;
export const VOICE_GROUP_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'] as const;

type RelatedNameRow = { name?: string | null };
type RelatedSongRow = { title?: string | null; composer?: string | null };

type ChoirMemberQueryRow = ChoirMember & {
  schools?: RelatedNameRow | RelatedNameRow[] | null;
  departments?: RelatedNameRow | RelatedNameRow[] | null;
  repertoire?: RelatedSongRow | RelatedSongRow[] | null;
};

type AssignmentQueryRow = Assignment & {
  choir_members?: { first_name?: string | null; last_name?: string | null } | Array<{ first_name?: string | null; last_name?: string | null }> | null;
};

type RehearsalInviteRow = {
  rehearsal_id: string;
  member_id: string;
};

type AssignmentTargetRow = {
  assignment_id: string;
  member_id: string;
};

type ChoirMemberRoleRow = {
  member_id: string;
  roles?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

const LEADERSHIP_ROLE_NAMES = new Set(['sef', 'partisyon sefi']);
const REHEARSAL_CONTINUITY_WEIGHT = 1;
const HOMEWORK_CONTINUITY_WEIGHT = 0.5;

interface PerformanceMember extends ChoirMember {
  school_name: string | null;
  department_name: string | null;
  favorite_song_title: string | null;
  favorite_song_composer: string | null;
  search_text: string;
}

export interface PerformanceMemberMetrics {
  show_homework_metrics: boolean;
  total_rehearsals: number;
  attended_rehearsals: number;
  pending_rehearsals: number;
  missed_rehearsals: number;
  attendance_percent: number;
  total_assignments: number | null;
  approved_assignments: number | null;
  submitted_assignments: number | null;
  pending_assignments: number | null;
  rejected_assignments: number | null;
  homework_percent: number | null;
  continuity_percent: number | null;
}

export interface PerformanceRosterMember extends PerformanceMember, PerformanceMemberMetrics {}

export interface PerformanceSummary extends PerformanceMemberMetrics {
  member_count: number;
}

export interface PerformanceRehearsalEntry {
  rehearsal: Rehearsal | null;
  attendance: Attendance | null;
  status: 'attended' | 'pending' | 'missed' | 'future' | 'no-rehearsal';
}

export interface PerformanceHomeworkEntry {
  assignment: Assignment;
  submission: AssignmentSubmission | null;
  status: 'approved' | 'pending' | 'rejected' | 'missing';
}

export interface PerformanceOverview {
  scope_label: string;
  show_homework_metrics: boolean;
  members: PerformanceRosterMember[];
  summary: PerformanceSummary;
  groupSummaries: Array<PerformanceSummary & { groupName: string }>;
}

export interface PerformanceMemberDetail {
  scope_label: string;
  show_homework_metrics: boolean;
  member: PerformanceRosterMember;
  rehearsals: PerformanceRehearsalEntry[];
  homework: PerformanceHomeworkEntry[];
}

function unwrapRelated<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getTodayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDateKey(dateStr: string) {
  return dateStr.slice(0, 10);
}

function isPastOrToday(dateKey: string, todayKey: string) {
  return dateKey <= todayKey;
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSearchDate(dateStr: string | null | undefined) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  return [
    dateStr.slice(0, 10),
    date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
    date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  ]
    .filter(Boolean)
    .join(' ');
}

function formatMetricPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function calculateContinuityPercent(attendedRehearsals: number, totalRehearsals: number, approvedAssignments: number, totalAssignments: number) {
  return formatMetricPercent(
    attendedRehearsals * REHEARSAL_CONTINUITY_WEIGHT + approvedAssignments * HOMEWORK_CONTINUITY_WEIGHT,
    totalRehearsals * REHEARSAL_CONTINUITY_WEIGHT + totalAssignments * HOMEWORK_CONTINUITY_WEIGHT,
  );
}

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

function collectRoleNames(value: ChoirMemberRoleRow['roles']) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((role) => role?.name)
      .filter((roleName): roleName is string => Boolean(roleName))
      .map((roleName) => normalizeRoleName(roleName));
  }
  return value.name ? [normalizeRoleName(value.name)] : [];
}

function getOrderedVoiceGroups(members: Array<Pick<PerformanceMember, 'voice_group'>>, includeAllCoreGroups: boolean) {
  const voiceGroups = [...new Set(members.map((member) => member.voice_group).filter((voiceGroup): voiceGroup is string => Boolean(voiceGroup)))];
  const orderedDetected = [
    ...VOICE_GROUP_ORDER.filter((voiceGroup) => voiceGroups.includes(voiceGroup)),
    ...voiceGroups.filter((voiceGroup) => !VOICE_GROUP_ORDER.includes(voiceGroup as (typeof VOICE_GROUP_ORDER)[number])),
  ];

  if (!includeAllCoreGroups) {
    return orderedDetected;
  }

  const extraGroups = orderedDetected.filter((voiceGroup) => !VOICE_GROUP_ORDER.includes(voiceGroup as (typeof VOICE_GROUP_ORDER)[number]));
  return [...VOICE_GROUP_ORDER, ...extraGroups];
}

function getScopeLabel(member: ChoirMember | null, isChef: boolean, isSectionLeader: boolean) {
  if (isChef) {
    return 'Tüm koristler';
  }
  if (isSectionLeader) {
    return getRoleDisplayLabel('Partisyon Şefi', member?.voice_group ?? null);
  }
  return 'Koristler';
}

function buildSearchText(member: PerformanceMember) {
  return normalizeSearchText(
    [
      member.first_name,
      member.last_name,
      member.voice_group ?? '',
      member.sub_voice_group ?? '',
      member.email ?? '',
      member.phone ?? '',
      formatSearchDate(member.birth_date),
      formatSearchDate(member.join_date),
      member.school_name ?? '',
      member.department_name ?? '',
      member.favorite_song_title ?? '',
      member.favorite_song_composer ?? '',
      member.linkedin_url ?? '',
      member.instagram_url ?? '',
      member.youtube_url ?? '',
      member.spotify_url ?? '',
      member.tiktok_url ?? '',
      member.x_url ?? '',
      member.is_active ? 'aktif' : 'pasif',
      member.id,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function createPerformanceMember(row: ChoirMemberQueryRow): PerformanceMember {
  const school = unwrapRelated(row.schools);
  const department = unwrapRelated(row.departments);
  const repertoire = unwrapRelated(row.repertoire);

  const member: PerformanceMember = {
    ...row,
    school_name: school?.name ?? row.school_name ?? null,
    department_name: department?.name ?? row.department_name ?? null,
    favorite_song_title: repertoire?.title ?? row.favorite_song_title ?? null,
    favorite_song_composer: repertoire?.composer ?? null,
    search_text: '',
  };

  member.search_text = buildSearchText(member);
  return member;
}

function getLatestSubmissionMap(rows: AssignmentSubmission[]) {
  const map = new Map<string, AssignmentSubmission>();

  for (const row of rows) {
    const key = `${row.assignment_id}:${row.member_id}`;
    const candidateTime = Date.parse(row.updated_at ?? row.submitted_at ?? '') || 0;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      continue;
    }

    const existingTime = Date.parse(existing.updated_at ?? existing.submitted_at ?? '') || 0;
    if (candidateTime >= existingTime) {
      map.set(key, row);
    }
  }

  return map;
}

function buildAssignmentMemberMap(
  assignments: AssignmentQueryRow[],
  scopeMembers: PerformanceMember[],
  targetRows: AssignmentTargetRow[],
  homeworkEligibleMemberIds: Set<string>,
) {
  const assignmentTargetMap = new Map<string, Set<string>>();

  for (const row of targetRows) {
    if (!homeworkEligibleMemberIds.has(row.member_id)) {
      continue;
    }

    const existing = assignmentTargetMap.get(row.assignment_id) ?? new Set<string>();
    existing.add(row.member_id);
    assignmentTargetMap.set(row.assignment_id, existing);
  }

  for (const assignment of assignments) {
    const explicitTargets = assignmentTargetMap.get(assignment.id) ?? new Set<string>();
    if (explicitTargets.size > 0) {
      assignmentTargetMap.set(assignment.id, explicitTargets);
      continue;
    }

    const fallbackMembers = assignment.target_voice_group?.trim()
      ? scopeMembers.filter((member) => member.voice_group === assignment.target_voice_group && homeworkEligibleMemberIds.has(member.id))
      : scopeMembers.filter((member) => homeworkEligibleMemberIds.has(member.id));

    assignmentTargetMap.set(assignment.id, new Set(fallbackMembers.map((member) => member.id)));
  }

  return assignmentTargetMap;
}

function buildMemberMetrics(
  member: PerformanceMember,
  rehearsalRows: Rehearsal[],
  inviteRows: RehearsalInviteRow[],
  attendanceRows: Attendance[],
  assignmentTargetMap: Map<string, Set<string>>,
  submissionRows: AssignmentSubmission[],
  todayKey: string,
  includeHomeworkMetrics: boolean,
  isLeadershipMember: boolean,
): PerformanceMemberMetrics {
  const memberInviteeIds = new Set(
    inviteRows.filter((row) => row.member_id === member.id).map((row) => row.rehearsal_id),
  );
  const relevantRehearsals = rehearsalRows.filter((rehearsal) => {
    const rehearsalDateKey = toDateKey(rehearsal.date);
    if (!isPastOrToday(rehearsalDateKey, todayKey)) {
      return false;
    }
    return memberInviteeIds.has(rehearsal.id);
  });

  const attendanceByRehearsal = new Map<string, Attendance>();
  for (const row of attendanceRows) {
    if (row.member_id === member.id) {
      attendanceByRehearsal.set(row.rehearsal_id, row);
    }
  }

  let attendedRehearsals = isLeadershipMember ? relevantRehearsals.length : 0;
  let pendingRehearsals = 0;
  let missedRehearsals = 0;

  if (!isLeadershipMember) {
    for (const rehearsal of relevantRehearsals) {
      const attendance = attendanceByRehearsal.get(rehearsal.id) ?? null;
      if (attendance?.status === 'approved') {
        attendedRehearsals += 1;
        continue;
      }
      if (attendance?.status === 'pending') {
        pendingRehearsals += 1;
        missedRehearsals += 1;
        continue;
      }
      missedRehearsals += 1;
    }
  }

  const attendancePercent = isLeadershipMember ? 100 : formatMetricPercent(attendedRehearsals, relevantRehearsals.length);

  if (!includeHomeworkMetrics) {
    return {
      show_homework_metrics: false,
      total_rehearsals: relevantRehearsals.length,
      attended_rehearsals: attendedRehearsals,
      pending_rehearsals: pendingRehearsals,
      missed_rehearsals: missedRehearsals,
      total_assignments: null,
      approved_assignments: null,
      submitted_assignments: null,
      pending_assignments: null,
      rejected_assignments: null,
      attendance_percent: attendancePercent,
      homework_percent: null,
      continuity_percent: null,
    };
  }

  const latestSubmissionMap = getLatestSubmissionMap(submissionRows);

  let totalAssignments = 0;
  let approvedAssignments = 0;
  let submittedAssignments = 0;
  let pendingAssignments = 0;
  let rejectedAssignments = 0;

  for (const [assignmentId, targetMemberIds] of assignmentTargetMap.entries()) {
    if (!targetMemberIds.has(member.id)) {
      continue;
    }

    const submission = latestSubmissionMap.get(`${assignmentId}:${member.id}`) ?? null;
    totalAssignments += 1;

    if (!submission) {
      continue;
    }

    submittedAssignments += 1;

    if (submission.status === 'approved') {
      approvedAssignments += 1;
      continue;
    }

    if (submission.status === 'pending' || !submission.status) {
      pendingAssignments += 1;
      continue;
    }

    if (submission.status === 'rejected') {
      rejectedAssignments += 1;
    }
  }

  const homeworkPercent = formatMetricPercent(approvedAssignments, totalAssignments);
  const continuityPercent = calculateContinuityPercent(
    attendedRehearsals,
    relevantRehearsals.length,
    approvedAssignments,
    totalAssignments,
  );

  return {
    show_homework_metrics: true,
    total_rehearsals: relevantRehearsals.length,
    attended_rehearsals: attendedRehearsals,
    pending_rehearsals: pendingRehearsals,
    missed_rehearsals: missedRehearsals,
    total_assignments: totalAssignments,
    approved_assignments: approvedAssignments,
    submitted_assignments: submittedAssignments,
    pending_assignments: pendingAssignments,
    rejected_assignments: rejectedAssignments,
    attendance_percent: attendancePercent,
    homework_percent: homeworkPercent,
    continuity_percent: continuityPercent,
  };
}

interface PerformanceDataset {
  show_homework_metrics: boolean;
  scopeMembers: PerformanceMember[];
  leadershipMemberIds: Set<string>;
  rehearsals: Rehearsal[];
  inviteRows: RehearsalInviteRow[];
  attendanceRows: Attendance[];
  assignments: AssignmentQueryRow[];
  targetRows: AssignmentTargetRow[];
  submissionRows: AssignmentSubmission[];
}

async function loadPerformanceDataset(member: ChoirMember | null, isChef: boolean, isSectionLeader: boolean) {
  if (!member?.id) {
    return null;
  }

  if (!isChef && !isSectionLeader) {
    return null;
  }

  if (!isChef && isSectionLeader && !member.voice_group) {
    return {
      show_homework_metrics: false,
      scopeMembers: [],
      leadershipMemberIds: new Set<string>(),
      rehearsals: [],
      inviteRows: [],
      attendanceRows: [],
      assignments: [],
      targetRows: [],
      submissionRows: [],
    };
  }

  const showHomeworkMetrics = isChef || isSectionLeader;

  let memberQuery = supabase
    .from('choir_members')
    .select(`
      id, first_name, last_name, voice_group, sub_voice_group, auth_user_id,
      email, phone, is_active, photo_url, birth_date, join_date,
      school_id, department_id, favorite_song_id,
      linkedin_url, instagram_url, youtube_url, spotify_url, tiktok_url, x_url,
      schools(name),
      departments(name),
      repertoire:favorite_song_id(title, composer)
    `)
    .eq('is_active', true);

  if (!isChef && isSectionLeader) {
    memberQuery = memberQuery.eq('voice_group', member.voice_group);
  }

  const { data: memberRows, error: memberError } = await memberQuery.order('voice_group').order('first_name').order('last_name');
  if (memberError) {
    throw memberError;
  }

  const scopeMembers = (memberRows ?? []).map((row) => createPerformanceMember(row as ChoirMemberQueryRow));

  const rehearsalQuery = supabase
    .from('rehearsals')
    .select('id, date, start_time, end_time, title, location, notes, collect_attendance, attendance_note, created_by')
    .eq('collect_attendance', true)
    .order('date', { ascending: true });

  const assignmentQuery = showHomeworkMetrics
    ? supabase
        .from('assignments')
        .select('id, title, description, deadline, target_voice_group, drive_folder_id, created_by, is_active, created_at, updated_at')
        .order('created_at', { ascending: true })
    : Promise.resolve({ data: [], error: null as null });

  const [{ data: rehearsalRows, error: rehearsalError }, { data: assignmentRows, error: assignmentError }] =
    await Promise.all([rehearsalQuery, assignmentQuery]);

  if (rehearsalError) {
    throw rehearsalError;
  }
  if (assignmentError) {
    throw assignmentError;
  }

  const rehearsals = (rehearsalRows ?? []) as Rehearsal[];
  const assignments = showHomeworkMetrics ? ((assignmentRows ?? []) as AssignmentQueryRow[]) : [];
  const rehearsalIds = rehearsals.map((row) => row.id);
  const scopeMemberIds = scopeMembers.map((row) => row.id);
  const assignmentIds = assignments.map((row) => row.id);

  const roleRowsPromise =
    scopeMemberIds.length > 0
      ? supabase
          .from('choir_member_roles')
          .select('member_id, roles(name)')
          .in('member_id', scopeMemberIds)
      : Promise.resolve({ data: [], error: null as null });

  const invitePromise =
    rehearsalIds.length > 0
      ? supabase.from('rehearsal_invitees').select('rehearsal_id, member_id').in('rehearsal_id', rehearsalIds)
      : Promise.resolve({ data: [], error: null as null });

  const attendancePromise =
    rehearsalIds.length > 0 && scopeMemberIds.length > 0
      ? supabase
          .from('attendance')
          .select('id, rehearsal_id, member_id, status, checked_in_at, approved_by, approved_at')
          .in('rehearsal_id', rehearsalIds)
          .in('member_id', scopeMemberIds)
      : Promise.resolve({ data: [], error: null as null });

  const targetPromise =
    showHomeworkMetrics && assignmentIds.length > 0
      ? supabase.from('assignment_targets').select('assignment_id, member_id').in('assignment_id', assignmentIds)
      : Promise.resolve({ data: [], error: null as null });

  const submissionPromise =
    showHomeworkMetrics && assignmentIds.length > 0 && scopeMemberIds.length > 0
      ? supabase
          .from('assignment_submissions')
          .select(
            'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, approved_at, approved_by',
          )
          .in('assignment_id', assignmentIds)
          .in('member_id', scopeMemberIds)
      : Promise.resolve({ data: [], error: null as null });

  const [
    { data: inviteRows, error: inviteError },
    { data: attendanceRows, error: attendanceError },
    { data: targetRows, error: targetError },
    { data: submissionRows, error: submissionError },
    { data: roleRows, error: roleRowsError },
  ] = await Promise.all([invitePromise, attendancePromise, targetPromise, submissionPromise, roleRowsPromise]);

  if (inviteError) {
    throw inviteError;
  }
  if (attendanceError) {
    throw attendanceError;
  }
  if (targetError) {
    throw targetError;
  }
  if (submissionError) {
    throw submissionError;
  }
  if (roleRowsError) {
    throw roleRowsError;
  }

  const leadershipMemberIds = new Set<string>();
  for (const row of (roleRows ?? []) as ChoirMemberRoleRow[]) {
    const roleNames = collectRoleNames(row.roles);
    if (roleNames.some((roleName) => LEADERSHIP_ROLE_NAMES.has(roleName))) {
      leadershipMemberIds.add(row.member_id);
    }
  }

  if (scopeMemberIds.includes(member.id) && (isChef || isSectionLeader)) {
    leadershipMemberIds.add(member.id);
  }

  return {
    show_homework_metrics: showHomeworkMetrics,
    scopeMembers,
    leadershipMemberIds,
    rehearsals,
    inviteRows: (inviteRows ?? []) as RehearsalInviteRow[],
    attendanceRows: (attendanceRows ?? []) as Attendance[],
    assignments,
    targetRows: (targetRows ?? []) as AssignmentTargetRow[],
    submissionRows: (submissionRows ?? []) as AssignmentSubmission[],
  };
}

function buildScopeSummary(dataset: PerformanceDataset): {
  members: PerformanceRosterMember[];
  summary: PerformanceSummary;
  groupSummaries: Array<PerformanceSummary & { groupName: string }>;
} {
  const { scopeMembers, leadershipMemberIds, rehearsals, inviteRows, attendanceRows, assignments, targetRows, submissionRows, show_homework_metrics } = dataset;
  const todayKey = getTodayKey();
  const homeworkEligibleMemberIds = new Set(
    scopeMembers.filter((member) => !leadershipMemberIds.has(member.id)).map((member) => member.id),
  );
  const assignmentTargetMap = show_homework_metrics
    ? buildAssignmentMemberMap(assignments, scopeMembers, targetRows, homeworkEligibleMemberIds)
    : new Map<string, Set<string>>();
  const memberMetrics = scopeMembers.map((member) =>
    buildMemberMetrics(
      member,
      rehearsals,
      inviteRows,
      attendanceRows,
      assignmentTargetMap,
      submissionRows,
      todayKey,
      show_homework_metrics && homeworkEligibleMemberIds.has(member.id),
      leadershipMemberIds.has(member.id),
    ),
  );

  const members = scopeMembers.map((member, index) => ({
    ...member,
    ...memberMetrics[index],
  }));

  const summary: PerformanceSummary = members.reduce<PerformanceSummary>(
    (acc, member) => {
      acc.member_count += 1;
      acc.total_rehearsals += member.total_rehearsals;
      acc.attended_rehearsals += member.attended_rehearsals;
      acc.pending_rehearsals += member.pending_rehearsals;
      acc.missed_rehearsals += member.missed_rehearsals;
      if (show_homework_metrics) {
        acc.total_assignments = (acc.total_assignments ?? 0) + (member.total_assignments ?? 0);
        acc.approved_assignments = (acc.approved_assignments ?? 0) + (member.approved_assignments ?? 0);
        acc.submitted_assignments = (acc.submitted_assignments ?? 0) + (member.submitted_assignments ?? 0);
        acc.pending_assignments = (acc.pending_assignments ?? 0) + (member.pending_assignments ?? 0);
        acc.rejected_assignments = (acc.rejected_assignments ?? 0) + (member.rejected_assignments ?? 0);
      }
      return acc;
    },
    {
      show_homework_metrics: show_homework_metrics,
      member_count: 0,
      total_rehearsals: 0,
      attended_rehearsals: 0,
      pending_rehearsals: 0,
      missed_rehearsals: 0,
      total_assignments: show_homework_metrics ? 0 : null,
      approved_assignments: show_homework_metrics ? 0 : null,
      submitted_assignments: show_homework_metrics ? 0 : null,
      pending_assignments: show_homework_metrics ? 0 : null,
      rejected_assignments: show_homework_metrics ? 0 : null,
      attendance_percent: 0,
      homework_percent: show_homework_metrics ? 0 : null,
      continuity_percent: show_homework_metrics ? 0 : null,
    },
  );

  summary.attendance_percent = formatMetricPercent(summary.attended_rehearsals, summary.total_rehearsals);
  if (show_homework_metrics) {
    summary.homework_percent = formatMetricPercent(summary.approved_assignments ?? 0, summary.total_assignments ?? 0);
    summary.continuity_percent = calculateContinuityPercent(
      summary.attended_rehearsals,
      summary.total_rehearsals,
      summary.approved_assignments ?? 0,
      summary.total_assignments ?? 0,
    );
  }

  const groupNames = getOrderedVoiceGroups(members, show_homework_metrics);
  const groupSummaries = groupNames.map((groupName) => {
    const groupMembers = members.filter((m) => m.voice_group === groupName);
    const groupSummary: PerformanceSummary & { groupName: string } = groupMembers.reduce(
      (acc, m) => {
        acc.member_count += 1;
        acc.total_rehearsals += m.total_rehearsals;
        acc.attended_rehearsals += m.attended_rehearsals;
        acc.pending_rehearsals += m.pending_rehearsals;
        acc.missed_rehearsals += m.missed_rehearsals;
        if (show_homework_metrics) {
          acc.total_assignments = (acc.total_assignments ?? 0) + (m.total_assignments ?? 0);
          acc.approved_assignments = (acc.approved_assignments ?? 0) + (m.approved_assignments ?? 0);
          acc.submitted_assignments = (acc.submitted_assignments ?? 0) + (m.submitted_assignments ?? 0);
          acc.pending_assignments = (acc.pending_assignments ?? 0) + (m.pending_assignments ?? 0);
          acc.rejected_assignments = (acc.rejected_assignments ?? 0) + (m.rejected_assignments ?? 0);
        }
        return acc;
      },
      {
        groupName,
        show_homework_metrics,
        member_count: 0,
        total_rehearsals: 0,
        attended_rehearsals: 0,
        pending_rehearsals: 0,
        missed_rehearsals: 0,
        total_assignments: show_homework_metrics ? 0 : null,
        approved_assignments: show_homework_metrics ? 0 : null,
        submitted_assignments: show_homework_metrics ? 0 : null,
        pending_assignments: show_homework_metrics ? 0 : null,
        rejected_assignments: show_homework_metrics ? 0 : null,
        attendance_percent: 0,
        homework_percent: show_homework_metrics ? 0 : null,
        continuity_percent: show_homework_metrics ? 0 : null,
      },
    );

    groupSummary.attendance_percent = formatMetricPercent(groupSummary.attended_rehearsals, groupSummary.total_rehearsals);
    if (show_homework_metrics) {
      groupSummary.homework_percent = formatMetricPercent(groupSummary.approved_assignments ?? 0, groupSummary.total_assignments ?? 0);
      groupSummary.continuity_percent = calculateContinuityPercent(
        groupSummary.attended_rehearsals,
        groupSummary.total_rehearsals,
        groupSummary.approved_assignments ?? 0,
        groupSummary.total_assignments ?? 0,
      );
    }

    return groupSummary;
  });

  return {
    members,
    summary,
    groupSummaries,
  };
}

export async function loadPerformanceOverview(member: ChoirMember | null, isChef: boolean, isSectionLeader: boolean): Promise<PerformanceOverview | null> {
  const dataset = await loadPerformanceDataset(member, isChef, isSectionLeader);
  if (!dataset) {
    return null;
  }

  const { members, summary, groupSummaries } = buildScopeSummary(dataset);

  return {
    scope_label: getScopeLabel(member, isChef, isSectionLeader),
    show_homework_metrics: dataset.show_homework_metrics,
    members,
    summary,
    groupSummaries,
  };
}

export async function loadPerformanceMemberDetail(
  member: ChoirMember | null,
  targetMemberId: string,
  isChef: boolean,
  isSectionLeader: boolean,
): Promise<PerformanceMemberDetail | null> {
  const dataset = await loadPerformanceDataset(member, isChef, isSectionLeader);
  if (!dataset) {
    return null;
  }

  const scopeResult = buildScopeSummary(dataset);

  const selectedMember = scopeResult.members.find((row) => row.id === targetMemberId) ?? null;
  if (!selectedMember) {
    return null;
  }

  const todayKey = getTodayKey();
  const isSelectedMemberLeadership = dataset.leadershipMemberIds.has(targetMemberId);
  const inviteRows = dataset.inviteRows.filter((row) => row.member_id === targetMemberId);
  const memberInviteeIds = new Set(inviteRows.map((row) => row.rehearsal_id));
  const attendanceByRehearsal = new Map<string, Attendance>();
  for (const row of dataset.attendanceRows) {
    if (row.member_id === targetMemberId) {
      attendanceByRehearsal.set(row.rehearsal_id, row);
    }
  }

  const rehearsals = dataset.rehearsals.map((rehearsal) => {
    const rehearsalDateKey = toDateKey(rehearsal.date);
    const attendance = attendanceByRehearsal.get(rehearsal.id) ?? null;
    const isRelevant = memberInviteeIds.has(rehearsal.id);
    const isFuture = !isPastOrToday(rehearsalDateKey, todayKey);

    let status: PerformanceRehearsalEntry['status'] = 'no-rehearsal';
    if (rehearsal.collect_attendance && isRelevant) {
      if (isFuture) {
        status = 'future';
      } else if (isSelectedMemberLeadership) {
        status = 'attended';
      } else if (attendance?.status === 'approved') {
        status = 'attended';
      } else if (attendance?.status === 'pending') {
        status = 'pending';
      } else {
        status = 'missed';
      }
    }

    return {
      rehearsal,
      attendance,
      status,
    };
  });

  const showHomeworkForSelectedMember = dataset.show_homework_metrics && selectedMember.show_homework_metrics;

  const homework = showHomeworkForSelectedMember
    ? (() => {
        const homeworkEligibleMemberIds = new Set(
          dataset.scopeMembers.filter((scopeMember) => !dataset.leadershipMemberIds.has(scopeMember.id)).map((scopeMember) => scopeMember.id),
        );
        const assignmentTargetMap = buildAssignmentMemberMap(dataset.assignments, dataset.scopeMembers, dataset.targetRows, homeworkEligibleMemberIds);
        const latestSubmissionMap = getLatestSubmissionMap(dataset.submissionRows);
        return dataset.assignments
          .filter((assignment) => (assignmentTargetMap.get(assignment.id) ?? new Set<string>()).has(targetMemberId))
          .map((assignment) => {
            const submission = latestSubmissionMap.get(`${assignment.id}:${targetMemberId}`) ?? null;
            let status: PerformanceHomeworkEntry['status'] = 'missing';
            if (submission?.status === 'approved') {
              status = 'approved';
            } else if (submission?.status === 'pending' || !submission?.status) {
              status = submission ? 'pending' : 'missing';
            } else if (submission?.status === 'rejected') {
              status = 'rejected';
            }

            return {
              assignment,
              submission,
              status,
            };
          })
          .sort((a, b) => {
            const aDeadline = a.assignment.deadline ? new Date(a.assignment.deadline).getTime() : Number.POSITIVE_INFINITY;
            const bDeadline = b.assignment.deadline ? new Date(b.assignment.deadline).getTime() : Number.POSITIVE_INFINITY;
            if (aDeadline !== bDeadline) {
              return aDeadline - bDeadline;
            }
            return new Date(b.assignment.created_at).getTime() - new Date(a.assignment.created_at).getTime();
          });
      })()
    : [];

  return {
    scope_label: getScopeLabel(member, isChef, isSectionLeader),
    show_homework_metrics: showHomeworkForSelectedMember,
    member: selectedMember,
    rehearsals,
    homework,
  };
}

export function getPerformanceScopeLabel(member: ChoirMember | null, isChef: boolean, isSectionLeader: boolean) {
  return getScopeLabel(member, isChef, isSectionLeader);
}

export function normalizePerformanceSearchQuery(query: string) {
  return normalizeSearchText(query);
}
