create table if not exists public.repertoire_song_comments (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.repertoire(id) on delete cascade,
  content_html text not null,
  created_by uuid not null references public.choir_members(id) on delete cascade default public.current_choir_member_id(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint repertoire_song_comments_content_chk check (
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
  )
);

notify pgrst, 'reload schema';

grant select, insert on table public.repertoire_song_comments to authenticated;

create index if not exists repertoire_song_comments_song_created_idx
  on public.repertoire_song_comments (song_id, created_at desc);

create or replace function public.set_repertoire_song_comments_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists repertoire_song_comments_set_updated_at on public.repertoire_song_comments;

create trigger repertoire_song_comments_set_updated_at
before update on public.repertoire_song_comments
for each row
execute function public.set_repertoire_song_comments_updated_at();

alter table public.repertoire_song_comments enable row level security;

drop policy if exists repertoire_song_comments_select on public.repertoire_song_comments;
create policy repertoire_song_comments_select
on public.repertoire_song_comments
for select
to authenticated
using (true);

drop policy if exists repertoire_song_comments_insert on public.repertoire_song_comments;
create policy repertoire_song_comments_insert
on public.repertoire_song_comments
for insert
to authenticated
with check (
  created_by = public.current_choir_member_id()
  and (
    public.current_member_has_role('Şef')
    or public.current_member_has_role('Partisyon Şefi')
  )
);
