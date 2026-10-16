-- Subscription restructure + mention-based allowances (additive; nothing is dropped
-- or deleted).
--
--   * Plans: Free $0 / Pro $100 / Scale $300. The old Starter ($9) and Business ($49)
--     plans are retired: hidden (is_public = false, retired_at set) but kept, so any
--     subscription row referencing them stays valid. Pro is repriced.
--   * New plan columns: max_keywords (active keywords per workspace),
--     keyword_refresh_target_minutes (target, not a guarantee), scheduling_priority.
--   * Paid-source operating budgets (internal, not customer credits): Free $0,
--     Pro $25, Scale $75 per workspace per month (plan_paid_allowances).
--   * Billing periods follow the subscription's own period (anchored on its start
--     day, not the calendar month); new subscriptions start their period at signup.
--   * mention_usage_periods: allowance, billable mentions consumed, held overflow,
--     exhaustion time — one row per workspace per billing period, updated under a
--     row lock so concurrent workers cannot exceed the allowance.
--   * Billable mention (interim policy until AI relevance exists): a NEW stored
--     mention that is an original (not a repost / exact duplicate) whose rule-based
--     status is "relevant", or that the team marks relevant. Re-seen items, empty
--     searches, failed requests, "needs review" and excluded items never count.
--     Marking a billed mention not relevant refunds it within the same period only.
--   * At 100 %: billable mentions are held in a bounded overflow queue (not shown,
--     not counted, not discarded) — at most 1,000 per workspace per period, kept 30
--     days after the period ends; beyond that only a count is kept. Paid collection
--     pauses until the allowance renews; free sources slow to daily.
--   * Metering starts when this migration runs: mentions stored earlier are not
--     counted (no retroactive billing).

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
alter table public.plans
  add column max_keywords integer not null default 10 check (max_keywords between 0 and 50),
  add column keyword_refresh_target_minutes integer not null default 10080
    check (keyword_refresh_target_minutes between 60 and 10080),
  add column scheduling_priority smallint not null default 0 check (scheduling_priority between 0 and 10),
  add column retired_at timestamptz;

update public.plans set
  name = 'Free', description = 'For testing and evaluating SignalForge.', price_cents_monthly = 0,
  max_products = 1, max_competitors_per_product = 0, monthly_mention_limit = 100, history_days = 30,
  monitoring_interval_minutes = 1440, max_keywords = 1, keyword_refresh_target_minutes = 10080,
  scheduling_priority = 0, is_public = true, sort_order = 0, retired_at = null
where id = 'free';

update public.plans set
  name = 'Pro', description = 'Automatic Smart Monitoring across every supported platform.', price_cents_monthly = 10000,
  max_products = 3, max_competitors_per_product = 3, monthly_mention_limit = 15000, history_days = 365,
  monitoring_interval_minutes = 60, max_keywords = 10, keyword_refresh_target_minutes = 1440,
  scheduling_priority = 1, is_public = true, sort_order = 1, retired_at = null
where id = 'pro';

insert into public.plans
  (id, name, description, price_cents_monthly, max_products, max_competitors_per_product,
   monthly_mention_limit, history_days, monitoring_interval_minutes, monthly_ai_token_budget, monthly_investigations,
   features, sort_order, max_keywords, keyword_refresh_target_minutes, scheduling_priority)
values
  ('scale', 'Scale', 'More keywords and mentions, faster keyword refresh targets and higher monitoring priority.', 30000,
   10, 5, 50000, 730, 60, 30000000, 40,
   '{"weekly_reports": true, "daily_reports": true, "feedback_intelligence": true, "advanced_analytics": true, "byok": true, "advanced_integrations": true}',
   2, 40, 360, 2)
on conflict (id) do nothing;

-- Retired: hidden from pricing, kept for referential integrity (no subscriber is moved).
update public.plans set is_public = false, retired_at = now(), sort_order = 90,
  max_keywords = case id when 'business' then 40 else 10 end,
  keyword_refresh_target_minutes = case id when 'business' then 360 else 1440 end,
  description = 'Retired plan (replaced by Free / Pro / Scale on 2026-10-16).'
where id in ('starter', 'business');

insert into public.plan_paid_allowances (plan_id, monthly_usd, boost_min_interval_minutes, max_boost_paid_checks, max_searches_per_platform)
values ('free', 0, 360, 0, 2), ('pro', 25, 60, 400, 2), ('scale', 75, 60, 1500, 4)
on conflict (plan_id) do update set
  monthly_usd = excluded.monthly_usd, boost_min_interval_minutes = excluded.boost_min_interval_minutes,
  max_boost_paid_checks = excluded.max_boost_paid_checks, max_searches_per_platform = excluded.max_searches_per_platform;

-- New subscriptions start their billing period at signup (Stripe overwrites both later).
alter table public.subscriptions
  alter column current_period_start set default now(),
  alter column current_period_end set default (now() + interval '1 month');

-- ---------------------------------------------------------------------------
-- Billing period: the subscription's stored period, rolled forward (or back) in
-- whole months from it when `at` lies outside it. The anchor day is preserved
-- (Jan 31 → Feb 28 → Mar 31). No subscription: calendar month.
-- ---------------------------------------------------------------------------
create or replace function private.billing_period(ws uuid, at timestamptz default now())
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s timestamptz;
  e timestamptz;
  anchor timestamptz;
  k integer;
begin
  select sub.current_period_start, sub.current_period_end into s, e from public.subscriptions sub where sub.workspace_id = ws;
  if s is null or e is null or e <= s then
    s := date_trunc('month', at);
    e := s + interval '1 month';
  end if;
  if at >= s and at < e then
    return query select s, e;
    return;
  end if;
  -- Monthly steps from the stored start keep its day; a shorter stored period (e.g.
  -- a trial) ends where it ends.
  anchor := s;
  k := (extract(year from age(at, anchor)) * 12 + extract(month from age(at, anchor)))::integer;
  while anchor + make_interval(months => k) > at loop k := k - 1; end loop;
  while anchor + make_interval(months => k + 1) <= at loop k := k + 1; end loop;
  return query select case when at >= e then greatest(anchor + make_interval(months => k), e) else anchor + make_interval(months => k) end,
                      anchor + make_interval(months => k + 1);
end;
$$;

revoke all on function private.billing_period(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.is_paid_provider(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p in ('reddit', 'x', 'linkedin', 'tiktok', 'instagram', 'facebook', 'substack', 'web', 'news', 'trustpilot');
$$;

-- ---------------------------------------------------------------------------
-- Usage periods
-- ---------------------------------------------------------------------------
create table public.mention_usage_periods (
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  -- Plan and allowance in force (updated when the plan changes mid-period).
  plan_id             text not null,
  mention_allowance   integer not null check (mention_allowance >= 0),
  mentions_consumed   integer not null default 0 check (mentions_consumed >= 0),
  -- Billable mentions found after the allowance was used up.
  mentions_held       integer not null default 0 check (mentions_held >= 0),
  mentions_not_held   integer not null default 0 check (mentions_not_held >= 0),
  mentions_released   integer not null default 0 check (mentions_released >= 0),
  -- Mentions stored before this are never billed in this period.
  metering_started_at timestamptz not null default now(),
  exhausted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (workspace_id, period_start),
  check (period_end > period_start)
);

create trigger mention_usage_periods_touch before update on public.mention_usage_periods
  for each row execute function private.touch_updated_at();

alter table public.mention_usage_periods enable row level security;
grant select on public.mention_usage_periods to authenticated;
create policy usage_periods_read on public.mention_usage_periods for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

alter table public.mentions add column billed_period_start timestamptz;
create index mentions_billed_idx on public.mentions (workspace_id, billed_period_start) where billed_period_start is not null;

-- Held billable mentions. Not readable by users (it would bypass the allowance).
create table public.mention_overflow (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  source        public.integration_provider not null,
  external_id   text not null check (char_length(external_id) <= 300),
  period_start  timestamptz not null,
  item          jsonb not null,
  found_at      timestamptz not null default now(),
  released_at   timestamptz,
  expires_at    timestamptz not null,
  unique (product_id, source, external_id)
);
create index mention_overflow_ws_idx on public.mention_overflow (workspace_id, found_at) where released_at is null;
alter table public.mention_overflow enable row level security;

-- Current period row for a workspace, created on demand, LOCKED, plan synced.
create or replace function private.lock_usage_period(ws uuid)
returns public.mention_usage_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  per record;
  pl public.plans;
  u public.mention_usage_periods;
begin
  select * into per from private.billing_period(ws, now());
  select * into pl from public.plans where id = private.effective_plan_id(ws);
  insert into public.mention_usage_periods (workspace_id, period_start, period_end, plan_id, mention_allowance)
  values (ws, per.period_start, per.period_end, pl.id, pl.monthly_mention_limit)
  on conflict (workspace_id, period_start) do nothing;
  select * into u from public.mention_usage_periods
   where workspace_id = ws and period_start = per.period_start for update;
  -- Upgrades raise the allowance at once; downgrades lower it (existing mentions stay).
  if u.plan_id <> pl.id or u.mention_allowance <> pl.monthly_mention_limit then
    update public.mention_usage_periods
       set plan_id = pl.id, mention_allowance = pl.monthly_mention_limit,
           exhausted_at = case when mentions_consumed >= pl.monthly_mention_limit then coalesce(exhausted_at, now()) end
     where workspace_id = ws and period_start = per.period_start
     returning * into u;
  end if;
  return u;
end;
$$;

revoke all on function private.lock_usage_period(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ingestion v3: billable metering + overflow. Dedup and user decisions unchanged.
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
  u public.mention_usage_periods;
  legacy_period date := date_trunc('month', now())::date;
  it jsonb;
  existing uuid;
  canon uuid;
  kind public.dedup_kind;
  new_id uuid;
  billable boolean;
  held_id uuid;
  n_inserted integer := 0;
  n_updated integer := 0;
  n_dupes integer := 0;
  n_billed integer := 0;
  n_held integer := 0;
  n_not_held integer := 0;
  n_already_held integer := 0;
  overflow_cap constant integer := 1000;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then
    raise exception 'items must be an array of at most 1000 elements' using errcode = '22023';
  end if;

  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  -- Serializes ingestion per workspace: concurrent jobs cannot overshoot the allowance.
  u := private.lock_usage_period(ws);

  -- Operational counter (all new rows, any kind), kept for continuity.
  insert into public.usage_counters (workspace_id, period_start, metric, amount)
  values (ws, legacy_period, 'mentions_ingested', 0)
  on conflict (workspace_id, period_start, metric) do nothing;

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

    billable := kind = 'original' and coalesce(it ->> 'relevance_status', 'pending') in ('relevant', 'user_relevant');

    if billable and u.mentions_consumed + n_billed >= u.mention_allowance then
      -- Allowance used up: hold it (bounded), never silently discard.
      if u.mentions_held + n_held >= overflow_cap then
        n_not_held := n_not_held + 1;
        continue;
      end if;
      held_id := null;
      insert into public.mention_overflow (workspace_id, product_id, source, external_id, period_start, item, expires_at)
      values (ws, p_product_id, p_source, it ->> 'external_id', u.period_start, it, u.period_end + interval '30 days')
      on conflict (product_id, source, external_id) do nothing
      returning id into held_id;
      if held_id is null then n_already_held := n_already_held + 1; else n_held := n_held + 1; end if;
      continue;
    end if;

    insert into public.mentions (
      workspace_id, product_id, source, external_id, source_url, parent_external_id,
      author_external_id, author_display, title, content, content_hash, language,
      published_at, engagement, engagement_score, matched_terms, relevance_score,
      relevance_status, dedup_kind, canonical_mention_id, processing_status, linked_url, retain_until,
      mention_type, collection_method, data_provider, community, link_target, published_at_estimated,
      billed_period_start)
    values (
      ws, p_product_id, p_source, it ->> 'external_id', it ->> 'source_url', it ->> 'parent_external_id',
      it ->> 'author_external_id', it ->> 'author_display', it ->> 'title', it ->> 'content', it ->> 'content_hash',
      it ->> 'language', (it ->> 'published_at')::timestamptz, coalesce(it -> 'engagement', '{}'::jsonb),
      coalesce((it ->> 'engagement_score')::bigint, 0),
      coalesce(array(select jsonb_array_elements_text(it -> 'matched_terms')), '{}'),
      (it ->> 'relevance_score')::real,
      coalesce((it ->> 'relevance_status')::public.relevance_status, 'pending'),
      kind, canon, 'filtered', it ->> 'linked_url', (it ->> 'retain_until')::timestamptz,
      coalesce(it ->> 'mention_type', 'post'), coalesce(it ->> 'collection_method', 'keyword_search'),
      coalesce(it ->> 'data_provider', 'official'), left(it ->> 'community', 200),
      coalesce(it ->> 'link_target', 'item'), coalesce((it ->> 'published_at_estimated')::boolean, false),
      case when billable then u.period_start end)
    on conflict (product_id, source, external_id) do nothing
    returning id into new_id;

    if new_id is null then
      n_updated := n_updated + 1;
    else
      n_inserted := n_inserted + 1;
      if kind <> 'original' then n_dupes := n_dupes + 1; end if;
      if billable then n_billed := n_billed + 1; end if;
    end if;
    new_id := null;
  end loop;

  if n_inserted > 0 then
    update public.usage_counters set amount = amount + n_inserted, updated_at = now()
     where workspace_id = ws and period_start = legacy_period and metric = 'mentions_ingested';
  end if;
  if n_billed > 0 or n_held > 0 or n_not_held > 0 then
    update public.mention_usage_periods
       set mentions_consumed = mentions_consumed + n_billed,
           mentions_held = mentions_held + n_held,
           mentions_not_held = mentions_not_held + n_not_held,
           exhausted_at = case when mentions_consumed + n_billed >= mention_allowance then coalesce(exhausted_at, now()) else exhausted_at end
     where workspace_id = ws and period_start = u.period_start
     returning * into u;
  end if;

  return jsonb_build_object('inserted', n_inserted, 'updated', n_updated, 'duplicates', n_dupes,
                            'billable', n_billed, 'held', n_held, 'already_held', n_already_held, 'not_held', n_not_held,
                            'over_limit', n_held + n_not_held + n_already_held,
                            'limit', u.mention_allowance, 'used', u.mentions_consumed,
                            'period_start', u.period_start, 'period_end', u.period_end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Relevance changes adjust the CURRENT period only.
-- ---------------------------------------------------------------------------
create or replace function private.mention_relevance_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.mention_usage_periods;
  now_relevant boolean := new.relevance_status in ('relevant', 'user_relevant');
  was_relevant boolean := old.relevance_status in ('relevant', 'user_relevant');
begin
  if now_relevant = was_relevant then
    return null;
  end if;
  if new.billed_period_start is not null and not now_relevant then
    u := private.lock_usage_period(new.workspace_id);
    if new.billed_period_start = u.period_start then
      update public.mentions set billed_period_start = null where id = new.id;
      update public.mention_usage_periods
         set mentions_consumed = greatest(0, mentions_consumed - 1),
             exhausted_at = case when mentions_consumed - 1 >= mention_allowance then exhausted_at end
       where workspace_id = u.workspace_id and period_start = u.period_start;
    end if;
  elsif new.billed_period_start is null and now_relevant and new.dedup_kind = 'original' then
    u := private.lock_usage_period(new.workspace_id);
    -- Bill only mentions stored during metering in this period, and only while allowance remains.
    if new.created_at >= greatest(u.period_start, u.metering_started_at) and u.mentions_consumed < u.mention_allowance then
      update public.mentions set billed_period_start = u.period_start where id = new.id;
      update public.mention_usage_periods
         set mentions_consumed = mentions_consumed + 1,
             exhausted_at = case when mentions_consumed + 1 >= mention_allowance then coalesce(exhausted_at, now()) else exhausted_at end
       where workspace_id = u.workspace_id and period_start = u.period_start;
    end if;
  end if;
  return null;
end;
$$;

create trigger mentions_relevance_billing after update of relevance_status on public.mentions
  for each row execute function private.mention_relevance_billing();

-- ---------------------------------------------------------------------------
-- Held mentions: delivered (and billed to the CURRENT period) only when an admin
-- asks and allowance remains — e.g. after an upgrade. Oldest first.
-- ---------------------------------------------------------------------------
create or replace function private.release_held_mentions(ws uuid, p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.mention_usage_periods;
  h record;
  r jsonb;
  released integer := 0;
begin
  u := private.lock_usage_period(ws);
  for h in
    select * from public.mention_overflow
     where workspace_id = ws and released_at is null and expires_at > now()
     order by found_at limit greatest(0, least(p_limit, u.mention_allowance - u.mentions_consumed))
  loop
    delete from public.mention_overflow where id = h.id;  -- frees the unique key for ingestion
    r := private.ingest_mentions(h.product_id, h.source, jsonb_build_array(h.item));
    if (r ->> 'held')::int > 0 then
      exit;  -- allowance reached again; the item went back to the queue
    end if;
    released := released + 1;
  end loop;
  if released > 0 then
    update public.mention_usage_periods
       set mentions_released = mentions_released + released,
           mentions_held = greatest(0, mentions_held - released)
     where workspace_id = ws and period_start = u.period_start;
  end if;
  return released;
end;
$$;

revoke all on function private.release_held_mentions(uuid, integer) from public, anon, authenticated;

create or replace function public.release_held_mentions(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_workspace_role(p_workspace_id, 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.release_held_mentions(p_workspace_id, 1000);
end;
$$;

revoke all on function public.release_held_mentions(uuid) from public, anon;
grant execute on function public.release_held_mentions(uuid) to authenticated;

-- Retention: expired held mentions are removed with expired mentions.
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
  delete from public.mention_overflow
   where id in (select id from public.mention_overflow where expires_at < now() limit greatest(1, least(p_limit, 10000)));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage summary (billing page, warnings, Smart Monitoring)
-- ---------------------------------------------------------------------------
create or replace function private.workspace_usage(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  per record;
  pl public.plans;
  u public.mention_usage_periods;
  allowance integer;
  consumed integer;
begin
  select * into per from private.billing_period(ws, now());
  select * into pl from public.plans where id = private.effective_plan_id(ws);
  select * into u from public.mention_usage_periods where workspace_id = ws and period_start = per.period_start;
  allowance := pl.monthly_mention_limit;
  consumed := coalesce(u.mentions_consumed, 0);
  return jsonb_build_object(
    'plan_id', pl.id, 'plan_name', pl.name, 'price_cents_monthly', pl.price_cents_monthly,
    'period_start', per.period_start, 'period_end', per.period_end,
    'mention_allowance', allowance, 'mentions_consumed', consumed,
    'mentions_remaining', greatest(0, allowance - consumed),
    'mentions_held', coalesce(u.mentions_held, 0), 'mentions_not_held', coalesce(u.mentions_not_held, 0),
    'exhausted_at', case when consumed >= allowance then coalesce(u.exhausted_at, now()) end,
    'metering_started_at', u.metering_started_at,
    'max_keywords', pl.max_keywords,
    'active_keywords', (select count(*) from public.product_aliases a join public.products p on p.id = a.product_id
                         where a.workspace_id = ws and a.enabled and p.archived_at is null),
    'keyword_refresh_target_minutes', pl.keyword_refresh_target_minutes,
    'monitoring_interval_minutes', pl.monitoring_interval_minutes
  );
end;
$$;

revoke all on function private.workspace_usage(uuid) from public, anon, authenticated;

create or replace function public.workspace_usage(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_workspace_role(p_workspace_id, 'viewer') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.workspace_usage(p_workspace_id);
end;
$$;

revoke all on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.workspace_usage(uuid) to authenticated;

create or replace function public.svc_workspace_usage(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.workspace_usage(p_workspace_id); $$;

revoke all on function public.svc_workspace_usage(uuid) from public, anon, authenticated;
grant execute on function public.svc_workspace_usage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Keyword allowance: active keywords across a workspace's active products.
-- Checked after each insert/enable, under a per-workspace lock. A downgraded
-- workspace keeps its keywords; the server monitors only the allowance (the rest
-- are shown as paused) and new saves must fit.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_keyword_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim integer;
  plan_name text;
  n integer;
begin
  if not new.enabled or exists (select 1 from public.products p where p.id = new.product_id and p.archived_at is not null) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('keywords:' || new.workspace_id::text, 0));
  select p.max_keywords, p.name into lim, plan_name from public.plans p where p.id = private.effective_plan_id(new.workspace_id);
  select count(*) into n from public.product_aliases a join public.products p on p.id = a.product_id
   where a.workspace_id = new.workspace_id and a.enabled and p.archived_at is null;
  if n > coalesce(lim, 0) then
    raise exception 'Your % plan includes % active keyword%. Turn some off or change plan.',
      plan_name, coalesce(lim, 0), case when coalesce(lim, 0) = 1 then '' else 's' end
      using errcode = 'P0001', hint = 'plan_limit:max_keywords';
  end if;
  return null;
end;
$$;

create trigger product_aliases_enforce_limit after insert or update of enabled on public.product_aliases
  for each row execute function private.enforce_keyword_limit();

-- ---------------------------------------------------------------------------
-- Scheduler: plan priority first; paid sources pause while the mention allowance
-- is used up (resume at renewal); free sources slow to daily meanwhile.
-- ---------------------------------------------------------------------------
create or replace function private.allowance_exhausted_until(ws uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select u.period_end from public.mention_usage_periods u, private.billing_period(ws, now()) per
   where u.workspace_id = ws and u.period_start = per.period_start
     and u.mentions_consumed >= u.mention_allowance and u.exhausted_at is not null;
$$;

revoke all on function private.allowance_exhausted_until(uuid) from public, anon, authenticated;

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
  paused_until timestamptz;
begin
  for q in
    select mq.id, mq.workspace_id, mq.product_id, mq.provider, mq.interval_minutes, mq.consecutive_failures,
           pl.monitoring_interval_minutes, pl.scheduling_priority
      from public.monitoring_queries mq
      join public.products p on p.id = mq.product_id and p.archived_at is null
      join public.plans pl on pl.id = private.effective_plan_id(mq.workspace_id)
     where mq.enabled
       and mq.competitor_id is null
       and mq.next_run_at <= now()
       and mq.provider::text = any (p_providers)
     order by pl.scheduling_priority desc, mq.next_run_at
     limit greatest(1, least(p_limit, 1000))
     for update of mq skip locked
  loop
    paused_until := private.allowance_exhausted_until(q.workspace_id);
    if paused_until is not null and private.is_paid_provider(q.provider::text) then
      update public.monitoring_queries
         set next_run_at = paused_until,
             interval_reasons = jsonb_build_array('Paused: this month''s mention allowance is used up. Paid platforms resume when it renews.')
       where id = q.id;
      continue;
    end if;
    mins := coalesce(q.interval_minutes, q.monitoring_interval_minutes);
    mins := greatest(mins, case when q.provider = 'youtube' then 1440 else 60 end);
    if paused_until is not null then
      mins := greatest(mins, 1440);
    end if;
    perform private.enqueue_job(
      'monitor.query',
      'mq:' || q.id || ':' || floor(extract(epoch from now()) / (mins * 60))::bigint
        || case when q.consecutive_failures > 0 then ':f' || q.consecutive_failures else '' end,
      jsonb_build_object('query_id', q.id),
      q.workspace_id, q.product_id, now(), 4, 100::smallint);
    -- Provisional; the job's completion replaces it with the adaptive choice.
    update public.monitoring_queries
       set next_run_at = now() + make_interval(secs => mins * 60 * (1 + random() * 0.05))
     where id = q.id;
    scheduled := scheduled + 1;
  end loop;
  return scheduled;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule context: + keyword allowance and refresh target, priority, allowance
-- pause, and the paid-source budget picture for pacing.
-- ---------------------------------------------------------------------------
create or replace function private.schedule_context(p_product_id uuid, p_platform text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.products where id = p_product_id),
  m as (
    select published_at from public.mentions
     where product_id = p_product_id and source::text = p_platform
       and relevance_status in ('relevant', 'user_relevant') and dedup_kind = 'original'
       and not published_at_estimated and published_at > now() - interval '28 days'
  )
  select jsonb_build_object(
    'workspace_id', p.workspace_id,
    'name', p.name,
    'website_url', p.website_url,
    'app_store_url', p.app_store_url,
    'archived', p.archived_at is not null,
    'mode', p.monitoring_mode,
    'plan_id', pl.id,
    'plan_name', pl.name,
    'plan_min_minutes', pl.monitoring_interval_minutes,
    'max_keywords', pl.max_keywords,
    'keyword_target_minutes', pl.keyword_refresh_target_minutes,
    'scheduling_priority', pl.scheduling_priority,
    'boost_min_minutes', coalesce(a.boost_min_interval_minutes, 60),
    'paid_allowance_usd', coalesce(a.monthly_usd, 0),
    'max_boost_paid_checks', coalesce(a.max_boost_paid_checks, 0),
    'max_searches_per_platform', coalesce(a.max_searches_per_platform, 2),
    'allowance_paused_until', private.allowance_exhausted_until(p.workspace_id),
    'boost', (select jsonb_build_object('id', b.id, 'mode', b.mode, 'ends_at', b.ends_at, 'max_paid_checks', b.max_paid_checks)
                from public.launch_boosts b
               where b.product_id = p.id and b.canceled_at is null and now() between b.starts_at and b.ends_at
                 and p_platform = any (b.platforms::text[])
               order by b.ends_at desc limit 1),
    'last24h', (select count(*) from m where published_at > now() - interval '24 hours'),
    'prev24h', (select count(*) from m where published_at <= now() - interval '24 hours' and published_at > now() - interval '48 hours'),
    'avg7d', (select count(*) from m where published_at > now() - interval '7 days') / 7.0,
    'avg28d', (select count(*) from m) / 28.0,
    'spike', exists (select 1 from public.buzz_spikes s
                      where s.product_id = p.id and (s.platform is null or s.platform::text = p_platform)
                        and s.period_end > now() - interval '48 hours')
  )
  from p
  join public.plans pl on pl.id = private.effective_plan_id(p.workspace_id)
  left join public.plan_paid_allowances a on a.plan_id = pl.id;
$$;

-- Paid budget picture for pacing (internal; never shown to customers as money).
create or replace function public.svc_paid_budget_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'allowance_usd', least(coalesce(a.monthly_usd, 0), coalesce(b.monthly_limit_usd, coalesce(a.monthly_usd, 0))),
    'spent_usd', (select coalesce(sum(private.ledger_amount(l) * al.share), 0)
                    from public.api_cost_allocations al join public.api_cost_ledger l on l.id = al.ledger_id
                   where al.workspace_id = p.workspace_id and l.period_start = date_trunc('month', now())::date),
    'paid_products', (select count(distinct mq.product_id) from public.monitoring_queries mq
                        join public.products pp on pp.id = mq.product_id and pp.archived_at is null
                       where mq.workspace_id = p.workspace_id and mq.enabled and mq.competitor_id is null
                         and private.is_paid_provider(mq.provider::text)),
    'month_end', date_trunc('month', now()) + interval '1 month',
    'prices', (select coalesce(jsonb_object_agg(x.pricing_key, x.price_usd), '{}'::jsonb) from (
                 select distinct on (pricing_key) pricing_key, price_usd from public.provider_pricing
                  where effective_from <= now() order by pricing_key, effective_from desc) x)
  )
  from public.products p
  left join public.plan_paid_allowances a on a.plan_id = private.effective_plan_id(p.workspace_id)
  left join public.api_budgets b on b.scope = 'workspace' and b.workspace_id = p.workspace_id
  where p.id = p_product_id;
$$;

revoke all on function public.svc_paid_budget_context(uuid) from public, anon, authenticated;
grant execute on function public.svc_paid_budget_context(uuid) to service_role;

-- Keyword schedule conflicts per platform (target not reachable within budgets).
alter table public.platform_activity
  add column keyword_target_minutes integer,
  add column slowest_keyword_minutes integer,
  add column keyword_conflict text check (char_length(keyword_conflict) <= 500),
  add column budget_paced boolean not null default false;
