-- Staff cost dashboard (additive): one service-role-only summary of what
-- SignalForge spends this month — SignalForge Intelligence (Gemini) and paid data
-- (API Direct) — against the operator limits, plus mention allowance pressure.
-- Read-only; limits are still changed only by the operator.

create or replace function public.svc_admin_cost_summary(p_month date default date_trunc('month', now() at time zone 'utc')::date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (p_month::timestamp at time zone 'utc') as m_start,
           ((p_month + interval '1 month')::timestamp at time zone 'utc') as m_end
  ), ai as (
    select u.* from public.ai_usage_records u, bounds b
     where u.billed_to = 'signalforge' and u.status <> 'released' and u.created_at >= b.m_start and u.created_at < b.m_end
  ), ai_cost as (
    -- Reserved calls count at their reservation until settled (same rule as the budget check).
    select a.*, case when a.status = 'reserved' then coalesce(a.reserved_microusd, 0) else a.cost_microusd end as micro from ai a
  ), api as (
    select l.*, coalesce(l.provider_confirmed_usd, l.charged_usd, case when l.status = 'reserved' then l.estimated_usd else 0 end) as usd
      from public.api_cost_ledger l where l.period_start = p_month and l.status <> 'released'
  )
  select jsonb_build_object(
    'month', p_month,
    'ai', jsonb_build_object(
      'limit_usd', (select monthly_limit_usd from public.ai_global_budget where id),
      'spent_microusd', (select coalesce(sum(micro), 0) from ai_cost),
      'requests', (select coalesce(sum(requests), count(*)) from ai_cost),
      'failed', (select count(*) from ai_cost where not success),
      'reserved_open', (select count(*) from ai_cost where status = 'reserved'),
      'by_purpose', (select coalesce(jsonb_agg(x order by x.micro desc), '[]'::jsonb) from (
          select purpose, sum(micro)::bigint as micro, count(*) as calls, sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens
            from ai_cost group by purpose) x),
      'by_model', (select coalesce(jsonb_agg(x order by x.micro desc), '[]'::jsonb) from (
          select model, sum(micro)::bigint as micro, count(*) as calls from ai_cost group by model) x),
      'daily', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
          select (created_at at time zone 'utc')::date as day, sum(micro)::bigint as micro from ai_cost group by 1) x)
    ),
    'api', jsonb_build_object(
      'enabled_limit_usd', (select monthly_limit_usd from public.api_budgets where scope = 'global' limit 1),
      'provider_limit_usd', (select monthly_limit_usd from public.api_budgets where scope = 'provider' and provider = 'apidirect' limit 1),
      'spent_usd', (select coalesce(sum(usd), 0) from api),
      'requests', (select count(*) from api),
      'by_platform', (select coalesce(jsonb_agg(x order by x.usd desc), '[]'::jsonb) from (
          select platform::text as platform, sum(usd) as usd, count(*) as calls from api group by platform) x),
      'daily', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
          select (reserved_at at time zone 'utc')::date as day, sum(usd) as usd from api group by 1) x)
    ),
    'workspaces', (select coalesce(jsonb_agg(x order by x.ai_micro + x.api_usd * 1000000 desc), '[]'::jsonb) from (
        select w.id, w.name, private.effective_plan_id(w.id) as plan,
               coalesce((select sum(micro) from ai_cost a where a.workspace_id = w.id), 0)::bigint as ai_micro,
               coalesce((select sum(l.usd * al.share) from api l join public.api_cost_allocations al on al.ledger_id = l.id where al.workspace_id = w.id), 0)::numeric(12, 4) as api_usd,
               u.mentions_consumed, u.mention_allowance, u.exhausted_at
          from public.workspaces w
          left join public.mention_usage_periods u on u.workspace_id = w.id
               and u.period_start = (select per.period_start from private.billing_period(w.id, now()) per)
        ) x where x.ai_micro > 0 or x.api_usd > 0 or coalesce(x.mentions_consumed, 0) > 0
        limit 100)
  );
$$;

revoke all on function public.svc_admin_cost_summary(date) from public, anon, authenticated;
grant execute on function public.svc_admin_cost_summary(date) to service_role;
