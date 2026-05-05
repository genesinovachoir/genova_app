create or replace function public.get_chat_rooms_for_member(p_member_id uuid)
returns table (
  room_id uuid,
  membership_id uuid,
  nickname text,
  membership_role text,
  last_read_at timestamptz,
  notifications_enabled boolean,
  hidden_at timestamptz,
  room_name text,
  room_slug text,
  room_description text,
  room_type text,
  room_created_by uuid,
  room_avatar_url text,
  room_is_archived boolean,
  room_created_at timestamptz,
  room_updated_at timestamptz,
  last_message jsonb,
  unread_count bigint,
  member_count bigint,
  members_preview jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with current_member as (
    select cm.id
    from public.choir_members cm
    where cm.id = p_member_id
      and cm.auth_user_id = auth.uid()
    limit 1
  ),
  member_rooms as (
    select
      crm.id as membership_id,
      crm.room_id,
      crm.nickname,
      crm.role::text as membership_role,
      crm.last_read_at,
      crm.notifications_enabled,
      crm.hidden_at,
      cr.name as room_name,
      cr.slug as room_slug,
      cr.description as room_description,
      cr.type::text as room_type,
      cr.created_by as room_created_by,
      cr.avatar_url as room_avatar_url,
      cr.is_archived as room_is_archived,
      cr.created_at as room_created_at,
      cr.updated_at as room_updated_at
    from public.chat_room_members crm
    join current_member cm on cm.id = crm.member_id
    join public.chat_rooms cr on cr.id = crm.room_id
    where cr.is_archived = false
  )
  select
    mr.room_id,
    mr.membership_id,
    mr.nickname,
    mr.membership_role,
    mr.last_read_at,
    mr.notifications_enabled,
    mr.hidden_at,
    mr.room_name,
    mr.room_slug,
    mr.room_description,
    mr.room_type,
    mr.room_created_by,
    mr.room_avatar_url,
    mr.room_is_archived,
    mr.room_created_at,
    mr.room_updated_at,
    last_msg.payload as last_message,
    coalesce(unread.unread_count, 0) as unread_count,
    coalesce(room_counts.member_count, 0) as member_count,
    coalesce(preview.members_preview, '[]'::jsonb) as members_preview
  from member_rooms mr
  left join lateral (
    select jsonb_build_object(
      'id', msg.id,
      'room_id', msg.room_id,
      'sender_id', msg.sender_id,
      'content', msg.content,
      'message_type', msg.message_type,
      'reply_to_id', null,
      'metadata_json', '{}'::jsonb,
      'is_edited', false,
      'is_deleted', msg.is_deleted,
      'created_at', msg.created_at,
      'updated_at', msg.created_at,
      'sender',
        case
          when sender.id is null then null
          else jsonb_build_object(
            'id', sender.id,
            'first_name', sender.first_name,
            'last_name', sender.last_name,
            'photo_url', sender.photo_url
          )
        end
    ) as payload
    from public.chat_messages msg
    left join public.choir_members sender on sender.id = msg.sender_id
    where msg.room_id = mr.room_id
    order by msg.created_at desc
    limit 1
  ) last_msg on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.chat_messages msg
    where msg.room_id = mr.room_id
      and msg.sender_id <> p_member_id
      and (mr.last_read_at is null or msg.created_at > mr.last_read_at)
  ) unread on true
  left join lateral (
    select count(*)::bigint as member_count
    from public.chat_room_members member_count_rows
    where member_count_rows.room_id = mr.room_id
  ) room_counts on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'member_id', room_member.member_id,
        'first_name', coalesce(nullif(trim(profile.first_name), ''), 'Üye'),
        'photo_url', profile.photo_url
      )
      order by room_member.joined_at asc
    ) as members_preview
    from public.chat_room_members room_member
    left join public.choir_members profile on profile.id = room_member.member_id
    where room_member.room_id = mr.room_id
  ) preview on true
  order by coalesce((last_msg.payload->>'created_at')::timestamptz, mr.room_created_at) desc;
$$;
