-- TikHub as a second paid data provider (additive). It searches X, TikTok and
-- Instagram for the platforms an operator lists in TIKHUB_PLATFORMS; every call
-- goes through the same reservation, budgets and ledger as API Direct.
--
-- Constraint changes only widen what is accepted ('tikhub', and TikHub's
-- /api/v1/... endpoint paths); no existing row changes.

alter table public.provider_pricing drop constraint provider_pricing_provider_check;
alter table public.provider_pricing add constraint provider_pricing_provider_check check (provider in ('apidirect', 'tikhub'));
alter table public.provider_pricing drop constraint provider_pricing_endpoint_check;
alter table public.provider_pricing add constraint provider_pricing_endpoint_check check (endpoint ~ '^(/api)?/v1/[a-z0-9/_]+$');

alter table public.api_budgets drop constraint api_budgets_provider_check;
alter table public.api_budgets add constraint api_budgets_provider_check check (provider in ('apidirect', 'tikhub'));

alter table public.api_cost_ledger drop constraint api_cost_ledger_provider_check;
alter table public.api_cost_ledger add constraint api_cost_ledger_provider_check check (provider in ('apidirect', 'tikhub'));

alter table public.mentions drop constraint mentions_data_provider_check;
alter table public.mentions add constraint mentions_data_provider_check check (data_provider in ('official', 'apidirect', 'tikhub'));

-- Prices from TikHub's own endpoint price list (GET /api/v1/tikhub/user/get_all_endpoints_info)
-- and the account balance before/after live calls, 2026-10-22. Billed per successful request;
-- failed requests are not charged. No monthly free allowance; these three endpoints get no volume discount.
insert into public.provider_pricing (pricing_key, provider, platform, endpoint, unit, price_usd, free_per_month, effective_from, verified_on, source_url) values
  ('tikhub_x.search',        'tikhub', 'x',         '/api/v1/twitter/web/fetch_search_timeline',        'request', 0.001, 0, '2026-10-22', '2026-10-22', 'https://tikhub.io/pricing'),
  ('tikhub_tiktok.search',   'tikhub', 'tiktok',    '/api/v1/tiktok/app/v3/fetch_video_search_result',  'request', 0.001, 0, '2026-10-22', '2026-10-22', 'https://tikhub.io/pricing'),
  ('tikhub_instagram.reels', 'tikhub', 'instagram', '/api/v1/instagram/v2/search_reels',                'request', 0.002, 0, '2026-10-22', '2026-10-22', 'https://tikhub.io/pricing')
on conflict (pricing_key, effective_from) do nothing;
