alter table public.repertoire_song_comments
  add column if not exists target_voice_group text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'repertoire_song_comments_target_voice_group_chk'
      and conrelid = 'public.repertoire_song_comments'::regclass
  ) then
    alter table public.repertoire_song_comments
      add constraint repertoire_song_comments_target_voice_group_chk
      check (
        target_voice_group is null
        or target_voice_group in ('Soprano', 'Alto', 'Tenor', 'Bass')
      );
  end if;
end;
$$;

create index if not exists repertoire_song_comments_song_target_created_idx
  on public.repertoire_song_comments (song_id, target_voice_group, created_at desc);

drop policy if exists repertoire_song_comments_select on public.repertoire_song_comments;
create policy repertoire_song_comments_select
on public.repertoire_song_comments
for select
to authenticated
using (
  public.current_member_has_role('Şef')
  or target_voice_group is null
  or target_voice_group = public.current_member_voice_group()
);

drop policy if exists repertoire_song_comments_insert on public.repertoire_song_comments;
create policy repertoire_song_comments_insert
on public.repertoire_song_comments
for insert
to authenticated
with check (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
);

drop policy if exists repertoire_song_comments_update on public.repertoire_song_comments;
create policy repertoire_song_comments_update
on public.repertoire_song_comments
for update
to authenticated
using (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
)
with check (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or (
      public.current_member_has_role('Partisyon Şefi')
      and target_voice_group = public.current_member_voice_group()
    )
  )
);

notify pgrst, 'reload schema';
