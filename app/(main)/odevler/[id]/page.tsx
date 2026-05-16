'use client';

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Upload,
  Calendar,
  Users,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
  Send,
  Pencil,
  Check,
  X,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
} from 'lucide-react';

function getInitials(firstName?: string | null, lastName?: string | null) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, type Assignment, type AssignmentSubmission } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { FileUploadModal } from '@/components/FileUploadModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ReviewNoteDialog } from '@/components/ReviewNoteDialog';
import { SwipeBack } from '@/components/SwipeBack';
import { useToast } from '@/components/ToastProvider';
import { useBackOrHome } from '@/hooks/useBackOrHome';
import { getAssignmentCacheKey, readAssignmentCache, writeAssignmentCache } from '@/lib/assignment-cache';
import { formatAssignmentScopeLabel } from '@/lib/assignment-scope';
import { uploadSubmission } from '@/lib/drive';
import { sanitizeRichText } from '@/lib/richText';
import { createSlugLookup, isUuidLike } from '@/lib/internalPageLinks';
import { useProtectedDriveFileUrl } from '@/hooks/useProtectedDriveFileUrl';
import { createRealtimeTopic } from '@/lib/realtime';

type ExtendedChoirMember = { first_name: string; last_name: string; photo_url?: string | null };

export interface ExtendedAssignment extends Omit<Assignment, 'choir_members'> {
  choir_members?: ExtendedChoirMember;
}

export interface ExtendedAssignmentSubmission extends Omit<AssignmentSubmission, 'choir_members'> {
  choir_members?: {
    first_name: string;
    last_name: string;
    voice_group: string | null;
    photo_url?: string | null;
  };
  reviewer?: {
    first_name: string;
    last_name?: string;
    photo_url: string | null;
  };
  isArchived?: boolean;
  archived_at?: string | null;
  source_submission_id?: string | null;
}

interface AssignmentDetailData {
  assignmentId: string;
  assignment: ExtendedAssignment;
  submissions: ExtendedAssignmentSubmission[];
  mySubmission: ExtendedAssignmentSubmission | null;
  submissionHistory: ExtendedAssignmentSubmission[];
  revisedMemberIds: string[];
  targetMembers: AssignmentTargetMember[];
  designatedMember?: {
    first_name: string;
    last_name: string;
    photo_url: string | null;
  } | null;
  auditLogs: AssignmentAuditLogItem[];
}

type AssignmentChoirMember =
  | ExtendedChoirMember
  | ExtendedChoirMember[]
  | null
  | undefined;

interface AssignmentRow extends Omit<Assignment, 'choir_members' | 'submission' | 'submission_count'> {
  choir_members?: AssignmentChoirMember;
}

type SubmissionChoirMember =
  | { first_name: string; last_name: string; voice_group: string | null; photo_url?: string | null }
  | Array<{ first_name: string; last_name: string; voice_group: string | null; photo_url?: string | null }>
  | null
  | undefined;

interface AssignmentSubmissionRow extends Omit<AssignmentSubmission, 'choir_members'> {
  choir_members?: SubmissionChoirMember;
}

interface AssignmentSubmissionHistoryRow {
  id: string;
  assignment_id: string;
  member_id: string;
  source_submission_id: string | null;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  drive_download_link: string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  drive_member_folder_id: string | null;
  submitted_at: string;
  updated_at: string | null;
  status: AssignmentSubmission['status'] | null;
  submission_note: string | null;
  reviewer_note: string | null;
  reviewer_audio_drive_file_id: string | null;
  reviewer_audio_file_name: string | null;
  reviewer_audio_mime_type: string | null;
  reviewer_audio_file_size_bytes: number | null;
  approved_at: string | null;
  approved_by: string | null;
  archived_at: string;
  archive_reason: string;
}

interface SubmissionMemberRow {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
  photo_url: string | null;
}

type AssignmentTargetChoirMember =
  | { first_name: string; last_name: string; voice_group: string | null }
  | Array<{ first_name: string; last_name: string; voice_group: string | null }>
  | null
  | undefined;

interface AssignmentTargetRow {
  member_id: string;
  choir_members?: AssignmentTargetChoirMember;
}

interface AssignmentTargetFallbackRow {
  id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface AssignmentTargetMember {
  member_id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface ReviewerMemberStatus {
  member_id: string;
  first_name: string;
  last_name: string;
  voice_group: string | null;
  submission: AssignmentSubmission | null;
}

interface AssignmentAuditLogRow {
  id: string;
  event_type: string;
  created_at: string;
  assignment_id: string;
  submission_id: string | null;
  member_id: string | null;
  actor_member_id: string | null;
  event_payload: Record<string, unknown> | null;
}

interface AssignmentAuditLogItem {
  id: string;
  eventType: string;
  createdAt: string;
  actorName: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
}

type ReviewerSubmissionState = 'missing' | 'pending' | 'approved' | 'rejected';

interface ChoirMemberRoleRow {
  member_id: string;
  roles?: { name?: string } | Array<{ name?: string }> | null;
}

const BLOCKED_ASSIGNMENT_ROLES = new Set(['Şef', 'Partisyon Şefi']);

function hasBlockedAssignmentRole(row: ChoirMemberRoleRow): boolean {
  if (!row.roles) {
    return false;
  }
  const roleEntries = Array.isArray(row.roles) ? row.roles : [row.roles];
  return roleEntries.some((entry) => Boolean(entry?.name && BLOCKED_ASSIGNMENT_ROLES.has(entry.name)));
}

function normalizeAssignment(row: AssignmentRow): ExtendedAssignment {
  return {
    ...row,
    choir_members: Array.isArray(row.choir_members) ? row.choir_members[0] ?? undefined : row.choir_members ?? undefined,
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) {
    return '—';
  }

  return new Date(dateStr).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getReviewerSubmissionState(submission: AssignmentSubmission | null): ReviewerSubmissionState {
  if (!submission) {
    return 'missing';
  }
  if (!submission.status || submission.status === 'pending') {
    return 'pending';
  }
  if (submission.status === 'approved') {
    return 'approved';
  }
  return 'rejected';
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return 'Veri yüklenemedi';
}

function getAuditEventLabel(eventType: string) {
  switch (eventType) {
    case 'submission_submitted':
      return 'Teslim yapıldı';
    case 'submission_resubmitted':
      return 'Teslim yenilendi';
    case 'submission_note_updated':
      return 'Teslim notu düzenlendi';
    case 'submission_reviewed':
      return 'Değerlendirildi';
    case 'submission_review_withdrawn':
      return 'Değerlendirme beklemeye alındı';
    case 'reviewer_note_updated':
      return 'Değerlendirme notu düzenlendi';
    case 'reviewer_note_hidden':
      return 'Not koristten gizlendi';
    case 'reviewer_note_unhidden':
      return 'Not tekrar görünür yapıldı';
    case 'assignment_locked':
      return 'Ödev kilitlendi';
    case 'assignment_unlocked':
      return 'Ödev kilidi açıldı';
    case 'assignment_missing_marked_not_done':
      return 'Teslim yapmayan korist işaretlendi';
    case 'submission_deleted_by_chef':
      return 'Teslim şef tarafından silindi';
    default:
      return eventType;
  }
}

const REVIEWER_LIST_VIRTUALIZE_THRESHOLD = 40;
const REVIEWER_LIST_ROW_HEIGHT = 76;
const REVIEWER_LIST_OVERSCAN = 8;
const REVIEWER_LIST_MAX_HEIGHT = 480;

interface ReviewerStatusRowProps {
  row: ReviewerMemberStatus;
  assignmentLocked: boolean;
  revisedMemberIdSet: Set<string>;
  onOpenMember: (memberId: string) => void;
  style?: CSSProperties;
}

const ReviewerStatusRow = memo(function ReviewerStatusRow({
  row,
  assignmentLocked,
  revisedMemberIdSet,
  onOpenMember,
  style,
}: ReviewerStatusRowProps) {
  const submission = row.submission;
  const memberState = getReviewerSubmissionState(submission);

  return (
    <button
      type="button"
      onClick={() => onOpenMember(row.member_id)}
      style={style}
      className="relative w-full overflow-hidden rounded-[4px] border border-[var(--color-border)] bg-white/4 px-4 py-3 text-left"
    >
      <span
        className={`absolute bottom-0 left-0 top-0 w-1 ${
          memberState === 'approved'
            ? 'bg-emerald-500/60'
            : memberState === 'rejected'
              ? 'bg-rose-500/60'
              : memberState === 'pending'
                ? 'bg-amber-400/80'
                : 'bg-neutral-500/40'
        }`}
      />
      <div className="pl-2">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-[var(--color-text-high)]">
            {row.first_name} {row.last_name}
          </p>
          <span className={`text-[0.6rem] font-bold uppercase tracking-[0.1em] opacity-80 ${
            memberState === 'approved'
              ? 'text-emerald-400'
              : memberState === 'rejected'
                ? 'text-rose-400'
                : memberState === 'pending'
                  ? 'text-amber-400'
                  : 'text-[var(--color-text-low)]'
          }`}>
            {memberState === 'approved'
              ? 'Onaylandı'
              : memberState === 'rejected'
                ? 'Reddedildi'
                : memberState === 'pending'
                  ? (revisedMemberIdSet.has(row.member_id) ? 'Revize Edildi' : 'Teslim Edildi')
                  : (assignmentLocked ? 'Yapmadı' : 'Teslim Yok')}
          </span>
        </div>
      </div>
    </button>
  );
});

interface ReviewerStatusListProps {
  rows: ReviewerMemberStatus[];
  assignmentLocked: boolean;
  revisedMemberIdSet: Set<string>;
  onOpenMember: (memberId: string) => void;
}

const ReviewerStatusList = memo(function ReviewerStatusList({
  rows,
  assignmentLocked,
  revisedMemberIdSet,
  onOpenMember,
}: ReviewerStatusListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const shouldVirtualize = rows.length > REVIEWER_LIST_VIRTUALIZE_THRESHOLD;

  if (!shouldVirtualize) {
    return (
      <div className="space-y-2">
        {rows.map((row) => (
          <ReviewerStatusRow
            key={row.member_id}
            row={row}
            assignmentLocked={assignmentLocked}
            revisedMemberIdSet={revisedMemberIdSet}
            onOpenMember={onOpenMember}
          />
        ))}
      </div>
    );
  }

  const viewportHeight = REVIEWER_LIST_MAX_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / REVIEWER_LIST_ROW_HEIGHT) - REVIEWER_LIST_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / REVIEWER_LIST_ROW_HEIGHT) + REVIEWER_LIST_OVERSCAN * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div
      className="overflow-y-auto pr-1"
      style={{ maxHeight: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: rows.length * REVIEWER_LIST_ROW_HEIGHT }}>
        {visibleRows.map((row, index) => {
          const absoluteIndex = startIndex + index;
          return (
            <ReviewerStatusRow
              key={row.member_id}
              row={row}
              assignmentLocked={assignmentLocked}
              revisedMemberIdSet={revisedMemberIdSet}
              onOpenMember={onOpenMember}
              style={{
                position: 'absolute',
                top: absoluteIndex * REVIEWER_LIST_ROW_HEIGHT,
                left: 0,
                right: 0,
                height: REVIEWER_LIST_ROW_HEIGHT - 8,
              }}
            />
          );
        })}
      </div>
    </div>
  );
});

interface AssignmentAuditLogListProps {
  logs: AssignmentAuditLogItem[];
}

const AssignmentAuditLogList = memo(function AssignmentAuditLogList({ logs }: AssignmentAuditLogListProps) {
  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="rounded-[4px] border border-[var(--color-border)] bg-white/4 px-3 py-2.5">
          <p className="text-sm font-medium text-[var(--color-text-high)]">{getAuditEventLabel(log.eventType)}</p>
          <p className="mt-1 text-[0.72rem] text-[var(--color-text-medium)]">
            {formatDate(log.createdAt)} · {log.actorName ?? 'Sistem'}
          </p>
        </div>
      ))}
    </div>
  );
});

interface ReviewSubmissionResponse {
  id: string;
  status: 'approved' | 'rejected' | 'pending';
  reviewer_note: string | null;
  reviewer_audio_drive_file_id?: string | null;
  reviewer_audio_file_name?: string | null;
  reviewer_audio_mime_type?: string | null;
  reviewer_audio_file_size_bytes?: number | null;
  is_reviewer_note_hidden?: boolean;
  hidden_by?: string | null;
  hidden_at?: string | null;
  approved_at: string | null;
  approved_by: string | null;
  updated_at: string | null;
}

interface DeleteSubmissionResponse {
  id: string;
}

interface HideReviewResponse {
  id: string;
  reviewer_note: string | null;
  reviewer_audio_drive_file_id?: string | null;
  reviewer_audio_file_name?: string | null;
  reviewer_audio_mime_type?: string | null;
  reviewer_audio_file_size_bytes?: number | null;
  is_reviewer_note_hidden: boolean;
  hidden_by: string | null;
  hidden_at: string | null;
  updated_at?: string | null;
}

interface LockAssignmentResponse {
  id: string;
  is_active: boolean;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
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

async function postFormWithAuth<T>(url: string, formData: FormData) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `İstek başarısız (${response.status})`);
  }

  return (await response.json()) as T;
}

async function reviewAssignmentSubmission(params: {
  submissionId: string;
  status: 'approved' | 'rejected' | 'pending';
  reviewerNote?: string;
  reviewerAudioFile?: File | null;
}) {
  const formData = new FormData();
  formData.set('submissionId', params.submissionId);
  formData.set('status', params.status);
  formData.set('reviewerNote', params.reviewerNote ?? '');
  if (params.reviewerAudioFile) {
    formData.set('reviewerAudioFile', params.reviewerAudioFile);
  } else {
    formData.set('clearReviewerAudio', 'true');
  }

  return postFormWithAuth<ReviewSubmissionResponse>('/api/assignment-submissions/review', formData);
}

async function withdrawAssignmentSubmission(params: {
  submissionId: string;
  reviewerNote?: string;
}) {
  return postJsonWithAuth<ReviewSubmissionResponse>('/api/assignment-submissions/withdraw', {
    submissionId: params.submissionId,
    reviewerNote: params.reviewerNote ?? null,
  });
}

async function updateSubmissionNote(params: {
  submissionId: string;
  noteType: 'submission' | 'reviewer';
  note: string;
}) {
  return postJsonWithAuth('/api/assignment-submissions/update-note', {
    submissionId: params.submissionId,
    noteType: params.noteType,
    note: params.note,
  });
}

async function hideReviewerNote(params: {
  submissionId: string;
  hidden: boolean;
}) {
  return postJsonWithAuth<HideReviewResponse>('/api/assignment-submissions/hide-review', {
    submissionId: params.submissionId,
    hidden: params.hidden,
  });
}

async function updateAssignmentLock(params: {
  assignmentId: string;
  locked: boolean;
}) {
  return postJsonWithAuth<LockAssignmentResponse>('/api/assignments/lock', {
    assignment_id: params.assignmentId,
    locked: params.locked,
    mark_missing_as_not_done: true,
  });
}

async function deleteAssignmentSubmission(submissionId: string) {
  return postJsonWithAuth<DeleteSubmissionResponse>('/api/assignment-submissions/delete', {
    submissionId,
  });
}

function SubmissionFileLink({
  submission,
  className,
  children,
}: {
  submission: Pick<AssignmentSubmission, 'drive_file_id' | 'file_name' | 'mime_type' | 'drive_web_view_link'> | null | undefined;
  className: string;
  children?: ReactNode;
}) {
  const { url, loading } = useProtectedDriveFileUrl(submission);

  if (!submission?.drive_file_id && !submission?.drive_web_view_link) {
    return null;
  }

  const href = submission?.drive_web_view_link ?? url;

  if (!href) {
    return (
      <span className={className}>
        {loading ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} className="opacity-50" />}
      </span>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children ?? <ExternalLink size={13} />}
    </a>
  );
}

function AssignmentReviewAudioPlayer({
  driveFileId,
  fileName,
  mimeType,
}: {
  driveFileId: string;
  fileName: string | null | undefined;
  mimeType: string | null | undefined;
}) {
  const { url, loading, error } = useProtectedDriveFileUrl({
    drive_file_id: driveFileId,
    file_name: fileName ?? 'degerlendirme-sesi',
    mime_type: mimeType ?? 'audio/webm',
  });

  return (
    <div className="mt-2 rounded-[10px] border border-[var(--color-border)] bg-black/5 p-2 dark:bg-white/5">
      {url ? (
        <audio controls preload="none" className="w-full" src={url} />
      ) : loading ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-[var(--color-text-medium)]">
          <Loader2 size={12} className="animate-spin" />
          Sesli değerlendirme yükleniyor...
        </div>
      ) : (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-rose-300">
          <AlertCircle size={12} />
          {error || 'Sesli değerlendirme açılamadı.'}
        </div>
      )}
    </div>
  );
}

async function fetchAssignmentDetail({
  assignmentIdentifier,
  assignmentIdHint,
  memberId,
  canReviewSubmissions,
  reviewerVoiceGroup,
  isChef,
  targetMemberId,
}: {
  assignmentIdentifier: string;
  assignmentIdHint: string | null;
  memberId: string | null;
  canReviewSubmissions: boolean;
  reviewerVoiceGroup: string | null;
  isChef: boolean;
  targetMemberId: string | null;
}): Promise<AssignmentDetailData> {
  let assignmentId: string | null = null;

  if (assignmentIdHint && isUuidLike(assignmentIdHint)) {
    assignmentId = assignmentIdHint;
  } else if (isUuidLike(assignmentIdentifier)) {
    assignmentId = assignmentIdentifier;
  } else {
    const { data: slugRows, error: slugError } = await supabase
      .from('assignments')
      .select('id, title, created_at');

    if (slugError) {
      throw slugError;
    }

    const slugLookup = createSlugLookup((slugRows ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>, 'odev');
    const normalizedIdentifier = assignmentIdentifier.toLowerCase();
    assignmentId = slugLookup.itemBySlug.get(normalizedIdentifier)?.id ?? null;
    if (!assignmentId) {
      const matchingBaseSlugEntries = slugLookup.entries.filter((entry) => entry.baseSlug === normalizedIdentifier);
      if (matchingBaseSlugEntries.length === 1) {
        assignmentId = matchingBaseSlugEntries[0].item.id;
      } else if (matchingBaseSlugEntries.length > 1) {
        assignmentId = matchingBaseSlugEntries.at(-1)?.item.id ?? null;
      }
    }
  }

  if (!assignmentId) {
    throw new Error('Ödev bulunamadı.');
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      id, title, description, deadline, target_voice_group, drive_folder_id, created_by, is_active, is_locked, locked_at, locked_by, created_at, updated_at,
      choir_members!assignments_created_by_fkey ( first_name, last_name, photo_url )
    `)
    .eq('id', assignmentId)
    .single();

  if (assignmentError) {
    throw assignmentError;
  }
  const normalizedAssignment = normalizeAssignment(assignment as AssignmentRow);

  let targetMembers: AssignmentTargetMember[] = [];
  let submissions: ExtendedAssignmentSubmission[] = [];
  let submissionHistoryRows: AssignmentSubmissionHistoryRow[] = [];
  const revisedMemberIds = new Set<string>();
  const submissionMembersById = new Map<string, SubmissionMemberRow>();
  const privateReviewerNotesBySubmissionId = new Map<string, {
    reviewer_note: string | null;
    reviewer_audio_drive_file_id: string | null;
    reviewer_audio_file_name: string | null;
    reviewer_audio_mime_type: string | null;
    reviewer_audio_file_size_bytes: number | null;
  }>();

  // 1. Giriş yapan kullanıcının veya hedef koristin teslimini çekelim
  let mySubmission: ExtendedAssignmentSubmission | null = null;
  let mySubmissionRow: AssignmentSubmissionRow | null = null;
  let mySubmissionRows: AssignmentSubmissionRow[] = [];
  let designatedMember: AssignmentDetailData['designatedMember'] = null;

  const effectiveMemberId = (canReviewSubmissions && targetMemberId) ? targetMemberId : memberId;

  if (effectiveMemberId) {
    const [mySubmissionResult, historyResult, targetMemberResult] = await Promise.all([
      supabase
        .from('assignment_submissions')
        .select(
          'id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, is_reviewer_note_hidden, hidden_by, hidden_at, approved_at, approved_by',
        )
        .eq('assignment_id', assignmentId)
        .eq('member_id', effectiveMemberId)
        .order('submitted_at', { ascending: false }),
      supabase
        .from('assignment_submission_history')
        .select(
          'id, assignment_id, member_id, source_submission_id, drive_file_id, drive_web_view_link, drive_download_link, file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at, status, submission_note, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes, approved_at, approved_by, archived_at, archive_reason',
        )
        .eq('assignment_id', assignmentId)
        .eq('member_id', effectiveMemberId)
        .order('archived_at', { ascending: false }),
      supabase
        .from('choir_members')
        .select('first_name, last_name, photo_url')
        .eq('id', effectiveMemberId)
        .single(),
    ]);

    const { data, error: mySubmissionError } = mySubmissionResult;
    if (mySubmissionError) {
      console.error('Submission fetch failed:', mySubmissionError);
    } else {
      mySubmissionRows = (data ?? []) as AssignmentSubmissionRow[];
      mySubmissionRow = mySubmissionRows[0] ?? null;
    }

    const { data: historyData, error: historyError } = historyResult;
    if (historyError) {
      console.error('Submission history fetch failed:', historyError);
    } else {
      submissionHistoryRows = (historyData ?? []) as AssignmentSubmissionHistoryRow[];
      if (submissionHistoryRows.length > 0) {
        revisedMemberIds.add(effectiveMemberId);
      }
    }

    const { data: targetMemberData } = targetMemberResult;
    if (targetMemberData) {
      designatedMember = {
        first_name: targetMemberData.first_name,
        last_name: targetMemberData.last_name,
        photo_url: targetMemberData.photo_url,
      };
    }
  }

  // 2. Eğer yetkili ise diğer teslimleri ve hedefleri çekelim
  if (canReviewSubmissions) {
    try {
      let targetsQuery = supabase
        .from('assignment_targets')
        .select(`
          member_id,
          choir_members!inner ( first_name, last_name, voice_group )
        `)
        .eq('assignment_id', assignmentId);

      if (!isChef) {
        if (!reviewerVoiceGroup) {
          targetsQuery = targetsQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
        } else {
          targetsQuery = targetsQuery.eq('choir_members.voice_group', reviewerVoiceGroup);
        }
      }

      const { data: targetRows, error: targetRowsError } = await targetsQuery;
      if (targetRowsError) {
        throw targetRowsError;
      }

      targetMembers = ((targetRows ?? []) as AssignmentTargetRow[])
        .map((target) => {
          const choirMember = Array.isArray(target.choir_members)
            ? target.choir_members[0] ?? null
            : target.choir_members ?? null;
          if (!choirMember || !target.member_id) {
            return null;
          }
          return {
            member_id: target.member_id,
            first_name: choirMember.first_name,
            last_name: choirMember.last_name,
            voice_group: choirMember.voice_group,
          } satisfies AssignmentTargetMember;
        })
        .filter((target): target is AssignmentTargetMember => Boolean(target));

      if (targetMembers.length > 0) {
        const { data: targetRoleRows, error: targetRoleRowsError } = await supabase
          .from('choir_member_roles')
          .select('member_id, roles(name)')
          .in(
            'member_id',
            targetMembers.map((member) => member.member_id),
          );
        if (targetRoleRowsError) {
          throw targetRoleRowsError;
        }
        const blockedIds = new Set(
          ((targetRoleRows ?? []) as ChoirMemberRoleRow[])
            .filter((row) => hasBlockedAssignmentRole(row))
            .map((row) => row.member_id),
        );
        if (blockedIds.size > 0) {
          targetMembers = targetMembers.filter((member) => !blockedIds.has(member.member_id));
        }
      }

      if (targetMembers.length === 0) {
        let fallbackTargetQuery = supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group')
          .eq('is_active', true);

        if (normalizedAssignment.target_voice_group) {
          fallbackTargetQuery = fallbackTargetQuery.eq('voice_group', normalizedAssignment.target_voice_group);
        }

        if (!isChef) {
          if (!reviewerVoiceGroup) {
            fallbackTargetQuery = fallbackTargetQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            fallbackTargetQuery = fallbackTargetQuery.eq('voice_group', reviewerVoiceGroup);
          }
        }

        const { data: fallbackTargetRows, error: fallbackTargetError } = await fallbackTargetQuery;
        if (fallbackTargetError) {
          throw fallbackTargetError;
        }

        let fallbackRows = (fallbackTargetRows ?? []) as AssignmentTargetFallbackRow[];
        const fallbackIds = fallbackRows.map((row) => row.id);
        if (fallbackIds.length > 0) {
          const { data: fallbackRoleRows, error: fallbackRoleError } = await supabase
            .from('choir_member_roles')
            .select('member_id, roles(name)')
            .in('member_id', fallbackIds);
          if (fallbackRoleError) {
            throw fallbackRoleError;
          }
          const blockedIds = new Set(
            ((fallbackRoleRows ?? []) as ChoirMemberRoleRow[])
              .filter((row) => hasBlockedAssignmentRole(row))
              .map((row) => row.member_id),
          );
          fallbackRows = fallbackRows.filter((row) => !blockedIds.has(row.id));
        }

        targetMembers = fallbackRows.map((row) => ({
          member_id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          voice_group: row.voice_group,
        }));
      }

      const targetMemberIds = targetMembers.map((target) => target.member_id);
      if (targetMemberIds.length > 0) {
        const { data: historyRows, error: historyRowsError } = await supabase
          .from('assignment_submission_history')
          .select('member_id')
          .eq('assignment_id', assignmentId)
          .in('member_id', targetMemberIds);
        if (historyRowsError) {
          throw historyRowsError;
        }
        for (const row of (historyRows ?? []) as Array<{ member_id: string | null }>) {
          if (row.member_id) {
            revisedMemberIds.add(row.member_id);
          }
        }
      }

      let submissionsQuery = supabase
        .from('assignment_submissions')
        .select(`
          id, assignment_id, member_id, drive_file_id, drive_web_view_link, drive_download_link,
          file_name, mime_type, file_size_bytes, drive_member_folder_id, submitted_at, updated_at,
          status, submission_note, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name,
          reviewer_audio_mime_type, reviewer_audio_file_size_bytes, is_reviewer_note_hidden, hidden_by, hidden_at,
          approved_at, approved_by
        `)
        .eq('assignment_id', assignmentId)
        .order('submitted_at', { ascending: false });

      if (targetMemberIds.length > 0) {
        submissionsQuery = submissionsQuery.in('member_id', targetMemberIds);
      } else if (!isChef) {
        if (!reviewerVoiceGroup) {
          submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          const { data: voiceGroupMembers, error: voiceGroupMembersError } = await supabase
            .from('choir_members')
            .select('id')
            .eq('voice_group', reviewerVoiceGroup)
            .eq('is_active', true);
          if (voiceGroupMembersError) {
            throw voiceGroupMembersError;
          }
          const voiceGroupMemberIds = (voiceGroupMembers ?? []).map((row) => row.id);
          if (voiceGroupMemberIds.length === 0) {
            submissionsQuery = submissionsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            submissionsQuery = submissionsQuery.in('member_id', voiceGroupMemberIds);
          }
        }
      }

      const { data: submissionRows, error: submissionsError } = await submissionsQuery;
      if (submissionsError) {
        throw submissionsError;
      }

      const rawSubmissions = (submissionRows ?? []) as AssignmentSubmissionRow[];
      const submissionMemberIds = Array.from(
        new Set([
          ...rawSubmissions.map((submission) => submission.member_id),
          ...rawSubmissions.map((submission) => submission.approved_by),
          ...mySubmissionRows.map((submission) => submission.member_id),
          ...mySubmissionRows.map((submission) => submission.approved_by),
          ...submissionHistoryRows.map((submission) => submission.member_id),
          ...submissionHistoryRows.map((submission) => submission.approved_by),
        ].filter((id): id is string => Boolean(id))),
      );

      if (submissionMemberIds.length > 0) {
        const { data: submissionMemberRows, error: submissionMembersError } = await supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group, photo_url')
          .in('id', submissionMemberIds);
        if (submissionMembersError) {
          throw submissionMembersError;
        }
        for (const row of (submissionMemberRows ?? []) as SubmissionMemberRow[]) {
          submissionMembersById.set(row.id, row);
        }
      }

      const privateSubmissionIds = Array.from(
        new Set(
          [
            ...rawSubmissions.map((submission) => submission.id),
            ...mySubmissionRows.map((submission) => submission.id),
          ].filter((submissionId): submissionId is string => Boolean(submissionId)),
        ),
      );

      if (privateSubmissionIds.length > 0) {
        const { data: privateRows, error: privateRowsError } = await supabase
          .from('assignment_submission_private_notes')
          .select('submission_id, reviewer_note, reviewer_audio_drive_file_id, reviewer_audio_file_name, reviewer_audio_mime_type, reviewer_audio_file_size_bytes')
          .in('submission_id', privateSubmissionIds);

        if (!privateRowsError) {
          for (const row of (privateRows ?? []) as Array<{
            submission_id: string;
            reviewer_note: string | null;
            reviewer_audio_drive_file_id: string | null;
            reviewer_audio_file_name: string | null;
            reviewer_audio_mime_type: string | null;
            reviewer_audio_file_size_bytes: number | null;
          }>) {
            privateReviewerNotesBySubmissionId.set(row.submission_id, {
              reviewer_note: row.reviewer_note,
              reviewer_audio_drive_file_id: row.reviewer_audio_drive_file_id,
              reviewer_audio_file_name: row.reviewer_audio_file_name,
              reviewer_audio_mime_type: row.reviewer_audio_mime_type,
              reviewer_audio_file_size_bytes: row.reviewer_audio_file_size_bytes,
            });
          }
        }
      }

      submissions = rawSubmissions.map((submission) => {
        const choirMember = submission.member_id ? submissionMembersById.get(submission.member_id) : undefined;
        const reviewerMember = submission.approved_by ? submissionMembersById.get(submission.approved_by) : undefined;
        const privateNote = privateReviewerNotesBySubmissionId.get(submission.id);
        const reviewerNote = submission.is_reviewer_note_hidden
          ? (privateNote?.reviewer_note ?? null)
          : submission.reviewer_note;
        return {
          ...submission,
          reviewer_note: reviewerNote,
          reviewer_audio_drive_file_id: submission.is_reviewer_note_hidden
            ? (privateNote?.reviewer_audio_drive_file_id ?? null)
            : submission.reviewer_audio_drive_file_id,
          reviewer_audio_file_name: submission.is_reviewer_note_hidden
            ? (privateNote?.reviewer_audio_file_name ?? null)
            : submission.reviewer_audio_file_name,
          reviewer_audio_mime_type: submission.is_reviewer_note_hidden
            ? (privateNote?.reviewer_audio_mime_type ?? null)
            : submission.reviewer_audio_mime_type,
          reviewer_audio_file_size_bytes: submission.is_reviewer_note_hidden
            ? (privateNote?.reviewer_audio_file_size_bytes ?? null)
            : submission.reviewer_audio_file_size_bytes,
          choir_members: choirMember
            ? {
                first_name: choirMember.first_name,
                last_name: choirMember.last_name,
                voice_group: choirMember.voice_group,
              }
            : undefined,
          reviewer: reviewerMember
            ? {
                first_name: reviewerMember.first_name,
                last_name: reviewerMember.last_name,
                photo_url: reviewerMember.photo_url,
              }
            : undefined,
        };
      });
    } catch (reviewFetchError) {
      console.error('Assignment review data fetch failed:', reviewFetchError);
      targetMembers = [];
      submissions = [];
    }
  } else if (mySubmissionRows.length > 0 || submissionHistoryRows.length > 0) {
    // Sadece korist ise ve kendi ödevi varsa, teslim/reviewer bilgilerini çekelim
    const neededIds = Array.from(
      new Set(
        [
          ...mySubmissionRows.map((submission) => submission.member_id),
          ...mySubmissionRows.map((submission) => submission.approved_by),
          ...submissionHistoryRows.map((submission) => submission.member_id),
          ...submissionHistoryRows.map((submission) => submission.approved_by),
        ].filter((id): id is string => Boolean(id)),
      ),
    );
    if (neededIds.length > 0) {
      const { data: memberRows } = await supabase
        .from('choir_members')
        .select('id, first_name, last_name, voice_group, photo_url')
        .in('id', neededIds);
      
      for (const row of (memberRows ?? []) as SubmissionMemberRow[]) {
        submissionMembersById.set(row.id, row);
      }
    }
  }

  // 3. Teslimleri ve geçmişini map edelim
  if (mySubmissionRow) {
    const choirMember = mySubmissionRow.member_id ? submissionMembersById.get(mySubmissionRow.member_id) : undefined;
    const reviewerMember = mySubmissionRow.approved_by ? submissionMembersById.get(mySubmissionRow.approved_by) : undefined;
    const privateNote = privateReviewerNotesBySubmissionId.get(mySubmissionRow.id);
    const myReviewerNote = mySubmissionRow.is_reviewer_note_hidden
      ? (privateNote?.reviewer_note ?? null)
      : mySubmissionRow.reviewer_note;
    mySubmission = {
      ...mySubmissionRow,
      reviewer_note: myReviewerNote,
      reviewer_audio_drive_file_id: mySubmissionRow.is_reviewer_note_hidden
        ? (privateNote?.reviewer_audio_drive_file_id ?? null)
        : mySubmissionRow.reviewer_audio_drive_file_id,
      reviewer_audio_file_name: mySubmissionRow.is_reviewer_note_hidden
        ? (privateNote?.reviewer_audio_file_name ?? null)
        : mySubmissionRow.reviewer_audio_file_name,
      reviewer_audio_mime_type: mySubmissionRow.is_reviewer_note_hidden
        ? (privateNote?.reviewer_audio_mime_type ?? null)
        : mySubmissionRow.reviewer_audio_mime_type,
      reviewer_audio_file_size_bytes: mySubmissionRow.is_reviewer_note_hidden
        ? (privateNote?.reviewer_audio_file_size_bytes ?? null)
        : mySubmissionRow.reviewer_audio_file_size_bytes,
      choir_members: choirMember
        ? {
            first_name: choirMember.first_name,
            last_name: choirMember.last_name,
            voice_group: choirMember.voice_group,
          }
        : undefined,
      reviewer: reviewerMember
        ? {
            first_name: reviewerMember.first_name,
            last_name: reviewerMember.last_name,
            photo_url: reviewerMember.photo_url,
          }
        : undefined,
      isArchived: false,
    };
  }

  const submissionHistory: ExtendedAssignmentSubmission[] = [];
  if (mySubmission) {
    submissionHistory.push(mySubmission);
  }

  for (const historyRow of submissionHistoryRows) {
    const choirMember = historyRow.member_id ? submissionMembersById.get(historyRow.member_id) : undefined;
    const reviewerMember = historyRow.approved_by ? submissionMembersById.get(historyRow.approved_by) : undefined;
    submissionHistory.push({
      id: `history-${historyRow.id}`,
      assignment_id: historyRow.assignment_id,
      member_id: historyRow.member_id,
      drive_file_id: historyRow.drive_file_id ?? '',
      drive_web_view_link: historyRow.drive_web_view_link,
      drive_download_link: historyRow.drive_download_link,
      file_name: historyRow.file_name,
      mime_type: historyRow.mime_type,
      file_size_bytes: historyRow.file_size_bytes,
      drive_member_folder_id: historyRow.drive_member_folder_id,
      submitted_at: historyRow.submitted_at,
      updated_at: historyRow.updated_at ?? historyRow.submitted_at,
      status: historyRow.status ?? 'pending',
      submission_note: historyRow.submission_note,
      reviewer_note: historyRow.reviewer_note,
      reviewer_audio_drive_file_id: historyRow.reviewer_audio_drive_file_id,
      reviewer_audio_file_name: historyRow.reviewer_audio_file_name,
      reviewer_audio_mime_type: historyRow.reviewer_audio_mime_type,
      reviewer_audio_file_size_bytes: historyRow.reviewer_audio_file_size_bytes,
      approved_at: historyRow.approved_at,
      approved_by: historyRow.approved_by,
      choir_members: choirMember
        ? {
            first_name: choirMember.first_name,
            last_name: choirMember.last_name,
            voice_group: choirMember.voice_group,
            photo_url: choirMember.photo_url ?? undefined,
          }
        : undefined,
      reviewer: reviewerMember
        ? {
            first_name: reviewerMember.first_name,
            last_name: reviewerMember.last_name,
            photo_url: reviewerMember.photo_url,
          }
        : undefined,
      isArchived: true,
      archived_at: historyRow.archived_at,
      source_submission_id: historyRow.source_submission_id,
    });
  }

  let auditLogs: AssignmentAuditLogItem[] = [];
  {
    let auditQuery = supabase
      .from('assignment_submission_audit_logs')
      .select('id, event_type, created_at, assignment_id, submission_id, member_id, actor_member_id, event_payload')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: false })
      .limit(80);

    if (effectiveMemberId) {
      auditQuery = auditQuery.or(`member_id.eq.${effectiveMemberId},member_id.is.null`);
    }

    const { data: auditRowsData, error: auditRowsError } = await auditQuery;
    if (auditRowsError) {
      console.error('Assignment audit logs fetch failed:', auditRowsError);
    } else {
      const auditRows = (auditRowsData ?? []) as AssignmentAuditLogRow[];
      const missingActorIds = Array.from(
        new Set(
          auditRows
            .map((row) => row.actor_member_id)
            .filter((id): id is string => Boolean(id) && !submissionMembersById.has(id as string)),
        ),
      );

      if (missingActorIds.length > 0) {
        const { data: actorRows } = await supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group, photo_url')
          .in('id', missingActorIds);
        for (const row of (actorRows ?? []) as SubmissionMemberRow[]) {
          submissionMembersById.set(row.id, row);
        }
      }

      auditLogs = auditRows.map((row) => {
        const actor = row.actor_member_id ? submissionMembersById.get(row.actor_member_id) : undefined;
        return {
          id: row.id,
          eventType: row.event_type,
          createdAt: row.created_at,
          actorId: row.actor_member_id ?? null,
          actorName: actor ? `${actor.first_name} ${actor.last_name}`.trim() : null,
          payload: row.event_payload ?? {},
        };
      });
    }
  }

  return {
    assignmentId,
    assignment: normalizedAssignment,
    submissions,
    mySubmission,
    submissionHistory,
    revisedMemberIds: Array.from(revisedMemberIds),
    targetMembers,
    designatedMember,
    auditLogs,
  };
}

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assignmentIdHint = searchParams?.get('aid') ?? null;
  const targetMemberId = searchParams?.get('mid') ?? null;
  const returnToPath = searchParams?.get('returnTo') ?? null;
  const assignmentIdentifier = decodeURIComponent(params?.id ?? '');
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const handleBack = useBackOrHome('/odevler');
  const backLabel = returnToPath?.startsWith('/koristler/') ? 'Koriste Dön' : 'Geri';
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const reviewerVoiceGroup = !isChef ? member?.voice_group ?? null : null;
  const canReviewSubmissions = isChef || isLeader;
  const roleKey = useMemo(() => (isChef ? 'chef' : isLeader ? 'leader' : 'member'), [isChef, isLeader]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [submissionNote, setSubmissionNote] = useState('');
  const [submissionToDelete, setSubmissionToDelete] = useState<AssignmentSubmission | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [isEditingSubmission, setIsEditingSubmission] = useState(false);
  const [reviewNoteDialog, setReviewNoteDialog] = useState<{
    open: boolean;
    type: 'approve' | 'reject';
    submission: AssignmentSubmission | null;
  }>({ open: false, type: 'approve', submission: null });
  const [isEditingReviewNote, setIsEditingReviewNote] = useState(false);
  const [reviewNoteValue, setReviewNoteValue] = useState('');
  const detailQueryKey = useMemo(
    () => [
      'assignment-detail',
      assignmentIdentifier,
      assignmentIdHint,
      member?.id ?? null,
      roleKey,
      reviewerVoiceGroup,
      targetMemberId,
    ] as const,
    [assignmentIdentifier, assignmentIdHint, member?.id, reviewerVoiceGroup, roleKey, targetMemberId],
  );

  useEffect(() => {
    if (!assignmentIdentifier) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: detailQueryKey });
      // Also invalidate the list just in case
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
    };

    const channel = supabase
      .channel(createRealtimeTopic(`odevler-detail:${assignmentIdentifier}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_targets' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions' }, invalidate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [assignmentIdentifier, detailQueryKey, queryClient]);

  const detailCacheKey = useMemo(
    () => getAssignmentCacheKey(
      'detail',
      assignmentIdentifier,
      assignmentIdHint,
      member?.id ?? null,
      roleKey,
      reviewerVoiceGroup,
      targetMemberId,
    ),
    [assignmentIdentifier, assignmentIdHint, member?.id, reviewerVoiceGroup, roleKey, targetMemberId],
  );

  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: async () => {
      const data = await fetchAssignmentDetail({
        assignmentIdentifier,
        assignmentIdHint,
        memberId: member?.id ?? null,
        canReviewSubmissions,
        reviewerVoiceGroup,
        isChef,
        targetMemberId,
      });
      writeAssignmentCache(detailCacheKey, data);
      return data;
    },
    enabled: Boolean(assignmentIdentifier) && !authLoading,
    initialData: () => readAssignmentCache<AssignmentDetailData>(detailCacheKey) ?? undefined,
    staleTime: 30_000,
    gcTime: 24 * 60 * 60_000,
  });
  const resolvedAssignmentId = detailQuery.data?.assignmentId ?? null;

  useEffect(() => {
    if (detailQuery.data) {
      writeAssignmentCache(detailCacheKey, detailQuery.data);
    }
  }, [detailCacheKey, detailQuery.data]);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, note }: { file: File; note?: string }) => {
      if (!resolvedAssignmentId) {
        throw new Error('Ödev bulunamadı.');
      }
      await uploadSubmission(resolvedAssignmentId, file, note);
    },
    onSuccess: async () => {
      setUploadOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['assignment-detail', assignmentIdentifier] });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Teslim yüklenemedi.', 'Yükleme başarısız');
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ submissionId, note }: { submissionId: string; note: string }) => {
      return updateSubmissionNote({
        submissionId,
        noteType: 'submission',
        note,
      });
    },
    onSuccess: async () => {
      setIsEditingSubmission(false);
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Güncelleme başarısız.', 'Hata');
    },
  });

  const updateReviewerNoteMutation = useMutation({
    mutationFn: async ({ submissionId, note }: { submissionId: string; note: string }) => {
      return updateSubmissionNote({
        submissionId,
        noteType: 'reviewer',
        note,
      });
    },
    onSuccess: async () => {
      setIsEditingReviewNote(false);
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Not güncellenemedi.', 'Hata');
    },
  });

  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const result = await deleteAssignmentSubmission(submissionId);
      return result.id;
    },
    onMutate: async (submissionId) => {
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const previousData = queryClient.getQueryData<AssignmentDetailData>(detailQueryKey);

      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.filter((submission) => submission.id !== submissionId),
          mySubmission: current.mySubmission?.id === submissionId ? null : current.mySubmission,
        };
      });

      return { previousData };
    },
    onSuccess: () => {
      setSubmissionToDelete(null);
    },
    onError: (error, _submissionId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(detailQueryKey, context.previousData);
      }
      toast.error(error instanceof Error ? error.message : 'Teslim silinemedi.', 'Silme başarısız');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      submissionId,
      status,
      reviewerNote,
      reviewerAudioFile,
    }: {
      submissionId: string;
      status: 'approved' | 'rejected';
      reviewerNote?: string;
      reviewerAudioFile?: File | null;
    }) => {
      return reviewAssignmentSubmission({ submissionId, status, reviewerNote, reviewerAudioFile });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const previousData = queryClient.getQueryData<AssignmentDetailData>(detailQueryKey);
      const reviewedAt = new Date().toISOString();

      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.map((submission) =>
                submission.id === variables.submissionId
                  ? {
                      ...submission,
                      status: variables.status,
                      reviewer_note: submission.is_reviewer_note_hidden
                        ? submission.reviewer_note ?? null
                        : (variables.reviewerNote ?? null),
                      approved_at: reviewedAt,
                      approved_by: member?.id ?? submission.approved_by ?? null,
                      updated_at: reviewedAt,
                    }
              : submission,
          ),
        };
      });

      return { previousData };
    },
    onSuccess: (updatedSubmission) => {
      queryClient.setQueryData<AssignmentDetailData | undefined>(detailQueryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          submissions: current.submissions.map((submission) =>
            submission.id === updatedSubmission.id
              ? {
                  ...submission,
                  status: updatedSubmission.status,
                  reviewer_note: updatedSubmission.reviewer_note ?? null,
                  reviewer_audio_drive_file_id: updatedSubmission.reviewer_audio_drive_file_id ?? null,
                  reviewer_audio_file_name: updatedSubmission.reviewer_audio_file_name ?? null,
                  reviewer_audio_mime_type: updatedSubmission.reviewer_audio_mime_type ?? null,
                  reviewer_audio_file_size_bytes: updatedSubmission.reviewer_audio_file_size_bytes ?? null,
                  is_reviewer_note_hidden: updatedSubmission.is_reviewer_note_hidden ?? submission.is_reviewer_note_hidden ?? false,
                  hidden_by: updatedSubmission.hidden_by ?? submission.hidden_by ?? null,
                  hidden_at: updatedSubmission.hidden_at ?? submission.hidden_at ?? null,
                  approved_at: updatedSubmission.approved_at ?? submission.approved_at ?? null,
                  approved_by: updatedSubmission.approved_by ?? submission.approved_by ?? null,
                  updated_at: updatedSubmission.updated_at ?? submission.updated_at,
                }
              : submission,
          ),
        };
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(detailQueryKey, context.previousData);
      }
      toast.error(error instanceof Error ? error.message : 'Değerlendirme kaydedilemedi.', 'Hata');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
  });

  const withdrawReviewMutation = useMutation({
    mutationFn: async ({ submissionId }: { submissionId: string }) => {
      return withdrawAssignmentSubmission({ submissionId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['reviewer-assignment-queue'] });
      toast.success('Değerlendirme beklemeye geri alındı.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Değerlendirme geri alınamadı.', 'Hata');
    },
  });

  const hideReviewMutation = useMutation({
    mutationFn: async ({ submissionId, hidden }: { submissionId: string; hidden: boolean }) => {
      return hideReviewerNote({ submissionId, hidden });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey });
      toast.success(data.is_reviewer_note_hidden ? 'Not koristten gizlendi.' : 'Not tekrar görünür yapıldı.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Not görünürlüğü güncellenemedi.', 'Hata');
    },
  });

  const lockAssignmentMutation = useMutation({
    mutationFn: async ({ locked }: { locked: boolean }) => {
      if (!resolvedAssignmentId) {
        throw new Error('Ödev bulunamadı.');
      }
      return updateAssignmentLock({ assignmentId: resolvedAssignmentId, locked });
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['reviewer-assignment-queue'] }),
      ]);
      toast.success(data.is_locked ? 'Ödev kilitlendi.' : 'Ödevin kilidi açıldı.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Ödev kilit durumu güncellenemedi.', 'Hata');
    },
  });

  const assignment = detailQuery.data?.assignment ?? null;
  const submissions = detailQuery.data?.submissions;
  const mySubmission = detailQuery.data?.mySubmission ?? null;
  const archivedSubmissionHistory = useMemo(
    () => {
      const submissionHistory = detailQuery.data?.submissionHistory ?? [];
      return submissionHistory
        .filter((submission) => submission.isArchived)
        .sort((a, b) => (Date.parse(a.submitted_at ?? '') || 0) - (Date.parse(b.submitted_at ?? '') || 0));
    },
    [detailQuery.data?.submissionHistory],
  );
  const targetMembers = detailQuery.data?.targetMembers;
  const designatedMember = detailQuery.data?.designatedMember ?? null;
  const revisedMemberIdSet = useMemo(
    () => new Set(detailQuery.data?.revisedMemberIds ?? []),
    [detailQuery.data?.revisedMemberIds],
  );
  const auditLogs = detailQuery.data?.auditLogs ?? [];
  const deletingSubmissionId = deleteSubmissionMutation.isPending ? deleteSubmissionMutation.variables : null;

  const reviewerMemberStatuses = useMemo<ReviewerMemberStatus[]>(() => {
    const latestSubmissionByMember = new Map<string, AssignmentSubmission>();
    for (const submission of submissions ?? []) {
      if (!submission.member_id) {
        continue;
      }
      const existing = latestSubmissionByMember.get(submission.member_id);
      if (!existing) {
        latestSubmissionByMember.set(submission.member_id, submission);
        continue;
      }

      const existingTime = Date.parse(existing.submitted_at ?? '') || 0;
      const candidateTime = Date.parse(submission.submitted_at ?? '') || 0;
      if (candidateTime >= existingTime) {
        latestSubmissionByMember.set(submission.member_id, submission);
      }
    }

    const memberMap = new Map<
      string,
      Pick<ReviewerMemberStatus, 'member_id' | 'first_name' | 'last_name' | 'voice_group'>
    >();

    for (const target of targetMembers ?? []) {
      memberMap.set(target.member_id, {
        member_id: target.member_id,
        first_name: target.first_name,
        last_name: target.last_name,
        voice_group: target.voice_group,
      });
    }

    if (memberMap.size === 0) {
      for (const submission of submissions ?? []) {
        const choirMember = submission.choir_members;
        if (!submission.member_id || !choirMember) {
          continue;
        }
        memberMap.set(submission.member_id, {
          member_id: submission.member_id,
          first_name: choirMember.first_name,
          last_name: choirMember.last_name,
          voice_group: choirMember.voice_group ?? null,
        });
      }
    }

    const rows: ReviewerMemberStatus[] = Array.from(memberMap.values()).map((memberBase) => ({
      ...memberBase,
      submission: latestSubmissionByMember.get(memberBase.member_id) ?? null,
    }));

    rows.sort((a, b) => {
      const aSubmitted = Boolean(a.submission);
      const bSubmitted = Boolean(b.submission);
      if (aSubmitted !== bSubmitted) {
        return Number(bSubmitted) - Number(aSubmitted);
      }

      const voiceCompare = (a.voice_group ?? '').localeCompare(b.voice_group ?? '', 'tr');
      if (voiceCompare !== 0) {
        return voiceCompare;
      }

      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'tr');
    });

    return rows;
  }, [submissions, targetMembers]);

  const reviewerReviewedCount = useMemo(
    () =>
      reviewerMemberStatuses.filter((row) => {
        const status = row.submission?.status;
        return status === 'approved' || status === 'rejected';
      }).length,
    [reviewerMemberStatuses],
  );
  const handleOpenReviewerMember = useCallback((memberId: string) => {
    const newParams = new URLSearchParams(searchParams?.toString() || '');
    newParams.set('mid', memberId);
    router.push(`${window.location.pathname}?${newParams.toString()}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [router, searchParams]);

  const reviewerTotalCount = reviewerMemberStatuses.length;
  const reviewerCompletedCount = reviewerReviewedCount;
  const completionPercentage =
    reviewerTotalCount > 0 ? Math.round((reviewerCompletedCount / reviewerTotalCount) * 100) : 0;
  const fallbackCompletionScopeLabel = isChef
    ? 'Toplam Koro'
    : reviewerVoiceGroup
      ? `${reviewerVoiceGroup} Partisi`
      : 'Kendi Partisi';
  const completionScopeLabel = formatAssignmentScopeLabel({
    targetVoiceGroup: assignment?.target_voice_group ?? null,
    targetVoiceGroups: (targetMembers ?? []).map((target) => target.voice_group),
    allChoirLabel: fallbackCompletionScopeLabel,
  });
  const detailErrorMessage = getReadableErrorMessage(detailQuery.error);

  return (
    <SwipeBack fallback="/odevler">
    <main className="relative min-h-screen bg-[var(--color-background)] pb-[max(2rem,env(safe-area-inset-bottom))]">

      <div className="space-y-6 px-5 pt-[max(env(safe-area-inset-top),1.5rem)]">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="page-kicker truncate">{targetMemberId ? 'Ödev Akışı' : 'tempoyu koru'}</span>
          </div>
          <button
            onClick={handleBack}
            className="flex shrink-0 h-8 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 pr-3 pl-2.5 text-[var(--color-text-medium)] backdrop-blur-md transition-all hover:bg-white/10 hover:text-[var(--color-text-high)] active:scale-95"
          >
            <ArrowLeft size={16} />
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em]">{backLabel}</span>
          </button>
        </div>
        {authLoading || (!detailQuery.data && detailQuery.isPending) ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
          </div>
        ) : detailQuery.isError ? (
          <div className="glass-panel flex items-center gap-3 p-6">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-sm text-red-400">{detailErrorMessage}</p>
          </div>
        ) : !assignment ? null : (
        <>
          {!targetMemberId && (
            <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-2">
              <h2 className="font-serif text-[1.9rem] leading-tight tracking-[-0.05em] sm:text-[2.5rem]">{assignment.title}</h2>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-xs">
                {assignment.deadline ? (
                  <div className="flex items-center gap-1.5 text-[var(--color-text-medium)]">
                    <Calendar size={13} className="text-[var(--color-accent)]" />
                    <span className="font-bold uppercase tracking-wider text-[var(--color-accent)] opacity-80">Son Teslim</span>
                    <span className="font-medium text-[var(--color-text-high)]">
                      {new Date(assignment.deadline).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ) : null}

                {canReviewSubmissions && (
                  <>
                    <div className="flex items-center gap-1.5 text-[var(--color-text-medium)]">
                      <Users size={13} className="text-[var(--color-accent)]" />
                      <span className="font-bold uppercase tracking-wider text-[var(--color-accent)] opacity-80">Kapsam</span>
                      <span className="font-medium text-[var(--color-text-high)]">{completionScopeLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--color-text-medium)]">
                      <CheckCircle2 size={13} className="text-emerald-400" />
                      <span className="font-bold uppercase tracking-wider text-emerald-400 opacity-80">Tamamlanma</span>
                      <span className="font-medium text-[var(--color-text-high)]">
                        %{completionPercentage} 
                        <span className="ml-1 opacity-50">({reviewerCompletedCount}/{reviewerTotalCount})</span>
                      </span>
                    </div>
                    <button
                      onClick={() => lockAssignmentMutation.mutate({ locked: !Boolean(assignment.is_locked) })}
                      disabled={lockAssignmentMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/5 px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-high)] transition hover:bg-white/10 disabled:opacity-50"
                      title={assignment.is_locked ? 'Kilidi Aç (Teslim Almaya Başla)' : 'Teslimleri Kapat (Ödevi Kilitle)'}
                    >
                      {lockAssignmentMutation.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : assignment.is_locked ? (
                        <Lock size={12} />
                      ) : (
                        <LockOpen size={12} />
                      )}
                      {assignment.is_locked ? 'Kilit Aç' : 'Kilitle'}
                    </button>
                  </>
                )}
              </div>
            </motion.section>
          )}

          <section className="mt-4 -mx-1">
            <div className="space-y-6">
              {!targetMemberId && (
                <div className="px-5 sm:px-6">
                  <span className="page-kicker">Ödev Akışı</span>
                </div>
              )}

              <div className="relative ml-9 space-y-8 border-l border-[var(--color-border-strong)] pb-4 md:ml-10">
                {/* 1. Ödevi Veren (Şef / Assignment Creator) */}
                <article className="group relative pl-6 pr-5 sm:pr-6">
                  <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                    {assignment.choir_members?.photo_url ? (
                      <img src={assignment.choir_members.photo_url} alt="Şef" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                        {getInitials(assignment.choir_members?.first_name, assignment.choir_members?.last_name)}
                      </div>
                    )}
                  </div>

                        <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                          {assignment.choir_members?.first_name} {assignment.choir_members?.last_name}
                        </p>
                        <span className="rounded-full border border-[var(--color-border)] bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-medium)]">
                          ÖDEV
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--color-text-medium)]">{formatDate(assignment.created_at)}</span>
                    </div>

                    {assignment.description ? (
                      <div
                        className="prose mt-1 max-w-none text-[var(--color-text-high)] opacity-90 [--tw-prose-body:var(--color-text-high)] [--tw-prose-headings:var(--color-text-high)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-text-high)] [--tw-prose-bullets:var(--color-text-medium)] [--tw-prose-quotes:var(--color-text-high)] [--tw-prose-code:var(--color-text-high)] [--tw-prose-hr:var(--color-border)] prose-p:my-0.5 prose-p:text-[14px] prose-p:leading-[1.3] prose-ul:list-disc prose-ol:list-decimal prose-li:my-0.5 prose-a:text-[var(--color-accent)] prose-img:my-2 prose-img:max-h-[50vh] prose-img:w-full prose-img:rounded-[8px] prose-img:border prose-img:border-[var(--color-border)] prose-img:object-cover"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.description) }}
                      />
                    ) : (
                      <p className="mt-1 text-sm text-[var(--color-text-medium)] italic">Açıklama bulunmuyor.</p>
                    )}
                  </div>
                </article>

                {/* 2. Korist Teslim Akışı */}
                {(!canReviewSubmissions || targetMemberId) ? (
                  <>
                    {archivedSubmissionHistory.length > 0 ? (
                      <>
                        {archivedSubmissionHistory.map((historySubmission, index) => (
                          <article key={historySubmission.id} className="group relative pl-6 pr-5 sm:pr-6">
                            <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                              {historySubmission.choir_members?.photo_url ? (
                                <img src={historySubmission.choir_members.photo_url} alt="Korist" className="h-full w-full object-cover" />
                              ) : targetMemberId && designatedMember?.photo_url ? (
                                <img src={designatedMember.photo_url} alt="Korist" className="h-full w-full object-cover" />
                              ) : member?.photo_url ? (
                                <img src={member.photo_url} alt="Ben" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                                  {getInitials(
                                    historySubmission.choir_members?.first_name || (targetMemberId ? designatedMember?.first_name : member?.first_name),
                                    historySubmission.choir_members?.last_name || (targetMemberId ? designatedMember?.last_name : member?.last_name),
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                                  Geçmiş Teslim #{index + 1}
                                </p>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                                    historySubmission.status === 'approved'
                                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                      : historySubmission.status === 'rejected'
                                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                                        : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                  }`}
                                >
                                  {historySubmission.status === 'approved'
                                    ? 'ONAYLANDI'
                                    : historySubmission.status === 'rejected'
                                      ? 'REDDEDİLDİ'
                                      : 'TESLİM EDİLDİ'}
                                </span>
                              </div>
                              <span className="text-[11px] text-[var(--color-text-medium)]">
                                {formatDate(historySubmission.submitted_at)}
                              </span>

                              <div className="mt-1 inline-flex max-w-[220px] items-center justify-between gap-3 rounded-full border border-[var(--color-border-strong)] bg-white/5 py-1 pl-1 pr-3 hidden-scroll">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[var(--color-text-medium)]">
                                    <Trash2 size={12} />
                                  </div>
                                  <p className="max-w-[150px] truncate text-xs font-semibold text-[var(--color-text-high)]">
                                    {historySubmission.file_name}
                                  </p>
                                </div>
                              </div>

                              {historySubmission.submission_note ? (
                                <div className="whitespace-pre-wrap text-sm text-[var(--color-text-high)]">
                                  {historySubmission.submission_note}
                                </div>
                              ) : null}

                              {historySubmission.reviewer_note ? (
                                <div className="whitespace-pre-wrap text-sm text-[var(--color-text-medium)]">
                                  {historySubmission.reviewer
                                    ? `${historySubmission.reviewer.first_name} ${historySubmission.reviewer.last_name || ''}`.trim()
                                    : 'Şef / Partisyon Şefi'}: {historySubmission.reviewer_note}
                                </div>
                              ) : null}

                              {historySubmission.reviewer_audio_drive_file_id ? (
                                <AssignmentReviewAudioPlayer
                                  driveFileId={historySubmission.reviewer_audio_drive_file_id}
                                  fileName={historySubmission.reviewer_audio_file_name}
                                  mimeType={historySubmission.reviewer_audio_mime_type}
                                />
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </>
                    ) : null}

                    {mySubmission ? (
                      <>
                        <article className="group relative pl-6 pr-3 sm:pr-4">
                          <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                            {mySubmission.choir_members?.photo_url ? (
                              <img src={mySubmission.choir_members.photo_url} alt="Korist" className="h-full w-full object-cover" />
                            ) : targetMemberId && designatedMember?.photo_url ? (
                              <img src={designatedMember.photo_url} alt="Korist" className="h-full w-full object-cover" />
                            ) : member?.photo_url ? (
                              <img src={member.photo_url} alt="Ben" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                                {getInitials(
                                  mySubmission.choir_members?.first_name || (targetMemberId ? designatedMember?.first_name : member?.first_name),
                                  mySubmission.choir_members?.last_name || (targetMemberId ? designatedMember?.last_name : member?.last_name),
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-start gap-1 min-w-0">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <p className="truncate text-[13px] font-semibold text-[var(--color-text-high)]">
                                  {mySubmission.choir_members
                                    ? `${mySubmission.choir_members.first_name} ${mySubmission.choir_members.last_name || ''}`.trim()
                                    : targetMemberId
                                      ? `${designatedMember?.first_name} ${designatedMember?.last_name || ''}`.trim()
                                      : `${member?.first_name} ${member?.last_name || ''}`.trim()}
                                </p>
                                <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
                                  TESLİM EDİLDİ
                                </span>
                              </div>

                              {!targetMemberId ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isEditingSubmission) {
                                        setIsEditingSubmission(false);
                                      } else {
                                        setSubmissionNote(mySubmission.submission_note || '');
                                        setIsEditingSubmission(true);
                                      }
                                    }}
                                    className={`rounded-full p-1.5 transition-colors ${
                                      isEditingSubmission
                                        ? 'bg-[var(--color-accent)] text-[var(--color-background)]'
                                        : 'text-[var(--color-text-medium)] hover:bg-white/5 hover:text-[var(--color-text-high)]'
                                    }`}
                                    title={isEditingSubmission ? 'Düzenlemeyi Kapat' : 'Düzenle'}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <span className="text-[11px] text-[var(--color-text-medium)]">
                              {mySubmission.updated_at && new Date(mySubmission.updated_at).getTime() - new Date(mySubmission.submitted_at).getTime() > 2000
                                ? `${formatDate(mySubmission.updated_at)} (düzenlendi)`
                                : formatDate(mySubmission.submitted_at)}
                            </span>
                          </div>

                          {isEditingSubmission ? (
                            <div className="mt-3 space-y-3">
                              <textarea
                                autoFocus
                                value={submissionNote}
                                onChange={(e) => setSubmissionNote(e.target.value)}
                                placeholder="Açıklama veya sorularınızı yazabilirsiniz (İsteğe bağlı)..."
                                className="w-full resize-none rounded-md border border-[var(--color-border-strong)] bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-low)] focus:ring-[1.5px] focus:ring-[var(--color-accent)]"
                                rows={3}
                              />
                              <div className="flex max-w-fit items-center justify-between rounded-full border border-[var(--color-border-strong)] bg-white/5 px-3 py-2.5">
                                <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                  <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                                  <p className="max-w-[100px] truncate text-[11px] font-semibold text-[var(--color-text-high)]">{mySubmission.file_name}</p>
                                </div>
                                <button
                                  onClick={() => {
                                    if (assignment?.is_locked) {
                                      toast.error('Bu ödev kilitlendiği için dosya değiştirilemez.', 'Ödev kilitli');
                                      return;
                                    }
                                    setUploadOpen(true);
                                    setIsEditingSubmission(false);
                                  }}
                                  className="shrink-0 flex items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-high)] transition hover:bg-white/15"
                                >
                                  <Upload size={11} /> Değiştir
                                </button>
                              </div>
                              <div className="flex justify-end pt-1">
                                <button
                                  onClick={() => updateNoteMutation.mutate({ submissionId: mySubmission.id, note: submissionNote })}
                                  disabled={updateNoteMutation.isPending}
                                  className="flex min-w-[90px] items-center justify-center rounded-[4px] bg-[var(--color-accent)] px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-[var(--color-background)] transition hover:opacity-90 active:scale-95"
                                >
                                  {updateNoteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Kaydet'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="mt-2 inline-flex max-w-[200px] items-center justify-between gap-3 rounded-full border border-emerald-500/30 bg-emerald-500/8 py-1 pl-1 pr-3 hidden-scroll">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                                    <CheckCircle2 size={12} />
                                  </div>
                                  <p className="max-w-[100px] truncate text-xs font-semibold text-emerald-400">{mySubmission.file_name}</p>
                                </div>
                                <SubmissionFileLink
                                  submission={mySubmission}
                                  className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
                                />
                              </div>

                              {mySubmission.submission_note ? (
                                <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-high)]">
                                  {mySubmission.submission_note}
                                </div>
                              ) : null}
                            </>
                          )}
                        </article>

                        {mySubmission.reviewer_note || mySubmission.reviewer_audio_drive_file_id || mySubmission.status !== 'pending' ? (
                          <article className="group relative pl-6 pr-5 sm:pr-6">
                            <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                              {mySubmission.reviewer?.photo_url ? (
                                <img src={mySubmission.reviewer.photo_url} alt="Değerlendiren" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                                  {getInitials(mySubmission.reviewer?.first_name, mySubmission.reviewer?.last_name)}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                                    {mySubmission.reviewer
                                      ? `${mySubmission.reviewer.first_name} ${mySubmission.reviewer.last_name || ''}`.trim()
                                      : 'Şef / Partisyon Şefi'}
                                  </p>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                                      mySubmission.status === 'approved'
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                        : mySubmission.status === 'rejected'
                                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                    }`}
                                  >
                                    {mySubmission.status === 'approved'
                                      ? 'ONAYLANDI'
                                      : mySubmission.status === 'rejected'
                                        ? 'REDDEDİLDİ'
                                        : 'BEKLEMEDE'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1">
                                  {canReviewSubmissions && !isEditingReviewNote && mySubmission.approved_by === member?.id ? (
                                    <button
                                      onClick={() => {
                                        setReviewNoteValue(mySubmission.reviewer_note || '');
                                        setIsEditingReviewNote(true);
                                      }}
                                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-medium)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-high)]"
                                      title="Değerlendirmeyi Düzenle"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                  ) : null}
                                  {isChef && canReviewSubmissions ? (
                                    <button
                                      onClick={() =>
                                        hideReviewMutation.mutate({
                                          submissionId: mySubmission.id,
                                          hidden: !Boolean(mySubmission.is_reviewer_note_hidden),
                                        })
                                      }
                                      disabled={hideReviewMutation.isPending}
                                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                                        mySubmission.is_reviewer_note_hidden
                                          ? 'border-amber-500/45 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                                          : 'border-[var(--color-border-strong)] text-[var(--color-text-medium)] hover:bg-white/5 hover:text-[var(--color-text-high)]'
                                      }`}
                                      title={
                                        mySubmission.is_reviewer_note_hidden
                                          ? 'Değerlendirme gizli (göstermek için tıkla)'
                                          : 'Değerlendirme görünür (gizlemek için tıkla)'
                                      }
                                    >
                                      {hideReviewMutation.isPending ? (
                                        <Loader2 size={12} className="animate-spin" />
                                      ) : mySubmission.is_reviewer_note_hidden ? (
                                        <EyeOff size={12} />
                                      ) : (
                                        <Eye size={12} />
                                      )}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {mySubmission.approved_at ? (
                                <span className="text-[11px] text-[var(--color-text-medium)]">
                                  {formatDate(mySubmission.approved_at)}
                                </span>
                              ) : null}
                            </div>

                            {isEditingReviewNote ? (
                              <div className="mt-2 space-y-2">
                                <textarea
                                  autoFocus
                                  value={reviewNoteValue}
                                  onChange={(e) => setReviewNoteValue(e.target.value)}
                                  placeholder="Notunuzu buraya yazın..."
                                  className="w-full resize-none rounded-md border border-[var(--color-border-strong)] bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-low)] focus:ring-[1.5px] focus:ring-[var(--color-accent)]"
                                  rows={3}
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setIsEditingReviewNote(false)}
                                    disabled={updateReviewerNoteMutation.isPending}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10 disabled:opacity-50"
                                    title="İptal"
                                  >
                                    <X size={14} />
                                  </button>
                                  <button
                                    onClick={() =>
                                      updateReviewerNoteMutation.mutate({
                                        submissionId: mySubmission.id,
                                        note: reviewNoteValue,
                                      })
                                    }
                                    disabled={updateReviewerNoteMutation.isPending}
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-background)] hover:opacity-90 disabled:opacity-50"
                                    title="Kaydet"
                                  >
                                    {updateReviewerNoteMutation.isPending ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Check size={14} />
                                    )}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {mySubmission.reviewer_note ? (
                                  <div
                                    className={`mt-2 whitespace-pre-wrap text-sm ${
                                      mySubmission.is_reviewer_note_hidden
                                        ? 'text-amber-200/85 line-through decoration-amber-300/70'
                                        : 'text-[var(--color-text-high)]'
                                    }`}
                                  >
                                    {mySubmission.reviewer_note}
                                  </div>
                                ) : null}

                                {mySubmission.reviewer_audio_drive_file_id ? (
                                  <AssignmentReviewAudioPlayer
                                    driveFileId={mySubmission.reviewer_audio_drive_file_id}
                                    fileName={mySubmission.reviewer_audio_file_name}
                                    mimeType={mySubmission.reviewer_audio_mime_type}
                                  />
                                ) : null}

                                {!mySubmission.reviewer_note && !mySubmission.reviewer_audio_drive_file_id && mySubmission.is_reviewer_note_hidden ? (
                                  <div className="mt-2 text-sm italic text-[var(--color-text-medium)]">
                                    Bu değerlendirme notu Şef tarafından gizlendi.
                                  </div>
                                ) : null}
                              </>
                            )}
                          </article>
                        ) : (
                          <article className="group relative pl-6 pr-5 sm:pr-6">
                            <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                              <AlertCircle size={14} className="text-amber-400" />
                            </div>

                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                                  Değerlendirme
                                </p>
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-400">
                                  İNCELEMEDE
                                </span>
                              </div>
                              <p className="mt-1 text-sm italic text-[var(--color-text-medium)]">
                                Şef veya partisyon şefinin ödevinizi incelemesi bekleniyor.
                              </p>
                            </div>
                          </article>
                        )}
                      </>
                    ) : targetMemberId ? (
                      <article className="group relative pl-6 pr-5 sm:pr-6">
                        <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                          {designatedMember?.photo_url ? (
                            <img src={designatedMember.photo_url} alt="Korist" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                              {getInitials(designatedMember?.first_name, designatedMember?.last_name)}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                              {designatedMember?.first_name} {designatedMember?.last_name}
                            </p>
                            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-400">
                              {assignment?.is_locked ? 'YAPMADI' : 'TESLİM EDİLMEDİ'}
                            </span>
                          </div>
                          <p className="mt-1 text-sm italic text-[var(--color-text-medium)]">
                            {assignment?.is_locked
                              ? 'Ödev kilitlendi ve bu korist için teslim bulunmuyor.'
                              : 'Bu korist henüz ödevini teslim etmedi.'}
                          </p>
                        </div>
                      </article>
                    ) : null}

                    {/* Reviewer Controls (Injected when mid is present) */}
                    {canReviewSubmissions && targetMemberId && mySubmission ? (
                      <div className="relative pl-6 pr-5 sm:pr-6 mt-8">
                        {mySubmission.status === 'pending' ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => {
                                setReviewNoteDialog({
                                  open: true,
                                  type: 'approve',
                                  submission: mySubmission,
                                });
                              }}
                              disabled={reviewMutation.isPending}
                              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-emerald-400 transition hover:bg-emerald-500/15 disabled:opacity-50"
                            >
                              <CheckCircle2 size={16} /> Onayla
                            </button>
                            <button
                              onClick={() => {
                                setReviewNoteDialog({
                                  open: true,
                                  type: 'reject',
                                  submission: mySubmission,
                                });
                              }}
                              disabled={reviewMutation.isPending}
                              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-rose-400 transition hover:bg-rose-500/15 disabled:opacity-50"
                            >
                              <AlertCircle size={16} /> Reddet
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => withdrawReviewMutation.mutate({ submissionId: mySubmission.id })}
                            disabled={withdrawReviewMutation.isPending}
                            className="flex w-full items-center justify-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-amber-300 transition hover:bg-amber-500/15 disabled:opacity-50"
                          >
                            {withdrawReviewMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Beklemeye Geri Al
                          </button>
                        )}
                      </div>
                    ) : null}

                    {/* Submission Input Area (If no submission OR rejected) - HIDDEN if targetMemberId is present */}
                    {!targetMemberId && (!mySubmission || mySubmission.status === 'rejected') && !assignment?.is_locked ? (
                    <div className="relative pl-6 pr-5 sm:pr-6 mt-8">
                      <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                        {member?.photo_url ? (
                          <img src={member.photo_url} alt="Ben" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-[var(--color-text-medium)]">
                            {getInitials(member?.first_name, member?.last_name)}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-[13px] font-semibold text-[var(--color-text-high)]">
                            {mySubmission?.status === 'rejected' ? 'Yeni Teslim' : (member?.first_name || 'Teslim Yap')}
                          </p>
                          {mySubmission?.status === 'rejected' && (
                            <span className="rounded-full border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
                              REVİZYON
                            </span>
                          )}
                        </div>
                        
                        <textarea
                          value={submissionNote}
                          onChange={(e) => setSubmissionNote(e.target.value)}
                          placeholder="Yeni açıklama veya sorularınızı yazabilirsiniz (İsteğe bağlı)..."
                          className="w-full resize-none rounded-md bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-low)] focus:ring-[1.5px] focus:ring-[var(--color-border-strong)] border border-[var(--color-border)]"
                          rows={2}
                        />
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => setUploadOpen(true)}
                            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-background)] transition-transform hover:opacity-90 active:scale-95"
                          >
                            <Upload size={14} strokeWidth={2.5} /> {mySubmission?.status === 'rejected' ? 'Yeni Dosya Yükle' : 'Dosya Yükle'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {!targetMemberId && !mySubmission && assignment?.is_locked ? (
                    <article className="group relative pl-6 pr-5 sm:pr-6">
                      <div className="absolute left-0 top-0 flex h-8 w-8 shrink-0 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-black/60 shadow-xl backdrop-blur-md">
                        <Lock size={14} className="text-rose-400" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold text-[var(--color-text-high)]">Ödev kilitlendi</p>
                          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-400">
                            YAPMADI
                          </span>
                        </div>
                        <p className="mt-1 text-sm italic text-[var(--color-text-medium)]">
                          Kilit sonrası yeni teslim kabul edilmiyor.
                        </p>
                      </div>
                    </article>
                  ) : null}
                </>
              ) : null}
              </div>
            </div>
          </section>

          {canReviewSubmissions ? (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass-panel p-5 sm:p-6 mt-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)]">
                    Teslim Takibi
                  </h3>
                </div>
                <p className="text-xs text-[var(--color-text-medium)]">
                  {reviewerCompletedCount} / {reviewerTotalCount} tamamlandı
                </p>
              </div>

              {targetMemberId ? (
                <div className="py-2 text-center">
                  <p className="text-sm text-[var(--color-text-medium)]">
                    Şu an belirli bir koristin teslimini inceliyorsunuz.
                  </p>
                </div>
              ) : reviewerMemberStatuses.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-medium)]">
                  Kişi bazlı liste için hedef korist bulunamadı.
                </p>
              ) : (
                <ReviewerStatusList
                  rows={reviewerMemberStatuses}
                  assignmentLocked={Boolean(assignment?.is_locked)}
                  revisedMemberIdSet={revisedMemberIdSet}
                  onOpenMember={handleOpenReviewerMember}
                />
              )}
            </motion.section>
          ) : null}

          {auditLogs.length > 0 ? (
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-5 sm:p-6 mt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)]">
                  Düzenleme Günlüğü
                </h3>
                <span className="text-[0.62rem] text-[var(--color-text-medium)]">{auditLogs.length} kayıt</span>
              </div>
              <AssignmentAuditLogList logs={auditLogs} />
            </motion.section>
          ) : null}
        </>
      )}

      <FileUploadModal
        isOpen={uploadOpen}
        onClose={() => !uploadMutation.isPending && setUploadOpen(false)}
        mode="submission"
        hideNoteInput={true}
        title={mySubmission ? 'Teslimi Güncelle' : 'Ödev Teslim Et'}
        description="Tüm dosya türlerini yükleyebilirsiniz (max 50MB)"
        onUpload={async (file, _, __) => {
          await uploadMutation.mutateAsync({ file, note: submissionNote.trim() || undefined });
        }}
      />

      <ConfirmDialog
        open={Boolean(submissionToDelete)}
        title="Teslim silinsin mi?"
        description={
          submissionToDelete 
            ? `“${submissionToDelete.file_name.length > 30 ? submissionToDelete.file_name.slice(0, 27) + '...' : submissionToDelete.file_name}” teslimi silinecek. Bu işlem geri alınamaz.` 
            : ''
        }
        confirmLabel="Sil"
        tone="danger"
        loading={deleteSubmissionMutation.isPending}
        onClose={() => setSubmissionToDelete(null)}
        onConfirm={() => {
          if (submissionToDelete) {
            deleteSubmissionMutation.mutate(submissionToDelete.id);
          }
        }}
      />

      <ReviewNoteDialog
        open={reviewNoteDialog.open}
        type={reviewNoteDialog.type}
        submissionName={reviewNoteDialog.submission?.file_name ?? 'Teslim'}
        loading={reviewMutation.isPending}
        onClose={() => {
          if (reviewMutation.isPending) {
            return;
          }
          setReviewNoteDialog({ open: false, type: 'approve', submission: null });
        }}
        onSubmit={async ({ note, audioFile }) => {
          const submission = reviewNoteDialog.submission;
          if (!submission?.id) {
            return;
          }

          await reviewMutation.mutateAsync({
            submissionId: submission.id,
            status: reviewNoteDialog.type === 'approve' ? 'approved' : 'rejected',
            reviewerNote: note,
            reviewerAudioFile: audioFile,
          });

          setReviewNoteDialog({ open: false, type: 'approve', submission: null });
        }}
      />
      </div>
    </main>
    </SwipeBack>
  );
}
