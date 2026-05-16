import { NextResponse } from 'next/server';

import { createSupabaseServiceClient, requireAuthenticatedUser } from '@/lib/server/supabase-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AttendanceStatus = 'pending' | 'approved' | 'rejected';

interface RehearsalInviteeRow {
  rehearsal_id: string;
  member_id: string;
}

interface AttendanceRow {
  id: string;
  rehearsal_id: string;
  member_id: string;
  status: AttendanceStatus;
  checked_in_at: string | null;
}

function getTodayInIstanbul() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export async function POST(request: Request) {
  try {
    await requireAuthenticatedUser(request);

    const serviceClient = createSupabaseServiceClient();
    const today = getTodayInIstanbul();
    const now = new Date().toISOString();

    const { data: rehearsals, error: rehearsalError } = await serviceClient
      .from('rehearsals')
      .select('id')
      .eq('collect_attendance', true)
      .lt('date', today);

    if (rehearsalError) {
      return new NextResponse(rehearsalError.message, { status: 500 });
    }

    const rehearsalIds = (rehearsals ?? []).map((rehearsal) => rehearsal.id).filter(Boolean);
    if (rehearsalIds.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, updated: 0 });
    }

    const [{ data: inviteeRows, error: inviteeError }, { data: attendanceRows, error: attendanceError }] =
      await Promise.all([
        serviceClient
          .from('rehearsal_invitees')
          .select('rehearsal_id, member_id')
          .in('rehearsal_id', rehearsalIds),
        serviceClient
          .from('attendance')
          .select('id, rehearsal_id, member_id, status, checked_in_at')
          .in('rehearsal_id', rehearsalIds),
      ]);

    if (inviteeError) {
      return new NextResponse(inviteeError.message, { status: 500 });
    }
    if (attendanceError) {
      return new NextResponse(attendanceError.message, { status: 500 });
    }

    const attendanceByInvitee = new Map(
      ((attendanceRows ?? []) as AttendanceRow[]).map((attendance) => [
        `${attendance.rehearsal_id}:${attendance.member_id}`,
        attendance,
      ]),
    );

    const pendingAttendanceIds: string[] = [];
    const missingAttendances: Array<{
      rehearsal_id: string;
      member_id: string;
      status: AttendanceStatus;
      checked_in_at: string;
      approved_at: string;
      approved_by: null;
    }> = [];

    for (const invitee of (inviteeRows ?? []) as RehearsalInviteeRow[]) {
      const existingAttendance = attendanceByInvitee.get(`${invitee.rehearsal_id}:${invitee.member_id}`);
      if (!existingAttendance) {
        missingAttendances.push({
          rehearsal_id: invitee.rehearsal_id,
          member_id: invitee.member_id,
          status: 'rejected',
          checked_in_at: now,
          approved_at: now,
          approved_by: null,
        });
        continue;
      }

      if (existingAttendance.status === 'pending') {
        pendingAttendanceIds.push(existingAttendance.id);
      }
    }

    if (pendingAttendanceIds.length > 0) {
      const { error: updateError } = await serviceClient
        .from('attendance')
        .update({
          status: 'rejected',
          approved_at: now,
          approved_by: null,
        })
        .in('id', pendingAttendanceIds);

      if (updateError) {
        return new NextResponse(updateError.message, { status: 500 });
      }
    }

    if (missingAttendances.length > 0) {
      const { error: insertError } = await serviceClient
        .from('attendance')
        .upsert(missingAttendances, { onConflict: 'rehearsal_id,member_id' });

      if (insertError) {
        return new NextResponse(insertError.message, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: missingAttendances.length,
      updated: pendingAttendanceIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new NextResponse(message, { status });
  }
}
