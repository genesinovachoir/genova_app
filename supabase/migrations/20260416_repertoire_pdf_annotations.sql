create extension if not exists pgcrypto;

create or replace function public.current_choir_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.id
  from public.choir_members cm
  where cm.auth_user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_choir_member_id() to authenticated;

create or replace function public.current_member_voice_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cm.voice_group
  from public.choir_members cm
  where cm.auth_user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_member_voice_group() to authenticated;

create or replace function public.current_member_has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.choir_member_roles cmr
    join public.roles r on r.id = cmr.role_id
    where cmr.member_id = public.current_choir_member_id()
      and r.name = role_name
  );
$$;

grant execute on function public.current_member_has_role(text) to authenticated;

create table if not exists public.repertoire_pdf_annotations (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.repertoire(id) on delete cascade,
  repertoire_file_id uuid not null references public.repertoire_files(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  layer_type text not null check (layer_type in ('personal', 'shared_voice_group', 'shared_all')),
  owner_member_id uuid null references public.choir_members(id) on delete cascade,
  target_voice_group text null check (target_voice_group is null or target_voice_group in ('Soprano', 'Alto', 'Tenor', 'Bass')),
  annotations_json jsonb not null default '[]'::jsonb,
  schema_version smallint not null default 1,
  created_by uuid null references public.choir_members(id) on delete set null default public.current_choir_member_id(),
  updated_by uuid null references public.choir_members(id) on delete set null default public.current_choir_member_id(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint repertoire_pdf_annotations_layer_shape_chk check (
    (layer_type = 'personal' and owner_member_id is not null and target_voice_group is null)
    or (layer_type = 'shared_voice_group' and owner_member_id is null and target_voice_group is not null)
    or (layer_type = 'shared_all' and owner_member_id is null and target_voice_group is null)
  ),
  constraint repertoire_pdf_annotations_annotations_array_chk check (jsonb_typeof(annotations_json) = 'array')
);

notify pgrst, 'reload schema';

grant select, insert, update, delete on table public.repertoire_pdf_annotations to authenticated;

create unique index if not exists repertoire_pdf_annotations_personal_unique_idx
  on public.repertoire_pdf_annotations (repertoire_file_id, page_number, owner_member_id)
  where layer_type = 'personal';

create unique index if not exists repertoire_pdf_annotations_shared_voice_group_unique_idx
  on public.repertoire_pdf_annotations (repertoire_file_id, page_number, target_voice_group)
  where layer_type = 'shared_voice_group';

create unique index if not exists repertoire_pdf_annotations_shared_all_unique_idx
  on public.repertoire_pdf_annotations (repertoire_file_id, page_number)
  where layer_type = 'shared_all';

create index if not exists repertoire_pdf_annotations_file_page_idx
  on public.repertoire_pdf_annotations (repertoire_file_id, page_number);

create or replace function public.set_repertoire_pdf_annotations_updated_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member uuid;
begin
  current_member := public.current_choir_member_id();

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := current_member;
  end if;

  new.updated_by := current_member;
  new.updated_at := timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists repertoire_pdf_annotations_set_updated_fields on public.repertoire_pdf_annotations;

create trigger repertoire_pdf_annotations_set_updated_fields
before insert or update on public.repertoire_pdf_annotations
for each row
execute function public.set_repertoire_pdf_annotations_updated_fields();

alter table public.repertoire_pdf_annotations enable row level security;

drop policy if exists repertoire_pdf_annotations_select_personal on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_select_personal
on public.repertoire_pdf_annotations
for select
to authenticated
using (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
);

drop policy if exists repertoire_pdf_annotations_select_shared_voice_group on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_select_shared_voice_group
on public.repertoire_pdf_annotations
for select
to authenticated
using (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role('Şef')
    or target_voice_group = public.current_member_voice_group()
  )
);

drop policy if exists repertoire_pdf_annotations_select_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_select_shared_all
on public.repertoire_pdf_annotations
for select
to authenticated
using (
  layer_type = 'shared_all'
);

drop policy if exists repertoire_pdf_annotations_insert_personal on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_insert_personal
on public.repertoire_pdf_annotations
for insert
to authenticated
with check (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
  and created_by = public.current_choir_member_id()
);

drop policy if exists repertoire_pdf_annotations_update_personal on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_update_personal
on public.repertoire_pdf_annotations
for update
to authenticated
using (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
)
with check (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
);

drop policy if exists repertoire_pdf_annotations_delete_personal on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_delete_personal
on public.repertoire_pdf_annotations
for delete
to authenticated
using (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
);

drop policy if exists repertoire_pdf_annotations_insert_shared_voice_group on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_insert_shared_voice_group
on public.repertoire_pdf_annotations
for insert
to authenticated
with check (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
);

drop policy if exists repertoire_pdf_annotations_update_shared_voice_group on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_update_shared_voice_group
on public.repertoire_pdf_annotations
for update
to authenticated
using (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
)
with check (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
);

drop policy if exists repertoire_pdf_annotations_delete_shared_voice_group on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_delete_shared_voice_group
on public.repertoire_pdf_annotations
for delete
to authenticated
using (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
);

drop policy if exists repertoire_pdf_annotations_insert_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_insert_shared_all
on public.repertoire_pdf_annotations
for insert
to authenticated
with check (
  layer_type = 'shared_all'
  and public.current_member_has_role('Şef')
);

drop policy if exists repertoire_pdf_annotations_update_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_update_shared_all
on public.repertoire_pdf_annotations
for update
to authenticated
using (
  layer_type = 'shared_all'
  and public.current_member_has_role('Şef')
)
with check (
  layer_type = 'shared_all'
  and public.current_member_has_role('Şef')
);

drop policy if exists repertoire_pdf_annotations_delete_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_delete_shared_all
on public.repertoire_pdf_annotations
for delete
to authenticated
using (
  layer_type = 'shared_all'
  and public.current_member_has_role('Şef')
);
