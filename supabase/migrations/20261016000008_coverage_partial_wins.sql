-- Coverage completeness: a partial window wins over a complete one (no data changes).
--
-- coverage_windows are recorded per platform, not per search. When one keyword's
-- search read a period completely but another keyword's search on the same
-- platform was cut short (page limit, provider window), the period used to count
-- as "complete" — so a capped historical scan could make recent days look busier
-- than older ones (an artificial spike; found in the 2026-10-16 spike audit).
-- Now any partial window overlapping a period makes that platform's count a lower
-- bound there: complete = complete windows minus partial windows.

create or replace function public.buzz_coverage(
  p_product_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text, p_sources text[] default null
)
returns table (bucket_start timestamptz, source text, covered real, complete real, failed boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.check_buzz_args(p_from, p_to, p_bucket, p_tz);
  return query
  with buckets as (
    select (g at time zone p_tz) as bs,
           ((g + case p_bucket when 'hour' then interval '1 hour' else interval '1 day' end) at time zone p_tz) as be
      from generate_series(date_trunc(p_bucket, p_from at time zone p_tz),
                           (p_to at time zone p_tz) - interval '1 microsecond',
                           case p_bucket when 'hour' then interval '1 hour' else interval '1 day' end) g
  ), win as (
    select cw.provider::text as src,
           range_agg(tstzrange(cw.window_start, cw.window_end)) filter (where cw.status in ('complete', 'partial')) as cov,
           range_agg(tstzrange(cw.window_start, cw.window_end)) filter (where cw.status = 'complete') as comp,
           range_agg(tstzrange(cw.window_start, cw.window_end)) filter (where cw.status = 'partial') as part,
           range_agg(tstzrange(cw.window_start, cw.window_end)) filter (where cw.status = 'failed') as fail
      from public.coverage_windows cw
     where cw.product_id = p_product_id
       and cw.window_end > p_from and cw.window_start < p_to
       and (p_sources is null or cw.provider::text = any (p_sources))
     group by 1
  )
  select b.bs, w.src,
         (coalesce((select sum(extract(epoch from upper(r) - lower(r)))
                      from unnest(coalesce(w.cov, '{}'::tstzmultirange) * tstzmultirange(tstzrange(b.bs, b.be))) r), 0)
           / extract(epoch from b.be - b.bs))::real,
         (coalesce((select sum(extract(epoch from upper(r) - lower(r)))
                      from unnest((coalesce(w.comp, '{}'::tstzmultirange) - coalesce(w.part, '{}'::tstzmultirange))
                                  * tstzmultirange(tstzrange(b.bs, b.be))) r), 0)
           / extract(epoch from b.be - b.bs))::real,
         coalesce(w.fail && tstzmultirange(tstzrange(b.bs, b.be)), false)
    -- Left join: buckets with no monitoring at all still come back (source null).
    from buckets b left join win w on true
   order by 1, 2;
end;
$$;

revoke all on function public.buzz_coverage(uuid, timestamptz, timestamptz, text, text, text[]) from public, anon;
grant execute on function public.buzz_coverage(uuid, timestamptz, timestamptz, text, text, text[]) to authenticated, service_role;
