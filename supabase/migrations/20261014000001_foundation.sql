-- SignalForge foundation: tenancy, plans, subscriptions, usage, audit.
--
-- Conventions
--   * Every tenant-owned row carries workspace_id and is protected by RLS.
--   * Helper functions live in the `private` schema, which is NOT exposed
--     through the Supabase Data API, so clients cannot call them directly.
--   * Child tables reference (id, workspace_id) composite keys so a row can
--     never be linked to a parent in another workspace.
--   * Secrets never live in tables readable by the `authenticated` role.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');

create type public.subscription_status as enum (
  'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  display_name  text check (char_length(display_name) <= 120),
  avatar_url    text check (char_length(avatar_url) <= 2048),
  default_workspace_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    left(new.raw_user_meta_data ->> 'avatar_url', 2048)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Plans (configurable; prices are proposals, not hardcoded in app code)
-- ---------------------------------------------------------------------------
create table public.plans (
  id                        text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  name                      text not null,
  description               text,
  price_cents_monthly       integer not null default 0 check (price_cents_monthly >= 0),
  currency                  text not null default 'usd',
  stripe_price_id           text unique,
  max_products              integer not null check (max_products >= 0),
  max_competitors_per_product integer not null default 0 check (max_competitors_per_product >= 0),
  monthly_mention_limit     integer not null check (monthly_mention_limit >= 0),
  history_days              integer not null check (history_days > 0),
  monitoring_interval_minutes integer not null check (monitoring_interval_minutes >= 15),
  monthly_ai_token_budget   bigint not null default 0 check (monthly_ai_token_budget >= 0),
  monthly_investigations    integer not null default 0 check (monthly_investigations >= 0),
  features                  jsonb not null default '{}'::jsonb,
  is_public                 boolean not null default true,
  sort_order                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger plans_touch before update on public.plans
  for each row execute function private.touch_updated_at();

-- Proposed launch plans. Edit rows (or set stripe_price_id) without code changes.
insert into public.plans
  (id, name, description, price_cents_monthly, max_products, max_competitors_per_product,
   monthly_mention_limit, history_days, monitoring_interval_minutes,
   monthly_ai_token_budget, monthly_investigations, features, sort_order)
values
  ('free', 'Free', 'One product, weekly reports.', 0, 1, 0, 500, 30, 1440, 0, 0,
   '{"weekly_reports": true, "daily_reports": false, "feedback_intelligence": false, "advanced_analytics": false, "byok": true}', 0),
  ('starter', 'Starter', 'Daily monitoring and basic AI classification.', 900, 1, 2, 3000, 90, 1440, 2000000, 0,
   '{"weekly_reports": true, "daily_reports": true, "feedback_intelligence": false, "advanced_analytics": false, "byok": true}', 1),
  ('pro', 'Pro', 'Three products, feedback intelligence, codebase investigations.', 1900, 3, 3, 15000, 365, 360, 8000000, 10,
   '{"weekly_reports": true, "daily_reports": true, "feedback_intelligence": true, "advanced_analytics": true, "byok": true}', 2),
  ('business', 'Business', 'Ten products and higher limits.', 4900, 10, 5, 60000, 730, 180, 30000000, 40,
   '{"weekly_reports": true, "daily_reports": true, "feedback_intelligence": true, "advanced_analytics": true, "byok": true, "advanced_integrations": true}', 3);

-- ---------------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  created_by  uuid references auth.users (id) on delete set null,
  onboarding_completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger workspaces_touch before update on public.workspaces
  for each row execute function private.touch_updated_at();

alter table public.profiles
  add constraint profiles_default_workspace_fk
  foreign key (default_workspace_id) references public.workspaces (id) on delete set null;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- References profiles (which cascades from auth.users) so the Data API can embed member profiles.
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.workspace_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- Role ranking used by authorization helpers.
create or replace function private.role_rank(r public.workspace_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner'  then 40
    when 'admin'  then 30
    when 'member' then 20
    when 'viewer' then 10
  end;
$$;

-- True when the current user belongs to the workspace with at least min_role.
-- SECURITY DEFINER so policies on workspace_members do not recurse.
create or replace function private.has_workspace_role(
  ws uuid,
  min_role public.workspace_role default 'viewer'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(min_role)
  );
$$;

revoke all on function private.has_workspace_role(uuid, public.workspace_role) from public;
grant execute on function private.has_workspace_role(uuid, public.workspace_role) to authenticated, service_role;

-- Every workspace must keep at least one owner.
create or replace function private.ensure_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := old.workspace_id;
begin
  -- Workspace itself being deleted: cascade is fine.
  if not exists (select 1 from public.workspaces w where w.id = ws) then
    return null;
  end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.role = 'owner'
  ) then
    raise exception 'A workspace must have at least one owner'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger workspace_members_keep_owner
  after update or delete on public.workspace_members
  deferrable initially deferred
  for each row execute function private.ensure_owner_remains();

-- ---------------------------------------------------------------------------
-- Subscriptions (written only by the server via verified payment webhooks)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  workspace_id              uuid primary key references public.workspaces (id) on delete cascade,
  plan_id                   text not null references public.plans (id),
  status                    public.subscription_status not null default 'active',
  provider                  text not null default 'none' check (provider in ('none', 'stripe')),
  provider_customer_id      text,
  provider_subscription_id  text unique,
  current_period_start      timestamptz not null default date_trunc('month', now()),
  current_period_end        timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  cancel_at_period_end      boolean not null default false,
  last_webhook_event_at     timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function private.touch_updated_at();

-- Processed payment-provider events, for idempotent webhook handling.
create table public.billing_events (
  id           text primary key,          -- provider event id
  provider     text not null,
  type         text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- Effective plan: a lapsed paid subscription falls back to the free plan.
create or replace function private.effective_plan_id(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.plan_id
       from public.subscriptions s
      where s.workspace_id = ws
        and s.status in ('active', 'trialing', 'past_due')),
    'free'
  );
$$;

revoke all on function private.effective_plan_id(uuid) from public;
-- Only used inside SECURITY DEFINER triggers; not callable by clients.
revoke all on function private.effective_plan_id(uuid) from authenticated;
grant execute on function private.effective_plan_id(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Usage counters (per workspace per billing period per metric)
-- ---------------------------------------------------------------------------
create table public.usage_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  period_start date not null,
  metric       text not null check (metric in (
                 'mentions_ingested', 'ai_tokens', 'ai_cost_microusd',
                 'investigations', 'api_calls', 'reports_generated')),
  amount       bigint not null default 0 check (amount >= 0),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, period_start, metric)
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only; written by triggers / server code)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index audit_logs_ws_created_idx on public.audit_logs (workspace_id, created_at desc);

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec   jsonb;
  ws    uuid;
  ent   text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws  := nullif(rec ->> 'workspace_id', '')::uuid;
  if tg_table_name = 'workspaces' then
    ws := (rec ->> 'id')::uuid;
  end if;
  ent := coalesce(rec ->> 'id', rec ->> 'user_id');

  -- Do not write an audit row pointing at a workspace that is being deleted.
  if tg_op = 'DELETE' and tg_table_name = 'workspaces' then
    return old;
  end if;
  if ws is not null and not exists (select 1 from public.workspaces w where w.id = ws) then
    ws := null;
  end if;

  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    ws,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    ent,
    -- Never copy secret-bearing columns; tables with secrets are not audited by row.
    jsonb_strip_nulls(jsonb_build_object(
      'name', rec ->> 'name',
      'role', rec ->> 'role',
      'provider', rec ->> 'provider',
      'status', rec ->> 'status'
    ))
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger audit_workspaces after insert or update or delete on public.workspaces
  for each row execute function private.audit_row_change();
create trigger audit_workspace_members after insert or update or delete on public.workspace_members
  for each row execute function private.audit_row_change();
