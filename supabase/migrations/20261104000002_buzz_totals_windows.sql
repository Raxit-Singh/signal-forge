-- Overview and Trends asked buzz_totals for eleven windows at once (the range, the period before it, the last
-- 24 hours, today, yesterday, 7 and 30 days and the periods before those, the 28-day baseline). Each call scanned
-- the same mentions again and looked the time zone up in pg_timezone_names, so on a large product the calls
-- competed for the database's CPU and some hit the 8 s statement timeout (57014).
--
-- buzz_totals_windows returns the same columns as buzz_totals for many windows in one scan. buzz_totals stays
-- as it is for other callers.

create or replace function public.buzz_totals_windows(
  p_product_id uuid, p_from timestamptz[], p_to timestamptz[], p_sources text[] default null
)
returns table (
  win integer, source text, relevant integer, irrelevant integer, pending integer,
  posts integer, comments integer, engagement bigint,
  unique_authors integer, with_author integer, duplicates_excluded integer, undated integer
)
language plpgsql
stable
security invoker
set search_path = ''
set work_mem = '32MB'
as $$
declare
  n integer := coalesce(pg_catalog.array_length(p_from, 1), 0);
  lo timestamptz;
  hi timestamptz;
begin
  if n = 0 or n > 16 or n <> coalesce(pg_catalog.array_length(p_to, 1), 0) then
    raise exception 'between 1 and 16 windows, each with a start and an end' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_from, p_to) w(f, t) where f is null or t is null or t <= f) then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select min(w.f), max(w.t) into lo, hi from unnest(p_from, p_to) w(f, t);
  if hi - lo > interval '400 days' then
    raise exception 'range too long' using errcode = '22023';
  end if;

  return query
  with w as (
    select x.ord::integer as i, x.f, x.t from unnest(p_from, p_to) with ordinality x(f, t, ord)
  ), base as (
    select m.published_at, m.source::text as src, m.dedup_kind, m.published_at_estimated, m.relevance_status,
           m.mention_type, m.engagement_score, coalesce(m.author_external_id, m.author_display) as author,
           (m.dedup_kind = 'original' and not m.published_at_estimated) as counted,
           m.relevance_status in ('relevant', 'user_relevant') as rel
      from public.mentions m
     where m.product_id = p_product_id
       and m.published_at >= lo and m.published_at < hi
       and (p_sources is null or m.source::text = any (p_sources))
  )
  select w.i, b.src,
         (count(*) filter (where b.counted and b.rel))::integer,
         (count(*) filter (where b.counted and b.relevance_status in ('irrelevant', 'user_irrelevant')))::integer,
         (count(*) filter (where b.counted and b.relevance_status = 'pending'))::integer,
         (count(*) filter (where b.counted and b.rel and b.mention_type in ('post', 'video', 'article', 'note', 'review')))::integer,
         (count(*) filter (where b.counted and b.rel and b.mention_type in ('comment', 'reply', 'quote', 'community_message')))::integer,
         (coalesce(sum(b.engagement_score) filter (where b.counted and b.rel), 0))::bigint,
         -- Authors are identified by the platform's own id/handle; rows without one are not guessed.
         (count(distinct b.author) filter (where b.counted and b.rel and b.author is not null))::integer,
         (count(*) filter (where b.counted and b.rel and b.author is not null))::integer,
         (count(*) filter (where b.dedup_kind <> 'original'))::integer,
         (count(*) filter (where b.dedup_kind = 'original' and b.published_at_estimated))::integer
    from base b
    join w on b.published_at >= w.f and b.published_at < w.t
   group by w.i, b.src
   order by 1, 2;
end;
$$;

revoke all on function public.buzz_totals_windows(uuid, timestamptz[], timestamptz[], text[]) from public, anon;
grant execute on function public.buzz_totals_windows(uuid, timestamptz[], timestamptz[], text[]) to authenticated, service_role;
