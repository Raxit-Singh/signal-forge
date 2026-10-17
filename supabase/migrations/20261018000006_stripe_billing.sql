-- Stripe billing (additive). Subscriptions are written only by the server from
-- verified Stripe webhooks, through this function:
--   * events are applied in Stripe's order: an event older than the last one
--     applied to the workspace is ignored (Stripe doesn't guarantee delivery order);
--   * a deleted subscription returns the workspace to Free (data is kept; limits
--     follow the plan, e.g. extra keywords are paused, never deleted).
-- billing_events (existing) records every event id for idempotency.

create or replace function public.svc_apply_subscription(
  p_workspace_id uuid, p_plan_id text, p_status public.subscription_status, p_customer text, p_subscription text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean, p_event_at timestamptz, p_deleted boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur record;
begin
  select * into cur from public.subscriptions where workspace_id = p_workspace_id for update;
  if cur.workspace_id is null then
    return 'unknown_workspace';
  end if;
  if cur.last_webhook_event_at is not null and p_event_at < cur.last_webhook_event_at then
    return 'stale';
  end if;
  -- Another subscription's events can't overwrite the current one (e.g. an old, cancelled checkout).
  if not p_deleted and cur.provider_subscription_id is not null and cur.provider_subscription_id <> p_subscription
     and cur.status in ('active', 'trialing', 'past_due') then
    return 'other_subscription';
  end if;
  if p_deleted then
    if cur.provider_subscription_id is distinct from p_subscription then
      return 'other_subscription';
    end if;
    update public.subscriptions set
      plan_id = 'free', status = 'active', provider = 'none', provider_subscription_id = null,
      provider_customer_id = coalesce(p_customer, provider_customer_id),
      current_period_start = date_trunc('month', now()), current_period_end = date_trunc('month', now()) + interval '1 month',
      cancel_at_period_end = false, last_webhook_event_at = p_event_at
    where workspace_id = p_workspace_id;
    return 'downgraded';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then
    return 'unknown_plan';
  end if;
  update public.subscriptions set
    plan_id = p_plan_id, status = p_status, provider = 'stripe', provider_customer_id = p_customer, provider_subscription_id = p_subscription,
    current_period_start = coalesce(p_period_start, current_period_start), current_period_end = coalesce(p_period_end, current_period_end),
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false), last_webhook_event_at = p_event_at
  where workspace_id = p_workspace_id;
  return 'applied';
end;
$$;

-- The Stripe customer of a workspace (created before its first checkout).
create or replace function public.svc_set_billing_customer(p_workspace_id uuid, p_customer text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscriptions set provider_customer_id = p_customer where workspace_id = p_workspace_id and provider_customer_id is null;
$$;

revoke all on function public.svc_apply_subscription(uuid, text, public.subscription_status, text, text, timestamptz, timestamptz, boolean, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.svc_set_billing_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_apply_subscription(uuid, text, public.subscription_status, text, text, timestamptz, timestamptz, boolean, timestamptz, boolean) to service_role;
grant execute on function public.svc_set_billing_customer(uuid, text) to service_role;
