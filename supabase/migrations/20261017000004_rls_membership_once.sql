-- RLS performance (no change in who can see or do what).
--
-- Policies called private.has_workspace_role(workspace_id, role) for EVERY row:
-- a security-definer function can't be inlined, so reading 13k mentions ran
-- 13k membership lookups (~1.8 s per scan) and Buzz Analytics hit the statement
-- timeout. Each policy now compares the row's workspace with the caller's
-- workspaces, computed once per query (a hashed sub-plan):
--
--   private.has_workspace_role(workspace_id, 'viewer')
--     →  workspace_id in (select private.user_workspace_ids('viewer'))
--
-- Same rule: has_workspace_role(ws, r) is true exactly when ws is one of the
-- caller's memberships with role rank >= r. has_workspace_role stays for code
-- that checks a single workspace.

create or replace function private.user_workspace_ids(min_role public.workspace_role default 'viewer')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
    from public.workspace_members m
   where m.user_id = (select auth.uid())
     and private.role_rank(m.role) >= private.role_rank(min_role);
$$;

revoke all on function private.user_workspace_ids(public.workspace_role) from public;
grant execute on function private.user_workspace_ids(public.workspace_role) to authenticated, service_role;

-- Rewrite every public-schema policy expression that uses the per-row check.
do $$
declare
  p record;
  pat constant text := 'private\.has_workspace_role\(([a-z_]+), (''[a-z]+''::[a-z_.]+)\)';
  rep constant text := '(\1 IN ( SELECT private.user_workspace_ids(\2)))';
  q text;
  c text;
  n integer := 0;
begin
  for p in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ 'private\.has_workspace_role\(' or with_check ~ 'private\.has_workspace_role\(')
  loop
    q := case when p.qual is null then null else regexp_replace(p.qual, pat, rep, 'g') end;
    c := case when p.with_check is null then null else regexp_replace(p.with_check, pat, rep, 'g') end;
    if coalesce(q, '') ~ 'has_workspace_role\(' or coalesce(c, '') ~ 'has_workspace_role\(' then
      raise exception 'policy %.% has a has_workspace_role call this migration does not recognise', p.tablename, p.policyname;
    end if;
    execute format('alter policy %I on public.%I', p.policyname, p.tablename)
      || case when q is not null then ' using (' || q || ')' else '' end
      || case when c is not null then ' with check (' || c || ')' else '' end;
    n := n + 1;
  end loop;
  raise notice 'rewrote % policies', n;
end;
$$;

-- buzz_totals: same output, one pass over only the columns it needs (it used to
-- copy whole rows, including content and embeddings, then scan them ten times).
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
    select m.source::text as src, m.dedup_kind, m.published_at_estimated, m.relevance_status, m.mention_type,
           m.engagement_score, coalesce(m.author_external_id, m.author_display) as author,
           (m.dedup_kind = 'original' and not m.published_at_estimated) as counted,
           m.relevance_status in ('relevant', 'user_relevant') as rel
      from public.mentions m
     where m.product_id = p_product_id
       and m.published_at >= p_from and m.published_at < p_to
       and (p_sources is null or m.source::text = any (p_sources))
  )
  select b.src,
         (count(*) filter (where counted and rel))::integer,
         (count(*) filter (where counted and relevance_status in ('irrelevant', 'user_irrelevant')))::integer,
         (count(*) filter (where counted and relevance_status = 'pending'))::integer,
         (count(*) filter (where counted and rel and mention_type in ('post', 'video', 'article', 'note', 'review')))::integer,
         (count(*) filter (where counted and rel and mention_type in ('comment', 'reply', 'quote', 'community_message')))::integer,
         (coalesce(sum(engagement_score) filter (where counted and rel), 0))::bigint,
         -- Authors are identified by the platform's own id/handle; rows without one are not guessed.
         (count(distinct author) filter (where counted and rel and author is not null))::integer,
         (count(*) filter (where counted and rel and author is not null))::integer,
         (count(*) filter (where dedup_kind <> 'original'))::integer,
         (count(*) filter (where dedup_kind = 'original' and published_at_estimated))::integer
    from base b
   group by b.src
   order by 1;
end;
$$;
