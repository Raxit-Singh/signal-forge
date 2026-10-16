-- Automatic Smart Monitoring (additive).
--
-- Replaces the customer-facing Eco / Balanced / Priority choice with an
-- automatic, deterministic platform ranking. Nothing is dropped:
-- products.monitoring_mode stays (no longer read by the engine) so this
-- migration can be rolled back by redeploying the previous app version.
--
--   * platform_activity          latest activity score, rank and schedule per product + platform
--   * monitoring_interval_changes every change of a platform's refresh interval, with reasons
--   * plan_paid_allowances.max_searches_per_platform
--                                 how many separate keyword searches a paid platform without OR
--                                 search may run per check (default 2 = the previous default)
--   * private.platform_activity_stats  stored-data signals for the ranking (no API calls)

-- ---------------------------------------------------------------------------
-- Plan entitlement that used to come from the monitoring mode
-- ---------------------------------------------------------------------------
alter table public.plan_paid_allowances
  add column max_searches_per_platform integer not null default 2 check (max_searches_per_platform between 1 and 10);

-- ---------------------------------------------------------------------------
-- Ranking output (written by the service role after runs and hourly)
-- ---------------------------------------------------------------------------
create table public.platform_activity (
  product_id              uuid not null,
  workspace_id            uuid not null,
  platform                public.integration_provider not null,
  phase                   text not null check (phase in ('discovery', 'ranked')),
  score                   smallint check (score between 0 and 100),
  rank                    smallint check (rank >= 1),
  components              jsonb not null default '[]'::jsonb,
  -- Discovery progress while a platform is new: {checks, neededChecks, days, neededDays}.
  discovery               jsonb,
  mentions_24h            integer not null default 0 check (mentions_24h >= 0),
  mentions_7d             integer not null default 0 check (mentions_7d >= 0),
  -- Average relevant mentions per week over the 21 days before the last 7 (null = not enough coverage).
  baseline_weekly         numeric(10, 2),
  growth_pct              numeric(10, 1),
  trend                   text not null check (trend in ('rising', 'stable', 'falling', 'new', 'unknown')),
  coverage_confidence     text not null check (coverage_confidence in ('high', 'medium', 'low')),
  complete_share          real not null default 0 check (complete_share between 0 and 1),
  -- What activity alone justifies (after hysteresis), before plan / source / boost limits.
  recommended_interval    integer not null check (recommended_interval between 60 and 1440),
  -- What the scheduler actually uses.
  interval_minutes        integer not null check (interval_minutes between 60 and 1440),
  plan_limited            boolean not null default false,
  lengthen_pending_since  timestamptz,
  last_success_at         timestamptz,
  next_run_at             timestamptz,
  reasons                 text[] not null default '{}',
  computed_at             timestamptz not null default now(),
  primary key (product_id, platform),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.monitoring_interval_changes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  product_id    uuid not null,
  platform      public.integration_provider not null,
  from_minutes  integer not null,
  to_minutes    integer not null,
  score         smallint,
  reasons       text[] not null default '{}',
  created_at    timestamptz not null default now(),
  check (from_minutes <> to_minutes),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index monitoring_interval_changes_product_idx on public.monitoring_interval_changes (product_id, created_at desc);

-- Numbered mention pagination orders by (published_at desc, id desc) within a product.
create index mentions_product_published_id_idx on public.mentions (product_id, published_at desc, id desc);

alter table public.platform_activity enable row level security;
alter table public.monitoring_interval_changes enable row level security;
revoke all on public.platform_activity, public.monitoring_interval_changes from anon, authenticated;
grant all on public.platform_activity, public.monitoring_interval_changes to service_role;
grant select on public.platform_activity, public.monitoring_interval_changes to authenticated;
create policy platform_activity_read on public.platform_activity for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy interval_changes_read on public.monitoring_interval_changes for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

-- ---------------------------------------------------------------------------
-- Stored-data signals per enabled platform of a product
-- ---------------------------------------------------------------------------
create or replace function private.range_share(r tstzmultirange, p_from timestamptz, p_to timestamptz)
returns real
language sql
immutable
set search_path = ''
as $$
  select case when p_to <= p_from then 0::real else
    (coalesce((select sum(extract(epoch from upper(x) - lower(x)))
                 from unnest(coalesce(r, '{}'::tstzmultirange) * tstzmultirange(tstzrange(p_from, p_to))) x), 0)
      / extract(epoch from p_to - p_from))::real
  end;
$$;

-- Relevant = relevant + user_relevant, originals only, real publication dates.
-- Engagement is compared only with the same platform's own history (75th percentile
-- of engagement_score over 28 days), never across platforms.
create or replace function private.platform_activity_stats(p_product_id uuid)
returns table (
  platform text,
  n24 integer, prev24 integer, n7 integer, n28 integer,
  authors7 integer, authored7 integer,
  eng_history integer, eng_high7 integer,
  spike_recent boolean,
  complete_share7 real, covered_share7 real, complete_share_prior real,
  first_monitored_at timestamptz, completed_checks integer,
  last_success_at timestamptz, next_run_at timestamptz, saturated_at timestamptz,
  failures integer, audit_missed integer, interval_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select mq.provider::text as platform,
           max(mq.last_success_at) as last_success_at,
           min(mq.next_run_at) as next_run_at,
           max(mq.last_saturated_at) as saturated_at,
           max(mq.consecutive_failures) as failures,
           max(coalesce((mq.cursor ->> 'audit_missed')::integer, 0)) as audit_missed,
           min(mq.interval_minutes) as interval_minutes
      from public.monitoring_queries mq
     where mq.product_id = p_product_id and mq.enabled and mq.competitor_id is null
     group by 1
  ), m as (
    select mn.source::text as platform, mn.published_at, mn.author_external_id, mn.engagement_score
      from public.mentions mn
     where mn.product_id = p_product_id
       and mn.relevance_status in ('relevant', 'user_relevant')
       and mn.dedup_kind = 'original' and not mn.published_at_estimated
       and mn.published_at > now() - interval '28 days' and mn.published_at <= now()
  ), e as (
    select m.platform, count(*)::integer as eng_history,
           percentile_cont(0.75) within group (order by m.engagement_score) as p75
      from m group by 1
  ), cw as (
    select c.provider::text as platform,
           range_agg(tstzrange(c.window_start, c.window_end)) filter (where c.status = 'complete') as comp,
           range_agg(tstzrange(c.window_start, c.window_end)) filter (where c.status in ('complete', 'partial')) as cov
      from public.coverage_windows c
     where c.product_id = p_product_id and c.window_end > now() - interval '28 days'
     group by 1
  ), f as (
    select c.provider::text as platform, min(c.window_end) as first_monitored_at, count(*)::integer as checks
      from public.coverage_windows c
     where c.product_id = p_product_id and c.status in ('complete', 'partial')
     group by 1
  )
  select q.platform,
         (select count(*) from m where m.platform = q.platform and m.published_at > now() - interval '24 hours')::integer,
         (select count(*) from m where m.platform = q.platform and m.published_at <= now() - interval '24 hours'
                                     and m.published_at > now() - interval '48 hours')::integer,
         (select count(*) from m where m.platform = q.platform and m.published_at > now() - interval '7 days')::integer,
         (select count(*) from m where m.platform = q.platform)::integer,
         (select count(distinct m.author_external_id) from m where m.platform = q.platform and m.published_at > now() - interval '7 days')::integer,
         (select count(m.author_external_id) from m where m.platform = q.platform and m.published_at > now() - interval '7 days')::integer,
         coalesce(e.eng_history, 0),
         (select count(*) from m where m.platform = q.platform and m.published_at > now() - interval '7 days'
                                     and e.p75 is not null and m.engagement_score > 0 and m.engagement_score >= e.p75)::integer,
         exists (select 1 from public.buzz_spikes s
                  where s.product_id = p_product_id and (s.platform is null or s.platform::text = q.platform)
                    and s.period_end > now() - interval '72 hours'),
         private.range_share(cw.comp, now() - interval '7 days', now()),
         private.range_share(cw.cov, now() - interval '7 days', now()),
         private.range_share(cw.comp, now() - interval '28 days', now() - interval '7 days'),
         f.first_monitored_at, coalesce(f.checks, 0),
         q.last_success_at, q.next_run_at, q.saturated_at, q.failures, q.audit_missed, q.interval_minutes
    from q
    left join e on e.platform = q.platform
    left join cw on cw.platform = q.platform
    left join f on f.platform = q.platform
   order by 1;
$$;

revoke all on function private.range_share(tstzmultirange, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.range_share(tstzmultirange, timestamptz, timestamptz) to service_role;
revoke all on function private.platform_activity_stats(uuid) from public, anon, authenticated;
grant execute on function private.platform_activity_stats(uuid) to service_role;

create or replace function public.svc_platform_activity_stats(p_product_id uuid)
returns table (
  platform text,
  n24 integer, prev24 integer, n7 integer, n28 integer,
  authors7 integer, authored7 integer,
  eng_history integer, eng_high7 integer,
  spike_recent boolean,
  complete_share7 real, covered_share7 real, complete_share_prior real,
  first_monitored_at timestamptz, completed_checks integer,
  last_success_at timestamptz, next_run_at timestamptz, saturated_at timestamptz,
  failures integer, audit_missed integer, interval_minutes integer
)
language sql security definer set search_path = '' as $$
  select * from private.platform_activity_stats(p_product_id);
$$;
revoke all on function public.svc_platform_activity_stats(uuid) from public, anon, authenticated;
grant execute on function public.svc_platform_activity_stats(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule context: + max_searches_per_platform (the mode is no longer used)
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
    'boost_min_minutes', coalesce(a.boost_min_interval_minutes, 60),
    'paid_allowance_usd', coalesce(a.monthly_usd, 0),
    'max_boost_paid_checks', coalesce(a.max_boost_paid_checks, 0),
    'max_searches_per_platform', coalesce(a.max_searches_per_platform, 2),
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
