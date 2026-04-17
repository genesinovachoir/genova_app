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
      and (
        r.name = role_name
        or (
          role_name in ('Şef', 'Åef', 'Sef')
          and r.name in ('Şef', 'Åef', 'Sef')
        )
        or (
          role_name in ('Partisyon Şefi', 'Partisyon Åefi', 'Partisyon Sefi')
          and r.name in ('Partisyon Şefi', 'Partisyon Åefi', 'Partisyon Sefi')
        )
      )
  );
$$;

grant execute on function public.current_member_has_role(text) to authenticated;
grant select, insert, update, delete on table public.repertoire_pdf_annotations to authenticated;

drop policy if exists repertoire_pdf_annotations_insert_personal on public.repertoire_pdf_annotations;
create policy repertoire_pdf_annotations_insert_personal
on public.repertoire_pdf_annotations
for insert
to authenticated
with check (
  layer_type = 'personal'
  and owner_member_id = public.current_choir_member_id()
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

notify pgrst, 'reload schema';
