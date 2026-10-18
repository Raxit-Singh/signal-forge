-- Keyword-first monitoring (additive, read-only). Relevant mentions per
-- keyword × platform in a period, for the Smart Monitoring rankings.
--
-- Counting rules (the same as Buzz Analytics):
--   * relevant (rule or user) originals only — duplicates/reposts excluded;
--   * publication time, and mentions whose publication time is estimated
--     (undated web results) are not counted in a period;
--   * a mention that matched several keywords counts once for EACH of them
--     here (per-keyword statistics). Product and platform totals count every
--     mention once (buzz_totals), so keyword rows don't add up to the total.
--   * only the product's current keywords are reported (matched terms are
--     compared case-insensitively with product_aliases).
-- Runs as the caller (security invoker): RLS limits it to the caller's workspaces.

create or replace function public.keyword_platform_counts(
  p_product_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (keyword text, platform text, mentions integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.check_buzz_args(p_from, p_to, 'day', 'UTC');
  return query
  select a.term::text, m.source::text, count(distinct m.id)::integer
    from public.mentions m
    cross join lateral unnest(m.matched_terms) as t(term)
    join public.product_aliases a
      on a.product_id = m.product_id and lower(a.term) = lower(t.term)
   where m.product_id = p_product_id
     and m.published_at >= p_from and m.published_at < p_to
     and m.dedup_kind = 'original'
     and not m.published_at_estimated
     and m.relevance_status in ('relevant', 'user_relevant')
   group by 1, 2
   order by 1, 2;
end;
$$;

revoke all on function public.keyword_platform_counts(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.keyword_platform_counts(uuid, timestamptz, timestamptz) to authenticated, service_role;
