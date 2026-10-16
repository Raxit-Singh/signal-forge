-- Internal plan entitlements (additive). Lets SignalForge staff give a workspace a
-- plan's limits for internal testing WITHOUT a subscription: nothing is billed,
-- no payment provider is involved, and `subscriptions` is not touched.
--
--   * One active grant per workspace; it takes precedence over the subscription
--     while active (not revoked, not expired). Revoking it falls back to the
--     subscription (or Free) immediately.
--   * Written only with the service role (scripts/grant-internal-plan.ts). Members
--     can read their own workspace's grant so the UI can say it isn't a paid plan.
--   * Paid collection still needs PAID_SOURCES_ENABLED and a global budget; a grant
--     only changes plan limits (keywords, mentions, intervals, internal paid budget).

create table public.internal_plan_grants (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  plan_id      text not null references public.plans (id),
  reason       text not null check (reason in ('internal_testing', 'development')),
  note         text check (char_length(note) <= 300),
  granted_by   text not null check (char_length(granted_by) between 1 and 100),
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  check (expires_at is null or expires_at > granted_at)
);

alter table public.internal_plan_grants enable row level security;
grant select on public.internal_plan_grants to authenticated;
create policy internal_grants_read on public.internal_plan_grants for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create or replace function private.active_internal_grant(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.plan_id from public.internal_plan_grants g
   where g.workspace_id = ws and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
$$;

revoke all on function private.active_internal_grant(uuid) from public, anon, authenticated;

-- Effective plan: active internal grant, else an active subscription, else Free.
create or replace function private.effective_plan_id(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.active_internal_grant(ws),
    (select s.plan_id
       from public.subscriptions s
      where s.workspace_id = ws
        and s.status in ('active', 'trialing', 'past_due')),
    'free'
  );
$$;

-- Usage summary: + how the plan is held (subscription vs internal grant).
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
  g public.internal_plan_grants;
begin
  select * into per from private.billing_period(ws, now());
  select * into pl from public.plans where id = private.effective_plan_id(ws);
  select * into u from public.mention_usage_periods where workspace_id = ws and period_start = per.period_start;
  select * into g from public.internal_plan_grants
   where workspace_id = ws and revoked_at is null and (expires_at is null or expires_at > now());
  allowance := pl.monthly_mention_limit;
  consumed := coalesce(u.mentions_consumed, 0);
  return jsonb_build_object(
    'plan_id', pl.id, 'plan_name', pl.name, 'price_cents_monthly', pl.price_cents_monthly,
    'entitlement', case when g.workspace_id is not null then g.reason else 'subscription' end,
    'entitlement_expires_at', g.expires_at,
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
