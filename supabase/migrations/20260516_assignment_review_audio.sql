alter table if exists public.assignment_submissions
  add column if not exists reviewer_audio_drive_file_id text null,
  add column if not exists reviewer_audio_file_name text null,
  add column if not exists reviewer_audio_mime_type text null,
  add column if not exists reviewer_audio_file_size_bytes bigint null;

alter table if exists public.assignment_submission_history
  add column if not exists reviewer_audio_drive_file_id text null,
  add column if not exists reviewer_audio_file_name text null,
  add column if not exists reviewer_audio_mime_type text null,
  add column if not exists reviewer_audio_file_size_bytes bigint null;

alter table if exists public.assignment_submission_private_notes
  add column if not exists reviewer_audio_drive_file_id text null,
  add column if not exists reviewer_audio_file_name text null,
  add column if not exists reviewer_audio_mime_type text null,
  add column if not exists reviewer_audio_file_size_bytes bigint null;

alter table if exists public.assignment_submissions
  drop constraint if exists assignment_submissions_reviewer_audio_fields_chk;

alter table if exists public.assignment_submissions
  add constraint assignment_submissions_reviewer_audio_fields_chk check (
    (
      reviewer_audio_drive_file_id is null
      and reviewer_audio_file_name is null
      and reviewer_audio_mime_type is null
      and reviewer_audio_file_size_bytes is null
    )
    or (
      reviewer_audio_drive_file_id is not null
      and reviewer_audio_file_name is not null
      and length(btrim(reviewer_audio_file_name)) > 0
    )
  );

alter table if exists public.assignment_submission_history
  drop constraint if exists assignment_submission_history_reviewer_audio_fields_chk;

alter table if exists public.assignment_submission_history
  add constraint assignment_submission_history_reviewer_audio_fields_chk check (
    (
      reviewer_audio_drive_file_id is null
      and reviewer_audio_file_name is null
      and reviewer_audio_mime_type is null
      and reviewer_audio_file_size_bytes is null
    )
    or (
      reviewer_audio_drive_file_id is not null
      and reviewer_audio_file_name is not null
      and length(btrim(reviewer_audio_file_name)) > 0
    )
  );

alter table if exists public.assignment_submission_private_notes
  drop constraint if exists assignment_submission_private_notes_reviewer_audio_fields_chk;

alter table if exists public.assignment_submission_private_notes
  add constraint assignment_submission_private_notes_reviewer_audio_fields_chk check (
    (
      reviewer_audio_drive_file_id is null
      and reviewer_audio_file_name is null
      and reviewer_audio_mime_type is null
      and reviewer_audio_file_size_bytes is null
    )
    or (
      reviewer_audio_drive_file_id is not null
      and reviewer_audio_file_name is not null
      and length(btrim(reviewer_audio_file_name)) > 0
    )
  );

create index if not exists assignment_submissions_reviewer_audio_drive_file_id_idx
  on public.assignment_submissions (reviewer_audio_drive_file_id)
  where reviewer_audio_drive_file_id is not null;

create index if not exists assignment_submission_private_notes_reviewer_audio_drive_file_id_idx
  on public.assignment_submission_private_notes (reviewer_audio_drive_file_id)
  where reviewer_audio_drive_file_id is not null;

create index if not exists assignment_submission_history_reviewer_audio_drive_file_id_idx
  on public.assignment_submission_history (reviewer_audio_drive_file_id)
  where reviewer_audio_drive_file_id is not null;

notify pgrst, 'reload schema';
