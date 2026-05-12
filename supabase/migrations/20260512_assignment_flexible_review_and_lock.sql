-- Flexible assignment review workflow + lock + auditable edits

alter table if exists public.assignments
  add column if not exists is_locked boolean not null default false,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.choir_members(id) on delete set null;

alter table if exists public.assignment_submissions
  add column if not exists is_reviewer_note_hidden boolean not null default false,
  add column if not exists reviewer_note_history jsonb not null default '[]'::jsonb,
  add column if not exists submission_note_history jsonb not null default '[]'::jsonb,
  add column if not exists hidden_by uuid references public.choir_members(id) on delete set null,
  add column if not exists hidden_at timestamptz;

update public.assignment_submissions
set reviewer_note_history = case
  when coalesce(reviewer_note, '') <> '' and coalesce(jsonb_array_length(reviewer_note_history), 0) = 0 then
    jsonb_build_array(
      jsonb_build_object(
        'action', 'seed',
        'changed_at', coalesce(approved_at, updated_at, submitted_at),
        'changed_by', approved_by,
        'previous_note_length', 0,
        'next_note_length', char_length(reviewer_note)
      )
    )
  else reviewer_note_history
end,
submission_note_history = case
  when coalesce(submission_note, '') <> '' and coalesce(jsonb_array_length(submission_note_history), 0) = 0 then
    jsonb_build_array(
      jsonb_build_object(
        'action', 'seed',
        'changed_at', coalesce(updated_at, submitted_at),
        'changed_by', member_id,
        'previous_note', null,
        'next_note', submission_note
      )
    )
  else submission_note_history
end;

create table if not exists public.assignment_submission_private_notes (
  submission_id uuid primary key references public.assignment_submissions(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  member_id uuid not null references public.choir_members(id) on delete cascade,
  reviewer_note text,
  note_history_json jsonb not null default '[]'::jsonb,
  is_hidden boolean not null default false,
  last_hidden_by uuid references public.choir_members(id) on delete set null,
  last_hidden_at timestamptz,
  last_updated_by uuid references public.choir_members(id) on delete set null,
  last_updated_at timestamptz not null default now()
);

create index if not exists idx_assignment_submission_private_notes_assignment_member
  on public.assignment_submission_private_notes (assignment_id, member_id);

insert into public.assignment_submission_private_notes (
  submission_id,
  assignment_id,
  member_id,
  reviewer_note,
  note_history_json,
  is_hidden,
  last_updated_by,
  last_updated_at
)
select
  s.id,
  s.assignment_id,
  s.member_id,
  s.reviewer_note,
  case
    when coalesce(s.reviewer_note, '') <> '' then
      jsonb_build_array(
        jsonb_build_object(
          'action', 'seed',
          'changed_at', coalesce(s.approved_at, s.updated_at, s.submitted_at),
          'changed_by', s.approved_by,
          'previous_note', null,
          'next_note', s.reviewer_note
        )
      )
    else '[]'::jsonb
  end,
  s.is_reviewer_note_hidden,
  s.approved_by,
  coalesce(s.approved_at, s.updated_at, s.submitted_at)
from public.assignment_submissions s
on conflict (submission_id) do nothing;

alter table public.assignment_submission_private_notes enable row level security;

drop policy if exists assignment_submission_private_notes_select on public.assignment_submission_private_notes;
create policy assignment_submission_private_notes_select
on public.assignment_submission_private_notes
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or (
    public.current_member_has_role('Partisyon Şefi')
    and exists (
      select 1
      from public.choir_members me
      join public.choir_members target_cm on target_cm.id = assignment_submission_private_notes.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
);

drop policy if exists assignment_submission_private_notes_block_authenticated_insert on public.assignment_submission_private_notes;
drop policy if exists assignment_submission_private_notes_block_authenticated_update on public.assignment_submission_private_notes;
drop policy if exists assignment_submission_private_notes_block_authenticated_delete on public.assignment_submission_private_notes;

create policy assignment_submission_private_notes_block_authenticated_insert
on public.assignment_submission_private_notes
as restrictive
for insert
to authenticated
with check (false);

create policy assignment_submission_private_notes_block_authenticated_update
on public.assignment_submission_private_notes
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy assignment_submission_private_notes_block_authenticated_delete
on public.assignment_submission_private_notes
as restrictive
for delete
to authenticated
using (false);

create table if not exists public.assignment_submission_audit_logs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  submission_id uuid references public.assignment_submissions(id) on delete set null,
  member_id uuid references public.choir_members(id) on delete set null,
  actor_member_id uuid references public.choir_members(id) on delete set null,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_assignment_submission_audit_logs_assignment_created
  on public.assignment_submission_audit_logs (assignment_id, created_at desc);

create index if not exists idx_assignment_submission_audit_logs_member_created
  on public.assignment_submission_audit_logs (member_id, created_at desc);

alter table public.assignment_submission_audit_logs enable row level security;

drop policy if exists assignment_submission_audit_logs_select on public.assignment_submission_audit_logs;
create policy assignment_submission_audit_logs_select
on public.assignment_submission_audit_logs
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or (
    assignment_submission_audit_logs.member_id is not null
    and assignment_submission_audit_logs.member_id = (
      select cm.id
      from public.choir_members cm
      where cm.auth_user_id = auth.uid()
      limit 1
    )
  )
  or (
    assignment_submission_audit_logs.member_id is null
    and exists (
      select 1
      from public.assignment_targets at
      join public.choir_members cm on cm.id = at.member_id
      where at.assignment_id = assignment_submission_audit_logs.assignment_id
        and cm.auth_user_id = auth.uid()
    )
  )
  or (
    public.current_member_has_role('Partisyon Şefi')
    and (
      (
        assignment_submission_audit_logs.member_id is not null
        and exists (
          select 1
          from public.choir_members me
          join public.choir_members target_cm on target_cm.id = assignment_submission_audit_logs.member_id
          where me.auth_user_id = auth.uid()
            and me.voice_group is not null
            and target_cm.voice_group = me.voice_group
        )
      )
      or (
        assignment_submission_audit_logs.member_id is null
        and exists (
          select 1
          from public.assignment_targets at
          join public.choir_members me on me.auth_user_id = auth.uid()
          join public.choir_members target_cm on target_cm.id = at.member_id
          where at.assignment_id = assignment_submission_audit_logs.assignment_id
            and me.voice_group is not null
            and target_cm.voice_group = me.voice_group
        )
      )
    )
  )
);

drop policy if exists assignment_submission_audit_logs_block_authenticated_insert on public.assignment_submission_audit_logs;
drop policy if exists assignment_submission_audit_logs_block_authenticated_update on public.assignment_submission_audit_logs;
drop policy if exists assignment_submission_audit_logs_block_authenticated_delete on public.assignment_submission_audit_logs;

create policy assignment_submission_audit_logs_block_authenticated_insert
on public.assignment_submission_audit_logs
as restrictive
for insert
to authenticated
with check (false);

create policy assignment_submission_audit_logs_block_authenticated_update
on public.assignment_submission_audit_logs
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy assignment_submission_audit_logs_block_authenticated_delete
on public.assignment_submission_audit_logs
as restrictive
for delete
to authenticated
using (false);

notify pgrst, 'reload schema';
