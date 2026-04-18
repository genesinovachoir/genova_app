alter table public.assignment_targets enable row level security;
alter table public.assignment_submissions enable row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'assignment_targets'
  loop
    execute format('drop policy if exists %I on public.assignment_targets', policy_name);
  end loop;
end
$$;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'assignment_submissions'
  loop
    execute format('drop policy if exists %I on public.assignment_submissions', policy_name);
  end loop;
end
$$;

create policy assignment_targets_select
on public.assignment_targets
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or assignment_targets.member_id = (
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
      join public.choir_members target_cm on target_cm.id = assignment_targets.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
);

create policy assignment_targets_insert
on public.assignment_targets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_targets.assignment_id
      and a.created_by = (
        select cm.id
        from public.choir_members cm
        where cm.auth_user_id = auth.uid()
        limit 1
      )
  )
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and exists (
        select 1
        from public.choir_members me
        join public.choir_members target_cm on target_cm.id = assignment_targets.member_id
        where me.auth_user_id = auth.uid()
          and me.voice_group is not null
          and target_cm.voice_group = me.voice_group
      )
    )
  )
);

create policy assignment_targets_update
on public.assignment_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_targets.assignment_id
      and a.created_by = (
        select cm.id
        from public.choir_members cm
        where cm.auth_user_id = auth.uid()
        limit 1
      )
  )
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and exists (
        select 1
        from public.choir_members me
        join public.choir_members target_cm on target_cm.id = assignment_targets.member_id
        where me.auth_user_id = auth.uid()
          and me.voice_group is not null
          and target_cm.voice_group = me.voice_group
      )
    )
  )
)
with check (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_targets.assignment_id
      and a.created_by = (
        select cm.id
        from public.choir_members cm
        where cm.auth_user_id = auth.uid()
        limit 1
      )
  )
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and exists (
        select 1
        from public.choir_members me
        join public.choir_members target_cm on target_cm.id = assignment_targets.member_id
        where me.auth_user_id = auth.uid()
          and me.voice_group is not null
          and target_cm.voice_group = me.voice_group
      )
    )
  )
);

create policy assignment_targets_delete
on public.assignment_targets
for delete
to authenticated
using (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_targets.assignment_id
      and a.created_by = (
        select cm.id
        from public.choir_members cm
        where cm.auth_user_id = auth.uid()
        limit 1
      )
  )
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and exists (
        select 1
        from public.choir_members me
        join public.choir_members target_cm on target_cm.id = assignment_targets.member_id
        where me.auth_user_id = auth.uid()
          and me.voice_group is not null
          and target_cm.voice_group = me.voice_group
      )
    )
  )
);

create policy assignment_submissions_select
on public.assignment_submissions
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or assignment_submissions.member_id = (
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
      join public.choir_members target_cm on target_cm.id = assignment_submissions.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
);

create policy assignment_submissions_insert
on public.assignment_submissions
for insert
to authenticated
with check (
  assignment_submissions.member_id = (
    select cm.id
    from public.choir_members cm
    where cm.auth_user_id = auth.uid()
    limit 1
  )
);

create policy assignment_submissions_update_review
on public.assignment_submissions
for update
to authenticated
using (
  public.current_member_has_role('Şef')
  or (
    public.current_member_has_role('Partisyon Şefi')
    and exists (
      select 1
      from public.choir_members me
      join public.choir_members target_cm on target_cm.id = assignment_submissions.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
)
with check (
  public.current_member_has_role('Şef')
  or (
    public.current_member_has_role('Partisyon Şefi')
    and exists (
      select 1
      from public.choir_members me
      join public.choir_members target_cm on target_cm.id = assignment_submissions.member_id
      where me.auth_user_id = auth.uid()
        and me.voice_group is not null
        and target_cm.voice_group = me.voice_group
    )
  )
);

create policy assignment_submissions_delete_chef
on public.assignment_submissions
for delete
to authenticated
using (
  public.current_member_has_role('Şef')
);

notify pgrst, 'reload schema';
