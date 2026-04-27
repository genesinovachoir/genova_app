import webpush from 'web-push';

import { stripHtmlTags } from '@/lib/richText';
import { createSupabaseServiceClient } from '@/lib/server/supabase-auth';

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SendProfileDecisionPushInput {
  memberId: string;
  status: 'approved' | 'rejected';
  rejectReason?: string | null;
  reviewerName?: string | null;
}

interface SendAnnouncementPublishedPushInput {
  announcementId: string;
  title: string;
  description: string;
  targetMemberIds: string[];
  publisherName?: string | null;
}

interface SendRehearsalCreatedPushInput {
  rehearsalId: string;
  rehearsalTitle: string;
  rehearsalDetails: string;
  collectAttendance: boolean;
  targetMemberIds: string[];
  rehearsalDate?: string | null;
}

interface SendAssignmentCreatedPushInput {
  assignmentId: string;
  deadlineText: string;
  targetMemberIds: string[];
}

interface SendRepertoireAssignmentPushInput {
  songId: string;
  songTitle: string;
  partName?: string | null;
  targetMemberIds: string[];
}

interface SendAssignmentReviewPushInput {
  memberId: string;
  assignmentId: string;
  status: 'approved' | 'rejected';
  reviewerMessage?: string | null;
}

interface PushPayload {
  title: string;
  body?: string;
  url: string;
  data: Record<string, unknown>;
  icon?: string;
}

let vapidConfigured = false;
const DEFAULT_BODY_MAX_LENGTH = 180;
const DEFAULT_TITLE_MAX_LENGTH = 90;
const ISO_TIMESTAMP_WITH_MILLISECONDS = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d{1,6}(Z|[+-]\d{2}:?\d{2})?/g;

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripMillisecondsFromIsoTimestamp(value: string) {
  return value.replace(ISO_TIMESTAMP_WITH_MILLISECONDS, '$1$2');
}

function getNotificationTimestampIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function simplifyNotificationText(value: string | null | undefined, maxLength = DEFAULT_BODY_MAX_LENGTH) {
  const plain = stripHtmlTags(value);
  if (!plain) {
    return '';
  }

  return truncateText(stripMillisecondsFromIsoTimestamp(plain), maxLength);
}

function getVapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

function ensureVapidConfigured() {
  if (vapidConfigured) {
    return true;
  }

  const config = getVapidConfig();
  if (!config) {
    return false;
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  vapidConfigured = true;
  return true;
}

function buildProfileDecisionPayload(input: SendProfileDecisionPushInput): PushPayload {
  const baseTitle = input.status === 'approved'
    ? 'Profil değişiklik talebiniz onaylandı'
    : 'Profil değişiklik talebiniz reddedildi';

  const reviewer = simplifyNotificationText(input.reviewerName, 60);

  let body = input.status === 'approved'
    ? 'Şef profil değişiklik talebinizi onayladı.'
    : 'Şef profil değişiklik talebinizi reddetti.';

  if (reviewer) {
    body = `${reviewer}: ${body}`;
  }

  const rejectReason = simplifyNotificationText(input.rejectReason, 120);
  if (input.status === 'rejected' && rejectReason) {
    body = `${body} Sebep: ${rejectReason}`;
  }

  return {
    title: baseTitle,
    body,
    url: '/profil/degisiklikler',
    data: {
      type: 'profile_change_request_reviewed',
      status: input.status,
      at: getNotificationTimestampIso(),
    },
  };
}

function buildAnnouncementPublishedPayload(input: SendAnnouncementPublishedPushInput): PushPayload {
  const content = simplifyNotificationText(input.description) || 'Yeni duyuru yayınlandı.';
  const titleLine = simplifyNotificationText(input.title, DEFAULT_TITLE_MAX_LENGTH) || 'Duyuru';

  return {
    title: 'Yeni Duyuru',
    body: `${titleLine}: ${content}`,
    url: `/announcements/${input.announcementId}`,
    data: {
      type: 'announcement_published',
      announcementId: input.announcementId,
      at: getNotificationTimestampIso(),
    },
  };
}

function buildRehearsalCreatedPayload(input: SendRehearsalCreatedPushInput): PushPayload {
  const titleLine = simplifyNotificationText(input.rehearsalTitle, DEFAULT_TITLE_MAX_LENGTH) || 'Etkinlik';
  const details = simplifyNotificationText(input.rehearsalDetails) || 'Etkinlik detayları güncellendi.';
  const rawBody = input.collectAttendance
    ? `Yoklama alınacaktır. ${details}`
    : details;
  const body = truncateText(rawBody, 220);

  const dateQuery = input.rehearsalDate?.trim() ? `?date=${encodeURIComponent(input.rehearsalDate.trim())}` : '';

  return {
    title: `Yeni Etkinlik - ${titleLine}`,
    body,
    url: `/devamsizlik${dateQuery}`,
    data: {
      type: 'rehearsal_created',
      rehearsalId: input.rehearsalId,
      rehearsalDate: input.rehearsalDate ?? null,
      at: getNotificationTimestampIso(),
    },
  };
}

function buildAssignmentCreatedPayload(input: SendAssignmentCreatedPushInput): PushPayload {
  const deadlineText = simplifyNotificationText(input.deadlineText, 70) || 'Belirlenen son tarihe kadar';

  return {
    title: 'Yeni Ödev',
    body: `${deadlineText} tarihine kadar teslim edilmesi gerek.`,
    url: `/odevler/${input.assignmentId}?aid=${input.assignmentId}`,
    data: {
      type: 'assignment_created',
      assignmentId: input.assignmentId,
      at: getNotificationTimestampIso(),
    },
  };
}

function buildRepertoireAssignmentPayload(input: SendRepertoireAssignmentPushInput): PushPayload {
  const titleLine = simplifyNotificationText(input.songTitle, DEFAULT_TITLE_MAX_LENGTH) || 'Repertuvar';
  const partLine = simplifyNotificationText(input.partName, 60);

  return {
    title: 'Yeni Repertuvar Ataması',
    body: partLine ? `${titleLine} - ${partLine}` : titleLine,
    url: `/repertuvar/${input.songId}`,
    data: {
      type: 'repertoire_assignment_created',
      songId: input.songId,
      partName: input.partName ?? null,
      at: getNotificationTimestampIso(),
    },
  };
}

function buildAssignmentReviewPayload(input: SendAssignmentReviewPushInput): PushPayload {
  const title = input.status === 'approved'
    ? 'Ödevin onaylandı'
    : 'Ödevin reddedildi';
  const body = simplifyNotificationText(input.reviewerMessage);

  const payload: PushPayload = {
    title,
    url: `/odevler/${input.assignmentId}?aid=${input.assignmentId}`,
    data: {
      type: 'assignment_reviewed',
      status: input.status,
      assignmentId: input.assignmentId,
      at: getNotificationTimestampIso(),
    },
  };

  if (body) {
    payload.body = body;
  }

  return payload;
}

function isStaleEndpointError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeStatusCode = (error as { statusCode?: number }).statusCode;
  return maybeStatusCode === 404 || maybeStatusCode === 410;
}

async function sendPushToMembers(memberIds: string[], payloadData: PushPayload) {
  if (!ensureVapidConfigured()) {
    return { sent: 0, skipped: true };
  }

  const normalizedMemberIds = Array.from(new Set(memberIds.map((memberId) => memberId.trim()).filter(Boolean)));
  if (normalizedMemberIds.length === 0) {
    return { sent: 0, skipped: false };
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: subscriptions, error } = await serviceClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('member_id', normalizedMemberIds);

  if (error || !subscriptions || subscriptions.length === 0) {
    return { sent: 0, skipped: false };
  }

  const payload = JSON.stringify(payloadData);
  const staleEndpoints: string[] = [];
  let sent = 0;

  for (const row of subscriptions as PushSubscriptionRow[]) {
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };

    try {
      await webpush.sendNotification(subscription, payload);
      sent += 1;
    } catch (pushError) {
      if (isStaleEndpointError(pushError)) {
        staleEndpoints.push(row.endpoint);
      } else {
        console.error('Push notification send failed:', pushError);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await serviceClient.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }

  return { sent, skipped: false };
}

export async function sendProfileDecisionPush(input: SendProfileDecisionPushInput) {
  return sendPushToMembers([input.memberId], buildProfileDecisionPayload(input));
}

export async function sendAnnouncementPublishedPush(input: SendAnnouncementPublishedPushInput) {
  return sendPushToMembers(input.targetMemberIds, buildAnnouncementPublishedPayload(input));
}

export async function sendRehearsalCreatedPush(input: SendRehearsalCreatedPushInput) {
  return sendPushToMembers(input.targetMemberIds, buildRehearsalCreatedPayload(input));
}

export async function sendAssignmentCreatedPush(input: SendAssignmentCreatedPushInput) {
  return sendPushToMembers(input.targetMemberIds, buildAssignmentCreatedPayload(input));
}

export async function sendRepertoireAssignmentPush(input: SendRepertoireAssignmentPushInput) {
  return sendPushToMembers(input.targetMemberIds, buildRepertoireAssignmentPayload(input));
}

export async function sendAssignmentReviewPush(input: SendAssignmentReviewPushInput) {
  return sendPushToMembers([input.memberId], buildAssignmentReviewPayload(input));
}
