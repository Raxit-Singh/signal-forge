-- Engagement signal fix (additive: replaces one function body).
-- "Top quarter" now means strictly above the platform's own 75th percentile, so a
-- platform whose mentions all have the same engagement doesn't count every one as
-- highly engaged.
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
                                     and e.p75 is not null and m.engagement_score > e.p75)::integer,
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
