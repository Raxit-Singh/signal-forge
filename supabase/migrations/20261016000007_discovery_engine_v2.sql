-- Intelligent Discovery Engine V2 (additive; existing data and RLS untouched).
--
--   * arrival_estimates   per query group: Gamma–Poisson arrival-rate posterior with
--                         exponential forgetting (raw results → capacity / brand-safe
--                         pacing; relevant mentions → freshness and importance).
--   * resumable collection: executions record the time span their results covered,
--                         continuation number and backfill task; checkpoints keep
--                         uncollected "gaps" in monitoring_queries.cursor (jsonb).
--   * historical search:  products.history_*; backfill_runs (one per request) and
--                         backfill_tasks (one per query group) with persisted cursors.
--   * spikes:             confidence (confirmed / possible), p-value; keyword-level
--                         spikes; per-scope evaluation state ("insufficient data").
--   * realtime:           workspace_events — one small row per finished batch
--                         (never per mention, never mention content or prices),
--                         readable by workspace members only, published to Supabase
--                         Realtime when the publication exists.
-- Everything the worker writes goes through the service role.

-- ---------------------------------------------------------------------------
-- Arrival-rate estimates (per query group)
-- ---------------------------------------------------------------------------
create table public.arrival_estimates (
  query_id          uuid primary key references public.monitoring_queries (id) on delete cascade,
  workspace_id      uuid not null,
  product_id        uuid not null,
  platform          public.integration_provider not null,
  stream            text not null default 'default',
  -- Gamma posterior over results per hour the search returns (alpha = shape, beta = hours).
  raw_alpha         double precision not null check (raw_alpha > 0),
  raw_beta          double precision not null check (raw_beta > 0),
  -- Same for relevant mentions per hour.
  rel_alpha         double precision not null check (rel_alpha > 0),
  rel_beta          double precision not null check (rel_beta > 0),
  observations      integer not null default 0 check (observations >= 0),
  saturations       integer not null default 0 check (saturations >= 0),
  exposure_hours    double precision not null default 0 check (exposure_hours >= 0),
  -- Results one check can retrieve within provider/page limits (per job; continuations extend it).
  capacity_per_check integer check (capacity_per_check >= 0),
  last_observed_at  timestamptz,
  updated_at        timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index arrival_estimates_product_idx on public.arrival_estimates (product_id, platform);

alter table public.monitoring_executions
  add column observed_span_minutes integer check (observed_span_minutes >= 0),
  add column continuation smallint not null default 0 check (continuation >= 0),
  add column backfill_task_id uuid;

alter table public.platform_activity
  add column importance_share real check (importance_share between 0 and 1),
  add column arrival_per_day real check (arrival_per_day >= 0),
  add column rate_upper_per_hour real check (rate_upper_per_hour >= 0),
  add column safe_interval_minutes integer check (safe_interval_minutes > 0),
  add column collection_risk text check (collection_risk in ('none', 'watch', 'at_risk', 'unavoidable')),
  add column risk_detail text check (char_length(risk_detail) <= 500),
  add column uncertainty real check (uncertainty >= 0),
  add column model text not null default 'score_v1' check (model in ('score_v1', 'arrival_v2'));

-- ---------------------------------------------------------------------------
-- Historical search preference (asked during onboarding)
-- ---------------------------------------------------------------------------
alter table public.products
  add column history_mode text check (history_mode in ('launch', '7d', '30d', '90d', '180d', '365d', 'custom')),
  add column history_start timestamptz,
  add column launch_date date;

-- ---------------------------------------------------------------------------
-- Historical backfill
-- ---------------------------------------------------------------------------
create table public.backfill_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  product_id    uuid not null,
  requested_by  uuid references auth.users (id) on delete set null,
  mode          text not null check (mode in ('launch', '7d', '30d', '90d', '180d', '365d', 'custom')),
  range_start   timestamptz not null,
  range_end     timestamptz not null,
  status        text not null default 'queued'
                check (status in ('queued', 'searching', 'partial', 'paused', 'completed', 'unavailable', 'canceled')),
  pause_reason  text check (char_length(pause_reason) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check (range_end > range_start),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index backfill_runs_product_idx on public.backfill_runs (product_id, created_at desc);

create table public.backfill_tasks (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.backfill_runs (id) on delete cascade,
  workspace_id    uuid not null,
  product_id      uuid not null,
  query_id        uuid references public.monitoring_queries (id) on delete set null,
  platform        public.integration_provider not null,
  stream          text not null default 'default',
  status          text not null default 'queued'
                  check (status in ('queued', 'searching', 'partial', 'paused', 'completed', 'unavailable')),
  -- Earliest moment this source can search back to (null = the requested start is supported).
  supported_since timestamptz,
  -- Remaining window to collect: {"since", "until", "page", "stalls"}; null once done.
  cursor          jsonb,
  jobs_run        integer not null default 0 check (jobs_run >= 0),
  pages           integer not null default 0 check (pages >= 0),
  results         integer not null default 0 check (results >= 0),
  inserted        integer not null default 0 check (inserted >= 0),
  paid_requests   integer not null default 0 check (paid_requests >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_run_at     timestamptz not null default now(),
  note            text check (char_length(note) <= 500),
  last_error      text check (char_length(last_error) <= 500),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index backfill_tasks_run_idx on public.backfill_tasks (run_id);
create index backfill_tasks_due_idx on public.backfill_tasks (next_run_at) where status in ('queued', 'searching', 'paused');

create trigger backfill_runs_touch before update on public.backfill_runs
  for each row execute function private.touch_updated_at();
create trigger backfill_tasks_touch before update on public.backfill_tasks
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Spikes: confidence, keyword level, evaluation state
-- ---------------------------------------------------------------------------
alter table public.buzz_spikes
  add column confidence text not null default 'confirmed' check (confidence in ('confirmed', 'possible')),
  add column p_value double precision check (p_value between 0 and 1),
  add column note text check (char_length(note) <= 300);

create table public.buzz_keyword_spikes (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  product_id       uuid not null,
  keyword          text not null check (char_length(keyword) between 1 and 200),
  granularity      text not null check (granularity in ('day', 'hour')),
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  observed         integer not null check (observed >= 0),
  expected         numeric(12, 3) not null check (expected >= 0),
  baseline_periods integer not null check (baseline_periods >= 0),
  robust_z         numeric(10, 3),
  ratio            numeric(10, 3),
  p_value          double precision check (p_value between 0 and 1),
  severity         text not null check (severity in ('notable', 'major')),
  confidence       text not null check (confidence in ('confirmed', 'possible')),
  note             text check (char_length(note) <= 300),
  detected_at      timestamptz not null default now(),
  check (period_end > period_start),
  unique (product_id, keyword, granularity, period_start),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index buzz_keyword_spikes_product_idx on public.buzz_keyword_spikes (product_id, period_start desc);

-- Latest evaluation per scope, so "not enough data" is shown instead of "no spike".
create table public.spike_evaluations (
  product_id       uuid not null,
  workspace_id     uuid not null,
  scope            text not null check (scope in ('product', 'platform', 'keyword')),
  scope_key        text not null default '' check (char_length(scope_key) <= 200),
  granularity      text not null check (granularity in ('day', 'hour')),
  status           text not null check (status in ('evaluated', 'insufficient_data')),
  baseline_periods integer not null default 0,
  needed_periods   integer not null default 0,
  evaluated_at     timestamptz not null default now(),
  primary key (product_id, scope, scope_key, granularity),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

-- Relevant original mentions per keyword per bucket (publication time; estimated dates excluded).
create or replace function public.keyword_series(
  p_product_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text
)
returns table (bucket_start timestamptz, keyword text, relevant integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.check_buzz_args(p_from, p_to, p_bucket, p_tz);
  return query
  select (date_trunc(p_bucket, m.published_at at time zone p_tz) at time zone p_tz) as bucket_start,
         lower(t.term) as keyword,
         count(distinct m.id)::integer
    from public.mentions m
    cross join lateral unnest(m.matched_terms) as t(term)
   where m.product_id = p_product_id
     and m.published_at >= p_from and m.published_at < p_to
     and m.dedup_kind = 'original'
     and not m.published_at_estimated
     and m.relevance_status in ('relevant', 'user_relevant')
   group by 1, 2
   order by 1, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: workspace-scoped change notifications (signals to refetch)
-- ---------------------------------------------------------------------------
create table public.workspace_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id   uuid,
  kind         text not null check (kind in ('mentions', 'monitoring', 'backfill', 'usage', 'spikes')),
  -- Counts only (e.g. {"inserted": 12}); never mention text, credentials or prices.
  payload      jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 1024),
  created_at   timestamptz not null default now()
);
create index workspace_events_ws_idx on public.workspace_events (workspace_id, id desc);
create index workspace_events_created_idx on public.workspace_events (created_at);

-- Emits one event; identical events within 2 seconds are coalesced (bounded fan-out during big scans).
create or replace function private.emit_workspace_event(p_workspace_id uuid, p_product_id uuid, p_kind text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.workspace_events e
              where e.workspace_id = p_workspace_id and e.product_id is not distinct from p_product_id
                and e.kind = p_kind and e.created_at > now() - interval '2 seconds') then
    return false;
  end if;
  insert into public.workspace_events (workspace_id, product_id, kind, payload)
  values (p_workspace_id, p_product_id, p_kind, coalesce(p_payload, '{}'::jsonb));
  return true;
end;
$$;

create or replace function public.svc_emit_workspace_event(p_workspace_id uuid, p_product_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.emit_workspace_event(p_workspace_id, p_product_id, p_kind, p_payload); $$;

-- Events are signals, not history: keep a day.
create or replace function public.svc_purge_workspace_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  delete from public.workspace_events where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Jobs: generic enqueue for continuations and backfill tasks (service role)
-- ---------------------------------------------------------------------------
create or replace function public.svc_enqueue_job(
  p_kind text, p_idempotency_key text, p_payload jsonb, p_workspace_id uuid, p_product_id uuid,
  p_run_after timestamptz default now(), p_priority smallint default 100
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_job(p_kind, p_idempotency_key, p_payload, p_workspace_id, p_product_id, p_run_after, 4, p_priority);
$$;

-- Due backfill tasks → jobs. Tasks of workspaces whose mention allowance is used up are
-- paused until it renews (progress kept); paid tasks wait while paid sources are off.
create or replace function private.schedule_backfills(p_providers text[], p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  n integer := 0;
  paused_until timestamptz;
begin
  for t in
    select bt.id, bt.workspace_id, bt.product_id, bt.platform, bt.status, bt.jobs_run, bt.consecutive_failures
      from public.backfill_tasks bt
      join public.products p on p.id = bt.product_id and p.archived_at is null
      join public.plans pl on pl.id = private.effective_plan_id(bt.workspace_id)
     where bt.status in ('queued', 'searching', 'paused')
       and bt.next_run_at <= now()
       and bt.platform::text = any (p_providers)
     order by pl.scheduling_priority desc, bt.next_run_at
     limit greatest(1, least(p_limit, 500))
     for update of bt skip locked
  loop
    paused_until := private.allowance_exhausted_until(t.workspace_id);
    if paused_until is not null then
      update public.backfill_tasks
         set status = 'paused', next_run_at = paused_until,
             note = 'Paused: this billing period''s mention allowance is used up. Resumes when it renews.'
       where id = t.id;
      update public.backfill_runs r set status = 'paused', pause_reason = 'Mention allowance used up until ' || to_char(paused_until, 'YYYY-MM-DD')
       where r.id = (select run_id from public.backfill_tasks where id = t.id) and r.status in ('queued', 'searching', 'partial');
      continue;
    end if;
    perform private.enqueue_job(
      'backfill.task', 'bf:' || t.id || ':' || t.jobs_run || ':' || t.consecutive_failures,
      jsonb_build_object('task_id', t.id), t.workspace_id, t.product_id, now(), 3, 120::smallint);
    -- Provisional: the job reschedules the task when it finishes (or the lease expires).
    update public.backfill_tasks
       set status = case when status = 'paused' then 'searching' else status end,
           next_run_at = now() + interval '10 minutes'
     where id = t.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.svc_schedule_backfills(p_providers text[], p_limit integer default 100)
returns integer
language sql
security definer
set search_path = ''
as $$ select private.schedule_backfills(p_providers, p_limit); $$;

-- ---------------------------------------------------------------------------
-- RLS & grants
-- ---------------------------------------------------------------------------
alter table public.arrival_estimates enable row level security;
alter table public.backfill_runs enable row level security;
alter table public.backfill_tasks enable row level security;
alter table public.buzz_keyword_spikes enable row level security;
alter table public.spike_evaluations enable row level security;
alter table public.workspace_events enable row level security;

revoke all on public.arrival_estimates, public.backfill_runs, public.backfill_tasks, public.buzz_keyword_spikes,
              public.spike_evaluations, public.workspace_events
  from anon, authenticated;
grant all on public.arrival_estimates, public.backfill_runs, public.backfill_tasks, public.buzz_keyword_spikes,
             public.spike_evaluations, public.workspace_events
  to service_role;
grant select on public.arrival_estimates, public.backfill_runs, public.backfill_tasks, public.buzz_keyword_spikes,
                public.spike_evaluations, public.workspace_events
  to authenticated;

create policy arrival_estimates_read on public.arrival_estimates for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy backfill_runs_read on public.backfill_runs for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy backfill_tasks_read on public.backfill_tasks for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy keyword_spikes_read on public.buzz_keyword_spikes for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy spike_evaluations_read on public.spike_evaluations for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy workspace_events_read on public.workspace_events for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

grant execute on function public.keyword_series(uuid, timestamptz, timestamptz, text, text) to authenticated, service_role;

revoke all on function private.emit_workspace_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.schedule_backfills(text[], integer) from public, anon, authenticated;
revoke all on function public.svc_emit_workspace_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.svc_purge_workspace_events() from public, anon, authenticated;
revoke all on function public.svc_enqueue_job(text, text, jsonb, uuid, uuid, timestamptz, smallint) from public, anon, authenticated;
revoke all on function public.svc_schedule_backfills(text[], integer) from public, anon, authenticated;
grant execute on function public.svc_emit_workspace_event(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.svc_purge_workspace_events() to service_role;
grant execute on function public.svc_enqueue_job(text, text, jsonb, uuid, uuid, timestamptz, smallint) to service_role;
grant execute on function public.svc_schedule_backfills(text[], integer) to service_role;

-- Supabase Realtime (postgres_changes) applies the subscriber's RLS to each change.
-- The publication only exists on Supabase; plain Postgres (tests) skips this.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.workspace_events;
  end if;
end;
$$;
