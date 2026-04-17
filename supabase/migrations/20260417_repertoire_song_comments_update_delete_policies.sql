grant update, delete on table public.repertoire_song_comments to authenticated;

drop policy if exists repertoire_song_comments_update on public.repertoire_song_comments;
create policy repertoire_song_comments_update
on public.repertoire_song_comments
for update
to authenticated
using (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or public.current_member_has_role('Partisyon Şefi')
  )
)
with check (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or public.current_member_has_role('Partisyon Şefi')
  )
);

drop policy if exists repertoire_song_comments_delete on public.repertoire_song_comments;
create policy repertoire_song_comments_delete
on public.repertoire_song_comments
for delete
to authenticated
using (
  (
    created_by = public.current_choir_member_id()
    and (
      public.current_member_has_role('Şef')
      or public.current_member_has_role('Partisyon Şefi')
    )
  )
  or public.current_member_has_role('Şef')
);
