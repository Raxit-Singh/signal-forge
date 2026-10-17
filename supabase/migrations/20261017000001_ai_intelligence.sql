-- Milestone 4: AI intelligence (additive; existing data, analytics and RLS untouched).
--
--   * Budgets: every model call is reserved before it is made and settled after
--     (ai_usage_records gains status/reservation columns). SignalForge-billed calls
--     need BOTH the plan's monthly token budget AND an operator-set global USD budget
--     (ai_global_budget; no row = SignalForge AI credits can't spend anything).
--     BYOK calls are billed to the customer's key; an optional monthly token cap
--     (ai_settings) stops them.
--   * ai_cache: model outputs by content hash, per workspace (never shared).
--   * mentions: AI classification state. AI never changes relevance_status (which
--     drives the mention allowance) or any analytics table; its "about the product"
--     answer is advisory (ai_about_product) and shown as a hint.
--   * ai_investigations: on-demand analyses keyed by subject (spike / cluster).
-- Everything the pipeline writes goes through the service role.

-- ---------------------------------------------------------------------------
-- Settings and budgets
-- ---------------------------------------------------------------------------
create table public.ai_settings (
  workspace_id            uuid primary key references public.workspaces (id) on delete cascade,
  -- Classify new mentions automatically (otherwise nothing runs until switched on).
  auto_classify           boolean not null default true,
  -- Optional monthly token cap for BYOK usage (null = no cap).
  byok_monthly_token_cap  bigint check (byok_monthly_token_cap > 0),
  updated_at              timestamptz not null default now()
);
create trigger ai_settings_touch before update on public.ai_settings
  for each row execute function private.touch_updated_at();

-- Single row, operator-managed. Absent = SignalForge AI credits disabled.
create table public.ai_global_budget (
  id                 boolean primary key default true check (id),
  monthly_limit_usd  numeric(12, 4) not null check (monthly_limit_usd >= 0),
  note               text check (char_length(note) <= 300),
  updated_at         timestamptz not null default now()
);

alter table public.ai_provider_connections
  add column last_error text check (char_length(last_error) <= 300);

alter table public.ai_usage_records
  add column product_id        uuid references public.products (id) on delete set null,
  add column status            text not null default 'settled' check (status in ('reserved', 'settled', 'released')),
  add column period_start      timestamptz,
  add column reserved_tokens   bigint not null default 0 check (reserved_tokens >= 0),
  add column reserved_microusd bigint check (reserved_microusd >= 0),
  add column cost_known        boolean not null default true,
  add column settled_at        timestamptz;
create index ai_usage_period_idx on public.ai_usage_records (workspace_id, period_start) where status <> 'released';
create index ai_usage_global_idx on public.ai_usage_records (created_at) where billed_to = 'signalforge' and status <> 'released';

-- ---------------------------------------------------------------------------
-- Output cache (service role only)
-- ---------------------------------------------------------------------------
create table public.ai_cache (
  cache_key     text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  purpose       text not null,
  model         text not null,
  output        jsonb not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '90 days')
);
create index ai_cache_expiry_idx on public.ai_cache (expires_at);

-- ---------------------------------------------------------------------------
-- Mention classification state
-- ---------------------------------------------------------------------------
alter table public.mentions
  add column ai_about_product text check (ai_about_product in ('yes', 'no', 'unsure')),
  add column ai_reason        text check (char_length(ai_reason) <= 400),
  add column ai_model         text check (char_length(ai_model) <= 100),
  add column ai_classified_at timestamptz,
  add column ai_attempts      smallint not null default 0 check (ai_attempts >= 0);
create index mentions_ai_pending_idx on public.mentions (product_id, discovered_at)
  where processing_status = 'filtered' and dedup_kind = 'original';

-- ---------------------------------------------------------------------------
-- Clusters and investigations
-- ---------------------------------------------------------------------------
alter table public.feedback_clusters
  add column top_terms   text[] not null default '{}',
  add column algorithm   text not null default 'tfidf_v1',
  add column computed_at timestamptz;

alter table public.ai_investigations drop constraint ai_investigations_kind_check;
alter table public.ai_investigations add constraint ai_investigations_kind_check
  check (kind in ('bug', 'feature', 'spike_explanation', 'cluster_summary'));
alter table public.ai_investigations
  add column subject_key    text check (char_length(subject_key) <= 200),
  add column error          text check (char_length(error) <= 500),
  add column cost_microusd  bigint check (cost_microusd >= 0),
  add column updated_at     timestamptz not null default now();
create unique index ai_investigations_subject_uniq on public.ai_investigations (product_id, kind, subject_key)
  where subject_key is not null;
create trigger ai_investigations_touch before update on public.ai_investigations
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Reserve / settle
-- ---------------------------------------------------------------------------
-- Reservations older than this are assumed abandoned (worker crashed) and released.
create or replace function private.ai_release_stale()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage_records set status = 'released', error_code = coalesce(error_code, 'abandoned'), settled_at = now()
   where status = 'reserved' and created_at < now() - interval '1 hour';
$$;

-- Tokens already used (or reserved) by a workspace in a billing period.
create or replace function private.ai_tokens_used(ws uuid, per timestamptz, p_billed_to text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when status = 'reserved' then reserved_tokens else input_tokens + output_tokens end), 0)::bigint
    from public.ai_usage_records
   where workspace_id = ws and period_start = per and billed_to = p_billed_to and status <> 'released';
$$;

/**
 * Reserves the upper bound of one model call. Returns {ok: true, id} or
 * {ok: false, reason} with reason one of: plan_budget, global_budget,
 * global_budget_missing, unknown_price, byok_cap.
 */
create or replace function public.svc_ai_reserve(
  p_workspace_id uuid, p_product_id uuid, p_provider public.ai_provider, p_model text, p_purpose text,
  p_billed_to text, p_tokens bigint, p_microusd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  per record;
  budget bigint;
  cap bigint;
  used bigint;
  g numeric;
  month_spent bigint;
  new_id bigint;
begin
  if p_billed_to not in ('signalforge', 'byok') or p_tokens < 0 then
    raise exception 'invalid reservation';
  end if;
  perform private.ai_release_stale();
  perform pg_advisory_xact_lock(hashtext('ai:' || p_workspace_id::text));
  select * into per from private.billing_period(p_workspace_id, now());
  used := private.ai_tokens_used(p_workspace_id, per.period_start, p_billed_to);

  if p_billed_to = 'signalforge' then
    select monthly_ai_token_budget into budget from public.plans where id = private.effective_plan_id(p_workspace_id);
    if used + p_tokens > coalesce(budget, 0) then
      return jsonb_build_object('ok', false, 'reason', 'plan_budget', 'used', used, 'limit', coalesce(budget, 0));
    end if;
    if p_microusd is null then
      return jsonb_build_object('ok', false, 'reason', 'unknown_price');
    end if;
    -- All workspaces share the operator's global budget: serialize on it.
    perform pg_advisory_xact_lock(hashtext('ai:global'));
    select monthly_limit_usd into g from public.ai_global_budget where id;
    if g is null then
      return jsonb_build_object('ok', false, 'reason', 'global_budget_missing');
    end if;
    select coalesce(sum(case when status = 'reserved' then coalesce(reserved_microusd, 0) else cost_microusd end), 0)::bigint
      into month_spent
      from public.ai_usage_records
     where billed_to = 'signalforge' and status <> 'released'
       and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    if month_spent + p_microusd > g * 1000000 then
      return jsonb_build_object('ok', false, 'reason', 'global_budget');
    end if;
  else
    select byok_monthly_token_cap into cap from public.ai_settings where workspace_id = p_workspace_id;
    if cap is not null and used + p_tokens > cap then
      return jsonb_build_object('ok', false, 'reason', 'byok_cap', 'used', used, 'limit', cap);
    end if;
  end if;

  insert into public.ai_usage_records (workspace_id, product_id, provider, model, purpose, billed_to, success, status,
                                       period_start, reserved_tokens, reserved_microusd, cost_known)
  values (p_workspace_id, p_product_id, p_provider, p_model, p_purpose, p_billed_to, false, 'reserved',
          per.period_start, p_tokens, p_microusd, p_microusd is not null)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.svc_ai_settle(
  p_id bigint, p_input_tokens integer, p_output_tokens integer, p_cached_tokens integer,
  p_cost_microusd bigint, p_success boolean, p_error text, p_cache_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage_records
     set status = 'settled', input_tokens = greatest(0, p_input_tokens), output_tokens = greatest(0, p_output_tokens),
         cached_tokens = greatest(0, p_cached_tokens), cost_microusd = greatest(0, coalesce(p_cost_microusd, 0)),
         cost_known = p_cost_microusd is not null, success = p_success, error_code = left(p_error, 100),
         cache_key = p_cache_key, settled_at = now()
   where id = p_id and status = 'reserved';
$$;

-- A call that never reached the provider: nothing was used.
create or replace function public.svc_ai_release(p_id bigint, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage_records set status = 'released', success = false, error_code = left(p_error, 100), settled_at = now()
   where id = p_id and status = 'reserved';
$$;

create or replace function public.svc_ai_purge_cache()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.ai_cache where expires_at < now() returning 1) select count(*)::integer from d;
$$;

revoke all on function private.ai_release_stale() from public, anon, authenticated;
revoke all on function private.ai_tokens_used(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.svc_ai_reserve(uuid, uuid, public.ai_provider, text, text, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.svc_ai_settle(bigint, integer, integer, integer, bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function public.svc_ai_release(bigint, text) from public, anon, authenticated;
revoke all on function public.svc_ai_purge_cache() from public, anon, authenticated;
grant execute on function public.svc_ai_reserve(uuid, uuid, public.ai_provider, text, text, text, bigint, bigint) to service_role;
grant execute on function public.svc_ai_settle(bigint, integer, integer, integer, bigint, boolean, text, text) to service_role;
grant execute on function public.svc_ai_release(bigint, text) to service_role;
grant execute on function public.svc_ai_purge_cache() to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ai_settings enable row level security;
alter table public.ai_global_budget enable row level security;
alter table public.ai_cache enable row level security;
grant select on public.ai_settings to authenticated;
create policy ai_settings_read on public.ai_settings for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
-- ai_global_budget and ai_cache: no client access at all.

-- Realtime: classification / analysis progress refreshes open pages (counts only).
alter table public.workspace_events drop constraint workspace_events_kind_check;
alter table public.workspace_events add constraint workspace_events_kind_check
  check (kind in ('mentions', 'monitoring', 'backfill', 'usage', 'spikes', 'ai'));
