-- Milestone 2: real data collection.
--   * scans            user-visible grouping of collection jobs (initial / manual scans)
--   * rate limiting    token buckets shared by every worker (one per external API)
--   * source health    last success / error per public source (global, not tenant data)
--   * query sync       monitoring_queries derived from a product's enabled keywords
--   * scheduler        due queries -> idempotent monitor.query jobs
--   * ingestion        atomic upsert + dedup + plan mention limit
-- Everything the worker calls is SECURITY DEFINER in `private`, exposed to the
-- service role only through thin `public.svc_*` wrappers.

-- ---------------------------------------------------------------------------
-- Scans
-- ---------------------------------------------------------------------------
create table public.scans (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  product_id    uuid not null,
  kind          text not null check (kind in ('initial', 'manual')),
  lookback_days integer not null check (lookback_days between 1 and 90),
  requested_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index scans_product_idx on public.scans (product_id, created_at desc);

alter table public.jobs add column scan_id uuid references public.scans (id) on delete set null;
create index jobs_scan_idx on public.jobs (scan_id) where scan_id is not null;

-- Repost detection: the external link a post shares (e.g. an HN story URL).
alter table public.mentions add column linked_url text check (char_length(linked_url) <= 2048);
create index mentions_linked_url_idx on public.mentions (product_id, linked_url) where linked_url is not null;

-- ---------------------------------------------------------------------------
-- Rate limiting (token bucket). Returns 0 when granted, otherwise the number of
-- seconds until `p_cost` tokens will be available (nothing is consumed then).
-- ---------------------------------------------------------------------------
create table public.rate_limit_buckets (
  key         text primary key check (char_length(key) <= 100),
  tokens      double precision not null,
  updated_at  timestamptz not null default now()
);

create or replace function private.take_tokens(
  p_key text, p_cost double precision, p_capacity double precision, p_refill_per_sec double precision
)
returns double precision
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.rate_limit_buckets;
  available double precision;
begin
  if p_cost <= 0 or p_capacity <= 0 or p_refill_per_sec <= 0 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;
  if p_cost > p_capacity then
    raise exception 'cost exceeds bucket capacity' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets (key, tokens) values (p_key, p_capacity)
  on conflict (key) do nothing;
  select * into b from public.rate_limit_buckets where key = p_key for update;

  available := least(p_capacity, b.tokens + extract(epoch from (now() - b.updated_at)) * p_refill_per_sec);
  if available >= p_cost then
    update public.rate_limit_buckets set tokens = available - p_cost, updated_at = now() where key = p_key;
    return 0;
  end if;
  update public.rate_limit_buckets set tokens = available, updated_at = now() where key = p_key;
  return (p_cost - available) / p_refill_per_sec;
end;
$$;

-- Lets the worker drain a bucket after an upstream "quota exceeded" response.
create or replace function private.drain_tokens(p_key text, p_seconds_until_refill double precision, p_refill_per_sec double precision)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rate_limit_buckets (key, tokens, updated_at)
  values (p_key, -greatest(p_seconds_until_refill, 0) * p_refill_per_sec, now())
  on conflict (key) do update set tokens = excluded.tokens, updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Source health (global per public source; contains no tenant data)
-- ---------------------------------------------------------------------------
create table public.source_health (
  provider        public.integration_provider primary key,
  status          text not null check (status in ('ok', 'degraded', 'error', 'not_configured')),
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text check (char_length(last_error) <= 500),
  detail          jsonb not null default '{}'::jsonb,   -- e.g. {"rate_limit_remaining": 27}
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs: postpone without consuming an attempt (rate limits are not failures).
-- ---------------------------------------------------------------------------
create or replace function private.defer_job(p_job_id uuid, p_worker text, p_seconds integer, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs
     set status = 'queued',
         attempts = greatest(attempts - 1, 0),
         run_after = now() + make_interval(secs => greatest(p_seconds, 1)),
         locked_by = null,
         locked_until = null,
         last_error = left(p_reason, 2000)
   where id = p_job_id and status = 'running' and locked_by = p_worker
  returning * into j;
  if j.id is null then
    return false;
  end if;
  insert into public.job_runs (job_id, workspace_id, attempt, worker, status, finished_at, error)
  values (j.id, j.workspace_id, j.attempts + 1, p_worker, 'queued', now(), left('deferred: ' || p_reason, 2000));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monitoring queries derived from enabled keywords.
--   hackernews, stackexchange: one query per keyword (their search has no OR)
--   github, youtube:           one combined OR query per product (saves quota)
-- At most 5 keywords per source; exact names, domains and repos first.
-- ---------------------------------------------------------------------------
create or replace function private.sync_monitoring_queries(p_product_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  terms text[];
  combined text;
  synced integer := 0;
begin
  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    return 0;
  end if;
  -- End users may only sync their own workspace's products (service role / migrations have no uid).
  if (select auth.uid()) is not null and not private.has_workspace_role(ws, 'admin') then
    raise exception 'Product not found' using errcode = '42501';
  end if;

  select coalesce(array_agg(term order by rank, created_at, term), '{}') into terms
    from (
      select a.term, a.created_at,
             case a.kind when 'exact_name' then 0 when 'domain' then 1 when 'custom' then 2
                         when 'handle' then 3 when 'abbreviation' then 4 else 5 end as rank
        from public.product_aliases a
       where a.product_id = p_product_id and a.enabled
       order by rank, a.created_at, a.term
       limit 5
    ) s;

  -- Disable everything first; the desired set is re-enabled below.
  update public.monitoring_queries set enabled = false
   where product_id = p_product_id and competitor_id is null and enabled;

  if array_length(terms, 1) is null then
    return 0;
  end if;

  insert into public.monitoring_queries (workspace_id, product_id, provider, query, params, enabled)
  select ws, p_product_id, p.provider::public.integration_provider, t.term, jsonb_build_object('terms', jsonb_build_array(t.term)), true
    from unnest(terms) as t(term)
   cross join (values ('hackernews'), ('stackexchange')) as p(provider)
  on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, lower(query))
  do update set enabled = true, params = excluded.params;
  get diagnostics synced = row_count;

  combined := left(array_to_string(terms, ' | '), 256);
  insert into public.monitoring_queries (workspace_id, product_id, provider, query, params, enabled)
  select ws, p_product_id, p.provider::public.integration_provider, combined, jsonb_build_object('terms', to_jsonb(terms)), true
    from (values ('github'), ('youtube')) as p(provider)
  on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, lower(query))
  do update set enabled = true, params = excluded.params;

  return synced + 2;
end;
$$;

-- Keep queries in sync whenever keywords are replaced.
create or replace function public.replace_product_aliases(p_product_id uuid, p_aliases jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws uuid;
  inserted integer;
begin
  if jsonb_typeof(p_aliases) <> 'array' or jsonb_array_length(p_aliases) > 50 then
    raise exception 'Aliases must be an array of at most 50 items' using errcode = '22023';
  end if;

  select p.workspace_id into ws from public.products p where p.id = p_product_id;
  if ws is null or not private.has_workspace_role(ws, 'admin') then
    raise exception 'Product not found' using errcode = '42501';
  end if;

  delete from public.product_aliases where product_id = p_product_id;

  insert into public.product_aliases
    (workspace_id, product_id, term, kind, is_ambiguous, context_terms, negative_terms, enabled, source)
  select ws, p_product_id,
         btrim(a ->> 'term'),
         coalesce((a ->> 'kind')::public.alias_kind, 'custom'),
         coalesce((a ->> 'is_ambiguous')::boolean, false),
         coalesce(array(select jsonb_array_elements_text(a -> 'context_terms')), '{}'),
         coalesce(array(select jsonb_array_elements_text(a -> 'negative_terms')), '{}'),
         coalesce((a ->> 'enabled')::boolean, true),
         coalesce(a ->> 'source', 'user')
    from jsonb_array_elements(p_aliases) a;

  get diagnostics inserted = row_count;
  perform private.sync_monitoring_queries(p_product_id);
  return inserted;
end;
$$;

-- `replace_product_aliases` runs as the user; the sync it calls is definer-owned.
grant execute on function private.sync_monitoring_queries(uuid) to authenticated;

-- Backfill products created before this migration.
select private.sync_monitoring_queries(id) from public.products;

-- ---------------------------------------------------------------------------
-- Scheduler: turn due queries into jobs. Interval comes from the workspace's
-- effective plan; YouTube runs at most daily (shared 10k-unit/day quota).
-- ---------------------------------------------------------------------------
create or replace function private.schedule_due_queries(p_providers text[], p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  scheduled integer := 0;
  mins integer;
begin
  for q in
    select mq.id, mq.workspace_id, mq.product_id, mq.provider, pl.monitoring_interval_minutes
      from public.monitoring_queries mq
      join public.products p on p.id = mq.product_id and p.archived_at is null
      join public.plans pl on pl.id = private.effective_plan_id(mq.workspace_id)
     where mq.enabled
       and mq.competitor_id is null
       and mq.next_run_at <= now()
       and mq.provider::text = any (p_providers)
     order by mq.next_run_at
     limit greatest(1, least(p_limit, 1000))
     for update of mq skip locked
  loop
    mins := greatest(q.monitoring_interval_minutes, case when q.provider = 'youtube' then 1440 else 15 end);
    perform private.enqueue_job(
      'monitor.query',
      'mq:' || q.id || ':' || floor(extract(epoch from now()) / (mins * 60))::bigint,
      jsonb_build_object('query_id', q.id),
      q.workspace_id, q.product_id, now(), 4, 100::smallint);
    -- Small jitter spreads load when many queries share a schedule.
    update public.monitoring_queries
       set next_run_at = now() + make_interval(secs => mins * 60 * (1 + random() * 0.05))
     where id = q.id;
    scheduled := scheduled + 1;
  end loop;
  return scheduled;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scans: enqueue one job per enabled query on the requested sources.
-- Re-requesting while a recent scan is still running returns that scan.
-- Authorization is checked by the server before calling.
-- ---------------------------------------------------------------------------
create or replace function private.start_scan(
  p_product_id uuid, p_user_id uuid, p_kind text, p_providers text[], p_lookback_days integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  sid uuid;
  q record;
begin
  select workspace_id into ws from public.products where id = p_product_id and archived_at is null;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  select s.id into sid
    from public.scans s
   where s.product_id = p_product_id
     and s.created_at > now() - interval '15 minutes'
     and exists (select 1 from public.jobs j where j.scan_id = s.id and j.status in ('queued', 'running'))
   order by s.created_at desc
   limit 1;
  if sid is not null then
    return sid;
  end if;

  insert into public.scans (workspace_id, product_id, kind, lookback_days, requested_by)
  values (ws, p_product_id, p_kind, p_lookback_days, p_user_id)
  returning id into sid;

  for q in
    select mq.id, mq.provider
      from public.monitoring_queries mq
     where mq.product_id = p_product_id and mq.enabled and mq.competitor_id is null
       and mq.provider::text = any (p_providers)
  loop
    insert into public.jobs (kind, idempotency_key, payload, workspace_id, product_id, max_attempts, priority, scan_id)
    values ('monitor.query', 'scan:' || sid || ':' || q.id,
            jsonb_build_object('query_id', q.id, 'since', now() - make_interval(days => p_lookback_days), 'max_pages', 3),
            ws, p_product_id, 3, 50, sid);
    -- The scan covers "now"; the regular schedule resumes one interval later.
    update public.monitoring_queries mq2
       set next_run_at = greatest(mq2.next_run_at, now() + interval '1 hour')
     where mq2.id = q.id;
  end loop;

  return sid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion. Items are pre-normalized and pre-filtered for relevance by the
-- worker. Guarantees:
--   * one row per (product, source, external_id); re-seen items refresh
--     engagement and never overwrite a user's relevance decision
--   * exact duplicates (same content hash) and reposts (same linked URL) are
--     stored but linked to the earliest original, so they are not counted as
--     independent reports. Short texts are never hashed (see worker).
--   * new rows count against the plan's monthly mention limit; excess items
--     are dropped and reported, never silently.
-- ---------------------------------------------------------------------------
create or replace function private.ingest_mentions(
  p_product_id uuid, p_source public.integration_provider, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  lim integer;
  used bigint;
  period date := date_trunc('month', now())::date;
  it jsonb;
  existing uuid;
  canon uuid;
  kind public.dedup_kind;
  new_id uuid;
  n_inserted integer := 0;
  n_updated integer := 0;
  n_dupes integer := 0;
  n_over integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then
    raise exception 'items must be an array of at most 1000 elements' using errcode = '22023';
  end if;

  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  select monthly_mention_limit into lim from public.plans where id = private.effective_plan_id(ws);

  -- Serialize ingestion per workspace so concurrent jobs cannot overshoot the limit.
  insert into public.usage_counters (workspace_id, period_start, metric, amount)
  values (ws, period, 'mentions_ingested', 0)
  on conflict (workspace_id, period_start, metric) do nothing;
  select amount into used from public.usage_counters
   where workspace_id = ws and period_start = period and metric = 'mentions_ingested'
   for update;

  for it in select * from jsonb_array_elements(p_items) loop
    select m.id into existing from public.mentions m
     where m.product_id = p_product_id and m.source = p_source and m.external_id = it ->> 'external_id';

    if existing is not null then
      update public.mentions m
         set engagement = coalesce(it -> 'engagement', m.engagement),
             engagement_score = coalesce((it ->> 'engagement_score')::bigint, m.engagement_score),
             title = coalesce(it ->> 'title', m.title),
             content = coalesce(it ->> 'content', m.content),
             matched_terms = coalesce(array(select jsonb_array_elements_text(it -> 'matched_terms')), m.matched_terms),
             relevance_score = coalesce((it ->> 'relevance_score')::real, m.relevance_score),
             relevance_status = case
               when m.relevance_status in ('user_relevant', 'user_irrelevant') then m.relevance_status
               else coalesce((it ->> 'relevance_status')::public.relevance_status, m.relevance_status) end
       where m.id = existing;
      n_updated := n_updated + 1;
      continue;
    end if;

    if used + n_inserted >= lim then
      n_over := n_over + 1;
      continue;
    end if;

    canon := null;
    kind := 'original';
    if it ->> 'linked_url' is not null then
      select m.id into canon from public.mentions m
       where m.product_id = p_product_id and m.linked_url = it ->> 'linked_url' and m.dedup_kind = 'original'
       order by m.published_at, m.id limit 1;
      if canon is not null then kind := 'repost'; end if;
    end if;
    if canon is null and it ->> 'content_hash' is not null then
      select m.id into canon from public.mentions m
       where m.product_id = p_product_id and m.content_hash = it ->> 'content_hash' and m.dedup_kind = 'original'
       order by m.published_at, m.id limit 1;
      if canon is not null then kind := 'exact_duplicate'; end if;
    end if;

    insert into public.mentions (
      workspace_id, product_id, source, external_id, source_url, parent_external_id,
      author_external_id, author_display, title, content, content_hash, language,
      published_at, engagement, engagement_score, matched_terms, relevance_score,
      relevance_status, dedup_kind, canonical_mention_id, processing_status, linked_url, retain_until)
    values (
      ws, p_product_id, p_source, it ->> 'external_id', it ->> 'source_url', it ->> 'parent_external_id',
      it ->> 'author_external_id', it ->> 'author_display', it ->> 'title', it ->> 'content', it ->> 'content_hash',
      it ->> 'language', (it ->> 'published_at')::timestamptz, coalesce(it -> 'engagement', '{}'::jsonb),
      coalesce((it ->> 'engagement_score')::bigint, 0),
      coalesce(array(select jsonb_array_elements_text(it -> 'matched_terms')), '{}'),
      (it ->> 'relevance_score')::real,
      coalesce((it ->> 'relevance_status')::public.relevance_status, 'pending'),
      kind, canon, 'filtered', it ->> 'linked_url', (it ->> 'retain_until')::timestamptz)
    on conflict (product_id, source, external_id) do nothing
    returning id into new_id;

    if new_id is null then
      n_updated := n_updated + 1;   -- inserted concurrently by another job
    else
      n_inserted := n_inserted + 1;
      if kind <> 'original' then n_dupes := n_dupes + 1; end if;
    end if;
    new_id := null;
  end loop;

  if n_inserted > 0 then
    update public.usage_counters set amount = amount + n_inserted, updated_at = now()
     where workspace_id = ws and period_start = period and metric = 'mentions_ingested';
  end if;

  return jsonb_build_object('inserted', n_inserted, 'updated', n_updated, 'duplicates', n_dupes,
                            'over_limit', n_over, 'limit', lim, 'used', used + n_inserted);
end;
$$;

-- Retention: delete mentions past their platform retention date.
create or replace function private.purge_expired_mentions(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.mentions
   where id in (select id from public.mentions where retain_until < now() limit greatest(1, least(p_limit, 10000)));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants & policies
-- ---------------------------------------------------------------------------
alter table public.scans enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.source_health enable row level security;
revoke all on public.scans, public.rate_limit_buckets, public.source_health from anon, authenticated;
grant all on public.scans, public.rate_limit_buckets, public.source_health to service_role;

grant select on public.scans to authenticated;
create policy scans_read on public.scans for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

grant select on public.source_health to authenticated;
create policy source_health_read on public.source_health for select to authenticated using (true);

grant select (scan_id) on public.jobs to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'private.take_tokens(text, double precision, double precision, double precision)',
    'private.drain_tokens(text, double precision, double precision)',
    'private.defer_job(uuid, text, integer, text)',
    'private.schedule_due_queries(text[], integer)',
    'private.start_scan(uuid, uuid, text, text[], integer)',
    'private.ingest_mentions(uuid, public.integration_provider, jsonb)',
    'private.purge_expired_mentions(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Service-role wrappers (the `private` schema is not exposed by the Data API)
-- ---------------------------------------------------------------------------
create or replace function public.svc_claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer, p_kinds text[] default null, p_scan_id uuid default null)
returns setof public.jobs language plpgsql security definer set search_path = '' as $$
begin
  if p_scan_id is null then
    return query select * from private.claim_jobs(p_worker, p_limit, p_lease_seconds, p_kinds);
    return;
  end if;
  -- Scan-scoped claim: used right after a user starts a scan, so that scan's
  -- jobs run immediately instead of waiting behind the global queue.
  return query
  with candidates as (
    select j.id from public.jobs j
     where j.scan_id = p_scan_id
       and ((j.status = 'queued' and j.run_after <= now()) or (j.status = 'running' and j.locked_until < now()))
     order by j.priority, j.run_after
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  )
  update public.jobs j
     set status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from candidates c where j.id = c.id
  returning j.*;
end $$;

create or replace function public.svc_complete_job(p_job_id uuid, p_worker text, p_result jsonb, p_metrics jsonb)
returns boolean language sql security definer set search_path = '' as $$
  select private.complete_job(p_job_id, p_worker, p_result, p_metrics);
$$;

create or replace function public.svc_fail_job(p_job_id uuid, p_worker text, p_error text, p_retryable boolean, p_retry_after_seconds integer default null)
returns public.job_status language sql security definer set search_path = '' as $$
  select private.fail_job(p_job_id, p_worker, p_error, p_retryable, 30, p_retry_after_seconds);
$$;

create or replace function public.svc_defer_job(p_job_id uuid, p_worker text, p_seconds integer, p_reason text)
returns boolean language sql security definer set search_path = '' as $$
  select private.defer_job(p_job_id, p_worker, p_seconds, p_reason);
$$;

create or replace function public.svc_try_acquire_lock(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean language sql security definer set search_path = '' as $$
  select private.try_acquire_lock(p_name, p_holder, p_ttl_seconds);
$$;

create or replace function public.svc_release_lock(p_name text, p_holder text)
returns void language sql security definer set search_path = '' as $$
  select private.release_lock(p_name, p_holder);
$$;

create or replace function public.svc_take_tokens(p_key text, p_cost double precision, p_capacity double precision, p_refill_per_sec double precision)
returns double precision language sql security definer set search_path = '' as $$
  select private.take_tokens(p_key, p_cost, p_capacity, p_refill_per_sec);
$$;

create or replace function public.svc_drain_tokens(p_key text, p_seconds_until_refill double precision, p_refill_per_sec double precision)
returns void language sql security definer set search_path = '' as $$
  select private.drain_tokens(p_key, p_seconds_until_refill, p_refill_per_sec);
$$;

create or replace function public.svc_schedule_due_queries(p_providers text[], p_limit integer)
returns integer language sql security definer set search_path = '' as $$
  select private.schedule_due_queries(p_providers, p_limit);
$$;

create or replace function public.svc_start_scan(p_product_id uuid, p_user_id uuid, p_kind text, p_providers text[], p_lookback_days integer)
returns uuid language sql security definer set search_path = '' as $$
  select private.start_scan(p_product_id, p_user_id, p_kind, p_providers, p_lookback_days);
$$;

create or replace function public.svc_ingest_mentions(p_product_id uuid, p_source public.integration_provider, p_items jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ingest_mentions(p_product_id, p_source, p_items);
$$;

create or replace function public.svc_purge_expired_mentions(p_limit integer)
returns integer language sql security definer set search_path = '' as $$
  select private.purge_expired_mentions(p_limit);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.svc_claim_jobs(text, integer, integer, text[], uuid)',
    'public.svc_complete_job(uuid, text, jsonb, jsonb)',
    'public.svc_fail_job(uuid, text, text, boolean, integer)',
    'public.svc_defer_job(uuid, text, integer, text)',
    'public.svc_try_acquire_lock(text, text, integer)',
    'public.svc_release_lock(text, text)',
    'public.svc_take_tokens(text, double precision, double precision, double precision)',
    'public.svc_drain_tokens(text, double precision, double precision)',
    'public.svc_schedule_due_queries(text[], integer)',
    'public.svc_start_scan(uuid, uuid, text, text[], integer)',
    'public.svc_ingest_mentions(uuid, public.integration_provider, jsonb)',
    'public.svc_purge_expired_mentions(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
