-- Catch-up migration for partial execution of 20260424_db_auth_rls_hardening.sql
-- Safe to run multiple times.

alter table if exists public.assignment_targets enable row level security;
alter table if exists public.assignment_submissions enable row level security;
alter table if exists public.announcements enable row level security;
alter table if exists public.rehearsals enable row level security;
alter table if exists public.rehearsal_invitees enable row level security;
alter table if exists public.repertoire enable row level security;
alter table if exists public.repertoire_tags enable row level security;
alter table if exists public.song_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- assignment_targets (authenticated direct write block)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- assignment_submissions (authenticated direct write block)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- announcements (authenticated direct write block)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- rehearsals + rehearsal_invitees (authenticated direct write block)
-- ---------------------------------------------------------------------------
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
-- repertoire: chef-only writes + restrictive guards
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
-- repertoire_tags: chef-only update
-- ---------------------------------------------------------------------------
drop policy if exists repertoire_tags_update on public.repertoire_tags;

create policy repertoire_tags_update
on public.repertoire_tags
for update
to authenticated
using (public.current_member_has_role('Şef'))
with check (public.current_member_has_role('Şef'));

-- ---------------------------------------------------------------------------
-- song_assignments: read access + chef-only writes
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
