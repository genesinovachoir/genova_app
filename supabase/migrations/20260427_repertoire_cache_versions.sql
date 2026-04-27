-- Repertuvar katalog cache invalidation marker.
-- Clients read this single row before deciding whether local metadata is fresh.

create table if not exists public.repertoire_cache_versions (
  scope text primary key,
  version bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.repertoire_cache_versions (scope, version, updated_at)
values ('catalog', 1, timezone('utc', now()))
on conflict (scope) do nothing;

alter table public.repertoire_cache_versions enable row level security;

drop policy if exists repertoire_cache_versions_select_authenticated on public.repertoire_cache_versions;
create policy repertoire_cache_versions_select_authenticated
on public.repertoire_cache_versions
for select
to authenticated
using (true);

create or replace function public.bump_repertoire_catalog_cache_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.repertoire_cache_versions (scope, version, updated_at)
  values ('catalog', 1, timezone('utc', now()))
  on conflict (scope) do update
    set version = public.repertoire_cache_versions.version + 1,
        updated_at = excluded.updated_at;

  return coalesce(new, old);
end;
$$;

drop trigger if exists repertoire_catalog_cache_bump_repertoire on public.repertoire;
create trigger repertoire_catalog_cache_bump_repertoire
after insert or update or delete on public.repertoire
for each row execute function public.bump_repertoire_catalog_cache_version();

drop trigger if exists repertoire_catalog_cache_bump_files on public.repertoire_files;
create trigger repertoire_catalog_cache_bump_files
after insert or update or delete on public.repertoire_files
for each row execute function public.bump_repertoire_catalog_cache_version();

drop trigger if exists repertoire_catalog_cache_bump_tags on public.repertoire_tags;
create trigger repertoire_catalog_cache_bump_tags
after insert or update or delete on public.repertoire_tags
for each row execute function public.bump_repertoire_catalog_cache_version();

drop trigger if exists repertoire_catalog_cache_bump_song_tags on public.repertoire_song_tags;
create trigger repertoire_catalog_cache_bump_song_tags
after insert or update or delete on public.repertoire_song_tags
for each row execute function public.bump_repertoire_catalog_cache_version();

drop trigger if exists repertoire_catalog_cache_bump_assignments on public.song_assignments;
create trigger repertoire_catalog_cache_bump_assignments
after insert or update or delete on public.song_assignments
for each row execute function public.bump_repertoire_catalog_cache_version();
