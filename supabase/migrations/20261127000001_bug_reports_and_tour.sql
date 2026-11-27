-- Bug reports from signed-in users, and whether each person has finished the app tour. Additive only.

-- The guided tour shown once after onboarding; replayable from the account menu. A user may only set their own.
alter table public.profiles add column if not exists tour_completed_at timestamptz;
grant update (tour_completed_at) on public.profiles to authenticated;

-- "Report a bug" in the app. Written by the server (service role) after it checks who is signed in, then emailed
-- to support. No policies: users can't read or write the table directly.
create table if not exists public.bug_reports (
  id              bigint generated always as identity primary key,
  workspace_id    uuid references public.workspaces (id) on delete set null,
  user_id         uuid references auth.users (id) on delete set null,
  reporter_email  text check (char_length(reporter_email) <= 320),
  message         text not null check (char_length(message) between 5 and 5000),
  page_url        text check (char_length(page_url) <= 2048),
  user_agent      text check (char_length(user_agent) <= 500),
  screenshot_name text check (char_length(screenshot_name) <= 200),
  email_status    text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  email_error     text check (char_length(email_error) <= 500),
  status          text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at      timestamptz not null default now()
);
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_user_idx on public.bug_reports (user_id, created_at desc);
alter table public.bug_reports enable row level security;  -- no policies: service role only
revoke all on public.bug_reports from anon, authenticated;
