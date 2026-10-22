-- Serper (google.serper.dev) as a paid provider for Web (Google Search) and News
-- (Google News) (additive). Same reservation, budgets and ledger as the others.
-- Constraint changes only widen what is accepted; no existing row changes.

alter table public.provider_pricing drop constraint provider_pricing_provider_check;
alter table public.provider_pricing add constraint provider_pricing_provider_check check (provider in ('apidirect', 'tikhub', 'serper'));
-- Serper's endpoints are /search and /news (no /v1 prefix).
alter table public.provider_pricing drop constraint provider_pricing_endpoint_check;
alter table public.provider_pricing add constraint provider_pricing_endpoint_check check (endpoint ~ '^/[a-z0-9/_]+$');

alter table public.api_budgets drop constraint api_budgets_provider_check;
alter table public.api_budgets add constraint api_budgets_provider_check check (provider in ('apidirect', 'tikhub', 'serper'));

alter table public.api_cost_ledger drop constraint api_cost_ledger_provider_check;
alter table public.api_cost_ledger add constraint api_cost_ledger_provider_check check (provider in ('apidirect', 'tikhub', 'serper'));

alter table public.mentions drop constraint mentions_data_provider_check;
alter table public.mentions add constraint mentions_data_provider_check check (data_provider in ('official', 'apidirect', 'tikhub', 'serper'));

-- Serper bills credits: $50 buys 50,000 (entry pack ⇒ $0.001 per credit, less on larger packs).
-- A query asking for up to 10 results costs 1 credit, 11–100 results 2 credits.
-- Web asks for 10 results (1 credit); News asks for 100 articles (2 credits).
insert into public.provider_pricing (pricing_key, provider, platform, endpoint, unit, price_usd, free_per_month, effective_from, verified_on, source_url) values
  ('serper_web.search',  'serper', 'web',  '/search', 'request', 0.001, 0, '2026-10-22', null, 'https://serper.dev/'),
  ('serper_news.search', 'serper', 'news', '/news',   'request', 0.002, 0, '2026-10-22', null, 'https://serper.dev/')
on conflict (pricing_key, effective_from) do nothing;
