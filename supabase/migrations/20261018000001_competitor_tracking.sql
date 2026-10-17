-- Competitor tracking (additive).
--
-- Each competitor gets a TRACKING PRODUCT: a products row with competitor_of set,
-- hidden from product lists. Collection, deduplication, relevance rules, AI
-- classification, spikes and the Buzz SQL functions all key on product_id, so a
-- competitor's mentions are collected and measured exactly like a product's, and
-- the product's own data is untouched (mentions are unique per product).
--
--   * competitors keeps the user-facing settings (name, website, keywords) and the
--     plan limit (max_competitors_per_product, enforced by its existing trigger).
--   * Tracking products don't count toward max_products or the product keyword
--     allowance; each has at most COMPETITOR_MAX_KEYWORDS active keywords.
--   * Their mentions DO count toward the workspace's monthly mention allowance:
--     they are collected mentions like any other.
--   * Paused competitor = archived tracking product (archived products aren't
--     monitored). Removing a competitor deletes its tracking product and mentions.
--   * Writes go through the RPCs below (admins only); direct writes are revoked so
--     a competitor can't exist without its tracking product.

alter table public.products
  add column competitor_of uuid,
  add constraint products_competitor_of_fk foreign key (competitor_of, workspace_id)
    references public.products (id, workspace_id) on delete cascade,
  add constraint products_competitor_not_self check (competitor_of is null or competitor_of <> id);
create index products_competitor_of_idx on public.products (competitor_of) where competitor_of is not null;

-- Product names are unique among a workspace's own products; a tracking product may
-- share a name with another product or another product's competitor.
drop index public.products_ws_name_uniq;
create unique index products_ws_name_uniq on public.products (workspace_id, lower(name))
  where archived_at is null and competitor_of is null;

alter table public.competitors
  add column tracking_product_id uuid unique references public.products (id) on delete set null;

revoke insert, update, delete on public.competitors from authenticated;

-- Product limit: tracking products don't use a product slot.
create or replace function private.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_allowed integer;
  current_count integer;
begin
  if new.competitor_of is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;  -- only inserts and un-archiving consume a slot
  end if;
  if new.archived_at is not null then
    return new;
  end if;
  -- Unauthorised writers are rejected by RLS; do not leak plan details to them.
  if (select auth.uid()) is not null and not private.has_workspace_role(new.workspace_id, 'admin') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('products:' || new.workspace_id::text, 0));

  select p.max_products into max_allowed
    from public.plans p
   where p.id = private.effective_plan_id(new.workspace_id);

  select count(*) into current_count
    from public.products pr
   where pr.workspace_id = new.workspace_id
     and pr.archived_at is null
     and pr.competitor_of is null
     and pr.id <> new.id;

  if current_count >= coalesce(max_allowed, 0) then
    raise exception 'Product limit reached for this plan (% allowed)', coalesce(max_allowed, 0)
      using errcode = 'P0001', hint = 'plan_limit:max_products';
  end if;
  return new;
end;
$$;

-- Keyword allowance: counts the workspace's own products only; a tracking product
-- has its own small cap.
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
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('keywords:' || new.workspace_id::text, 0));
  select p.max_keywords, p.name into lim, plan_name from public.plans p where p.id = private.effective_plan_id(new.workspace_id);
  select count(*) into n from public.product_aliases a join public.products p on p.id = a.product_id
   where a.workspace_id = new.workspace_id and a.enabled and p.archived_at is null and p.competitor_of is null;
  if n > coalesce(lim, 0) then
    raise exception 'Your % plan includes % active keyword%. Turn some off or change plan.',
      plan_name, coalesce(lim, 0), case when coalesce(lim, 0) = 1 then '' else 's' end
      using errcode = 'P0001', hint = 'plan_limit:max_keywords';
  end if;
  return null;
end;
$$;

create or replace function private.competitor_max_keywords()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

-- Archiving or restoring a product does the same to its competitors' tracking
-- products (restored only while the competitor is enabled).
create or replace function private.cascade_product_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.competitor_of is null and old.archived_at is distinct from new.archived_at then
    update public.products tp set archived_at = new.archived_at
      from public.competitors c
     where c.tracking_product_id = tp.id and c.product_id = new.id
       and (new.archived_at is not null or c.enabled);
  end if;
  return null;
end;
$$;

create trigger products_cascade_archive after update of archived_at on public.products
  for each row execute function private.cascade_product_archive();

-- ---------------------------------------------------------------------------
-- RPCs (run as the caller's identity for role checks; definer for the writes)
-- ---------------------------------------------------------------------------
create or replace function private.clean_competitor_keywords(p_name text, p_keywords text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  out text[] := '{}';
  k text;
begin
  foreach k in array array[p_name] || coalesce(p_keywords, '{}') loop  -- the name first
    k := btrim(regexp_replace(coalesce(k, ''), '\s+', ' ', 'g'));
    if char_length(k) between 2 and 100 and not exists (select 1 from unnest(out) o where lower(o) = lower(k)) then
      out := out || k;
    end if;
  end loop;
  if cardinality(out) = 0 then
    raise exception 'Give the competitor a name of at least 2 characters' using errcode = '22023';
  end if;
  if cardinality(out) > private.competitor_max_keywords() then
    raise exception 'A competitor can have at most % keywords.', private.competitor_max_keywords()
      using errcode = 'P0001', hint = 'plan_limit:competitor_keywords';
  end if;
  return out;
end;
$$;

create or replace function public.add_competitor(p_product_id uuid, p_name text, p_website text default null, p_keywords text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prod record;
  comp_id uuid;
  track_id uuid;
  kws text[];
  site text := nullif(btrim(coalesce(p_website, '')), '');
  i integer;
begin
  select id, workspace_id, competitor_of, archived_at into prod from public.products where id = p_product_id;
  if prod.id is null or not private.has_workspace_role(prod.workspace_id, 'admin') then
    raise exception 'Product not found' using errcode = '42501';
  end if;
  if prod.competitor_of is not null or prod.archived_at is not null then
    raise exception 'Competitors can only be added to an active product' using errcode = '22023';
  end if;
  kws := private.clean_competitor_keywords(p_name, p_keywords);

  insert into public.competitors (workspace_id, product_id, name, website_url, keywords)
  values (prod.workspace_id, prod.id, btrim(p_name), site, kws)
  returning id into comp_id;

  insert into public.products (workspace_id, name, website_url, competitor_of, onboarding_step, created_by)
  values (prod.workspace_id, btrim(p_name), site, prod.id, 6, (select auth.uid()))
  returning id into track_id;

  for i in 1 .. cardinality(kws) loop
    insert into public.product_aliases (workspace_id, product_id, term, kind, source)
    values (prod.workspace_id, track_id, kws[i], case when i = 1 then 'exact_name' else 'custom' end::public.alias_kind, 'user');
  end loop;

  update public.competitors set tracking_product_id = track_id where id = comp_id;
  return comp_id;
end;
$$;

create or replace function public.update_competitor(p_competitor_id uuid, p_name text, p_website text, p_keywords text[], p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  kws text[];
  site text := nullif(btrim(coalesce(p_website, '')), '');
  i integer;
  parent_archived boolean;
begin
  select * into c from public.competitors where id = p_competitor_id;
  if c.id is null or not private.has_workspace_role(c.workspace_id, 'admin') then
    raise exception 'Competitor not found' using errcode = '42501';
  end if;
  kws := private.clean_competitor_keywords(p_name, p_keywords);
  select archived_at is not null into parent_archived from public.products where id = c.product_id;

  update public.competitors set name = btrim(p_name), website_url = site, keywords = kws, enabled = p_enabled where id = c.id;
  update public.products set name = btrim(p_name), website_url = site,
         archived_at = case when p_enabled and not parent_archived then null else coalesce(archived_at, now()) end
   where id = c.tracking_product_id;

  delete from public.product_aliases where product_id = c.tracking_product_id;
  for i in 1 .. cardinality(kws) loop
    insert into public.product_aliases (workspace_id, product_id, term, kind, source)
    values (c.workspace_id, c.tracking_product_id, kws[i], case when i = 1 then 'exact_name' else 'custom' end::public.alias_kind, 'user');
  end loop;
end;
$$;

create or replace function public.remove_competitor(p_competitor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.competitors where id = p_competitor_id;
  if c.id is null or not private.has_workspace_role(c.workspace_id, 'admin') then
    raise exception 'Competitor not found' using errcode = '42501';
  end if;
  delete from public.products where id = c.tracking_product_id;  -- its mentions, searches and analytics go with it
  delete from public.competitors where id = c.id;
end;
$$;

revoke all on function public.add_competitor(uuid, text, text, text[]) from public, anon;
revoke all on function public.update_competitor(uuid, text, text, text[], boolean) from public, anon;
revoke all on function public.remove_competitor(uuid) from public, anon;
grant execute on function public.add_competitor(uuid, text, text, text[]) to authenticated;
grant execute on function public.update_competitor(uuid, text, text, text[], boolean) to authenticated;
grant execute on function public.remove_competitor(uuid) to authenticated;
revoke all on function private.clean_competitor_keywords(text, text[]) from public;
revoke all on function private.cascade_product_archive() from public;
