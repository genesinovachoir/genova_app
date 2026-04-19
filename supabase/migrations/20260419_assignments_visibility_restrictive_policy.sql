alter table public.assignments enable row level security;

create or replace function public.can_current_member_access_assignment_for_read(
  p_assignment_id uuid,
  p_assignment_creator_id uuid,
  p_assignment_target_voice_group text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
with me as (
  select cm.id, cm.voice_group
  from public.choir_members cm
  where cm.auth_user_id = auth.uid()
  limit 1
),
has_targets as (
  select exists (
    select 1
    from public.assignment_targets at
    where at.assignment_id = p_assignment_id
  ) as value
)
select
  public.current_member_has_role('Şef')
  or (
    exists (select 1 from me)
    and (
      p_assignment_creator_id = (select me.id from me)
      or (
        (select value from has_targets)
        and (
          exists (
            select 1
            from public.assignment_targets at
            where at.assignment_id = p_assignment_id
              and at.member_id = (select me.id from me)
          )
          or (
            public.current_member_has_role('Partisyon Şefi')
            and (select me.voice_group from me) is not null
            and exists (
              select 1
              from public.assignment_targets at
              join public.choir_members target_cm on target_cm.id = at.member_id
              where at.assignment_id = p_assignment_id
                and target_cm.voice_group = (select me.voice_group from me)
            )
          )
        )
      )
      or (
        not (select value from has_targets)
        and (
          p_assignment_target_voice_group is null
          or btrim(p_assignment_target_voice_group) = ''
          or (
            (select me.voice_group from me) is not null
            and (select me.voice_group from me) = p_assignment_target_voice_group
          )
        )
      )
    )
  );
$$;

revoke all on function public.can_current_member_access_assignment_for_read(uuid, uuid, text) from public;
grant execute on function public.can_current_member_access_assignment_for_read(uuid, uuid, text) to authenticated;

drop policy if exists assignments_select_targeted_restrictive on public.assignments;

create policy assignments_select_targeted_restrictive
on public.assignments
as restrictive
for select
to authenticated
using (
  public.can_current_member_access_assignment_for_read(
    assignments.id,
    assignments.created_by,
    assignments.target_voice_group
  )
);
