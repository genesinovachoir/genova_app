import { createSupabaseServiceClient } from './supabase-auth';

interface InsertAssignmentAuditLogInput {
  assignmentId: string;
  eventType: string;
  submissionId?: string | null;
  memberId?: string | null;
  actorMemberId?: string | null;
  payload?: Record<string, unknown>;
}

export async function insertAssignmentAuditLog(
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  input: InsertAssignmentAuditLogInput,
) {
  const { error } = await serviceClient
    .from('assignment_submission_audit_logs')
    .insert({
      assignment_id: input.assignmentId,
      submission_id: input.submissionId ?? null,
      member_id: input.memberId ?? null,
      actor_member_id: input.actorMemberId ?? null,
      event_type: input.eventType,
      event_payload: input.payload ?? {},
    });

  if (error) {
    throw new Error(error.message);
  }
}
