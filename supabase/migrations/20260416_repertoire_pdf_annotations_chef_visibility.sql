create or replace function public.current_member_has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with role_aliases(value) as (
    select role_name
    union
    select chr(350) || 'ef'
    where role_name in (chr(350) || 'ef', 'Sef', convert_from(decode('c385c29e6566', 'hex'), 'UTF8'))
    union
    select 'Sef'
    where role_name in (chr(350) || 'ef', 'Sef', convert_from(decode('c385c29e6566', 'hex'), 'UTF8'))
    union
    select convert_from(decode('c385c29e6566', 'hex'), 'UTF8')
    where role_name in (chr(350) || 'ef', 'Sef', convert_from(decode('c385c29e6566', 'hex'), 'UTF8'))
    union
    select 'Partisyon ' || chr(350) || 'efi'
    where role_name in (
      'Partisyon ' || chr(350) || 'efi',
      'Partisyon Sefi',
      'Partisyon ' || convert_from(decode('c385c29e6566', 'hex'), 'UTF8') || 'i'
    )
    union
    select 'Partisyon Sefi'
    where role_name in (
      'Partisyon ' || chr(350) || 'efi',
      'Partisyon Sefi',
      'Partisyon ' || convert_from(decode('c385c29e6566', 'hex'), 'UTF8') || 'i'
    )
    union
    select 'Partisyon ' || convert_from(decode('c385c29e6566', 'hex'), 'UTF8') || 'i'
    where role_name in (
      'Partisyon ' || chr(350) || 'efi',
      'Partisyon Sefi',
      'Partisyon ' || convert_from(decode('c385c29e6566', 'hex'), 'UTF8') || 'i'
    )
  )
  select exists (
    select 1
    from public.choir_member_roles cmr
    join public.roles r on r.id = cmr.role_id
    where cmr.member_id = public.current_choir_member_id()
      and r.name in (select value from role_aliases)
  );
$$;

grant execute on function public.current_member_has_role(text) to authenticated;
grant select, insert, update, delete on table public.repertoire_pdf_annotations to authenticated;

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
    public.current_member_has_role(chr(350) || 'ef')
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

drop policy if exists repertoire_pdf_annotations_insert_shared_voice_group on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_insert_shared_voice_group
on public.repertoire_pdf_annotations
for insert
to authenticated
with check (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role(chr(350) || 'ef')
    or (
      public.current_member_has_role('Partisyon ' || chr(350) || 'efi')
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
    public.current_member_has_role(chr(350) || 'ef')
    or (
      public.current_member_has_role('Partisyon ' || chr(350) || 'efi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
)
with check (
  layer_type = 'shared_voice_group'
  and (
    public.current_member_has_role(chr(350) || 'ef')
    or (
      public.current_member_has_role('Partisyon ' || chr(350) || 'efi')
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
    public.current_member_has_role(chr(350) || 'ef')
    or (
      public.current_member_has_role('Partisyon ' || chr(350) || 'efi')
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
  and public.current_member_has_role(chr(350) || 'ef')
);

drop policy if exists repertoire_pdf_annotations_update_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_update_shared_all
on public.repertoire_pdf_annotations
for update
to authenticated
using (
  layer_type = 'shared_all'
  and public.current_member_has_role(chr(350) || 'ef')
)
with check (
  layer_type = 'shared_all'
  and public.current_member_has_role(chr(350) || 'ef')
);

drop policy if exists repertoire_pdf_annotations_delete_shared_all on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_delete_shared_all
on public.repertoire_pdf_annotations
for delete
to authenticated
using (
  layer_type = 'shared_all'
  and public.current_member_has_role(chr(350) || 'ef')
);

notify pgrst, 'reload schema';
