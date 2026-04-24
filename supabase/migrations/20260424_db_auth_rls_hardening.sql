-- Security hardening for client-authenticated write paths.
-- Goal:
-- 1) Enforce strict insert shape for profile change requests.
-- 2) Block direct authenticated writes on API-only tables.
-- 3) Enforce chef-only writes for repertoire and song assignments.

alter table if exists public.profile_change_requests enable row level security;
alter table if exists public.assignments enable row level security;
alter table if exists public.assignment_targets enable row level security;
alter table if exists public.assignment_submissions enable row level security;
alter table if exists public.announcements enable row level security;
alter table if exists public.rehearsals enable row level security;
alter table if exists public.rehearsal_invitees enable row level security;
alter table if exists public.repertoire enable row level security;
alter table if exists public.repertoire_tags enable row level security;
alter table if exists public.song_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- profile_change_requests: authenticated users can only create their own
-- pending request with allowlisted keys.
-- ---------------------------------------------------------------------------
drop policy if exists profile_change_requests_insert_guard on public.profile_change_requests;

create policy profile_change_requests_insert_guard
on public.profile_change_requests
as restrictive
for insert
to authenticated
with check (
  member_id = (
    select cm.id
    from public.choir_members cm
    where cm.auth_user_id = auth.uid()
    limit 1
  )
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and reject_reason is null
  and jsonb_typeof(changes_json) = 'object'
  and changes_json <> '{}'::jsonb
  and (
    changes_json - array[
      'email',
      'phone',
      'birth_date',
      'school_id',
      'department_id',
      'linkedin_url',
      'instagram_url',
      'youtube_url',
      'spotify_url',
      'photo_url'
    ]::text[]
  ) = '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- API-only tables: block authenticated direct writes (service role still works).
-- ---------------------------------------------------------------------------

drop policy if exists assignments_block_authenticated_insert on public.assignments;
drop policy if exists assignments_block_authenticated_update on public.assignments;
drop policy if exists assignments_block_authenticated_delete on public.assignments;

create policy assignments_block_authenticated_insert
on public.assignments
as restrictive
for insert
to authenticated
with check (false);

create policy assignments_block_authenticated_update
on public.assignments
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy assignments_block_authenticated_delete
on public.assignments
as restrictive
for delete
to authenticated
using (false);

drop policy if exists assignment_targets_block_authenticated_insert on public.assignment_targets;
drop policy if exists assignment_targets_block_authenticated_update on public.assignment_targets;
drop policy if exists assignment_targets_block_authenticated_delete on public.assignment_targets;

create policy assignment_targets_block_authenticated_insert
on public.assignment_targets
as restrictive
for insert
to authenticated
with check (false);

create policy assignment_targets_block_authenticated_update
on public.assignment_targets
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy assignment_targets_block_authenticated_delete
on public.assignment_targets
as restrictive
for delete
to authenticated
using (false);

drop policy if exists assignment_submissions_block_authenticated_insert on public.assignment_submissions;
drop policy if exists assignment_submissions_block_authenticated_update on public.assignment_submissions;
drop policy if exists assignment_submissions_block_authenticated_delete on public.assignment_submissions;

create policy assignment_submissions_block_authenticated_insert
on public.assignment_submissions
as restrictive
for insert
to authenticated
with check (false);

create policy assignment_submissions_block_authenticated_update
on public.assignment_submissions
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy assignment_submissions_block_authenticated_delete
on public.assignment_submissions
as restrictive
for delete
to authenticated
using (false);

drop policy if exists announcements_block_authenticated_insert on public.announcements;
drop policy if exists announcements_block_authenticated_update on public.announcements;
drop policy if exists announcements_block_authenticated_delete on public.announcements;

create policy announcements_block_authenticated_insert
on public.announcements
as restrictive
for insert
to authenticated
with check (false);

create policy announcements_block_authenticated_update
on public.announcements
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy announcements_block_authenticated_delete
on public.announcements
as restrictive
for delete
to authenticated
using (false);

drop policy if exists rehearsals_block_authenticated_insert on public.rehearsals;
drop policy if exists rehearsals_block_authenticated_update on public.rehearsals;
drop policy if exists rehearsals_block_authenticated_delete on public.rehearsals;

create policy rehearsals_block_authenticated_insert
on public.rehearsals
as restrictive
for insert
to authenticated
with check (false);

create policy rehearsals_block_authenticated_update
on public.rehearsals
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy rehearsals_block_authenticated_delete
on public.rehearsals
as restrictive
for delete
to authenticated
using (false);

drop policy if exists rehearsal_invitees_block_authenticated_insert on public.rehearsal_invitees;
drop policy if exists rehearsal_invitees_block_authenticated_update on public.rehearsal_invitees;
drop policy if exists rehearsal_invitees_block_authenticated_delete on public.rehearsal_invitees;

create policy rehearsal_invitees_block_authenticated_insert
on public.rehearsal_invitees
as restrictive
for insert
to authenticated
with check (false);

create policy rehearsal_invitees_block_authenticated_update
on public.rehearsal_invitees
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy rehearsal_invitees_block_authenticated_delete
on public.rehearsal_invitees
as restrictive
for delete
to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- repertoire: allow chef writes explicitly and guard against broader policies.
-- ---------------------------------------------------------------------------
drop policy if exists repertoire_insert_chef on public.repertoire;
drop policy if exists repertoire_update_chef on public.repertoire;
drop policy if exists repertoire_delete_chef on public.repertoire;
drop policy if exists repertoire_insert_chef_guard on public.repertoire;
drop policy if exists repertoire_update_chef_guard on public.repertoire;
drop policy if exists repertoire_delete_chef_guard on public.repertoire;

create policy repertoire_insert_chef
on public.repertoire
for insert
to authenticated
with check (public.current_member_has_role('Şef'));

create policy repertoire_update_chef
on public.repertoire
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

create policy repertoire_delete_chef
on public.repertoire
for delete
to authenticated
using (public.current_member_has_role('Şef'));

create policy repertoire_insert_chef_guard
on public.repertoire
as restrictive
for insert
to authenticated
with check (public.current_member_has_role('Şef'));

create policy repertoire_update_chef_guard
on public.repertoire
as restrictive
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

create policy repertoire_delete_chef_guard
on public.repertoire
as restrictive
for delete
to authenticated
using (public.current_member_has_role('Şef'));

-- ---------------------------------------------------------------------------
-- repertoire_tags: add missing update policy for chef.
-- ---------------------------------------------------------------------------
drop policy if exists repertoire_tags_update on public.repertoire_tags;

create policy repertoire_tags_update
on public.repertoire_tags
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

-- ---------------------------------------------------------------------------
-- song_assignments: keep read access for chef/partisyon şefi/self;
-- enforce chef-only writes.
-- ---------------------------------------------------------------------------
drop policy if exists song_assignments_select_access on public.song_assignments;
drop policy if exists song_assignments_insert_chef on public.song_assignments;
drop policy if exists song_assignments_update_chef on public.song_assignments;
drop policy if exists song_assignments_delete_chef on public.song_assignments;
drop policy if exists song_assignments_insert_chef_guard on public.song_assignments;
drop policy if exists song_assignments_update_chef_guard on public.song_assignments;
drop policy if exists song_assignments_delete_chef_guard on public.song_assignments;

create policy song_assignments_select_access
on public.song_assignments
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or public.current_member_has_role('Partisyon Şefi')
  or song_assignments.member_id = (
    select cm.id
    from public.choir_members cm
    where cm.auth_user_id = auth.uid()
    limit 1
  )
);

create policy song_assignments_insert_chef
on public.song_assignments
for insert
to authenticated
with check (public.current_member_has_role('Şef'));

create policy song_assignments_update_chef
on public.song_assignments
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

create policy song_assignments_delete_chef
on public.song_assignments
for delete
to authenticated
using (public.current_member_has_role('Şef'));

create policy song_assignments_insert_chef_guard
on public.song_assignments
as restrictive
for insert
to authenticated
with check (public.current_member_has_role('Şef'));

create policy song_assignments_update_chef_guard
on public.song_assignments
as restrictive
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

create policy song_assignments_delete_chef_guard
on public.song_assignments
as restrictive
for delete
to authenticated
using (public.current_member_has_role('Şef'));

notify pgrst, 'reload schema';
