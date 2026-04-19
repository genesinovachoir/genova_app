create table if not exists public.assignment_submission_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  member_id uuid not null references public.choir_members(id) on delete cascade,
  source_submission_id uuid references public.assignment_submissions(id) on delete set null,
  drive_file_id text,
  drive_web_view_link text,
  drive_download_link text,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  drive_member_folder_id text,
  submitted_at timestamptz not null,
  updated_at timestamptz,
  status text,
  submission_note text,
  reviewer_note text,
  approved_at timestamptz,
  approved_by uuid references public.choir_members(id) on delete set null,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'resubmitted' check (archive_reason in ('resubmitted', 'deleted', 'migrated'))
);

create index if not exists idx_assignment_submission_history_assignment_member_time
  on public.assignment_submission_history (assignment_id, member_id, archived_at desc);

create index if not exists idx_assignment_submission_history_source_submission
  on public.assignment_submission_history (source_submission_id);

alter table public.assignment_submission_history enable row level security;

drop policy if exists assignment_submission_history_select on public.assignment_submission_history;
create policy assignment_submission_history_select
on public.assignment_submission_history
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or assignment_submission_history.member_id = (
    select cm.id
    from public.choir_members cm
    where cm.auth_user_id = auth.uid()
    limit 1
  )
  or (
    public.current_member_has_role('Partisyon Şefi')
    and exists (
      select 1
      from public.choir_members me
      join public.choir_members target_cm on target_cm.id = assignment_submission_history.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
);

notify pgrst, 'reload schema';
