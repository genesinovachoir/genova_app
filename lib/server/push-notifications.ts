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

function buildPayload(input: SendProfileDecisionPushInput) {
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

function isStaleEndpointError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeStatusCode = (error as { statusCode?: number }).statusCode;
  return maybeStatusCode === 404 || maybeStatusCode === 410;
}

export async function sendProfileDecisionPush(input: SendProfileDecisionPushInput) {
  if (!ensureVapidConfigured()) {
    return { sent: 0, skipped: true };
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: subscriptions, error } = await serviceClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('member_id', input.memberId);

  if (error || !subscriptions || subscriptions.length === 0) {
    return { sent: 0, skipped: false };
  }

  const payload = JSON.stringify(buildPayload(input));
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
