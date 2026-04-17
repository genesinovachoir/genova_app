-- ============================================================
-- Repertuvar etiket sistemi
-- Şef, etiketleri bu tabloya ekler/siler.
-- Şarkılar <> etiketler M:N ilişkisi.
-- ============================================================

-- Etiket tanımları
create table if not exists public.repertoire_tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text default null,   -- isteğe bağlı renk kodu (#hex)
  created_by  uuid references public.choir_members(id) on delete set null,
  created_at  timestamptz default now()
);

-- Şarkı <-> Etiket bağlantı tablosu
create table if not exists public.repertoire_song_tags (
  song_id  uuid not null references public.repertoire(id) on delete cascade,
  tag_id   uuid not null references public.repertoire_tags(id) on delete cascade,
  primary key (song_id, tag_id)
);

-- RLS
alter table public.repertoire_tags enable row level security;
alter table public.repertoire_song_tags enable row level security;

-- Herkes okuyabilir
create policy "repertoire_tags_select"
  on public.repertoire_tags for select
  using (true);

create policy "repertoire_song_tags_select"
  on public.repertoire_song_tags for select
  using (true);

-- Sadece şef (Şef rolü) oluşturabilir/silebilir
-- Roller choir_member_roles > roles tablosundan gelir
create policy "repertoire_tags_insert"
  on public.repertoire_tags for insert
  with check (
    exists (
      select 1
      from public.choir_members cm
      join public.choir_member_roles cmr on cmr.member_id = cm.id
      join public.roles r on r.id = cmr.role_id
      where cm.auth_user_id = auth.uid() and r.name = 'Şef'
    )
  );

create policy "repertoire_tags_delete"
  on public.repertoire_tags for delete
  using (
    exists (
      select 1
      from public.choir_members cm
      join public.choir_member_roles cmr on cmr.member_id = cm.id
      join public.roles r on r.id = cmr.role_id
      where cm.auth_user_id = auth.uid() and r.name = 'Şef'
    )
  );

create policy "repertoire_song_tags_insert"
  on public.repertoire_song_tags for insert
  with check (
    exists (
      select 1
      from public.choir_members cm
      join public.choir_member_roles cmr on cmr.member_id = cm.id
      join public.roles r on r.id = cmr.role_id
      where cm.auth_user_id = auth.uid() and r.name = 'Şef'
    )
  );

create policy "repertoire_song_tags_delete"
  on public.repertoire_song_tags for delete
  using (
    exists (
      select 1
      from public.choir_members cm
      join public.choir_member_roles cmr on cmr.member_id = cm.id
      join public.roles r on r.id = cmr.role_id
      where cm.auth_user_id = auth.uid() and r.name = 'Şef'
    )
  );
