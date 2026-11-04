-- Yearly billing and new prices (owner's decision, 2026-11-04). Additive.
--
--   Monthly:  Starter $70, Pro $120 (was $110), Scale $350.
--   Yearly:   $10 / $20 / $50 off the monthly price for each month, paid once a year:
--             Starter $60 × 12 = $720, Pro $100 × 12 = $1,200, Scale $300 × 12 = $3,600.
--
-- plans.price_cents_yearly is the whole year's price (null: no yearly option).
-- plans.dodo_yearly_product_id is the Dodo product for it (scripts/dodo-setup.ts sets it).
-- Limits (keywords, mentions) are the same on both; a yearly plan's mention allowance still renews monthly.

alter table public.plans add column if not exists price_cents_yearly integer check (price_cents_yearly is null or price_cents_yearly > 0);
alter table public.plans add column if not exists dodo_yearly_product_id text unique;

update public.plans set price_cents_monthly = 7000,  price_cents_yearly = 72000  where id = 'starter';
update public.plans set price_cents_monthly = 12000, price_cents_yearly = 120000 where id = 'pro';
update public.plans set price_cents_monthly = 35000, price_cents_yearly = 360000 where id = 'scale';

-- Billing period for the mention allowance: as before, except that a stored period longer than 45 days (a yearly
-- subscription) is split into monthly periods counted from its start (anchor day kept, the last one ending with the
-- year), so the allowance still renews every month. Monthly subscriptions are unaffected.
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
  anchor := s;
  if at >= s and at < e then
    if e <= s + interval '45 days' then
      return query select s, e;
      return;
    end if;
    k := (extract(year from age(at, anchor)) * 12 + extract(month from age(at, anchor)))::integer;
    while anchor + make_interval(months => k) > at loop k := k - 1; end loop;
    while anchor + make_interval(months => k + 1) <= at loop k := k + 1; end loop;
    return query select anchor + make_interval(months => k), least(anchor + make_interval(months => k + 1), e);
    return;
  end if;
  -- Monthly steps from the stored start keep its day; a shorter stored period (e.g.
  -- a trial) ends where it ends.
  k := (extract(year from age(at, anchor)) * 12 + extract(month from age(at, anchor)))::integer;
  while anchor + make_interval(months => k) > at loop k := k - 1; end loop;
  while anchor + make_interval(months => k + 1) <= at loop k := k + 1; end loop;
  return query select case when at >= e then greatest(anchor + make_interval(months => k), e) else anchor + make_interval(months => k) end,
                      anchor + make_interval(months => k + 1);
end;
$$;

revoke all on function private.billing_period(uuid, timestamptz) from public, anon, authenticated;
