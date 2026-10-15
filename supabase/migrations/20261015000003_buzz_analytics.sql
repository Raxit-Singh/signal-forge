-- Milestone 3: Buzz Analytics read functions.
-- SECURITY INVOKER: the caller's RLS applies, so a user only ever aggregates
-- mentions and coverage of workspaces they belong to.
-- Counting rules (shared by every function):
--   * only original mentions (exact duplicates and reposts are excluded)
--   * rows whose publication time is unknown (web results) are left out of time
--     series and reported separately by buzz_totals
--   * buckets follow the caller's IANA time zone

create or replace function private.check_buzz_args(p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception 'range too long' using errcode = '22023';
  end if;
  if p_bucket not in ('hour', 'day') then
    raise exception 'bucket must be hour or day' using errcode = '22023';
  end if;
  if p_bucket = 'hour' and p_to - p_from > interval '15 days' then
    raise exception 'hourly range too long' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
end;
$$;

-- Counts per bucket and platform.
create or replace function public.buzz_series(
  p_product_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text, p_sources text[] default null
)
returns table (
  bucket_start timestamptz, source text,
  relevant integer, irrelevant integer, pending integer,
  posts integer, comments integer, engagement bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.check_buzz_args(p_from, p_to, p_bucket, p_tz);
  return query
  select (date_trunc(p_bucket, m.published_at at time zone p_tz) at time zone p_tz) as bucket_start,
         m.source::text,
         count(*) filter (where m.relevance_status in ('relevant', 'user_relevant'))::integer,
         count(*) filter (where m.relevance_status in ('irrelevant', 'user_irrelevant'))::integer,
         count(*) filter (where m.relevance_status = 'pending')::integer,
         count(*) filter (where m.relevance_status in ('relevant', 'user_relevant')
                            and m.mention_type in ('post', 'video', 'article', 'note', 'review'))::integer,
         count(*) filter (where m.relevance_status in ('relevant', 'user_relevant')
                            and m.mention_type in ('comment', 'reply', 'quote', 'community_message'))::integer,
         coalesce(sum(m.engagement_score) filter (where m.relevance_status in ('relevant', 'user_relevant')), 0)::bigint
    from public.mentions m
   where m.product_id = p_product_id
     and m.published_at >= p_from and m.published_at < p_to
     and m.dedup_kind = 'original'
     and not m.published_at_estimated
     and (p_sources is null or m.source::text = any (p_sources))
   group by 1, 2
   order by 1, 2;
end;
$$;

-- Period totals per platform (unique authors cannot be summed across buckets).
create or replace function public.buzz_totals(
  p_product_id uuid, p_from timestamptz, p_to timestamptz, p_sources text[] default null
)
returns table (
  source text, relevant integer, irrelevant integer, pending integer,
  posts integer, comments integer, engagement bigint,
  unique_authors integer, with_author integer, duplicates_excluded integer, undated integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.check_buzz_args(p_from, p_to, 'day', 'UTC');
  return query
  with base as (
    select m.* from public.mentions m
     where m.product_id = p_product_id
       and m.published_at >= p_from and m.published_at < p_to
       and (p_sources is null or m.source::text = any (p_sources))
  ), rel as (
    select * from base where dedup_kind = 'original' and not published_at_estimated
  )
  select s.src,
         (select count(*) from rel where rel.source::text = s.src and relevance_status in ('relevant', 'user_relevant'))::integer,
         (select count(*) from rel where rel.source::text = s.src and relevance_status in ('irrelevant', 'user_irrelevant'))::integer,
         (select count(*) from rel where rel.source::text = s.src and relevance_status = 'pending')::integer,
         (select count(*) from rel where rel.source::text = s.src and relevance_status in ('relevant', 'user_relevant')
                                    and mention_type in ('post', 'video', 'article', 'note', 'review'))::integer,
         (select count(*) from rel where rel.source::text = s.src and relevance_status in ('relevant', 'user_relevant')
                                    and mention_type in ('comment', 'reply', 'quote', 'community_message'))::integer,
         (select coalesce(sum(engagement_score), 0) from rel where rel.source::text = s.src
                                    and relevance_status in ('relevant', 'user_relevant'))::bigint,
         -- Authors are identified by the platform's own id/handle; rows without one are not guessed.
         (select count(distinct coalesce(author_external_id, author_display)) from rel where rel.source::text = s.src
                                    and relevance_status in ('relevant', 'user_relevant')
                                    and coalesce(author_external_id, author_display) is not null)::integer,
         (select count(*) from rel where rel.source::text = s.src and relevance_status in ('relevant', 'user_relevant')
                                    and coalesce(author_external_id, author_display) is not null)::integer,
         (select count(*) from base where base.source::text = s.src and dedup_kind <> 'original')::integer,
         (select count(*) from base where base.source::text = s.src and dedup_kind = 'original' and published_at_estimated)::integer
    from (select distinct b.source::text as src from base b) s
   order by 1;
end;
$$;

-- Fraction of each bucket that monitoring actually covered, per platform.
-- Every bucket of the range is returned (source null when nothing covered the range).
-- covered = complete or partial windows; complete = complete windows only.
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
                      from unnest(coalesce(w.comp, '{}'::tstzmultirange) * tstzmultirange(tstzrange(b.bs, b.be))) r), 0)
           / extract(epoch from b.be - b.bs))::real,
         coalesce(w.fail && tstzmultirange(tstzrange(b.bs, b.be)), false)
    -- Left join: buckets with no monitoring at all still come back (source null).
    from buckets b left join win w on true
   order by 1, 2;
end;
$$;

revoke all on function private.check_buzz_args(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function private.check_buzz_args(timestamptz, timestamptz, text, text) to authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.buzz_series(uuid, timestamptz, timestamptz, text, text, text[])',
    'public.buzz_totals(uuid, timestamptz, timestamptz, text[])',
    'public.buzz_coverage(uuid, timestamptz, timestamptz, text, text, text[])'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
