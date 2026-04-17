alter table public.repertoire enable row level security;

drop policy if exists "Chorists see assigned visible songs" on public.repertoire;
drop policy if exists repertoire_select_assigned_visible on public.repertoire;
drop policy if exists repertoire_select_chef on public.repertoire;

create policy repertoire_select_chef
on public.repertoire
for select
to authenticated
using (
  exists (
    select 1
    from public.choir_members cm
    join public.choir_member_roles cmr on cmr.member_id = cm.id
    join public.roles r on r.id = cmr.role_id
    where cm.auth_user_id = auth.uid()
      and r.name = 'Şef'
  )
);

create policy repertoire_select_assigned_visible
on public.repertoire
for select
to authenticated
using (
  is_visible = true
  and exists (
    select 1
    from public.song_assignments sa
    join public.choir_members cm on cm.id = sa.member_id
    where sa.song_id = repertoire.id
      and cm.auth_user_id = auth.uid()
  )
);

notify pgrst, 'reload schema';
