import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PushSubscriptionBody {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as PushSubscriptionBody;

    const endpoint = body.endpoint?.trim();
    const p256dh = body.keys?.p256dh?.trim();
    const auth = body.keys?.auth?.trim();

    if (!endpoint || !p256dh || !auth) {
      return new NextResponse('Geçersiz PushSubscription payload.', { status: 400 });
    }

    const serviceClient = createSupabaseServiceClient();
    const { data: member, error: memberError } = await serviceClient
      .from('choir_members')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (memberError) {
      return new NextResponse(memberError.message, { status: 500 });
    }

    if (!member) {
      return new NextResponse('Choir member kaydı bulunamadı.', { status: 404 });
    }

    const payload = {
      member_id: member.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get('user-agent') ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('push_subscriptions')
      .upsert(payload, { onConflict: 'endpoint' });

    if (upsertError) {
      return new NextResponse(upsertError.message, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
