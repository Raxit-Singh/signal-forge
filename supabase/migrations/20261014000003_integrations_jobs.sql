-- Integrations, encrypted credentials, AI provider connections,
-- monitoring queries, background job queue, and source coverage.

create type public.integration_provider as enum (
  'github', 'youtube', 'hackernews', 'stackexchange',
  'app_store_connect', 'google_play', 'discord',
  -- Future: interfaces only. Never enabled without official API access.
  'reddit', 'x', 'instagram', 'linkedin', 'facebook', 'slack', 'product_hunt'
);

create type public.integration_status as enum (
  'not_connected', 'connected', 'degraded', 'error', 'blocked', 'disabled'
);

create type public.ai_provider as enum ('signalforge', 'anthropic', 'openai', 'gemini');

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead', 'canceled');

-- ---------------------------------------------------------------------------
-- Secrets: application-layer encrypted (AES-256-GCM) by the server before
-- insert. No RLS policy grants any access to anon/authenticated, so only the
-- service role (server) can read or write these rows.
-- ---------------------------------------------------------------------------
create table public.credential_secrets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  purpose       text not null check (purpose in ('integration', 'ai_provider')),
  ciphertext    text not null,          -- base64(iv || authTag || ciphertext)
  key_version   smallint not null default 1,
  created_at    timestamptz not null default now(),
  rotated_at    timestamptz,
  unique (id, workspace_id)
);

create index credential_secrets_ws_idx on public.credential_secrets (workspace_id);

-- ---------------------------------------------------------------------------
-- Integrations (non-secret configuration and health only)
-- ---------------------------------------------------------------------------
create table public.integrations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  product_id      uuid,
  provider        public.integration_provider not null,
  status          public.integration_status not null default 'not_connected',
  status_reason   text check (char_length(status_reason) <= 500),
  config          jsonb not null default '{}'::jsonb,   -- non-secret (repo names, channel ids, ...)
  secret_id       uuid,
  external_account text check (char_length(external_account) <= 200), -- e.g. GitHub installation account login
  scopes          text[] not null default '{}',
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text check (char_length(last_error) <= 1000),
  connected_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (secret_id, workspace_id) references public.credential_secrets (id, workspace_id) on delete set null (secret_id)
);

create unique index integrations_scope_uniq
  on public.integrations (workspace_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), provider);

create trigger integrations_touch before update on public.integrations
  for each row execute function private.touch_updated_at();
create trigger audit_integrations after insert or update of status, secret_id or delete on public.integrations
  for each row execute function private.audit_row_change();

-- Short-lived OAuth state tokens (CSRF protection for OAuth callbacks).
create table public.oauth_states (
  state         text primary key check (char_length(state) >= 32),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      public.integration_provider not null,
  redirect_to   text,
  code_verifier text,
  expires_at    timestamptz not null default now() + interval '10 minutes',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI provider connections (metadata only; key material in credential_secrets)
-- ---------------------------------------------------------------------------
create table public.ai_provider_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  provider       public.ai_provider not null,
  secret_id      uuid,
  key_hint       text check (key_hint ~ '^[A-Za-z0-9_-]{0,8}$'),  -- last 4 chars only
  status         text not null default 'unverified' check (status in ('unverified', 'valid', 'invalid', 'revoked')),
  default_model  text check (char_length(default_model) <= 100),
  is_default     boolean not null default false,
  validated_at   timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, provider),
  foreign key (secret_id, workspace_id) references public.credential_secrets (id, workspace_id) on delete set null (secret_id),
  constraint byok_needs_secret check (provider = 'signalforge' or secret_id is not null or status = 'revoked')
);

create unique index ai_provider_default_uniq on public.ai_provider_connections (workspace_id) where is_default;

create trigger ai_provider_connections_touch before update on public.ai_provider_connections
  for each row execute function private.touch_updated_at();
create trigger audit_ai_provider_connections after insert or update of status, secret_id or delete on public.ai_provider_connections
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Monitoring queries: what to search, where, and when next.
-- ---------------------------------------------------------------------------
create table public.monitoring_queries (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  product_id     uuid not null,
  competitor_id  uuid,
  provider       public.integration_provider not null,
  query          text not null check (char_length(query) between 1 and 256),
  params         jsonb not null default '{}'::jsonb,
  cursor         jsonb not null default '{}'::jsonb,     -- e.g. last seen timestamp/id
  enabled        boolean not null default true,
  last_run_at    timestamptz,
  next_run_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (competitor_id, workspace_id) references public.competitors (id, workspace_id) on delete cascade
);

create unique index monitoring_queries_uniq
  on public.monitoring_queries (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, lower(query));
create index monitoring_queries_due_idx on public.monitoring_queries (next_run_at) where enabled;

create trigger monitoring_queries_touch before update on public.monitoring_queries
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Job queue (Postgres-backed; leased with SKIP LOCKED; idempotent by key)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid references public.workspaces (id) on delete cascade,
  product_id       uuid,
  kind             text not null check (kind ~ '^[a-z][a-z0-9_.]{2,63}$'),
  payload          jsonb not null default '{}'::jsonb,
  idempotency_key  text not null unique check (char_length(idempotency_key) <= 200),
  status           public.job_status not null default 'queued',
  priority         smallint not null default 100,
  attempts         integer not null default 0,
  max_attempts     integer not null default 5 check (max_attempts between 1 and 20),
  run_after        timestamptz not null default now(),
  locked_by        text,
  locked_until     timestamptz,
  last_error       text check (char_length(last_error) <= 2000),
  progress         jsonb not null default '{}'::jsonb,   -- user-visible progress (e.g. initial scan)
  result           jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index jobs_ready_idx on public.jobs (priority, run_after) where status = 'queued';
create index jobs_stale_idx on public.jobs (locked_until) where status = 'running';
create index jobs_ws_idx on public.jobs (workspace_id, created_at desc);

create trigger jobs_touch before update on public.jobs
  for each row execute function private.touch_updated_at();

create table public.job_runs (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  attempt      integer not null,
  worker       text,
  status       public.job_status not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text check (char_length(error) <= 2000),
  metrics      jsonb not null default '{}'::jsonb
);

create index job_runs_job_idx on public.job_runs (job_id, attempt);

-- Enqueue idempotently. Returns the existing job id when the key was seen before.
create or replace function private.enqueue_job(
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_workspace_id uuid default null,
  p_product_id uuid default null,
  p_run_after timestamptz default now(),
  p_max_attempts integer default 5,
  p_priority smallint default 100
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  jid uuid;
begin
  insert into public.jobs (kind, idempotency_key, payload, workspace_id, product_id, run_after, max_attempts, priority)
  values (p_kind, p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_workspace_id, p_product_id, p_run_after, p_max_attempts, p_priority)
  on conflict (idempotency_key) do nothing
  returning id into jid;

  if jid is null then
    select j.id into jid from public.jobs j where j.idempotency_key = p_idempotency_key;
  end if;
  return jid;
end;
$$;

-- Claim up to p_limit ready jobs; also reclaims jobs whose lease expired (worker crash).
create or replace function private.claim_jobs(
  p_worker text,
  p_limit integer default 5,
  p_lease_seconds integer default 120,
  p_kinds text[] default null
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select j.id
      from public.jobs j
     where (
             (j.status = 'queued' and j.run_after <= now())
          or (j.status = 'running' and j.locked_until < now())
           )
       and (p_kinds is null or j.kind = any (p_kinds))
     order by j.priority, j.run_after
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

-- Mark success. Only the worker holding the lease may complete the job.
create or replace function private.complete_job(
  p_job_id uuid,
  p_worker text,
  p_result jsonb default null,
  p_metrics jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs
     set status = 'succeeded', result = p_result, locked_by = null, locked_until = null,
         finished_at = now(), last_error = null
   where id = p_job_id and status = 'running' and locked_by = p_worker
  returning * into j;

  if j.id is null then
    return false;
  end if;

  insert into public.job_runs (job_id, workspace_id, attempt, worker, status, finished_at, metrics)
  values (j.id, j.workspace_id, j.attempts, p_worker, 'succeeded', now(), coalesce(p_metrics, '{}'::jsonb));
  return true;
end;
$$;

-- Mark failure; schedule retry with exponential backoff + jitter, or dead-letter.
-- Backoff: min(base * 2^(attempt-1), 6h) * (0.8..1.2)
create or replace function private.fail_job(
  p_job_id uuid,
  p_worker text,
  p_error text,
  p_retryable boolean default true,
  p_base_seconds integer default 30,
  p_retry_after_seconds integer default null
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  delay_seconds double precision;
  next_status public.job_status;
begin
  select * into j from public.jobs where id = p_job_id and status = 'running' and locked_by = p_worker for update;
  if j.id is null then
    return null;
  end if;

  if p_retryable and j.attempts < j.max_attempts then
    delay_seconds := coalesce(
      p_retry_after_seconds::double precision,
      least(p_base_seconds * power(2, greatest(j.attempts - 1, 0)), 21600) * (0.8 + random() * 0.4)
    );
    next_status := 'queued';
  else
    next_status := 'dead';
  end if;

  update public.jobs
     set status = next_status,
         last_error = left(p_error, 2000),
         locked_by = null,
         locked_until = null,
         run_after = case when next_status = 'queued' then now() + make_interval(secs => delay_seconds) else run_after end,
         finished_at = case when next_status = 'dead' then now() else null end
   where id = j.id;

  insert into public.job_runs (job_id, workspace_id, attempt, worker, status, finished_at, error)
  values (j.id, j.workspace_id, j.attempts, p_worker, 'failed', now(), left(p_error, 2000));

  return next_status;
end;
$$;

revoke all on function private.enqueue_job(text, text, jsonb, uuid, uuid, timestamptz, integer, smallint) from public, authenticated;
revoke all on function private.claim_jobs(text, integer, integer, text[]) from public, authenticated;
revoke all on function private.complete_job(uuid, text, jsonb, jsonb) from public, authenticated;
revoke all on function private.fail_job(uuid, text, text, boolean, integer, integer) from public, authenticated;
grant execute on function private.enqueue_job(text, text, jsonb, uuid, uuid, timestamptz, integer, smallint) to service_role;
grant execute on function private.claim_jobs(text, integer, integer, text[]) to service_role;
grant execute on function private.complete_job(uuid, text, jsonb, jsonb) to service_role;
grant execute on function private.fail_job(uuid, text, text, boolean, integer, integer) to service_role;

-- Named distributed locks (e.g. "only one scheduler tick at a time").
create table public.job_locks (
  name         text primary key,
  holder       text not null,
  expires_at   timestamptz not null
);

create or replace function private.try_acquire_lock(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  got text;
begin
  insert into public.job_locks (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
     set holder = excluded.holder, expires_at = excluded.expires_at
   where public.job_locks.expires_at < now() or public.job_locks.holder = excluded.holder
  returning holder into got;
  return coalesce(got = p_holder, false);
end;
$$;

create or replace function private.release_lock(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_locks where name = p_name and holder = p_holder;
$$;

revoke all on function private.try_acquire_lock(text, text, integer) from public, authenticated;
revoke all on function private.release_lock(text, text) from public, authenticated;
grant execute on function private.try_acquire_lock(text, text, integer) to service_role;
grant execute on function private.release_lock(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Source coverage: which windows were actually monitored, per source.
-- Analytics use this to distinguish "no mentions" from "no data".
-- ---------------------------------------------------------------------------
create table public.coverage_windows (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,
  product_id    uuid not null,
  provider      public.integration_provider not null,
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  status        text not null check (status in ('complete', 'partial', 'failed')),
  detail        text check (char_length(detail) <= 500),
  job_id        uuid references public.jobs (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (window_end > window_start),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index coverage_windows_lookup_idx on public.coverage_windows (product_id, provider, window_end desc);

-- External API usage for cost and quota tracking.
create table public.api_usage_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references public.workspaces (id) on delete set null,
  provider      public.integration_provider not null,
  endpoint      text not null,
  units         integer not null default 1 check (units >= 0),
  status_code   integer,
  occurred_at   timestamptz not null default now()
);

create index api_usage_provider_time_idx on public.api_usage_events (provider, occurred_at desc);
