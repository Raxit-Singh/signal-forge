-- Products, aliases (search keywords), competitors and product events.

create type public.alias_kind as enum (
  'exact_name', 'abbreviation', 'domain', 'misspelling', 'handle', 'custom'
);

create type public.product_event_kind as enum (
  'launch', 'major_update', 'new_feature', 'marketing_campaign',
  'product_hunt_launch', 'pricing_change', 'other'
);

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  website_url     text check (website_url is null or (website_url ~* '^https?://' and char_length(website_url) <= 2048)),
  description     text check (char_length(description) <= 2000),
  category        text check (char_length(category) <= 80),
  target_audience text check (char_length(target_audience) <= 500),
  app_store_url   text check (app_store_url is null or (app_store_url ~* '^https://apps\.apple\.com/' and char_length(app_store_url) <= 2048)),
  play_store_url  text check (play_store_url is null or (play_store_url ~* '^https://play\.google\.com/' and char_length(play_store_url) <= 2048)),
  github_repo     text check (github_repo is null or github_repo ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$'),
  -- Onboarding progress for this product: 1=details, 2=aliases, 3=sources, 4=ai, 5=scan, 6=done
  onboarding_step smallint not null default 2 check (onboarding_step between 1 and 6),
  archived_at     timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, workspace_id)
);

create unique index products_ws_name_uniq on public.products (workspace_id, lower(name)) where archived_at is null;
create index products_ws_idx on public.products (workspace_id) where archived_at is null;

create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function private.audit_row_change();

-- Server-side plan enforcement: active product count may not exceed the plan.
-- Serialised per workspace with an advisory lock so concurrent inserts cannot race.
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
     and pr.id <> new.id;

  if current_count >= coalesce(max_allowed, 0) then
    raise exception 'Product limit reached for this plan (% allowed)', coalesce(max_allowed, 0)
      using errcode = 'P0001', hint = 'plan_limit:max_products';
  end if;
  return new;
end;
$$;

create trigger products_enforce_limit
  before insert or update of archived_at on public.products
  for each row execute function private.enforce_product_limit();

-- Search keywords for a product (or a competitor, see below).
create table public.product_aliases (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  product_id      uuid not null,
  term            text not null check (char_length(btrim(term)) between 2 and 100),
  kind            public.alias_kind not null default 'custom',
  -- Ambiguous terms (e.g. "Linear", "Notion") are never treated as a reliable match
  -- on their own: a mention must also contain one of the context terms.
  is_ambiguous    boolean not null default false,
  context_terms   text[] not null default '{}' check (cardinality(context_terms) <= 20),
  negative_terms  text[] not null default '{}' check (cardinality(negative_terms) <= 20),
  enabled         boolean not null default true,
  source          text not null default 'user' check (source in ('suggested', 'user')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  constraint ambiguous_needs_context check (not is_ambiguous or cardinality(context_terms) > 0 or not enabled)
);

create unique index product_aliases_term_uniq on public.product_aliases (product_id, lower(term));
create index product_aliases_ws_idx on public.product_aliases (workspace_id);

create trigger product_aliases_touch before update on public.product_aliases
  for each row execute function private.touch_updated_at();

create table public.competitors (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  product_id    uuid not null,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  website_url   text check (website_url is null or (website_url ~* '^https?://' and char_length(website_url) <= 2048)),
  keywords      text[] not null default '{}' check (cardinality(keywords) <= 20),
  context_terms text[] not null default '{}' check (cardinality(context_terms) <= 20),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create unique index competitors_name_uniq on public.competitors (product_id, lower(name));

create trigger competitors_touch before update on public.competitors
  for each row execute function private.touch_updated_at();

create or replace function private.enforce_competitor_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_allowed integer;
  current_count integer;
begin
  -- Unauthorised writers are rejected by RLS; do not leak plan details to them.
  if (select auth.uid()) is not null and not private.has_workspace_role(new.workspace_id, 'admin') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('competitors:' || new.product_id::text, 0));
  select p.max_competitors_per_product into max_allowed
    from public.plans p where p.id = private.effective_plan_id(new.workspace_id);
  select count(*) into current_count from public.competitors c where c.product_id = new.product_id;
  if current_count >= coalesce(max_allowed, 0) then
    raise exception 'Competitor limit reached for this plan (% allowed)', coalesce(max_allowed, 0)
      using errcode = 'P0001', hint = 'plan_limit:max_competitors';
  end if;
  return new;
end;
$$;

create trigger competitors_enforce_limit before insert on public.competitors
  for each row execute function private.enforce_competitor_limit();

create table public.product_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  product_id    uuid not null,
  kind          public.product_event_kind not null,
  title         text not null check (char_length(btrim(title)) between 1 and 160),
  notes         text check (char_length(notes) <= 2000),
  url           text check (url is null or (url ~* '^https?://' and char_length(url) <= 2048)),
  occurred_at   timestamptz not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index product_events_product_time_idx on public.product_events (product_id, occurred_at desc);
