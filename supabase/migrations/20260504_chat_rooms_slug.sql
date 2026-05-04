alter table public.chat_rooms
  add column if not exists slug text;

create or replace function public.chat_slugify(input_text text)
returns text
language sql
immutable
as $$
  select left(
    trim(
      both '-'
      from regexp_replace(
        regexp_replace(
          lower(
            translate(coalesce(input_text, ''), 'şŞçÇğĞüÜöÖıİ', 'ssccgguuooii')
          ),
          '[^a-z0-9\s-]+',
          '',
          'g'
        ),
        '[\s_]+',
        '-',
        'g'
      )
    ),
    80
  );
$$;

do $$
declare
  room_row record;
  base_slug text;
  candidate_slug text;
  suffix integer;
begin
  for room_row in
    select id, name
    from public.chat_rooms
    order by created_at asc, id asc
  loop
    base_slug := public.chat_slugify(room_row.name);

    if base_slug is null or base_slug = '' then
      base_slug := 'oda';
    end if;

    candidate_slug := left(base_slug, 80);
    suffix := 2;

    while exists (
      select 1
      from public.chat_rooms cr
      where cr.slug = candidate_slug
        and cr.id <> room_row.id
    ) loop
      candidate_slug := left(base_slug, greatest(1, 80 - length('-' || suffix::text))) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;

    update public.chat_rooms
    set slug = candidate_slug
    where id = room_row.id;
  end loop;
end
$$;

alter table public.chat_rooms
  alter column slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_rooms_slug_key'
      and conrelid = 'public.chat_rooms'::regclass
  ) then
    alter table public.chat_rooms
      add constraint chat_rooms_slug_key unique (slug);
  end if;
end
$$;

drop function if exists public.chat_slugify(text);
