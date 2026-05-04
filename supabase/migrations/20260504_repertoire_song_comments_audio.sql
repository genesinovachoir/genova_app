alter table public.repertoire_song_comments
  add column if not exists audio_drive_file_id text null,
  add column if not exists audio_file_name text null,
  add column if not exists audio_mime_type text null,
  add column if not exists audio_file_size_bytes bigint null;

alter table public.repertoire_song_comments
  drop constraint if exists repertoire_song_comments_content_chk;

alter table public.repertoire_song_comments
  add constraint repertoire_song_comments_content_chk check (
    length(
      btrim(
        regexp_replace(
          replace(content_html, '&nbsp;', ' '),
          '<[^>]*>',
          '',
          'g'
        )
      )
    ) > 0
    or position('<img' in lower(content_html)) > 0
    or audio_drive_file_id is not null
  );

alter table public.repertoire_song_comments
  drop constraint if exists repertoire_song_comments_audio_fields_chk;

alter table public.repertoire_song_comments
  add constraint repertoire_song_comments_audio_fields_chk check (
    (
      audio_drive_file_id is null
      and audio_file_name is null
      and audio_mime_type is null
      and audio_file_size_bytes is null
    )
    or (
      audio_drive_file_id is not null
      and audio_file_name is not null
      and length(btrim(audio_file_name)) > 0
    )
  );

create index if not exists repertoire_song_comments_audio_drive_file_id_idx
  on public.repertoire_song_comments (audio_drive_file_id)
  where audio_drive_file_id is not null;

notify pgrst, 'reload schema';
