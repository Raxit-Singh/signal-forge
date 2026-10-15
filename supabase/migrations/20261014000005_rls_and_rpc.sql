-- Row Level Security, least-privilege grants, and user-callable RPCs.
--
-- Supabase grants broad table privileges to anon/authenticated by default.
-- We revoke them and grant back only what each table needs, so RLS is a
-- second line of defence rather than the only one.

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- service_role bypasses RLS in Supabase; make sure it can reach everything.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Grants (what each role may attempt; RLS decides which rows)
-- ---------------------------------------------------------------------------
grant select on public.plans to anon, authenticated;

grant select, update (display_name, avatar_url, default_workspace_id) on public.profiles to authenticated;
grant select, update (name), delete on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.usage_counters to authenticated;
grant select on public.audit_logs to authenticated;

grant select, insert, delete,
      update (name, website_url, description, category, target_audience,
              app_store_url, play_store_url, github_repo, onboarding_step, archived_at)
  on public.products to authenticated;
grant select, insert, update, delete on public.product_aliases to authenticated;
grant select, insert, update, delete on public.competitors to authenticated;
grant select, insert, update, delete on public.product_events to authenticated;

grant select on public.integrations to authenticated;
grant select (id, workspace_id, provider, key_hint, status, default_model, is_default, validated_at, created_at, updated_at)
  on public.ai_provider_connections to authenticated;
grant select, insert, delete, update (query, enabled, params) on public.monitoring_queries to authenticated;
grant select (id, workspace_id, product_id, kind, status, attempts, max_attempts, run_after, last_error, progress, result, created_at, updated_at, finished_at)
  on public.jobs to authenticated;
grant select on public.job_runs to authenticated;
grant select on public.coverage_windows to authenticated;

grant select, update (relevance_status, sentiment, feedback_category) on public.mentions to authenticated;
grant select, insert on public.mention_classifications to authenticated;
grant select, update (status) on public.feedback_clusters to authenticated;
grant select on public.feedback_cluster_members to authenticated;
grant select on public.daily_mention_stats to authenticated;
grant select on public.ai_usage_records to authenticated;
grant select on public.ai_investigations to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, update (read_at) on public.notifications to authenticated;
grant select on public.reports to authenticated;

-- Tables with NO client grants at all (server / service role only):
--   credential_secrets, oauth_states, billing_events, job_locks, api_usage_events

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy plans_read on public.plans for select to anon, authenticated using (is_public);

create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (default_workspace_id is null or private.has_workspace_role(default_workspace_id, 'viewer'))
  );

create policy workspaces_read on public.workspaces for select to authenticated
  using (private.has_workspace_role(id, 'viewer'));
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.has_workspace_role(id, 'admin'))
  with check (private.has_workspace_role(id, 'admin'));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (private.has_workspace_role(id, 'owner'));

create policy members_read on public.workspace_members for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create policy subscriptions_read on public.subscriptions for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy usage_read on public.usage_counters for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy audit_read on public.audit_logs for select to authenticated
  using (workspace_id is not null and private.has_workspace_role(workspace_id, 'admin'));

-- Products: everyone in the workspace reads, admins manage.
create policy products_read on public.products for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_workspace_role(workspace_id, 'admin') and created_by = (select auth.uid()));
create policy products_update on public.products for update to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));
create policy products_delete on public.products for delete to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'));

create policy aliases_read on public.product_aliases for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy aliases_write on public.product_aliases for all to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));

create policy competitors_read on public.competitors for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy competitors_write on public.competitors for all to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));

create policy events_read on public.product_events for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy events_write on public.product_events for all to authenticated
  using (private.has_workspace_role(workspace_id, 'member'))
  with check (private.has_workspace_role(workspace_id, 'member'));

create policy integrations_read on public.integrations for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy ai_connections_read on public.ai_provider_connections for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create policy queries_read on public.monitoring_queries for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy queries_write on public.monitoring_queries for all to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'))
  with check (private.has_workspace_role(workspace_id, 'admin'));

create policy jobs_read on public.jobs for select to authenticated
  using (workspace_id is not null and private.has_workspace_role(workspace_id, 'viewer'));
create policy job_runs_read on public.job_runs for select to authenticated
  using (workspace_id is not null and private.has_workspace_role(workspace_id, 'viewer'));
create policy coverage_read on public.coverage_windows for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create policy mentions_read on public.mentions for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy mentions_correct on public.mentions for update to authenticated
  using (private.has_workspace_role(workspace_id, 'member'))
  with check (private.has_workspace_role(workspace_id, 'member'));

create policy classifications_read on public.mention_classifications for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy classifications_manual on public.mention_classifications for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, 'member')
    and classifier = 'manual'
    and created_by = (select auth.uid())
  );

create policy clusters_read on public.feedback_clusters for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy clusters_status on public.feedback_clusters for update to authenticated
  using (private.has_workspace_role(workspace_id, 'member'))
  with check (private.has_workspace_role(workspace_id, 'member'));
create policy cluster_members_read on public.feedback_cluster_members for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create policy daily_stats_read on public.daily_mention_stats for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));
create policy ai_usage_read on public.ai_usage_records for select to authenticated
  using (private.has_workspace_role(workspace_id, 'admin'));
create policy investigations_read on public.ai_investigations for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

create policy notif_prefs_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and private.has_workspace_role(workspace_id, 'viewer'))
  with check (user_id = (select auth.uid()) and private.has_workspace_role(workspace_id, 'viewer'));

create policy notifications_read on public.notifications for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer') and (user_id is null or user_id = (select auth.uid())));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer') and (user_id is null or user_id = (select auth.uid())))
  with check (private.has_workspace_role(workspace_id, 'viewer'));

create policy reports_read on public.reports for select to authenticated
  using (private.has_workspace_role(workspace_id, 'viewer'));

-- ---------------------------------------------------------------------------
-- Guard: paid workspaces must cancel billing before deletion.
-- ---------------------------------------------------------------------------
create or replace function private.block_delete_with_active_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.subscriptions s
     where s.workspace_id = old.id
       and s.provider <> 'none'
       and s.status in ('active', 'trialing', 'past_due')
       and not s.cancel_at_period_end
  ) then
    raise exception 'Cancel the paid subscription before deleting this workspace'
      using errcode = 'P0001', hint = 'billing_active';
  end if;
  return old;
end;
$$;

create trigger workspaces_block_delete_billing before delete on public.workspaces
  for each row execute function private.block_delete_with_active_billing();

-- ---------------------------------------------------------------------------
-- RPC: create a workspace (with owner membership and free subscription).
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := btrim(coalesce(p_name, ''));
  base_slug text;
  final_slug text;
  ws_id uuid;
  owned integer;
  n integer := 0;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then
    raise exception 'Workspace name must be 1-80 characters' using errcode = '22023';
  end if;

  -- Abuse guard: at most 5 owned workspaces per user.
  perform pg_advisory_xact_lock(hashtextextended('ws-create:' || uid::text, 0));
  select count(*) into owned from public.workspace_members m where m.user_id = uid and m.role = 'owner';
  if owned >= 5 then
    raise exception 'Workspace limit reached' using errcode = 'P0001', hint = 'limit:workspaces';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(clean_name), '[^a-z0-9]+', '-', 'g'));
  base_slug := left(coalesce(nullif(base_slug, ''), 'workspace'), 40);
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'workspace'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.workspaces w where w.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    if n > 10 then
      raise exception 'Could not allocate a workspace slug' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.workspaces (name, slug, created_by)
  values (clean_name, final_slug, uid)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, uid, 'owner');
  insert into public.subscriptions (workspace_id, plan_id, status, provider) values (ws_id, 'free', 'active', 'none');
  insert into public.notification_preferences (workspace_id, user_id, channel) values (ws_id, uid, 'email');

  update public.profiles set default_workspace_id = ws_id
   where id = uid and default_workspace_id is null;

  return ws_id;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: atomically replace a product's aliases (security invoker => RLS applies).
-- p_aliases: [{term, kind, is_ambiguous, context_terms[], negative_terms[], enabled, source}]
-- ---------------------------------------------------------------------------
create or replace function public.replace_product_aliases(p_product_id uuid, p_aliases jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws uuid;
  inserted integer;
begin
  if jsonb_typeof(p_aliases) <> 'array' or jsonb_array_length(p_aliases) > 50 then
    raise exception 'Aliases must be an array of at most 50 items' using errcode = '22023';
  end if;

  select p.workspace_id into ws from public.products p where p.id = p_product_id;
  if ws is null or not private.has_workspace_role(ws, 'admin') then
    raise exception 'Product not found' using errcode = '42501';
  end if;

  delete from public.product_aliases where product_id = p_product_id;

  insert into public.product_aliases
    (workspace_id, product_id, term, kind, is_ambiguous, context_terms, negative_terms, enabled, source)
  select ws, p_product_id,
         btrim(a ->> 'term'),
         coalesce((a ->> 'kind')::public.alias_kind, 'custom'),
         coalesce((a ->> 'is_ambiguous')::boolean, false),
         coalesce(array(select jsonb_array_elements_text(a -> 'context_terms')), '{}'),
         coalesce(array(select jsonb_array_elements_text(a -> 'negative_terms')), '{}'),
         coalesce((a ->> 'enabled')::boolean, true),
         coalesce(a ->> 'source', 'user')
    from jsonb_array_elements(p_aliases) a;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_product_aliases(uuid, jsonb) from public, anon;
grant execute on function public.replace_product_aliases(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion (service role only; the server then deletes the auth user).
-- Deletes workspaces the user solely owns; refuses if a solely-owned workspace
-- still has other members (ownership must be transferred first).
-- ---------------------------------------------------------------------------
create or replace function private.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  deleted uuid[] := '{}';
  left_ws uuid[] := '{}';
begin
  for r in
    select m.workspace_id, m.role,
           (select count(*) from public.workspace_members o
             where o.workspace_id = m.workspace_id and o.role = 'owner' and o.user_id <> p_user_id) as other_owners,
           (select count(*) from public.workspace_members o
             where o.workspace_id = m.workspace_id and o.user_id <> p_user_id) as other_members
      from public.workspace_members m
     where m.user_id = p_user_id
     for update of m
  loop
    if r.role = 'owner' and r.other_owners = 0 then
      if r.other_members > 0 then
        raise exception 'Transfer ownership of workspace % before deleting your account', r.workspace_id
          using errcode = 'P0001', hint = 'transfer_ownership';
      end if;
      delete from public.workspaces where id = r.workspace_id;
      deleted := deleted || r.workspace_id;
    else
      delete from public.workspace_members where workspace_id = r.workspace_id and user_id = p_user_id;
      left_ws := left_ws || r.workspace_id;
    end if;
  end loop;

  return jsonb_build_object('deleted_workspaces', to_jsonb(deleted), 'left_workspaces', to_jsonb(left_ws));
end;
$$;

revoke all on function private.prepare_account_deletion(uuid) from public, authenticated;
grant execute on function private.prepare_account_deletion(uuid) to service_role;
