-- Question 06 (three written answers): run once in Supabase → SQL Editor, BEFORE pushing the app code that saves them.
-- Checks: the answers given at each check. Profiles: the answers given on workshop day (before the first action).
alter table public.checks
  add column if not exists reflect_well text,     -- What are you doing particularly well in your coaching?
  add column if not exists reflect_when text,     -- When do you fall back into a coaching habit you want to change? ("When …")
  add column if not exists reflect_will text;     -- What are you committed to doing differently? ("I will …")

alter table public.profiles
  add column if not exists reflect_well text,
  add column if not exists reflect_when text,
  add column if not exists reflect_will text;
