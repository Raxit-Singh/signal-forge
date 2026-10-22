-- Serper News is billed per credit (additive): Serper reports the credits each query
-- used (free accounts: 10 articles for 1 credit; paid: up to 100 for 2), and the app
-- settles exactly that. serper_news.search (per query) stays for history; the code
-- now reserves under serper_news.credits.
insert into public.provider_pricing (pricing_key, provider, platform, endpoint, unit, price_usd, free_per_month, effective_from, verified_on, source_url) values
  ('serper_news.credits', 'serper', 'news', '/news', 'request', 0.001, 0, '2026-10-22', '2026-10-22', 'https://serper.dev/')
on conflict (pricing_key, effective_from) do nothing;
