import webpush from 'web-push';

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

  const reviewer = input.reviewerName?.trim();

  let body = input.status === 'approved'
    ? 'Şef profil değişiklik talebinizi onayladı.'
    : 'Şef profil değişiklik talebinizi reddetti.';

  if (reviewer) {
    body = `${reviewer}: ${body}`;
  }

  if (input.status === 'rejected' && input.rejectReason?.trim()) {
    body = `${body} Sebep: ${input.rejectReason.trim()}`;
  }

  return {
    title: baseTitle,
    body,
    url: '/profil/degisiklikler',
    data: {
      type: 'profile_change_request_reviewed',
      status: input.status,
      at: new Date().toISOString(),
    },
  };
}

function buildAnnouncementPublishedPayload(input: SendAnnouncementPublishedPushInput): PushPayload {
  const content = input.description.trim() || 'Yeni duyuru';
  const titleLine = input.title.trim() || 'Duyuru';

  return {
    title: 'Yeni Duyuru',
    body: `${titleLine} - ${content}`,
    url: `/announcements/${input.announcementId}`,
    data: {
      type: 'announcement_published',
      announcementId: input.announcementId,
      at: new Date().toISOString(),
    },
  };
}

function buildRehearsalCreatedPayload(input: SendRehearsalCreatedPushInput): PushPayload {
  const titleLine = input.rehearsalTitle.trim() || 'Etkinlik';
  const details = input.rehearsalDetails.trim() || 'Etkinlik detayları güncellendi.';
  const body = input.collectAttendance
    ? `Yoklama alınacaktır. ${details}`
    : details;

  const dateQuery = input.rehearsalDate?.trim() ? `?date=${encodeURIComponent(input.rehearsalDate.trim())}` : '';

  return {
    title: `Yeni Etkinlik - ${titleLine}`,
    body,
    url: `/devamsizlik${dateQuery}`,
    data: {
      type: 'rehearsal_created',
      rehearsalId: input.rehearsalId,
      rehearsalDate: input.rehearsalDate ?? null,
      at: new Date().toISOString(),
    },
  };
}

function buildAssignmentCreatedPayload(input: SendAssignmentCreatedPushInput): PushPayload {
  const deadlineText = input.deadlineText.trim() || 'Belirlenen son tarihe kadar';

  return {
    title: 'Yeni Ödev',
    body: `${deadlineText} tarihine kadar teslim edilmesi gerek.`,
    url: `/odevler/${input.assignmentId}?aid=${input.assignmentId}`,
    data: {
      type: 'assignment_created',
      assignmentId: input.assignmentId,
      at: new Date().toISOString(),
    },
  };
}

function buildAssignmentReviewPayload(input: SendAssignmentReviewPushInput): PushPayload {
  const title = input.status === 'approved'
    ? 'Ödevin onaylandı'
    : 'Ödevin reddedildi';
  const body = input.reviewerMessage?.trim();

  const payload: PushPayload = {
    title,
    url: `/odevler/${input.assignmentId}?aid=${input.assignmentId}`,
    data: {
      type: 'assignment_reviewed',
      status: input.status,
      assignmentId: input.assignmentId,
      at: new Date().toISOString(),
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

export async function sendAssignmentReviewPush(input: SendAssignmentReviewPushInput) {
  return sendPushToMembers([input.memberId], buildAssignmentReviewPayload(input));
}
