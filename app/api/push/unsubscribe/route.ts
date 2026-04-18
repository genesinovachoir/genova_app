import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UnsubscribeBody {
  endpoint?: string;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request);
    const body = (await request.json()) as UnsubscribeBody;
    const endpoint = body.endpoint?.trim();

    if (!endpoint) {
      return new NextResponse('endpoint zorunlu.', { status: 400 });
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
      return NextResponse.json({ ok: true });
    }

    const { error: deleteError } = await serviceClient
      .from('push_subscriptions')
      .delete()
      .eq('member_id', member.id)
      .eq('endpoint', endpoint);

    if (deleteError) {
      return new NextResponse(deleteError.message, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
