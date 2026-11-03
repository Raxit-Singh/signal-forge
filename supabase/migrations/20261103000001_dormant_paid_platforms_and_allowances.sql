-- Dormant paid platforms and new paid-source allowances (owner's decision, 2026-11-03).
--
--   * A paid platform that has found no relevant mentions in 14+ days of monitoring is
--     searched about once a week per keyword (adaptive-v2 dormantInterval): every paid
--     search costs money even when it comes back empty. The scheduler's platform interval
--     may now be up to a week (monitoring_queries.interval_minutes already allowed 10080).
--   * Monthly paid-source allowances per workspace, sized for the worst measured cost
--     (about $0.003 per relevant mention plus empty searches): Starter $15, Pro $35,
--     Scale $150. Subscription prices and mention allowances are unchanged.

alter table public.platform_activity
  drop constraint if exists platform_activity_interval_minutes_check,
  add constraint platform_activity_interval_minutes_check check (interval_minutes between 60 and 10080);

insert into public.plan_paid_allowances (plan_id, monthly_usd, boost_min_interval_minutes, max_boost_paid_checks, max_searches_per_platform)
values ('starter', 15, 60, 400, 2), ('pro', 35, 60, 400, 2), ('scale', 150, 60, 1500, 4)
on conflict (plan_id) do update set monthly_usd = excluded.monthly_usd;
