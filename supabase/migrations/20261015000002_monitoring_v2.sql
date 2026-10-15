-- Milestone 2.5: multi-platform monitoring infrastructure.
--   * mention model     type / collection method / link target / provider / estimated dates
--   * query groups      stream + fingerprint + adaptive schedule state on monitoring_queries
--   * source settings   per-product platform selection and monitoring mode
--   * cost control      pricing registry, budgets, atomic reservations, ledger, reconciliation
--   * adaptive engine   execution log, launch boosts, comment-expansion history
-- All changes are additive. Supplier pricing and spend are service-role only:
-- customers never see internal API prices.

-- ---------------------------------------------------------------------------
-- Mentions: richer, platform-neutral model (existing rows keep their meaning)
-- ---------------------------------------------------------------------------
alter table public.mentions
  add column mention_type text not null default 'post'
    check (mention_type in ('post', 'comment', 'reply', 'quote', 'video', 'review', 'article', 'note', 'community_message')),
  add column collection_method text not null default 'keyword_search'
    check (collection_method in ('keyword_search', 'comment_search', 'comment_expansion', 'reply_expansion',
                                 'quote_expansion', 'review_feed', 'tag_feed')),
  add column data_provider text not null default 'official' check (data_provider in ('official', 'apidirect')),
  add column community text check (char_length(community) <= 200),
  -- What `source_url` opens: the item itself, its parent thread (Reddit comment search
  -- returns no comment permalink), the content a link post shares, or a listing page.
  add column link_target text not null default 'item' check (link_target in ('item', 'thread', 'shared_content', 'listing')),
  -- Web search results carry no publication date; discovery time is stored instead
  -- and analytics leave these rows out of time series.
  add column published_at_estimated boolean not null default false;

update public.mentions
   set mention_type = case
         when source = 'youtube' and parent_external_id is null then 'video'
         when parent_external_id is not null then 'comment'
         else 'post' end
 where mention_type = 'post';

create index mentions_analytics_idx on public.mentions (product_id, published_at)
  include (source, relevance_status, dedup_kind, mention_type, engagement_score, author_external_id)
  where not published_at_estimated;

-- ---------------------------------------------------------------------------
-- Monitoring queries become query groups with their own checkpoint + schedule
-- ---------------------------------------------------------------------------
alter table public.monitoring_queries drop constraint if exists monitoring_queries_query_check;
alter table public.monitoring_queries
  add constraint monitoring_queries_query_len check (char_length(query) between 1 and 500),
  -- One platform can have several independently checkpointed streams (Reddit posts / comments).
  add column stream text not null default 'default' check (stream ~ '^[a-z_]{1,32}$'),
  -- sha256 of platform + stream + normalized expression + language/region/filters (shared query registry).
  add column fingerprint text check (fingerprint ~ '^[0-9a-f]{64}$'),
  add column managed_by text not null default 'legacy' check (managed_by in ('legacy', 'optimizer')),
  -- Optimizer explanation: which keywords this group covers, which were skipped and why.
  add column query_plan jsonb not null default '{}'::jsonb,
  add column interval_minutes integer check (interval_minutes between 15 and 10080),
  add column interval_reasons jsonb not null default '[]'::jsonb,
  add column coverage_confidence text check (coverage_confidence in ('high', 'medium', 'low')),
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  add column last_success_at timestamptz,
  add column last_saturated_at timestamptz,
  add column last_audit_at timestamptz;

create unique index monitoring_queries_stream_uniq
  on public.monitoring_queries (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, stream, lower(query));
-- Replaced by the stream-aware index above (an index, not data).
drop index if exists public.monitoring_queries_uniq;
create index monitoring_queries_fingerprint_idx on public.monitoring_queries (fingerprint) where enabled and fingerprint is not null;

-- Users may create/edit queries only through the app's columns, never schedule or cost state.
revoke insert on public.monitoring_queries from authenticated;
grant insert (workspace_id, product_id, competitor_id, provider, query, params, enabled) on public.monitoring_queries to authenticated;

-- Legacy keyword sync (HN / Stack Exchange per term, GitHub / YouTube combined) now
-- touches only its own sources, so optimizer-managed groups are left alone.
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

  update public.monitoring_queries set enabled = false
   where product_id = p_product_id and competitor_id is null and enabled and managed_by = 'legacy'
     and provider in ('hackernews', 'stackexchange', 'github', 'youtube');

  if array_length(terms, 1) is null then
    return 0;
  end if;

  insert into public.monitoring_queries (workspace_id, product_id, provider, query, params, enabled)
  select ws, p_product_id, p.provider::public.integration_provider, t.term, jsonb_build_object('terms', jsonb_build_array(t.term)), true
    from unnest(terms) as t(term)
   cross join (values ('hackernews'), ('stackexchange')) as p(provider)
  on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, stream, lower(query))
  do update set enabled = true, params = excluded.params;
  get diagnostics synced = row_count;

  combined := left(array_to_string(terms, ' | '), 256);
  insert into public.monitoring_queries (workspace_id, product_id, provider, query, params, enabled)
  select ws, p_product_id, p.provider::public.integration_provider, combined, jsonb_build_object('terms', to_jsonb(terms)), true
    from (values ('github'), ('youtube')) as p(provider)
  on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, stream, lower(query))
  do update set enabled = true, params = excluded.params;

  return synced + 2;
end;
$$;

-- Optimizer-managed groups are written by the server (service role) after it
-- computes them from keywords + platform capabilities. Desired set in, rest disabled.
create or replace function private.apply_query_groups(p_product_id uuid, p_groups jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  g jsonb;
  n integer := 0;
begin
  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 200 then
    raise exception 'groups must be an array of at most 200 items' using errcode = '22023';
  end if;

  update public.monitoring_queries set enabled = false
   where product_id = p_product_id and competitor_id is null and managed_by = 'optimizer' and enabled;

  for g in select * from jsonb_array_elements(p_groups) loop
    insert into public.monitoring_queries
      (workspace_id, product_id, provider, stream, query, params, fingerprint, query_plan, managed_by, enabled)
    values (ws, p_product_id, (g ->> 'provider')::public.integration_provider, g ->> 'stream', g ->> 'query',
            coalesce(g -> 'params', '{}'::jsonb), g ->> 'fingerprint', coalesce(g -> 'plan', '{}'::jsonb), 'optimizer', true)
    on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, stream, lower(query))
    do update set enabled = true, params = excluded.params, fingerprint = excluded.fingerprint,
                  query_plan = excluded.query_plan, managed_by = 'optimizer';
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-product platform selection + monitoring mode
-- ---------------------------------------------------------------------------
alter table public.products
  add column monitoring_mode text not null default 'balanced' check (monitoring_mode in ('eco', 'balanced', 'priority'));
grant update (monitoring_mode) on public.products to authenticated;

create table public.product_source_settings (
  workspace_id  uuid not null,
  product_id    uuid not null,
  platform      public.integration_provider not null,
  enabled       boolean not null,
  -- Worker-maintained resolution state (e.g. Trustpilot business found / not found). Not user-writable.
  config        jsonb not null default '{}'::jsonb,
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (product_id, platform),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create trigger product_source_settings_touch before update on public.product_source_settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Pricing registry (single source of truth for estimated charges)
-- ---------------------------------------------------------------------------
create table public.provider_pricing (
  pricing_key        text not null check (pricing_key ~ '^[a-z_]+\.[a-z_]+$'),
  provider           text not null check (provider in ('apidirect')),
  platform           public.integration_provider not null,
  endpoint           text not null check (endpoint ~ '^/v1/[a-z0-9/_]+$'),
  unit               text not null check (unit in ('request', 'page')),
  price_usd          numeric(10, 5) not null check (price_usd >= 0),
  free_per_month     integer not null default 0 check (free_per_month >= 0),
  effective_from     date not null,
  verified_on        date,
  source_url         text not null,
  primary key (pricing_key, effective_from)
);

insert into public.provider_pricing (pricing_key, provider, platform, endpoint, unit, price_usd, free_per_month, effective_from, verified_on, source_url)
values
  ('reddit.posts',             'apidirect', 'reddit',     '/v1/reddit/posts',               'request', 0.003, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('reddit.comments',          'apidirect', 'reddit',     '/v1/reddit/comments',            'page',    0.003, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('x.posts',                  'apidirect', 'x',          '/v1/twitter/posts',              'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('x.tweet_comments',         'apidirect', 'x',          '/v1/twitter/tweet/comments',     'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('x.tweet_quotes',           'apidirect', 'x',          '/v1/twitter/tweet/quotes',       'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('linkedin.posts',           'apidirect', 'linkedin',   '/v1/linkedin/posts',             'request', 0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('tiktok.videos',            'apidirect', 'tiktok',     '/v1/tiktok/videos',              'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('tiktok.video_comments',    'apidirect', 'tiktok',     '/v1/tiktok/video/comments',      'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('instagram.posts',          'apidirect', 'instagram',  '/v1/instagram/posts',            'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('instagram.post_comments',  'apidirect', 'instagram',  '/v1/instagram/post/comments',    'page',    0.006, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('facebook.posts',           'apidirect', 'facebook',   '/v1/facebook/posts',             'page',    0.008, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('facebook.post_comments',   'apidirect', 'facebook',   '/v1/facebook/post/comments',     'page',    0.008, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('substack.posts',           'apidirect', 'substack',   '/v1/substack/posts',             'request', 0.003, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('substack.notes',           'apidirect', 'substack',   '/v1/substack/notes',             'page',    0.003, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('web.search',               'apidirect', 'web',        '/v1/web/search',                 'page',    0.004, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('news.articles',            'apidirect', 'news',       '/v1/news/articles',              'request', 0.008, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('trustpilot.company_reviews','apidirect','trustpilot', '/v1/trustpilot/company/reviews', 'page',    0.005, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing'),
  ('youtube.videos',           'apidirect', 'youtube',    '/v1/youtube/videos',             'page',    0.005, 50, '2026-10-15', '2026-10-15', 'https://apidirect.io/docs/pricing');

-- Unit price in force now for a key.
create or replace function private.current_price(p_key text)
returns public.provider_pricing
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.provider_pricing
   where pricing_key = p_key and effective_from <= current_date
   order by effective_from desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Budgets. Global / provider / platform rows are operator-set (service role).
-- A workspace's monthly allowance comes from its plan (plan_paid_allowances),
-- optionally lowered by a workspace or product row. No global row => no paid calls.
-- ---------------------------------------------------------------------------
create table public.plan_paid_allowances (
  plan_id                     text primary key references public.plans (id) on delete cascade,
  monthly_usd                 numeric(12, 4) not null default 0 check (monthly_usd >= 0),
  -- Shortest refresh interval a Launch Boost may use on this plan.
  boost_min_interval_minutes  integer not null default 60 check (boost_min_interval_minutes >= 60),
  max_boost_paid_checks       integer not null default 0 check (max_boost_paid_checks >= 0)
);

insert into public.plan_paid_allowances (plan_id, monthly_usd, boost_min_interval_minutes, max_boost_paid_checks) values
  ('free', 0, 360, 0), ('starter', 1, 180, 100), ('pro', 5, 60, 400), ('business', 20, 60, 1500);

create table public.api_budgets (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('global', 'provider', 'platform', 'workspace', 'product')),
  provider         text check (provider in ('apidirect')),
  platform         public.integration_provider,
  workspace_id     uuid references public.workspaces (id) on delete cascade,
  product_id       uuid references public.products (id) on delete cascade,
  monthly_limit_usd numeric(12, 4) not null check (monthly_limit_usd >= 0),
  note             text check (char_length(note) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (
    (scope = 'global' and provider is null and platform is null and workspace_id is null and product_id is null) or
    (scope = 'provider' and provider is not null and platform is null and workspace_id is null and product_id is null) or
    (scope = 'platform' and platform is not null and workspace_id is null and product_id is null) or
    (scope = 'workspace' and workspace_id is not null and product_id is null) or
    (scope = 'product' and product_id is not null)
  )
);

create unique index api_budgets_scope_uniq on public.api_budgets
  (scope, provider, platform, workspace_id, product_id) nulls not distinct;

create trigger api_budgets_touch before update on public.api_budgets
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Launch Boost: temporary faster monitoring for selected platforms.
-- Paid platforms need an explicit authorization and a cap on extra paid checks.
-- ---------------------------------------------------------------------------
create table public.launch_boosts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  product_id          uuid not null,
  title               text not null check (char_length(btrim(title)) between 1 and 120),
  platforms           public.integration_provider[] not null check (cardinality(platforms) between 1 and 25),
  mode                text not null default 'priority' check (mode in ('balanced', 'priority')),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  max_paid_checks     integer not null default 0 check (max_paid_checks between 0 and 100000),
  paid_authorized_by  uuid references auth.users (id) on delete set null,
  paid_authorized_at  timestamptz,
  canceled_at         timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '14 days'),
  check (max_paid_checks = 0 or paid_authorized_at is not null),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index launch_boosts_active_idx on public.launch_boosts (product_id, ends_at) where canceled_at is null;

-- ---------------------------------------------------------------------------
-- Cost ledger: one row per paid HTTP request, reserved before the call and
-- settled after it. Allocations split a shared request across the workspaces
-- (and boosts) it served.
-- ---------------------------------------------------------------------------
create table public.api_cost_ledger (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null check (provider in ('apidirect')),
  platform              public.integration_provider not null,
  endpoint              text not null check (char_length(endpoint) <= 100),
  pricing_key           text not null,
  purpose               text not null check (purpose in ('search', 'comment_search', 'comment_expansion', 'reply_expansion',
                                                         'quote_expansion', 'review_fetch', 'audit', 'live_test')),
  units_requested       integer not null check (units_requested between 1 and 1000),
  unit_price_usd        numeric(10, 5) not null,
  estimated_usd         numeric(12, 5) not null,
  billed_units          integer check (billed_units >= 0),
  charged_usd           numeric(12, 5),                 -- per the provider's documented billing rules
  provider_confirmed_usd numeric(12, 5),                -- from reconciliation, when available
  status                text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'unknown')),
  http_status           integer,
  error_code            text check (char_length(error_code) <= 60),
  results_returned      integer,
  relevant_mentions     integer,
  duplicates            integer,
  duration_ms           integer,
  job_id                uuid references public.jobs (id) on delete set null,
  query_fingerprint     text,
  period_start          date not null default date_trunc('month', now())::date,
  reserved_at           timestamptz not null default now(),
  settled_at            timestamptz
);

create index api_cost_ledger_period_idx on public.api_cost_ledger (period_start, platform);
create index api_cost_ledger_job_idx on public.api_cost_ledger (job_id) where job_id is not null;
create index api_cost_ledger_open_idx on public.api_cost_ledger (reserved_at) where status = 'reserved';

create table public.api_cost_allocations (
  ledger_id     uuid not null references public.api_cost_ledger (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  boost_id      uuid references public.launch_boosts (id) on delete set null,
  share         numeric(8, 6) not null check (share > 0 and share <= 1),
  primary key (ledger_id, product_id)
);

create index api_cost_allocations_ws_idx on public.api_cost_allocations (workspace_id);
create index api_cost_allocations_boost_idx on public.api_cost_allocations (boost_id) where boost_id is not null;

create table public.billing_reconciliations (
  id              bigint generated always as identity primary key,
  provider        text not null check (provider in ('apidirect')),
  period_start    date not null,
  invoiced_usd    numeric(12, 4) not null check (invoiced_usd >= 0),
  estimated_usd   numeric(12, 4) not null,
  charged_usd     numeric(12, 4) not null,
  notes           text check (char_length(notes) <= 1000),
  recorded_at     timestamptz not null default now(),
  unique (provider, period_start)
);

-- Month-to-date spend for a filter. Unsettled and unknown reservations count at
-- their estimate (a crashed call may still have been billed).
create or replace function private.ledger_amount(l public.api_cost_ledger)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case l.status when 'released' then 0 when 'settled' then coalesce(l.charged_usd, l.estimated_usd) else l.estimated_usd end;
$$;

/*
  Reserve budget for one paid request. p_members: [{workspace_id, product_id, boost_id?}].
  Checks global → provider → platform budgets on the full estimate, then each
  member's workspace allowance / product budget / boost cap on its share; members
  that can't afford their share are dropped (and shares recomputed). Serialized by
  an advisory lock, so concurrent jobs can never overshoot a limit together.
  Returns {ok, ledger_id, estimated_usd, members[]} or {ok:false, reason}.
*/
create or replace function private.reserve_api_spend(
  p_platform text, p_pricing_key text, p_units integer, p_purpose text,
  p_members jsonb, p_job_id uuid default null, p_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  price public.provider_pricing;
  est numeric;
  period date := date_trunc('month', now())::date;
  lim numeric;
  spent numeric;
  accepted jsonb := '[]'::jsonb;
  candidates jsonb;
  m jsonb;
  share numeric;
  changed boolean;
  ws_limit numeric;
  boost public.launch_boosts;
  boost_used integer;
  lid uuid;
begin
  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'invalid units' using errcode = '22023';
  end if;
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 or jsonb_array_length(p_members) > 500 then
    raise exception 'members must be a non-empty array' using errcode = '22023';
  end if;

  select * into price from private.current_price(p_pricing_key);
  if price.pricing_key is null or price.platform::text <> p_platform then
    return jsonb_build_object('ok', false, 'reason', 'unpriced');
  end if;
  est := price.price_usd * p_units;

  perform pg_advisory_xact_lock(hashtext('signalforge:api_spend'));

  -- Reservations older than 15 minutes belong to crashed workers: keep counting them.
  update public.api_cost_ledger set status = 'unknown'
   where status = 'reserved' and reserved_at < now() - interval '15 minutes';

  select monthly_limit_usd into lim from public.api_budgets where scope = 'global';
  if lim is null or lim <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_global_budget');
  end if;
  select coalesce(sum(private.ledger_amount(l)), 0) into spent from public.api_cost_ledger l where l.period_start = period;
  if spent + est > lim then
    return jsonb_build_object('ok', false, 'reason', 'global_budget_exhausted');
  end if;

  select monthly_limit_usd into lim from public.api_budgets where scope = 'provider' and provider = price.provider;
  if lim is not null then
    select coalesce(sum(private.ledger_amount(l)), 0) into spent
      from public.api_cost_ledger l where l.period_start = period and l.provider = price.provider;
    if spent + est > lim then
      return jsonb_build_object('ok', false, 'reason', 'provider_budget_exhausted');
    end if;
  end if;

  select monthly_limit_usd into lim from public.api_budgets where scope = 'platform' and platform::text = p_platform;
  if lim is not null then
    select coalesce(sum(private.ledger_amount(l)), 0) into spent
      from public.api_cost_ledger l where l.period_start = period and l.platform::text = p_platform;
    if spent + est > lim then
      return jsonb_build_object('ok', false, 'reason', 'platform_budget_exhausted');
    end if;
  end if;

  -- Per-member checks; drop members that can't afford their share until stable.
  candidates := p_members;
  loop
    accepted := '[]'::jsonb;
    changed := false;
    share := est / jsonb_array_length(candidates);
    for m in select * from jsonb_array_elements(candidates) loop
      -- Workspace allowance: plan allowance, optionally lowered by a workspace budget row.
      select least(coalesce(a.monthly_usd, 0), coalesce(b.monthly_limit_usd, 'Infinity'::numeric)) into ws_limit
        from (select 1) one
        left join public.plan_paid_allowances a on a.plan_id = private.effective_plan_id((m ->> 'workspace_id')::uuid)
        left join public.api_budgets b on b.scope = 'workspace' and b.workspace_id = (m ->> 'workspace_id')::uuid;
      select coalesce(sum(private.ledger_amount(l) * al.share), 0) into spent
        from public.api_cost_allocations al join public.api_cost_ledger l on l.id = al.ledger_id
       where al.workspace_id = (m ->> 'workspace_id')::uuid and l.period_start = period;
      if spent + share > ws_limit then changed := true; continue; end if;

      select monthly_limit_usd into lim from public.api_budgets where scope = 'product' and product_id = (m ->> 'product_id')::uuid;
      if lim is not null then
        select coalesce(sum(private.ledger_amount(l) * al.share), 0) into spent
          from public.api_cost_allocations al join public.api_cost_ledger l on l.id = al.ledger_id
         where al.product_id = (m ->> 'product_id')::uuid and l.period_start = period;
        if spent + share > lim then changed := true; continue; end if;
      end if;

      if m ->> 'boost_id' is not null then
        select * into boost from public.launch_boosts where id = (m ->> 'boost_id')::uuid;
        select count(*) into boost_used from public.api_cost_allocations al
          join public.api_cost_ledger l on l.id = al.ledger_id
         where al.boost_id = boost.id and l.status <> 'released';
        if boost.id is null or boost.canceled_at is not null or now() not between boost.starts_at and boost.ends_at
           or boost_used + 1 > boost.max_paid_checks then
          changed := true; continue;
        end if;
      end if;

      accepted := accepted || jsonb_build_array(m);
    end loop;
    exit when not changed or jsonb_array_length(accepted) = 0;
    candidates := accepted;
  end loop;

  if jsonb_array_length(accepted) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'workspace_budget_exhausted');
  end if;

  insert into public.api_cost_ledger
    (provider, platform, endpoint, pricing_key, purpose, units_requested, unit_price_usd, estimated_usd, job_id, query_fingerprint)
  values (price.provider, price.platform, price.endpoint, price.pricing_key, p_purpose, p_units, price.price_usd, est, p_job_id, p_fingerprint)
  returning id into lid;

  insert into public.api_cost_allocations (ledger_id, workspace_id, product_id, boost_id, share)
  select lid, (a ->> 'workspace_id')::uuid, (a ->> 'product_id')::uuid, (a ->> 'boost_id')::uuid,
         round(1.0 / jsonb_array_length(accepted), 6)
    from jsonb_array_elements(accepted) a;

  return jsonb_build_object('ok', true, 'ledger_id', lid, 'estimated_usd', est, 'members', accepted);
end;
$$;

-- Record the outcome. billed_units follows the provider's documented rules
-- (computed by the server); 0 releases the reservation.
create or replace function private.settle_api_spend(
  p_ledger_id uuid, p_http_status integer, p_error_code text, p_billed_units integer,
  p_results integer, p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No HTTP status = no answer seen (timeout/network): it may still have been
  -- billed, so the row stays 'unknown' and keeps counting at its estimate.
  update public.api_cost_ledger
     set billed_units = case when p_http_status is null then null else greatest(coalesce(p_billed_units, 0), 0) end,
         charged_usd = case when p_http_status is null then null else unit_price_usd * greatest(coalesce(p_billed_units, 0), 0) end,
         status = case when p_http_status is null then 'unknown'
                       when coalesce(p_billed_units, 0) > 0 then 'settled' else 'released' end,
         http_status = p_http_status,
         error_code = left(p_error_code, 60),
         results_returned = p_results,
         duration_ms = p_duration_ms,
         settled_at = now()
   where id = p_ledger_id and status in ('reserved', 'unknown');
end;
$$;

create or replace function private.annotate_api_spend(p_ledger_id uuid, p_relevant integer, p_duplicates integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.api_cost_ledger set relevant_mentions = p_relevant, duplicates = p_duplicates where id = p_ledger_id;
$$;

-- ---------------------------------------------------------------------------
-- Execution log (customer-visible: no prices) and comment-expansion history
-- ---------------------------------------------------------------------------
create table public.monitoring_executions (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null,
  product_id        uuid not null,
  query_id          uuid references public.monitoring_queries (id) on delete set null,
  job_id            uuid references public.jobs (id) on delete set null,
  platform          public.integration_provider not null,
  stream            text not null default 'default',
  status            text not null check (status in ('succeeded', 'partial', 'failed', 'skipped', 'covered_by_shared')),
  started_at        timestamptz not null,
  finished_at       timestamptz not null default now(),
  window_start      timestamptz,
  window_end        timestamptz,
  pages_requested   integer not null default 0,
  items_fetched     integer not null default 0,
  items_relevant    integer not null default 0,
  inserted          integer not null default 0,
  duplicates        integer not null default 0,
  saturated         boolean not null default false,
  paid_requests     integer not null default 0,
  shared_with       integer not null default 1,      -- products served by the same upstream fetch
  expansions        integer not null default 0,      -- comment/reply pages fetched for selected parents
  next_interval_minutes integer,
  interval_reasons  jsonb not null default '[]'::jsonb,
  coverage_confidence text check (coverage_confidence in ('high', 'medium', 'low')),
  detail            text check (char_length(detail) <= 500),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index monitoring_executions_product_idx on public.monitoring_executions (product_id, finished_at desc);
create index monitoring_executions_query_idx on public.monitoring_executions (query_id, finished_at desc);

create table public.comment_expansions (
  workspace_id          uuid not null,
  product_id            uuid not null,
  platform              public.integration_provider not null,
  parent_external_id    text not null check (char_length(parent_external_id) <= 300),
  last_expanded_at      timestamptz not null,
  comment_count_at_last integer not null default 0,
  expansions            integer not null default 1,
  last_found            integer not null default 0,
  primary key (product_id, platform, parent_external_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Scheduler: interval comes from the adaptive engine (stored per query group),
-- bounded below by the plan; the job's completion writes the next run time.
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
    select mq.id, mq.workspace_id, mq.product_id, mq.provider, mq.interval_minutes, pl.monitoring_interval_minutes
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
    mins := coalesce(q.interval_minutes, q.monitoring_interval_minutes);
    mins := greatest(mins, case when q.provider = 'youtube' then 1440 else 60 end);
    perform private.enqueue_job(
      'monitor.query',
      'mq:' || q.id || ':' || floor(extract(epoch from now()) / (mins * 60))::bigint,
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
-- Spikes (detected by the server from stored mentions)
-- ---------------------------------------------------------------------------
create table public.buzz_spikes (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  product_id         uuid not null,
  platform           public.integration_provider,          -- null = all monitored platforms
  granularity        text not null check (granularity in ('day', 'hour')),
  period_start       timestamptz not null,
  period_end         timestamptz not null,
  observed           integer not null check (observed >= 0),
  expected           numeric(12, 3) not null check (expected >= 0),
  baseline_periods   integer not null check (baseline_periods >= 0),
  robust_z           numeric(10, 3),
  ratio              numeric(10, 3),
  severity           text not null check (severity in ('notable', 'major')),
  detected_at        timestamptz not null default now(),
  -- For a later AI explanation (Milestone 4); null until generated.
  explanation        text check (char_length(explanation) <= 4000),
  explanation_status text not null default 'none' check (explanation_status in ('none', 'pending', 'ready', 'insufficient_data')),
  check (period_end > period_start),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create unique index buzz_spikes_uniq on public.buzz_spikes
  (product_id, platform, granularity, period_start) nulls not distinct;
create index buzz_spikes_product_idx on public.buzz_spikes (product_id, period_start desc);

-- ---------------------------------------------------------------------------
-- RLS & grants
-- ---------------------------------------------------------------------------
alter table public.product_source_settings enable row level security;
alter table public.provider_pricing enable row level security;
alter table public.plan_paid_allowances enable row level security;
alter table public.api_budgets enable row level security;
alter table public.launch_boosts enable row level security;
alter table public.api_cost_ledger enable row level security;
alter table public.api_cost_allocations enable row level security;
alter table public.billing_reconciliations enable row level security;
alter table public.monitoring_executions enable row level security;
alter table public.comment_expansions enable row level security;
alter table public.buzz_spikes enable row level security;

revoke all on public.product_source_settings, public.provider_pricing, public.plan_paid_allowances, public.api_budgets,
              public.launch_boosts, public.api_cost_ledger, public.api_cost_allocations, public.billing_reconciliations,
              public.monitoring_executions, public.comment_expansions, public.buzz_spikes
  from anon, authenticated;
grant all on public.product_source_settings, public.provider_pricing, public.plan_paid_allowances, public.api_budgets,
             public.launch_boosts, public.api_cost_ledger, public.api_cost_allocations, public.billing_reconciliations,
             public.monitoring_executions, public.comment_expansions, public.buzz_spikes
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Customers: their own settings, boosts, executions and spikes. Never pricing, budgets or the ledger.
grant select, insert (workspace_id, product_id, platform, enabled, updated_by), update (enabled, updated_by), delete
  on public.product_source_settings to authenticated;
create policy source_settings_read on public.product_source_settings for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy source_settings_write on public.product_source_settings for all to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));

grant select, insert (workspace_id, product_id, title, platforms, mode, starts_at, ends_at, max_paid_checks,
                      paid_authorized_by, paid_authorized_at, created_by),
      update (canceled_at)
  on public.launch_boosts to authenticated;
create policy boosts_read on public.launch_boosts for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy boosts_insert on public.launch_boosts for insert to authenticated
  with check (private.has_workspace_role(workspace_id, 'admin')
              and created_by = (select auth.uid())
              and (paid_authorized_by is null or paid_authorized_by = (select auth.uid())));
create policy boosts_cancel on public.launch_boosts for update to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));

grant select on public.monitoring_executions to authenticated;
create policy executions_read on public.monitoring_executions for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

grant select on public.buzz_spikes to authenticated;
create policy spikes_read on public.buzz_spikes for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

do $$
declare f text;
begin
  foreach f in array array[
    'private.apply_query_groups(uuid, jsonb)',
    'private.current_price(text)',
    'private.reserve_api_spend(text, text, integer, text, jsonb, uuid, text)',
    'private.settle_api_spend(uuid, integer, text, integer, integer, integer)',
    'private.annotate_api_spend(uuid, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

create or replace function public.svc_apply_query_groups(p_product_id uuid, p_groups jsonb)
returns integer language sql security definer set search_path = '' as $$
  select private.apply_query_groups(p_product_id, p_groups);
$$;

create or replace function public.svc_reserve_api_spend(
  p_platform text, p_pricing_key text, p_units integer, p_purpose text, p_members jsonb,
  p_job_id uuid default null, p_fingerprint text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select private.reserve_api_spend(p_platform, p_pricing_key, p_units, p_purpose, p_members, p_job_id, p_fingerprint);
$$;

create or replace function public.svc_settle_api_spend(
  p_ledger_id uuid, p_http_status integer, p_error_code text, p_billed_units integer, p_results integer, p_duration_ms integer)
returns void language sql security definer set search_path = '' as $$
  select private.settle_api_spend(p_ledger_id, p_http_status, p_error_code, p_billed_units, p_results, p_duration_ms);
$$;

create or replace function public.svc_annotate_api_spend(p_ledger_id uuid, p_relevant integer, p_duplicates integer)
returns void language sql security definer set search_path = '' as $$
  select private.annotate_api_spend(p_ledger_id, p_relevant, p_duplicates);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.svc_apply_query_groups(uuid, jsonb)',
    'public.svc_reserve_api_spend(text, text, integer, text, jsonb, uuid, text)',
    'public.svc_settle_api_spend(uuid, integer, text, integer, integer, integer)',
    'public.svc_annotate_api_spend(uuid, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ingestion v2: same guarantees as Milestone 2, plus the new mention fields.
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
      relevance_status, dedup_kind, canonical_mention_id, processing_status, linked_url, retain_until,
      mention_type, collection_method, data_provider, community, link_target, published_at_estimated)
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
      coalesce(it ->> 'link_target', 'item'), coalesce((it ->> 'published_at_estimated')::boolean, false))
    on conflict (product_id, source, external_id) do nothing
    returning id into new_id;

    if new_id is null then
      n_updated := n_updated + 1;
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

-- ---------------------------------------------------------------------------
-- Inputs for the adaptive engine, in one round trip: plan floor, boost, mode,
-- and recent relevant-mention activity for one product + platform.
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
    'plan_min_minutes', pl.monitoring_interval_minutes,
    'boost_min_minutes', coalesce(a.boost_min_interval_minutes, 60),
    'paid_allowance_usd', coalesce(a.monthly_usd, 0),
    'max_boost_paid_checks', coalesce(a.max_boost_paid_checks, 0),
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

revoke all on function private.schedule_context(uuid, text) from public, anon, authenticated;
grant execute on function private.schedule_context(uuid, text) to service_role;

create or replace function public.svc_schedule_context(p_product_id uuid, p_platform text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.schedule_context(p_product_id, p_platform);
$$;
revoke all on function public.svc_schedule_context(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_schedule_context(uuid, text) to service_role;
