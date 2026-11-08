-- Check reminders: run once in Supabase → SQL Editor.
-- 1) A table that records each reminder email (one per coach per check, so nobody gets it twice).
-- 2) A daily schedule that calls the send-reminders function at 13:00 and 14:00 UTC;
--    the function itself only sends at 9:00 AM New York time (covers winter and summer time).

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  checkpoint text not null check (checkpoint in ('week2', 'week4', 'week6')),
  opens_at timestamptz not null,        -- when the check opened for this coach
  sent_at timestamptz,                  -- when the email went out
  email_id text,                        -- Resend's id for the email
  created_at timestamptz not null default now(),
  unique (user_id, checkpoint)
);
alter table public.reminders enable row level security;
-- Only admins can read it (for the dashboard). Only the reminder function (server side) writes to it.
create policy "Admins read reminders" on public.reminders
  for select to authenticated using ((select public.is_admin()));

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The key below is the project's public "anon" key (safe to share; it only lets the schedule call the function).
select cron.schedule(
  'send-reminders',
  '0 13,14 * * *',
  $$
  select net.http_post(
    url := 'https://guwjgnvqygnxlpltmvop.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1d2pnbnZxeWdueGxwbHRtdm9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjIwOTcsImV4cCI6MjEwOTYzODA5N30.o1fOe98yYGpZA0c24TxHFJ996SLT9gTnEpgnqpHZ7B0'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
