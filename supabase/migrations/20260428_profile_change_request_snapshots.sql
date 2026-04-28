-- Store old profile values with each change request and route new submissions
-- through the API so pending-request merging rules cannot be bypassed.

alter table if exists public.profile_change_requests
  add column if not exists previous_values_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_change_requests_previous_values_object'
      and conrelid = 'public.profile_change_requests'::regclass
  ) then
    alter table public.profile_change_requests
      add constraint profile_change_requests_previous_values_object
      check (jsonb_typeof(previous_values_json) = 'object');
  end if;
end $$;

drop policy if exists member_insert_own on public.profile_change_requests;
drop policy if exists profile_change_requests_insert_guard on public.profile_change_requests;
drop policy if exists profile_change_requests_block_direct_insert on public.profile_change_requests;

create policy profile_change_requests_block_direct_insert
on public.profile_change_requests
as restrictive
for insert
to authenticated
with check (false);
