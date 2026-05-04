alter table public.chat_room_members
  add column if not exists hidden_at timestamptz;
