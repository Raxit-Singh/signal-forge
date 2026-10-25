-- New pricing (owner's decision, 2026-10-25) and keywords shared with competitors.
--
--   * Starter  $70/month: 1 keyword, no competitors, 4,000 mentions a month.
--   * Pro     $110/month: 3 keywords shared between the workspace's products and
--     its competitors (a competitor's name is one keyword), 10,000 mentions a month.
--     A product needs at least one keyword, so at most 2 competitors.
--   * Scale is unchanged until its new terms are decided.
--   Settings the owner didn't specify (history window, monitoring speed, AI budget,
--   features) are Pro's current values for both tiers.
--
-- Competitor keywords now count toward the plan's keyword allowance (they used to
-- have a separate cap of 3 each, which let competitors multiply collection cost).
-- The per-competitor cap of 3 still applies. Existing data isn't changed: a
-- workspace already over its allowance keeps its keywords; new ones are refused.

update public.plans pr set
  name = 'Starter',
  description = '1 keyword, 4,000 mentions a month.',
  price_cents_monthly = 7000,
  max_products = 1,
  max_competitors_per_product = 0,
  monthly_mention_limit = 4000,
  max_keywords = 1,
  history_days = src.history_days,
  monitoring_interval_minutes = src.monitoring_interval_minutes,
  monthly_ai_token_budget = src.monthly_ai_token_budget,
  monthly_investigations = src.monthly_investigations,
  features = src.features,
  keyword_refresh_target_minutes = src.keyword_refresh_target_minutes,
  scheduling_priority = src.scheduling_priority,
  is_public = true,
  retired_at = null,
  sort_order = 1
from public.plans src
where pr.id = 'starter' and src.id = 'pro';

update public.plans set
  description = '3 keywords for your product and competitors, 10,000 mentions a month.',
  price_cents_monthly = 11000,
  max_keywords = 3,
  max_competitors_per_product = 2,
  monthly_mention_limit = 10000,
  sort_order = 2
where id = 'pro';

update public.plans set sort_order = 3 where id = 'scale';

-- Keyword allowance: every enabled keyword on the workspace's active products AND
-- its competitors' tracking products counts; a competitor still has at most 3.
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
  is_competitor boolean;
begin
  select p.competitor_of is not null into is_competitor from public.products p where p.id = new.product_id;
  if not new.enabled or exists (select 1 from public.products p where p.id = new.product_id and p.archived_at is not null) then
    return null;
  end if;
  if is_competitor then
    select count(*) into n from public.product_aliases a where a.product_id = new.product_id and a.enabled;
    if n > private.competitor_max_keywords() then
      raise exception 'A competitor can have at most % keywords.', private.competitor_max_keywords()
        using errcode = 'P0001', hint = 'plan_limit:competitor_keywords';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('keywords:' || new.workspace_id::text, 0));
  select p.max_keywords, p.name into lim, plan_name from public.plans p where p.id = private.effective_plan_id(new.workspace_id);
  select count(*) into n from public.product_aliases a join public.products p on p.id = a.product_id
   where a.workspace_id = new.workspace_id and a.enabled and p.archived_at is null;
  if n > coalesce(lim, 0) then
    raise exception 'Your % plan includes % keyword% in total, for your products and competitors. Turn some off or change plan.',
      plan_name, coalesce(lim, 0), case when coalesce(lim, 0) = 1 then '' else 's' end
      using errcode = 'P0001', hint = 'plan_limit:max_keywords';
  end if;
  return null;
end;
$$;
