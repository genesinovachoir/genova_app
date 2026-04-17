alter table public.choir_members enable row level security;

drop policy if exists public_read_active_members on public.choir_members;
drop policy if exists read_choir_members on public.choir_members;

create policy read_choir_members
on public.choir_members
for select
to authenticated
using (
  is_active = true
  or auth_user_id = auth.uid()
);

notify pgrst, 'reload schema';
