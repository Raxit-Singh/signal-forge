-- Milestone 4 correction: two separate AI systems (additive; nothing deleted).
--
-- SYSTEM A — SignalForge Intelligence (paid by SignalForge, Gemini):
--   * mentions: richer classification (signals, severity, affected area, confidence)
--     and an embedding for semantic issue grouping (real[], no extension needed).
--     AI relevance stays in SHADOW MODE: ai_about_product is a recommendation;
--     relevance_status (manual + rules) remains authoritative and drives billing.
--   * feedback_category gains 'complaint' and 'other'.
--   * feedback_clusters: evidence-backed priority.
--   * ai_usage_records: request count and provider-confirmed cost (when available).
--   * feedback_daily(): classified vs unclassified series for the Feedback page.
--
-- SYSTEM B — Customer-connected Claude developer agent (paid by the customer):
--   * OAuth 2.1 authorization server for the SignalForge remote MCP server
--     (clients via Dynamic Client Registration, one-time codes with PKCE,
--     hashed rotating tokens, per-workspace grants, revocation).
--   * GitHub App installations and per-product repository mapping.
--   * Claude Code routine connection (fire URL; token encrypted in credential_secrets).
--   * Agent tasks, scoped approvals and an event log.
-- Secrets and token hashes are service-role only.

-- ===========================================================================
-- SYSTEM A
-- ===========================================================================
alter type public.feedback_category add value if not exists 'complaint';
alter type public.feedback_category add value if not exists 'other';

alter table public.mentions
  add column ai_signals     jsonb,
  add column ai_severity    text check (ai_severity in ('low', 'medium', 'high', 'critical')),
  add column ai_area        text check (char_length(ai_area) <= 80),
  add column ai_confidence  real check (ai_confidence between 0 and 1),
  add column embedding      real[] check (embedding is null or cardinality(embedding) between 64 and 3072),
  add column embedding_model text check (char_length(embedding_model) <= 100),
  add column embedded_at    timestamptz;
create index mentions_embed_pending_idx on public.mentions (product_id, ai_classified_at)
  where processing_status = 'classified' and embedding is null;

alter table public.feedback_clusters
  add column priority_score    real,
  add column priority_evidence jsonb,
  add column area              text check (char_length(area) <= 80);

alter table public.ai_usage_records
  add column requests               integer not null default 1 check (requests >= 0),
  add column provider_cost_microusd bigint check (provider_cost_microusd >= 0);

-- Daily feedback series in the viewer's time zone. SECURITY INVOKER: RLS applies.
-- Unclassified mentions are counted separately, never folded into a label.
create or replace function public.feedback_daily(p_product_id uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns table (
  day date, classified integer, unclassified integer,
  positive integer, negative integer, neutral integer, mixed integer, uncertain integer,
  bugs integer, features integer, complaints integer, praise integer, questions integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select (m.published_at at time zone p_tz)::date as day,
         count(*) filter (where m.processing_status = 'classified')::integer,
         count(*) filter (where m.processing_status <> 'classified')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.sentiment = 'positive')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.sentiment = 'negative')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.sentiment = 'neutral')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.sentiment = 'mixed')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.sentiment = 'uncertain')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.feedback_category = 'bug_report')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.feedback_category = 'feature_request')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.feedback_category::text in ('complaint', 'usability_complaint', 'pricing_complaint', 'performance_issue'))::integer,
         count(*) filter (where m.processing_status = 'classified' and m.feedback_category = 'positive_review')::integer,
         count(*) filter (where m.processing_status = 'classified' and m.feedback_category = 'support_question')::integer
    from public.mentions m
   where m.product_id = p_product_id
     and m.dedup_kind = 'original'
     and m.relevance_status in ('relevant', 'pending', 'user_relevant')
     and coalesce(m.ai_about_product, 'yes') <> 'no'
     and m.published_at >= p_from and m.published_at < p_to
     and not m.published_at_estimated
   group by 1
   order by 1;
$$;
grant execute on function public.feedback_daily(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

-- ===========================================================================
-- SYSTEM B — OAuth authorization server for the remote MCP server
-- ===========================================================================
create table public.oauth_clients (
  client_id       text primary key check (client_id ~ '^sfc_[A-Za-z0-9_-]{20,64}$'),
  client_name     text not null check (char_length(client_name) between 1 and 200),
  redirect_uris   text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);

-- A user's consent for one client to act on one workspace.
create table public.oauth_grants (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null references public.oauth_clients (client_id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  scopes        text[] not null,
  resource      text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index oauth_grants_ws_idx on public.oauth_grants (workspace_id, created_at desc);

create table public.oauth_codes (
  code_hash       text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  grant_id        uuid not null references public.oauth_grants (id) on delete cascade,
  redirect_uri    text not null,
  code_challenge  text not null check (char_length(code_challenge) between 43 and 128),
  expires_at      timestamptz not null,
  used_at         timestamptz
);

create table public.oauth_tokens (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_id     uuid not null references public.oauth_grants (id) on delete cascade,
  kind         text not null check (kind in ('access', 'refresh')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  -- Refresh rotation: the token that replaced this one (reuse of a replaced token revokes the grant).
  replaced_at  timestamptz
);
create index oauth_tokens_grant_idx on public.oauth_tokens (grant_id);

-- ===========================================================================
-- SYSTEM B — repositories, Claude Code routine, tasks
-- ===========================================================================
alter table public.credential_secrets drop constraint credential_secrets_purpose_check;
alter table public.credential_secrets add constraint credential_secrets_purpose_check
  check (purpose in ('integration', 'ai_provider', 'agent'));

create table public.github_installations (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  installation_id       bigint not null,
  account_login         text not null check (char_length(account_login) <= 100),
  repository_selection  text check (repository_selection in ('all', 'selected')),
  permissions           jsonb not null default '{}'::jsonb,
  installed_by          uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  unique (workspace_id, installation_id)
);

create table public.agent_repositories (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  product_id       uuid not null,
  installation_id  bigint not null,
  repo_id          bigint not null,
  full_name        text not null check (full_name ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$'),
  default_branch   text not null check (char_length(default_branch) <= 255),
  private          boolean not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (product_id),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

-- The customer's Claude Code routine (API trigger). The token is encrypted in credential_secrets.
create table public.agent_connections (
  workspace_id     uuid primary key references public.workspaces (id) on delete cascade,
  provider         text not null default 'claude_code_routine' check (provider = 'claude_code_routine'),
  routine_id       text not null check (routine_id ~ '^trig_[A-Za-z0-9]{8,64}$'),
  fire_url         text not null check (fire_url ~ '^https://' and char_length(fire_url) <= 300),
  secret_id        uuid,
  status           text not null default 'unverified' check (status in ('unverified', 'ready', 'error', 'revoked')),
  last_fired_at    timestamptz,
  last_error       text check (char_length(last_error) <= 300),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (secret_id, workspace_id) references public.credential_secrets (id, workspace_id) on delete set null (secret_id)
);
create trigger agent_connections_touch before update on public.agent_connections
  for each row execute function private.touch_updated_at();

create table public.agent_tasks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  product_id       uuid not null,
  cluster_id       uuid,
  repository_id    uuid,
  provider         text not null default 'claude_code' check (provider = 'claude_code'),
  -- How it runs: the customer's routine (fired by SignalForge) or a manual Claude Code handoff.
  execution        text not null check (execution in ('routine', 'manual')),
  stage            text not null check (stage in ('investigation', 'implementation')),
  status           text not null check (status in (
                     'not_started', 'awaiting_connection', 'awaiting_repository', 'investigating',
                     'investigation_complete', 'awaiting_approval', 'approved', 'implementing', 'testing',
                     'pr_created', 'failed', 'cancelled')),
  context          jsonb not null,                 -- the context package (bounded, no secrets)
  context_hash     text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  report           jsonb,                          -- investigation report (validated)
  plan_hash        text check (plan_hash ~ '^[0-9a-f]{64}$'),
  session_id       text check (char_length(session_id) <= 200),
  session_url      text check (session_url ~ '^https://' and char_length(session_url) <= 500),
  pr_url           text check (pr_url ~ '^https://github\.com/' and char_length(pr_url) <= 500),
  pr_number        integer,
  pr_state         text check (pr_state in ('open', 'closed', 'merged', 'unverified')),
  branch           text check (char_length(branch) <= 255),
  result_summary   text check (char_length(result_summary) <= 4000),
  error            text check (char_length(error) <= 500),
  parent_task_id   uuid references public.agent_tasks (id) on delete set null,
  -- The routine runs with the customer's full Claude Code permissions (it can't be made
  -- technically read-only), so starting one needs the user's explicit acknowledgement.
  execution_acknowledged_at timestamptz,
  -- Problems SignalForge detected, e.g. pull requests opened during an investigation.
  warnings         text[] not null default '{}',
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (cluster_id, workspace_id) references public.feedback_clusters (id, workspace_id) on delete set null (cluster_id),
  foreign key (repository_id, workspace_id) references public.agent_repositories (id, workspace_id) on delete set null (repository_id)
);
create index agent_tasks_ws_idx on public.agent_tasks (workspace_id, created_at desc);
create index agent_tasks_cluster_idx on public.agent_tasks (cluster_id, created_at desc);
create trigger agent_tasks_touch before update on public.agent_tasks
  for each row execute function private.touch_updated_at();

-- An approval authorizes exactly one plan version, for one issue, repository and environment.
create table public.agent_approvals (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  investigation_task_id uuid not null,
  cluster_id       uuid,
  repository_full_name text not null,
  plan_hash        text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  environment      text not null check (char_length(environment) <= 120),
  approved_by      uuid not null references auth.users (id) on delete cascade,
  approved_at      timestamptz not null default now(),
  used_at          timestamptz,
  revoked_at       timestamptz,
  foreign key (investigation_task_id, workspace_id) references public.agent_tasks (id, workspace_id) on delete cascade
);
create unique index agent_approvals_once on public.agent_approvals (investigation_task_id) where revoked_at is null;

create table public.agent_task_events (
  id          bigint generated always as identity primary key,
  workspace_id uuid not null,
  task_id     uuid not null,
  kind        text not null check (char_length(kind) <= 60),
  detail      jsonb not null default '{}'::jsonb,
  actor       text not null check (actor in ('user', 'signalforge', 'agent')),
  created_at  timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.agent_tasks (id, workspace_id) on delete cascade
);
create index agent_task_events_task_idx on public.agent_task_events (task_id, created_at);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.github_installations enable row level security;
alter table public.agent_repositories enable row level security;
alter table public.agent_connections enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_approvals enable row level security;
alter table public.agent_task_events enable row level security;

-- Grants (who connected Claude, when) are visible to workspace admins; codes and tokens to nobody.
grant select (id, client_id, user_id, workspace_id, scopes, created_at, last_used_at, revoked_at) on public.oauth_grants to authenticated;
create policy oauth_grants_read on public.oauth_grants for select to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'));

grant select on public.github_installations, public.agent_repositories, public.agent_tasks, public.agent_approvals, public.agent_task_events to authenticated;
grant select (workspace_id, provider, routine_id, status, last_fired_at, last_error, created_at, updated_at) on public.agent_connections to authenticated;
create policy gh_installations_read on public.github_installations for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy agent_repositories_read on public.agent_repositories for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy agent_connections_read on public.agent_connections for select to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'));
create policy agent_tasks_read on public.agent_tasks for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy agent_approvals_read on public.agent_approvals for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy agent_task_events_read on public.agent_task_events for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

-- ===========================================================================
-- Budget reservations: test-classifier calls are recorded as 'test' (never billed to
-- SignalForge credits, never counted against plan or global limits).
-- ===========================================================================
alter table public.ai_usage_records drop constraint ai_usage_records_billed_to_check;
alter table public.ai_usage_records add constraint ai_usage_records_billed_to_check
  check (billed_to in ('signalforge', 'byok', 'test'));

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
  if p_billed_to not in ('signalforge', 'byok', 'test') or p_tokens < 0 then
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
  elsif p_billed_to = 'byok' then
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

-- Settle with the request count and, when the provider reports one, its own cost figure.
create or replace function public.svc_ai_settle_v2(
  p_id bigint, p_input_tokens integer, p_output_tokens integer, p_cached_tokens integer,
  p_cost_microusd bigint, p_success boolean, p_error text, p_cache_key text, p_requests integer, p_provider_cost_microusd bigint
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
         cache_key = p_cache_key, requests = greatest(0, coalesce(p_requests, 1)),
         provider_cost_microusd = p_provider_cost_microusd, settled_at = now()
   where id = p_id and status = 'reserved';
$$;
revoke all on function public.svc_ai_settle_v2(bigint, integer, integer, integer, bigint, boolean, text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.svc_ai_settle_v2(bigint, integer, integer, integer, bigint, boolean, text, text, integer, bigint) to service_role;
