-- Email delivery log (additive). One row per email SignalForge tried to send:
-- what kind, to whom, and what happened (sent / skipped because email isn't
-- configured / failed). No message bodies are stored. Service role only.
-- Rows older than 90 days are purged by daily maintenance.

create table public.email_log (
  id                  bigint generated always as identity primary key,
  workspace_id        uuid references public.workspaces (id) on delete set null,
  user_id             uuid references auth.users (id) on delete set null,
  recipient           text not null check (char_length(recipient) <= 320),
  kind                text not null check (kind in ('invitation', 'weekly_report')),
  subject             text not null check (char_length(subject) <= 300),
  dedupe_key          text unique check (char_length(dedupe_key) <= 200),
  status              text not null check (status in ('sent', 'skipped', 'failed')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  error               text check (char_length(error) <= 500),
  created_at          timestamptz not null default now()
);
create index email_log_ws_idx on public.email_log (workspace_id, created_at desc);
alter table public.email_log enable row level security;  -- no policies: service role only

create or replace function public.svc_purge_email_log()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.email_log where created_at < now() - interval '90 days' returning 1) select count(*)::integer from d;
$$;
revoke all on function public.svc_purge_email_log() from public, anon, authenticated;
grant execute on function public.svc_purge_email_log() to service_role;
