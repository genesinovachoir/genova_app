alter table public.choir_members
  add column if not exists about_text text;

drop policy if exists profile_change_requests_insert_guard on public.profile_change_requests;

create policy profile_change_requests_insert_guard
on public.profile_change_requests
as restrictive
for insert
to authenticated
with check (
  member_id = (
    select cm.id
    from public.choir_members cm
    where cm.auth_user_id = auth.uid()
    limit 1
  )
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and reject_reason is null
  and jsonb_typeof(changes_json) = 'object'
  and changes_json <> '{}'::jsonb
  and (
    changes_json - array[
      'email',
      'phone',
      'birth_date',
      'school_id',
      'department_id',
      'favorite_song_id',
      'about_text',
      'linkedin_url',
      'instagram_url',
      'youtube_url',
      'spotify_url',
      'tiktok_url',
      'x_url',
      'photo_url'
    ]::text[]
  ) = '{}'::jsonb
);
