-- Database tests: tenancy isolation, RLS, grants, plan limits, job queue.
-- Run with scripts/test-db.sh (creates a throwaway local PostgreSQL cluster).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

create table t.results (n serial, ok boolean, name text);
grant insert, select on t.results to anon, authenticated, service_role;
grant usage on sequence t.results_n_seq to anon, authenticated, service_role;

create function t.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  insert into t.results (ok, name) values (coalesce(cond, false), name);
  if coalesce(cond, false) then
    raise notice 'ok   - %', name;
  else
    raise notice 'FAIL - %', name;
  end if;
end $$;

-- Expect a statement to raise. Optional substring to match in the error message.
create function t.throws(stmt text, name text, expect text default null) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute stmt;
  exception when others then
    msg := sqlerrm;
    perform t.ok(expect is null or position(lower(expect) in lower(msg)) > 0, name || ' [' || msg || ']');
    return;
  end;
  perform t.ok(false, name || ' [did not raise]');
end $$;

create function t.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
end $$;

grant execute on all functions in schema t to anon, authenticated, service_role;

-- Fixed ids keep the test deterministic.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.test', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.test', '{}');

select t.ok((select count(*) from public.profiles) = 3, 'profile row created for each new auth user');
select t.ok((select display_name from public.profiles where email = 'alice@example.test') = 'Alice', 'profile picks up full_name metadata');

-- ===================================================================== alice
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role, anon;

select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;

insert into ids select 'ws_a', public.create_workspace('Alice Labs');
select t.ok((select count(*) from public.workspaces) = 1, 'alice sees exactly her workspace');
select t.ok((select role::text from public.workspace_members) = 'owner', 'creator becomes owner');
select t.ok((select plan_id from public.subscriptions) = 'free', 'new workspace starts on free plan');
select t.ok((select slug from public.workspaces) = 'alice-labs', 'slug is derived from name');
select t.ok((select default_workspace_id from public.profiles where id = auth.uid()) = (select v from ids where k = 'ws_a'), 'default workspace set on profile');
select t.throws($$select public.create_workspace('   ')$$, 'blank workspace name rejected', '1-80');

with p as (
  insert into public.products (workspace_id, name, website_url, description, created_by)
  select v, 'FocusFlow', 'https://focusflow.example', 'Pomodoro timer for devs', auth.uid() from ids where k = 'ws_a'
  returning id
)
insert into ids select 'p_a', id from p;

select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'Second', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'free plan blocks a second product', 'product limit');

select t.throws(
  format($$select public.replace_product_aliases(%L, '[{"term":"Linear","kind":"exact_name","is_ambiguous":true}]')$$, (select v from ids where k = 'p_a')),
  'ambiguous alias without context terms rejected', 'ambiguous_needs_context');

select t.ok(public.replace_product_aliases((select v from ids where k = 'p_a'),
  '[{"term":"FocusFlow","kind":"exact_name"},
    {"term":"focusflow.example","kind":"domain"},
    {"term":"Flow","kind":"abbreviation","is_ambiguous":true,"context_terms":["pomodoro","timer"]}]') = 3,
  'replace_product_aliases inserts valid aliases');
select t.ok(public.replace_product_aliases((select v from ids where k = 'p_a'),
  '[{"term":"FocusFlow","kind":"exact_name"}]') = 1, 'replace_product_aliases replaces, not appends');
select t.ok((select count(*) from public.product_aliases) = 1, 'alias count after replace');

select t.throws($$select * from public.credential_secrets$$, 'credential_secrets unreadable by users', 'permission denied');
select t.throws($$select * from public.oauth_states$$, 'oauth_states unreadable by users', 'permission denied');
select t.throws($$select secret_id from public.ai_provider_connections$$, 'secret_id column not exposed', 'permission denied');
select t.throws(
  format($$update public.subscriptions set plan_id = 'business' where workspace_id = %L$$, (select v from ids where k = 'ws_a')),
  'users cannot self-upgrade their plan', 'permission denied');
select t.throws(
  format($$insert into public.subscriptions (workspace_id, plan_id) values (%L, 'pro')$$, gen_random_uuid()),
  'users cannot insert subscriptions', 'permission denied');
select t.throws($$select private.enqueue_job('x.y', 'k')$$, 'users cannot enqueue jobs directly', 'permission denied');
select t.throws($$select private.effective_plan_id(gen_random_uuid())$$, 'plan helper not callable by users', 'permission denied');

reset role;

-- ===================================================================== bob
select t.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;

insert into ids select 'ws_b', public.create_workspace('Bob Co');
select t.ok((select count(*) from public.workspaces) = 1, 'bob sees only his own workspace');
select t.ok((select count(*) from public.products) = 0, 'bob cannot see alice''s products');
select t.ok((select count(*) from public.product_aliases) = 0, 'bob cannot see alice''s aliases');
select t.ok((select count(*) from public.workspace_members) = 1, 'bob sees only his memberships');
select t.ok((select count(*) from public.profiles) = 1, 'bob cannot see unrelated profiles');

select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'Intruder', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'bob cannot insert into alice''s workspace (and learns nothing about her plan)', 'row-level security');

update public.products set name = 'pwned' where id = (select v from ids where k = 'p_a');
reset role;
select t.ok((select name from public.products where id = (select v from ids where k = 'p_a')) = 'FocusFlow', 'bob''s update of alice''s product affected nothing');
set role authenticated;

delete from public.workspaces where id = (select v from ids where k = 'ws_a');
reset role;
select t.ok(exists (select 1 from public.workspaces where id = (select v from ids where k = 'ws_a')), 'bob cannot delete alice''s workspace');
set role authenticated;

select t.throws(
  format($$select public.replace_product_aliases(%L, '[{"term":"evil"}]')$$, (select v from ids where k = 'p_a')),
  'bob cannot replace alice''s aliases', 'not found');

select t.throws(
  format($$update public.profiles set default_workspace_id = %L where id = auth.uid()$$, (select v from ids where k = 'ws_a')),
  'bob cannot point his profile at alice''s workspace', 'row-level security');
reset role;

-- ===================================================================== anon
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
select t.ok((select count(*) from public.plans) = 4, 'anon can read public plans');
select t.throws($$select * from public.products$$, 'anon cannot read products', 'permission denied');
select t.throws($$select * from public.workspaces$$, 'anon cannot read workspaces', 'permission denied');
select t.throws($$select public.create_workspace('anon ws')$$, 'anon cannot create workspaces', 'permission denied');
reset role;

-- ===================================================================== integrity (superuser / service context)
select t.throws(
  format($$insert into public.product_aliases (workspace_id, product_id, term) values (%L, %L, 'cross')$$,
         (select v from ids where k = 'ws_b'), (select v from ids where k = 'p_a')),
  'composite FK blocks linking alias to another workspace''s product', 'foreign key');

-- Plan changes drive limits.
update public.subscriptions set plan_id = 'pro' where workspace_id = (select v from ids where k = 'ws_a');
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'Spoofed', '00000000-0000-0000-0000-00000000000b')$$, (select v from ids where k = 'ws_a')),
  'created_by cannot be spoofed', 'row-level security');

select t.throws(
  format($$insert into public.products (workspace_id, name, website_url, created_by) values (%L, 'X', 'javascript:alert(1)', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'non-http website URL rejected', 'check constraint');

select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'focusflow', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'duplicate product name (case-insensitive) rejected', null);
insert into public.products (workspace_id, name, created_by) select v, 'Two', auth.uid() from ids where k = 'ws_a';
insert into public.products (workspace_id, name, created_by) select v, 'Three', auth.uid() from ids where k = 'ws_a';
select t.ok((select count(*) from public.products) = 3, 'pro plan allows three products');
select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'Four', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'pro plan blocks a fourth product', 'product limit');
reset role;

update public.subscriptions set status = 'canceled' where workspace_id = (select v from ids where k = 'ws_a');
set role authenticated;
update public.products set archived_at = now() where name = 'Three';
select t.ok((select count(*) from public.products where archived_at is null) = 2, 'archiving works after downgrade');
select t.throws($$update public.products set archived_at = null where name = 'Three'$$,
  'canceled subscription falls back to free limits on unarchive', 'product limit');
reset role;
update public.subscriptions set status = 'active' where workspace_id = (select v from ids where k = 'ws_a');

-- Viewer role.
insert into public.workspace_members (workspace_id, user_id, role)
select v, '00000000-0000-0000-0000-00000000000c', 'viewer' from ids where k = 'ws_a';
select t.as_user('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select t.ok((select count(*) from public.products) = 3, 'viewer can read workspace products');
select t.ok((select count(*) from public.profiles) = 2, 'viewer sees co-member profiles');
select t.throws(
  format($$insert into public.products (workspace_id, name, created_by) values (%L, 'ViewerProduct', auth.uid())$$, (select v from ids where k = 'ws_a')),
  'viewer cannot create products', 'row-level security');
update public.products set name = 'viewer edit' where name = 'Two';
select t.ok((select count(*) from public.products where name = 'Two') = 1, 'viewer update affected nothing');
select t.ok((select count(*) from public.audit_logs) = 0, 'viewer cannot read audit logs');
reset role;

select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.audit_logs where entity_type = 'products' and action = 'insert') = 3, 'owner sees product audit entries');
reset role;

-- Last owner cannot be removed or demoted.
do $$
begin
  set constraints all immediate;
  begin
    delete from public.workspace_members
     where user_id = '00000000-0000-0000-0000-00000000000a'
       and workspace_id = (select v from ids where k = 'ws_a');
    perform t.ok(false, 'removing last owner is blocked [did not raise]');
  exception when others then
    perform t.ok(position('at least one owner' in sqlerrm) > 0, 'removing last owner is blocked [' || sqlerrm || ']');
  end;
  begin
    update public.workspace_members set role = 'admin'
     where user_id = '00000000-0000-0000-0000-00000000000a'
       and workspace_id = (select v from ids where k = 'ws_a');
    perform t.ok(false, 'demoting last owner is blocked [did not raise]');
  exception when others then
    perform t.ok(position('at least one owner' in sqlerrm) > 0, 'demoting last owner is blocked [' || sqlerrm || ']');
  end;
end $$;

-- Mention dedup guarantee.
insert into public.mentions (workspace_id, product_id, source, external_id, source_url, published_at)
select (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'hackernews', '12345', 'https://news.ycombinator.com/item?id=12345', now();
select t.throws(
  format($$insert into public.mentions (workspace_id, product_id, source, external_id, source_url, published_at) values (%L, %L, 'hackernews', '12345', 'https://news.ycombinator.com/item?id=12345', now())$$,
         (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')),
  'same source item cannot be stored twice for a product', 'duplicate key');
select t.throws(
  format($$insert into public.mentions (workspace_id, product_id, source, external_id, source_url, published_at) values (%L, %L, 'hackernews', '999', 'http://insecure.example', now())$$,
         (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')),
  'mention URLs must be https', 'check constraint');

insert into public.daily_mention_stats (workspace_id, product_id, day, source, mentions)
select (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), current_date, 'hackernews', 1;
select t.throws(
  format($$insert into public.daily_mention_stats (workspace_id, product_id, day, source, mentions) values (%L, %L, current_date, 'hackernews', 2)$$,
         (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')),
  'daily stats unique even with null competitor', 'duplicate key');

-- Users may correct classification columns but not content.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.mentions set relevance_status = 'user_irrelevant' where external_id = '12345';
select t.ok((select relevance_status::text from public.mentions where external_id = '12345') = 'user_irrelevant', 'member can mark mention irrelevant');
select t.throws($$update public.mentions set content = 'tampered'$$, 'mention content is not user-editable', 'permission denied');
select t.throws(
  format($$insert into public.mention_classifications (workspace_id, mention_id, dimension, label, classifier, created_by) select workspace_id, id, 'sentiment', 'positive', 'anthropic:fake', auth.uid() from public.mentions limit 1$$),
  'users cannot forge model classifications', 'row-level security');
reset role;

-- ===================================================================== job queue (service role)
set role service_role;
select t.ok(private.enqueue_job('scan.initial', 'scan:p_a:1', '{}', (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'))
          = private.enqueue_job('scan.initial', 'scan:p_a:1', '{}', (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')),
  'enqueue is idempotent by key');
select t.ok((select count(*) from public.jobs) = 1, 'only one job row for repeated enqueue');
select t.ok((select count(*) from private.claim_jobs('w1', 5, 60)) = 1, 'worker claims the ready job');
select t.ok((select count(*) from private.claim_jobs('w2', 5, 60)) = 0, 'claimed job is not handed to a second worker');
select t.ok(private.fail_job((select id from public.jobs limit 1), 'w2', 'boom') is null, 'non-holder cannot fail a job');
select t.ok(private.fail_job((select id from public.jobs limit 1), 'w1', 'HTTP 503') = 'queued', 'retryable failure re-queues');
select t.ok((select run_after > now() + interval '20 seconds' and run_after < now() + interval '40 seconds' from public.jobs limit 1), 'first retry backs off ~30s (with jitter)');
update public.jobs set run_after = now() - interval '1 second';
select count(*) from private.claim_jobs('w1', 5, 60);
select t.ok((select attempts from public.jobs limit 1) = 2, 'attempt counter increments');
select t.ok(private.fail_job((select id from public.jobs limit 1), 'w1', 'HTTP 503') = 'queued', 'second failure re-queues');
select t.ok((select run_after > now() + interval '45 seconds' from public.jobs limit 1), 'second retry backs off ~60s (exponential)');
update public.jobs set run_after = now() - interval '1 second';
select count(*) from private.claim_jobs('w1', 5, 60);
select t.ok(private.complete_job((select id from public.jobs limit 1), 'w1', '{"found":0}') , 'holder completes job');
select t.ok((select status::text from public.jobs limit 1) = 'succeeded', 'job marked succeeded');
select t.ok((select count(*) from public.job_runs) = 3, 'every attempt recorded in job_runs');

select private.enqueue_job('scan.poll', 'k2', '{}', (select v from ids where k = 'ws_a'), null, now(), 1);
select count(*) from private.claim_jobs('w1', 5, 60);
select t.ok(private.fail_job((select id from public.jobs where idempotency_key = 'k2'), 'w1', 'fatal') = 'dead', 'exhausted job is dead-lettered');

select private.enqueue_job('scan.poll', 'k3', '{}', (select v from ids where k = 'ws_a'));
select count(*) from private.claim_jobs('crashed-worker', 5, 60);
update public.jobs set locked_until = now() - interval '1 second' where idempotency_key = 'k3';
select t.ok((select count(*) from private.claim_jobs('w9', 5, 60)) = 1, 'expired lease is reclaimed after a worker crash');
select t.ok(not private.complete_job((select id from public.jobs where idempotency_key = 'k3'), 'crashed-worker'), 'stale worker cannot complete a reclaimed job');

select t.ok(private.try_acquire_lock('scheduler', 'a', 60), 'lock acquired');
select t.ok(not private.try_acquire_lock('scheduler', 'b', 60), 'lock held by another holder');
update public.job_locks set expires_at = now() - interval '1 second';
select t.ok(private.try_acquire_lock('scheduler', 'b', 60), 'expired lock can be taken over');
reset role;

select t.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select t.ok((select count(*) from public.jobs) = 0, 'bob cannot see alice''s jobs');
select t.throws($$select locked_by from public.jobs$$, 'job lease internals hidden from users', 'permission denied');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.jobs) = 3, 'alice sees her workspace jobs (scan progress)');
reset role;

-- ===================================================================== deletion
update public.subscriptions set provider = 'stripe', plan_id = 'pro', status = 'active'
 where workspace_id = (select v from ids where k = 'ws_a');
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.throws(format($$delete from public.workspaces where id = %L$$, (select v from ids where k = 'ws_a')),
  'workspace with active paid billing cannot be deleted', 'cancel the paid subscription');
reset role;

set role service_role;
select t.throws($$select private.prepare_account_deletion('00000000-0000-0000-0000-00000000000a')$$,
  'sole owner with other members must transfer ownership first', 'transfer ownership');
select t.ok((private.prepare_account_deletion('00000000-0000-0000-0000-00000000000c') -> 'left_workspaces') ? (select v::text from ids where k = 'ws_a'),
  'viewer account deletion only leaves the workspace');
select t.ok((private.prepare_account_deletion('00000000-0000-0000-0000-00000000000b') -> 'deleted_workspaces') ? (select v::text from ids where k = 'ws_b'),
  'sole-owner workspace deleted with account');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select t.ok(not exists (select 1 from public.workspaces where id = (select v from ids where k = 'ws_b')), 'bob''s workspace is gone');
select t.ok(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'bob''s profile cascaded');
select t.ok(exists (select 1 from public.products where id = (select v from ids where k = 'p_a')), 'alice''s data untouched by bob''s deletion');

-- Service-only wrappers are not callable by end users.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.throws($$select public.svc_prepare_account_deletion(auth.uid())$$, 'users cannot call service-only RPCs', 'permission denied');
reset role;
set role anon;
select t.throws($$select public.svc_prepare_account_deletion(gen_random_uuid())$$, 'anon cannot call service-only RPCs', 'permission denied');
reset role;

-- ===================================================================== collection (M2)
-- Query sync: keyword changes no longer derive queries in SQL (that path searched only the first 5
-- keywords); the server's planner writes groups for every keyword through svc_apply_query_groups.
insert into public.monitoring_queries (workspace_id, product_id, provider, query, params, enabled, managed_by, cursor) values
  ((select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'hackernews', 'FocusFlow', '{"terms":["FocusFlow"]}', true, 'legacy', '{"until":"2026-10-01T00:00:00Z"}'),
  ((select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'stackexchange', 'old keyword', '{"terms":["old keyword"]}', true, 'legacy', '{}');
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.replace_product_aliases((select v from ids where k = 'p_a'),
  '[{"term":"FocusFlow","kind":"exact_name"},{"term":"focusflow.app","kind":"domain"},{"term":"Flow","kind":"custom","is_ambiguous":true,"context_terms":["pomodoro"]},{"term":"off","kind":"custom","enabled":false}]');
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled) = 2,
  'replacing keywords writes no queries in SQL any more (existing rows untouched until the server re-plans)');
reset role;
set role service_role;
select t.ok(public.svc_apply_query_groups((select v from ids where k = 'p_a'), jsonb_build_array(
  jsonb_build_object('provider', 'hackernews', 'stream', 'default', 'query', 'FocusFlow', 'params', '{"terms":["FocusFlow"]}'),
  jsonb_build_object('provider', 'hackernews', 'stream', 'default', 'query', 'focusflow.app', 'params', '{"terms":["focusflow.app"]}'),
  jsonb_build_object('provider', 'hackernews', 'stream', 'default', 'query', 'Flow', 'params', '{"terms":["Flow"]}'),
  jsonb_build_object('provider', 'github', 'stream', 'default', 'query', 'FocusFlow OR "focusflow.app" OR Flow', 'params', '{"terms":["FocusFlow","focusflow.app","Flow"]}'))) = 4,
  'the server writes one group per planned search, for every keyword');
reset role;
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled and provider = 'hackernews') = 3,
  'one HN query per enabled keyword');
select t.ok((select managed_by || ' ' || (cursor ->> 'until') from public.monitoring_queries
              where product_id = (select v from ids where k = 'p_a') and provider = 'hackernews' and query = 'FocusFlow') = 'optimizer 2026-10-01T00:00:00Z',
  'an old first-5 row matching a planned search is taken over in place and keeps its checkpoint');
select t.ok(exists (select 1 from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and query = 'old keyword' and not enabled),
  'old rows that are no longer planned are disabled, not deleted');
set role service_role;
select public.svc_apply_query_groups((select v from ids where k = 'p_a'), jsonb_build_array(
  jsonb_build_object('provider', 'hackernews', 'stream', 'default', 'query', 'FocusFlow', 'params', '{"terms":["FocusFlow"]}'),
  jsonb_build_object('provider', 'stackexchange', 'stream', 'default', 'query', 'FocusFlow', 'params', '{"terms":["FocusFlow"]}'),
  jsonb_build_object('provider', 'github', 'stream', 'default', 'query', 'FocusFlow', 'params', '{"terms":["FocusFlow"]}'),
  jsonb_build_object('provider', 'youtube', 'stream', 'default', 'query', 'FocusFlow', 'params', '{"terms":["FocusFlow"]}')));
reset role;
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled) = 4,
  'removing keywords disables their queries (1 per source left)');

-- A user cannot sync another workspace's product even with a direct grant path.
select t.as_user('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select t.throws(format($$select public.replace_product_aliases(%L, '[{"term":"x1"}]')$$, (select v from ids where k = 'p_a')),
  'viewer cannot replace keywords (and so cannot trigger a sync)', 'not found');
select t.throws(format($$select private.sync_monitoring_queries(%L)$$, (select v from ids where k = 'p_a')),
  'viewer cannot call the sync function directly either', 'not found');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select t.throws(format($$select private.sync_monitoring_queries(%L)$$, (select v from ids where k = 'p_a')),
  'outsider cannot sync another workspace''s product', 'not found');
reset role;

-- Rate limiter
set role service_role;
select t.ok(public.svc_take_tokens('test:bucket', 2, 3, 1) = 0, 'token bucket grants within capacity');
select t.ok(public.svc_take_tokens('test:bucket', 2, 3, 1) > 0, 'token bucket refuses when empty and returns a wait');
select t.ok(public.svc_take_tokens('test:bucket', 1, 3, 1) = 0, 'smaller request still fits the remainder');
select public.svc_drain_tokens('test:bucket', 60, 1);
select t.ok(public.svc_take_tokens('test:bucket', 1, 3, 1) > 50, 'drain pushes availability ~60s out');
select t.throws($$select public.svc_take_tokens('test:bad', 5, 3, 1)$$, 'cost above capacity is rejected', 'capacity');
reset role;

-- Scheduler + scans
set role service_role;
update public.monitoring_queries set next_run_at = now() - interval '1 minute' where product_id = (select v from ids where k = 'p_a');
select t.ok(public.svc_schedule_due_queries(array['hackernews','github'], 100) = 2, 'scheduler enqueues due queries for enabled providers only');
select t.ok(public.svc_schedule_due_queries(array['hackernews','github'], 100) = 0, 'scheduled queries are not due again immediately');
select t.ok((select count(*) from public.jobs where kind = 'monitor.query' and product_id = (select v from ids where k = 'p_a')) = 2,
  'one job per due query');
update public.monitoring_queries set next_run_at = now() - interval '1 minute' where product_id = (select v from ids where k = 'p_a') and provider = 'hackernews';
select t.ok(public.svc_schedule_due_queries(array['hackernews'], 100) = 1
  and (select count(*) from public.jobs where kind = 'monitor.query' and product_id = (select v from ids where k = 'p_a')) = 2,
  'rescheduling within the same interval bucket is idempotent');

insert into ids select 'scan1', public.svc_start_scan((select v from ids where k = 'p_a'), '00000000-0000-0000-0000-00000000000a', 'initial', array['hackernews','stackexchange'], 30);
select t.ok((select count(*) from public.jobs where scan_id = (select v from ids where k = 'scan1')) = 2, 'scan enqueues one job per query on requested sources');
select t.ok(public.svc_start_scan((select v from ids where k = 'p_a'), '00000000-0000-0000-0000-00000000000a', 'initial', array['hackernews'], 30)
  = (select v from ids where k = 'scan1'), 'starting a scan while one is running returns the running scan');
reset role;

-- Defer does not consume attempts
set role service_role;
create temp table claimed as select * from public.svc_claim_jobs('w1', 1, 60, null, (select v from ids where k = 'scan1'));
select t.ok((select count(*) from claimed) = 1, 'scan-scoped claim returns that scan''s job');
select t.ok(public.svc_defer_job((select id from claimed), 'w1', 30, 'rate limited'), 'running job can be deferred by its worker');
select t.ok((select attempts from public.jobs where id = (select id from claimed)) = 0
  and (select status::text from public.jobs where id = (select id from claimed)) = 'queued', 'deferral refunds the attempt');
select t.ok(not public.svc_defer_job((select id from claimed), 'w1', 30, 'again'), 'cannot defer a job you no longer hold');
reset role;

-- Ingestion: dedup, reposts, user decisions, limits
set role service_role;
create temp table r1 as select public.svc_ingest_mentions((select v from ids where k = 'p_a'), 'hackernews', jsonb_build_array(
  jsonb_build_object('external_id', 'a1', 'source_url', 'https://news.ycombinator.com/item?id=a1', 'published_at', '2026-10-01T00:00:00Z',
    'content', 'FocusFlow keeps crashing when I start a session', 'content_hash', 'h1', 'relevance_status', 'relevant', 'relevance_score', 0.9,
    'matched_terms', jsonb_build_array('FocusFlow'), 'engagement', '{"points": 3}', 'engagement_score', 3),
  jsonb_build_object('external_id', 'a2', 'source_url', 'https://news.ycombinator.com/item?id=a2', 'published_at', '2026-10-02T00:00:00Z',
    'content', 'FocusFlow keeps crashing when I start a session', 'content_hash', 'h1', 'relevance_status', 'relevant'),
  jsonb_build_object('external_id', 's1', 'source_url', 'https://news.ycombinator.com/item?id=s1', 'published_at', '2026-10-01T00:00:00Z',
    'title', 'FocusFlow 2.0', 'linked_url', 'https://focusflow.app/blog/2', 'relevance_status', 'relevant'),
  jsonb_build_object('external_id', 's2', 'source_url', 'https://news.ycombinator.com/item?id=s2', 'published_at', '2026-10-03T00:00:00Z',
    'title', 'FocusFlow 2.0 released', 'linked_url', 'https://focusflow.app/blog/2', 'relevance_status', 'relevant'),
  jsonb_build_object('external_id', 'a3', 'source_url', 'https://news.ycombinator.com/item?id=a3', 'published_at', '2026-10-04T00:00:00Z',
    'content', '+1', 'relevance_status', 'relevant'),
  jsonb_build_object('external_id', 'a4', 'source_url', 'https://news.ycombinator.com/item?id=a4', 'published_at', '2026-10-04T00:01:00Z',
    'content', '+1', 'relevance_status', 'relevant')
)) as r;
select t.ok((select (r ->> 'inserted')::int from r1) = 6 and (select (r ->> 'duplicates')::int from r1) = 2, 'ingest stores 6, flags 2 as duplicates');
select t.ok((select dedup_kind::text from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 'a2') = 'exact_duplicate'
  and (select canonical_mention_id from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 'a2')
    = (select id from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 'a1'),
  'exact duplicate links to the earliest original');
select t.ok((select dedup_kind::text from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 's2') = 'repost',
  'same linked URL is a repost');
select t.ok((select count(*) from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id in ('a3','a4') and dedup_kind = 'original') = 2,
  'short identical texts without a hash stay independent reports');
select t.ok((select amount from public.usage_counters where workspace_id = (select v from ids where k = 'ws_a') and metric = 'mentions_ingested') = 6,
  'new mentions count toward monthly usage');
reset role;

-- A user's relevance decision survives re-ingestion; engagement refreshes.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
update public.mentions set relevance_status = 'user_irrelevant' where product_id = (select v from ids where k = 'p_a') and external_id = 'a1';
reset role;
set role service_role;
create temp table r2 as select public.svc_ingest_mentions((select v from ids where k = 'p_a'), 'hackernews', jsonb_build_array(
  jsonb_build_object('external_id', 'a1', 'source_url', 'https://news.ycombinator.com/item?id=a1', 'published_at', '2026-10-01T00:00:00Z',
    'relevance_status', 'relevant', 'engagement', '{"points": 40}', 'engagement_score', 40))) as r;
select t.ok((select (r ->> 'updated')::int from r2) = 1 and (select (r ->> 'inserted')::int from r2) = 0, 're-seen item is an update, not a new mention');
select t.ok((select relevance_status::text from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 'a1') = 'user_irrelevant',
  'user relevance decision is never overwritten');
select t.ok((select engagement_score from public.mentions where product_id = (select v from ids where k = 'p_a') and external_id = 'a1') = 40, 'engagement refreshes');
select t.ok((select amount from public.usage_counters where workspace_id = (select v from ids where k = 'ws_a') and metric = 'mentions_ingested') = 6,
  're-seen items do not count toward usage');

-- Monthly limit
insert into public.plans (id, name, max_products, monthly_mention_limit, history_days, monitoring_interval_minutes, is_public)
values ('t_tiny', 'Tiny', 10, 7, 30, 60, false);
update public.subscriptions set plan_id = 't_tiny' where workspace_id = (select v from ids where k = 'ws_a');
create temp table r3 as select public.svc_ingest_mentions((select v from ids where k = 'p_a'), 'github', jsonb_build_array(
  jsonb_build_object('external_id', 'g1', 'source_url', 'https://github.com/o/r/issues/1', 'published_at', '2026-10-05T00:00:00Z'),
  jsonb_build_object('external_id', 'g2', 'source_url', 'https://github.com/o/r/issues/2', 'published_at', '2026-10-05T00:00:00Z'),
  jsonb_build_object('external_id', 'g3', 'source_url', 'https://github.com/o/r/issues/3', 'published_at', '2026-10-05T00:00:00Z'))) as r;
select t.ok((select (r ->> 'inserted')::int from r3) = 1 and (select (r ->> 'over_limit')::int from r3) = 2, 'monthly mention limit stops new rows and reports the overflow');
update public.subscriptions set plan_id = 'pro' where workspace_id = (select v from ids where k = 'ws_a');
delete from public.plans where id = 't_tiny';
select t.throws($$select public.svc_ingest_mentions(gen_random_uuid(), 'github', '[]')$$, 'ingest into unknown product fails', 'not found');
reset role;

-- Retention purge
set role service_role;
update public.mentions set retain_until = now() - interval '1 day' where product_id = (select v from ids where k = 'p_a') and external_id = 'a4';
select t.ok(public.svc_purge_expired_mentions(100) = 1, 'purge deletes only expired mentions');
reset role;

-- Isolation & privilege for the new objects
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.scans) = 1, 'owner sees their scans');
select t.ok((select count(*) from public.jobs where scan_id is not null) = 2, 'owner sees scan jobs (scan_id column readable)');
select t.throws($$select * from public.rate_limit_buckets$$, 'users cannot read rate limit buckets', 'permission denied');
select t.throws($$select public.svc_ingest_mentions(gen_random_uuid(), 'github', '[]')$$, 'users cannot call ingest', 'permission denied');
select t.throws($$select public.svc_schedule_due_queries(array['github'], 1)$$, 'users cannot call the scheduler', 'permission denied');
select t.throws($$insert into public.source_health (provider, status) values ('github', 'ok')$$, 'users cannot write source health', 'permission denied');
reset role;
set role service_role;
insert into public.source_health (provider, status) values ('hackernews', 'ok');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select t.ok((select count(*) from public.source_health) = 1, 'source health is readable by any signed-in user');
reset role;
set role anon;
select t.throws($$select * from public.source_health$$, 'anon cannot read source health', 'permission denied');
select t.throws($$select * from public.scans$$, 'anon cannot read scans', 'permission denied');
reset role;

-- ===================================================================== M2.5 monitoring + cost control
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'dave@example.test');
select t.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
insert into ids select 'ws_d', public.create_workspace('Dave Co');
with p as (
  insert into public.products (workspace_id, name, created_by)
  select v, 'DaveApp', auth.uid() from ids where k = 'ws_d' returning id
)
insert into ids select 'p_d', id from p;
reset role;

-- Supplier pricing, budgets and the ledger are never visible to customers.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.throws($$select * from public.provider_pricing$$, 'users cannot read supplier pricing', 'permission denied');
select t.throws($$select * from public.api_budgets$$, 'users cannot read budgets', 'permission denied');
select t.throws($$select * from public.api_cost_ledger$$, 'users cannot read the cost ledger', 'permission denied');
select t.throws($$select * from public.api_cost_allocations$$, 'users cannot read cost allocations', 'permission denied');
select t.throws($$select * from public.plan_paid_allowances$$, 'users cannot read paid allowances', 'permission denied');
select t.throws($$select * from public.comment_expansions$$, 'users cannot read expansion internals', 'permission denied');
select t.throws($$select public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search', '[]')$$, 'users cannot reserve spend', 'permission denied');
select t.throws($$select public.svc_apply_query_groups(gen_random_uuid(), '[]')$$, 'users cannot write query groups', 'permission denied');
select t.throws($$select public.svc_schedule_context(gen_random_uuid(), 'reddit')$$, 'users cannot read schedule internals', 'permission denied');
-- Queries: users may not set fingerprints or schedule state.
select t.throws(format($$insert into public.monitoring_queries (workspace_id, product_id, provider, query, fingerprint) values (%L, %L, 'reddit', 'x', repeat('a', 64))$$,
  (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')), 'users cannot set query fingerprints', 'permission denied');
select t.throws(format($$update public.monitoring_queries set interval_minutes = 15 where product_id = %L$$, (select v from ids where k = 'p_a')),
  'users cannot change adaptive schedule state', 'permission denied');
reset role;
set role anon;
select t.throws($$select * from public.launch_boosts$$, 'anon cannot read launch boosts', 'permission denied');
select t.throws($$select public.buzz_totals(gen_random_uuid(), now() - interval '1 day', now())$$, 'anon cannot run analytics', 'permission denied');
reset role;

-- Reservations (service role). ws_a is on Pro (allowance $5), ws_d on Free ($0).
set role service_role;
create temp table rv (k text primary key, r jsonb);
grant all on rv to service_role;
insert into rv values ('no_budget', public.svc_reserve_api_spend('reddit', 'reddit.comments', 2, 'comment_search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a')))));
select t.ok((select r ->> 'reason' from rv where k = 'no_budget') = 'no_global_budget', 'no paid call without an operator-set global budget');
insert into public.api_budgets (scope, monthly_limit_usd) values ('global', 0.02);
insert into rv values ('first', public.svc_reserve_api_spend('reddit', 'reddit.comments', 2, 'comment_search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))), null, repeat('f', 64)));
select t.ok((select (r ->> 'ok')::boolean from rv where k = 'first') and (select (r ->> 'estimated_usd')::numeric from rv where k = 'first') = 0.006,
  'reservation estimates from the pricing registry (2 pages x $0.003)');
select t.ok((select status from public.api_cost_ledger where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'first')) = 'reserved', 'ledger row starts reserved');
select public.svc_settle_api_spend((select (r ->> 'ledger_id')::uuid from rv where k = 'first'), 200, null, 2, 0, 900);
select t.ok((select status = 'settled' and charged_usd = 0.006 and results_returned = 0 from public.api_cost_ledger where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'first')),
  'zero-result 200 settles as billed');
insert into rv values ('err', public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a')))));
select public.svc_settle_api_spend((select (r ->> 'ledger_id')::uuid from rv where k = 'err'), 502, 'upstream_error', 0, null, 300);
select t.ok((select status = 'released' and charged_usd = 0 from public.api_cost_ledger where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'err')),
  'unbilled failure releases the reservation');
insert into rv values ('lost', public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a')))));
select public.svc_settle_api_spend((select (r ->> 'ledger_id')::uuid from rv where k = 'lost'), null, 'no_response', 0, null, 20000);
select t.ok((select status = 'unknown' and charged_usd is null from public.api_cost_ledger where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'lost')),
  'a request with no answer stays counted at its estimate');
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.unknown', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'unpriced',
  'unpriced endpoints are refused');
select t.ok((public.svc_reserve_api_spend('x', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'unpriced',
  'pricing key must belong to the platform');
-- Spent so far: 0.006 settled + 0.003 unknown = 0.009 of 0.02. 4 X pages ($0.024) would exceed it.
select t.ok((public.svc_reserve_api_spend('x', 'x.posts', 4, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'global_budget_exhausted',
  'global monthly limit is enforced including unknown spend');
update public.api_budgets set monthly_limit_usd = 100 where scope = 'global';
insert into public.api_budgets (scope, platform, monthly_limit_usd) values ('platform', 'x', 0.01);
select t.ok((public.svc_reserve_api_spend('x', 'x.posts', 2, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'platform_budget_exhausted',
  'platform budget is enforced');
insert into public.api_budgets (scope, provider, monthly_limit_usd) values ('provider', 'apidirect', 0.01);
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'provider_budget_exhausted',
  'provider budget is enforced');
delete from public.api_budgets where scope in ('provider', 'platform');
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_d'), 'product_id', (select v from ids where k = 'p_d'))))) ->> 'reason' = 'workspace_budget_exhausted',
  'free plan has no paid-source allowance');
-- Shared fetch: dave can't pay, so only alice is billed (full share).
insert into rv values ('shared', public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search', jsonb_build_array(
  jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a')),
  jsonb_build_object('workspace_id', (select v from ids where k = 'ws_d'), 'product_id', (select v from ids where k = 'p_d')))));
select t.ok(jsonb_array_length((select r -> 'members' from rv where k = 'shared')) = 1
  and (select share from public.api_cost_allocations where ledger_id = (select (r ->> 'ledger_id')::uuid from rv where k = 'shared')) = 1,
  'members who cannot afford their share are dropped; the rest share the cost');
update public.plan_paid_allowances set monthly_usd = 5 where plan_id = 'free';
insert into rv values ('split', public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search', jsonb_build_array(
  jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a')),
  jsonb_build_object('workspace_id', (select v from ids where k = 'ws_d'), 'product_id', (select v from ids where k = 'p_d')))));
select t.ok((select sum(share) from public.api_cost_allocations where ledger_id = (select (r ->> 'ledger_id')::uuid from rv where k = 'split')) = 1
  and (select count(*) from public.api_cost_allocations where ledger_id = (select (r ->> 'ledger_id')::uuid from rv where k = 'split')) = 2,
  'one shared request is split across both products');
update public.plan_paid_allowances set monthly_usd = 0 where plan_id = 'free';
insert into public.api_budgets (scope, product_id, monthly_limit_usd) values ('product', (select v from ids where k = 'p_a'), 0.001);
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))))) ->> 'reason' = 'workspace_budget_exhausted',
  'product budget is enforced');
delete from public.api_budgets where scope = 'product';
-- Stale reservations count as unknown spend.
update public.api_cost_ledger set reserved_at = now() - interval '1 hour' where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'shared');
select public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search',
  jsonb_build_array(jsonb_build_object('workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'))));
select t.ok((select status from public.api_cost_ledger where id = (select (r ->> 'ledger_id')::uuid from rv where k = 'shared')) = 'unknown',
  'reservations abandoned by crashed workers become unknown (still counted)');
select t.ok((select count(*) from public.provider_pricing) = 18 and (select price_usd from private.current_price('x.posts')) = 0.006,
  'pricing registry seeded from the verified price list');
reset role;

-- Launch boosts: admins only, paid boosts need explicit authorization, isolated per workspace.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
with b as (
  insert into public.launch_boosts (workspace_id, product_id, title, platforms, starts_at, ends_at, created_by)
  select (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'v2 launch', array['hackernews','bluesky']::public.integration_provider[],
         now() - interval '1 hour', now() + interval '2 days', auth.uid()
  returning id)
insert into ids select 'boost_a', id from b;
select t.ok((select count(*) from public.launch_boosts) = 1, 'admin can create a free-source boost');
select t.throws(format($$insert into public.launch_boosts (workspace_id, product_id, title, platforms, starts_at, ends_at, max_paid_checks, created_by)
  values (%L, %L, 'paid', array['reddit']::public.integration_provider[], now(), now() + interval '1 day', 50, auth.uid())$$,
  (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')), 'paid boost without authorization is rejected', 'check');
select t.throws(format($$insert into public.launch_boosts (workspace_id, product_id, title, platforms, starts_at, ends_at, max_paid_checks, paid_authorized_by, paid_authorized_at, created_by)
  values (%L, %L, 'paid', array['reddit']::public.integration_provider[], now(), now() + interval '1 day', 50, '00000000-0000-0000-0000-00000000000d', now(), auth.uid())$$,
  (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')), 'paid authorization must be the acting user', 'row-level security');
with b as (
  insert into public.launch_boosts (workspace_id, product_id, title, platforms, starts_at, ends_at, max_paid_checks, paid_authorized_by, paid_authorized_at, created_by)
  values ((select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'paid', array['reddit']::public.integration_provider[],
          now() - interval '1 minute', now() + interval '1 day', 1, auth.uid(), now(), auth.uid())
  returning id)
insert into ids select 'boost_paid', id from b;
select t.throws(format($$insert into public.launch_boosts (workspace_id, product_id, title, platforms, starts_at, ends_at, created_by)
  values (%L, %L, 'long', array['x']::public.integration_provider[], now(), now() + interval '20 days', auth.uid())$$,
  (select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a')), 'boosts last at most 14 days', 'check');
insert into public.product_source_settings (workspace_id, product_id, platform, enabled, updated_by)
values ((select v from ids where k = 'ws_a'), (select v from ids where k = 'p_a'), 'reddit', true, auth.uid());
select t.throws(format($$update public.product_source_settings set config = '{"x":1}' where product_id = %L$$, (select v from ids where k = 'p_a')),
  'users cannot write worker-maintained source config', 'permission denied');
update public.products set monitoring_mode = 'priority' where id = (select v from ids where k = 'p_a');
select t.ok((select monitoring_mode from public.products where id = (select v from ids where k = 'p_a')) = 'priority', 'admin can change the monitoring mode');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select t.ok((select count(*) from public.launch_boosts) = 0, 'other workspaces cannot see boosts');
select t.ok((select count(*) from public.product_source_settings) = 0, 'other workspaces cannot see source settings');
update public.launch_boosts set canceled_at = now();
reset role;
select t.ok((select count(*) from public.launch_boosts where canceled_at is not null) = 0, 'other workspaces cannot cancel boosts');

-- Boost paid-check cap (1) is enforced by reservations.
set role service_role;
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search', jsonb_build_array(jsonb_build_object(
  'workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'), 'boost_id', (select v from ids where k = 'boost_paid')))) ->> 'ok')::boolean,
  'boost allows paid checks up to its cap');
select t.ok((public.svc_reserve_api_spend('reddit', 'reddit.posts', 1, 'search', jsonb_build_array(jsonb_build_object(
  'workspace_id', (select v from ids where k = 'ws_a'), 'product_id', (select v from ids where k = 'p_a'), 'boost_id', (select v from ids where k = 'boost_paid')))) ->> 'reason') = 'workspace_budget_exhausted',
  'boost paid-check cap stops further paid calls');
select t.ok((public.svc_schedule_context((select v from ids where k = 'p_a'), 'hackernews') -> 'boost' ->> 'id')::uuid = (select v from ids where k = 'boost_a')
  and (public.svc_schedule_context((select v from ids where k = 'p_a'), 'hackernews') ->> 'plan_min_minutes')::int = 360
  and public.svc_schedule_context((select v from ids where k = 'p_a'), 'hackernews') ->> 'mode' = 'priority',
  'schedule context exposes plan floor, mode and the active boost for that platform');
select t.ok(public.svc_schedule_context((select v from ids where k = 'p_a'), 'github') -> 'boost' = 'null'::jsonb,
  'a boost only applies to its selected platforms');
reset role;

-- Optimizer query groups: streams coexist; keyword replacement in SQL leaves them alone.
set role service_role;
select t.ok(public.svc_apply_query_groups((select v from ids where k = 'p_a'), jsonb_build_array(
  jsonb_build_object('provider', 'reddit', 'stream', 'posts', 'query', 'FocusFlow', 'fingerprint', repeat('a', 64), 'params', '{"terms":["FocusFlow"]}'),
  jsonb_build_object('provider', 'reddit', 'stream', 'comments', 'query', 'FocusFlow', 'fingerprint', repeat('b', 64), 'params', '{"terms":["FocusFlow"]}'))) = 2,
  'service writes optimizer query groups');
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and provider = 'reddit' and enabled) = 2,
  'Reddit posts and comments are separate query groups (separate checkpoints) with the same query text');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.replace_product_aliases((select v from ids where k = 'p_a'), '[{"term":"FocusFlow","kind":"exact_name"}]');
reset role;
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and provider = 'reddit' and enabled) = 2,
  'replacing keywords in SQL does not disable planned groups');
set role service_role;
select public.svc_apply_query_groups((select v from ids where k = 'p_a'), jsonb_build_array(
  jsonb_build_object('provider', 'reddit', 'stream', 'comments', 'query', 'FocusFlow', 'fingerprint', repeat('b', 64))));
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and provider = 'reddit' and enabled) = 1
  and exists (select 1 from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and stream = 'posts' and not enabled),
  'groups no longer wanted are disabled, not deleted (checkpoints survive)');
-- Adaptive interval drives the scheduler bucket.
update public.monitoring_queries set next_run_at = now() - interval '1 minute', interval_minutes = 120
 where product_id = (select v from ids where k = 'p_a') and stream = 'comments';
select t.ok(public.svc_schedule_due_queries(array['reddit'], 10) = 1, 'scheduler picks up due optimizer groups');
select t.ok((select next_run_at > now() + interval '115 minutes' and next_run_at < now() + interval '130 minutes'
  from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and stream = 'comments'),
  'provisional next run follows the adaptive interval (2 h), not the plan default');
reset role;

-- A failed check gets its quicker retry even inside the same interval bucket.
set role service_role;
create temp table cq as select id from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and stream = 'comments';
update public.monitoring_queries set next_run_at = now() - interval '1 minute', consecutive_failures = 1 where id = (select id from cq);
select t.ok(public.svc_schedule_due_queries(array['reddit'], 10) = 1, 'a failed group is due again');
select t.ok((select count(*) from public.jobs where idempotency_key like 'mq:' || (select id from cq) || ':%') = 2
  and exists (select 1 from public.jobs where idempotency_key like 'mq:' || (select id from cq) || ':%:f1'),
  'after a failure, the retry is a new job in the same bucket');
update public.monitoring_queries set next_run_at = now() - interval '1 minute' where id = (select id from cq);
select public.svc_schedule_due_queries(array['reddit'], 10);
select t.ok((select count(*) from public.jobs where idempotency_key like 'mq:' || (select id from cq) || ':%') = 2,
  'without a new failure, rescheduling in the same bucket stays idempotent');
reset role;

-- ===================================================================== M3 Buzz analytics
-- Dave's product, fixed timestamps (UTC): day 1 = 2026-09-01.
set role service_role;
select public.svc_ingest_mentions((select v from ids where k = 'p_d'), 'reddit', jsonb_build_array(
  jsonb_build_object('external_id', 'r1', 'source_url', 'https://reddit.com/r/a/comments/r1/x', 'published_at', '2026-09-01T10:00:00Z',
    'relevance_status', 'relevant', 'author_external_id', 'u1', 'engagement_score', 5, 'mention_type', 'post', 'data_provider', 'apidirect', 'community', 'r/a'),
  jsonb_build_object('external_id', 'r2', 'source_url', 'https://reddit.com/r/a/comments/r1/x', 'published_at', '2026-09-01T23:30:00Z',
    'relevance_status', 'relevant', 'author_external_id', 'u1', 'engagement_score', 1, 'mention_type', 'comment', 'collection_method', 'comment_search', 'link_target', 'thread'),
  jsonb_build_object('external_id', 'r3', 'source_url', 'https://reddit.com/r/a/comments/r3/x', 'published_at', '2026-09-02T09:00:00Z',
    'relevance_status', 'irrelevant', 'author_external_id', 'u2'),
  jsonb_build_object('external_id', 'r4', 'source_url', 'https://reddit.com/r/a/comments/r4/x', 'published_at', '2026-09-02T09:00:00Z',
    'relevance_status', 'pending', 'author_external_id', 'u3')));
select public.svc_ingest_mentions((select v from ids where k = 'p_d'), 'hackernews', jsonb_build_array(
  jsonb_build_object('external_id', 'h1', 'source_url', 'https://news.ycombinator.com/item?id=h1', 'published_at', '2026-09-02T12:00:00Z',
    'relevance_status', 'user_relevant', 'author_external_id', 'pg', 'linked_url', 'daveapp.example/launch'),
  jsonb_build_object('external_id', 'h2', 'source_url', 'https://news.ycombinator.com/item?id=h2', 'published_at', '2026-09-02T13:00:00Z',
    'relevance_status', 'relevant', 'author_external_id', 'tptacek', 'linked_url', 'daveapp.example/launch')));
select public.svc_ingest_mentions((select v from ids where k = 'p_d'), 'web', jsonb_build_array(
  jsonb_build_object('external_id', 'w1', 'source_url', 'https://blog.example/daveapp', 'published_at', '2026-09-02T00:00:00Z',
    'relevance_status', 'relevant', 'published_at_estimated', true)));
insert into public.coverage_windows (workspace_id, product_id, provider, window_start, window_end, status) values
  ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'reddit', '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z', 'complete'),
  ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'hackernews', '2026-09-02T00:00:00Z', '2026-09-02T12:00:00Z', 'complete'),
  ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'hackernews', '2026-09-02T06:00:00Z', '2026-09-03T00:00:00Z', 'partial');
reset role;
select t.ok((select mention_type || '/' || collection_method || '/' || link_target from public.mentions where external_id = 'r2') = 'comment/comment_search/thread'
  and (select data_provider || '/' || community from public.mentions where external_id = 'r1') = 'apidirect/r/a',
  'ingest stores the extended mention model');

select t.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
create temp table s_utc as select * from public.buzz_series((select v from ids where k = 'p_d'), '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z', 'day', 'UTC');
select t.ok((select relevant from s_utc where bucket_start = '2026-09-01T00:00:00Z' and source = 'reddit') = 2
  and (select irrelevant from s_utc where bucket_start = '2026-09-02T00:00:00Z' and source = 'reddit') = 1
  and (select pending from s_utc where bucket_start = '2026-09-02T00:00:00Z' and source = 'reddit') = 1,
  'daily series splits relevant / irrelevant / pending');
select t.ok((select relevant from s_utc where source = 'hackernews') = 1, 'reposts are excluded from counts (dedup before aggregation)');
select t.ok(not exists (select 1 from s_utc where source = 'web'), 'undated web results stay out of time series');
select t.ok((select posts from s_utc where bucket_start = '2026-09-01T00:00:00Z' and source = 'reddit') = 1
  and (select comments from s_utc where bucket_start = '2026-09-01T00:00:00Z' and source = 'reddit') = 1, 'post/comment split');
create temp table s_ny as select * from public.buzz_series((select v from ids where k = 'p_d'), '2026-08-31T04:00:00Z', '2026-09-03T04:00:00Z', 'day', 'America/New_York');
select t.ok((select relevant from s_ny where bucket_start = '2026-09-01T04:00:00Z' and source = 'reddit') = 2
  and (select count(*) from s_ny where source = 'reddit' and relevant > 0) = 1,
  'day buckets follow the viewer''s time zone (23:30 UTC is still Sep 1 in New York)');
create temp table tot as select * from public.buzz_totals((select v from ids where k = 'p_d'), '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z');
select t.ok((select unique_authors from tot where source = 'reddit') = 1 and (select with_author from tot where source = 'reddit') = 2,
  'unique authors are distinct per platform');
select t.ok((select duplicates_excluded from tot where source = 'hackernews') = 1 and (select undated from tot where source = 'web') = 1,
  'totals report excluded duplicates and undated rows');
select t.ok((select engagement from tot where source = 'reddit') = 6, 'engagement totals');
-- Totals reconcile with the series.
select t.ok((select sum(relevant) from s_utc) = (select sum(relevant) from tot), 'series and totals reconcile');
create temp table cov as select * from public.buzz_coverage((select v from ids where k = 'p_d'), '2026-08-31T00:00:00Z', '2026-09-03T00:00:00Z', 'day', 'UTC');
select t.ok((select covered from cov where bucket_start = '2026-08-31T00:00:00Z' and source = 'reddit') = 0, 'day before monitoring is uncovered (a gap, not zero)');
select t.ok((select covered from cov where bucket_start = '2026-09-02T00:00:00Z' and source = 'hackernews') = 1
  and (select complete from cov where bucket_start = '2026-09-02T00:00:00Z' and source = 'hackernews') = 0.5,
  'overlapping windows are merged; partial coverage is separated from complete');
select t.ok((select covered from cov where bucket_start = '2026-09-01T00:00:00Z' and source = 'hackernews') = 0, 'per-source coverage');
select t.throws($$select * from public.buzz_series(gen_random_uuid(), now() - interval '1 day', now(), 'day', 'Mars/Base')$$, 'unknown time zones are rejected', 'time zone');
select t.throws($$select * from public.buzz_series(gen_random_uuid(), now() - interval '30 days', now(), 'hour', 'UTC')$$, 'hourly ranges are bounded', 'too long');
select t.throws($$select * from public.buzz_series(gen_random_uuid(), now(), now() - interval '1 day', 'day', 'UTC')$$, 'inverted ranges are rejected', 'invalid range');
reset role;

-- Isolation: alice aggregates nothing from dave's product.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.buzz_series((select v from ids where k = 'p_d'), '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z', 'day', 'UTC')) = 0,
  'analytics never aggregate another workspace''s mentions');
select t.ok((select count(*) from public.buzz_totals((select v from ids where k = 'p_d'), '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z')) = 0,
  'totals are isolated too');
select t.ok((select count(*) from public.buzz_coverage((select v from ids where k = 'p_d'), '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z', 'day', 'UTC') where source is not null) = 0,
  'coverage is isolated too');
reset role;

-- Spikes and execution logs: readable by the workspace only.
set role service_role;
insert into public.buzz_spikes (workspace_id, product_id, platform, granularity, period_start, period_end, observed, expected, baseline_periods, robust_z, ratio, severity)
values ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), null, 'day', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z', 30, 4, 20, 9.1, 7.5, 'major');
select t.throws(format($$insert into public.buzz_spikes (workspace_id, product_id, platform, granularity, period_start, period_end, observed, expected, baseline_periods, severity)
  values (%L, %L, null, 'day', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z', 31, 4, 20, 'major')$$, (select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d')),
  'one spike per product/platform/period (re-detection is idempotent)', 'duplicate');
insert into public.monitoring_executions (workspace_id, product_id, platform, status, started_at)
values ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'reddit', 'succeeded', now());
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select t.ok((select count(*) from public.buzz_spikes) = 1 and (select count(*) from public.monitoring_executions) = 1, 'workspace sees its spikes and executions');
select t.throws($$insert into public.buzz_spikes (workspace_id, product_id, granularity, period_start, period_end, observed, expected, baseline_periods, severity)
  values (gen_random_uuid(), gen_random_uuid(), 'day', now(), now() + interval '1 day', 1, 1, 1, 'major')$$, 'users cannot write spikes', 'permission denied');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.buzz_spikes) = 0 and (select count(*) from public.monitoring_executions where product_id = (select v from ids where k = 'p_d')) = 0,
  'other workspaces cannot see spikes or execution logs');
reset role;

-- ===================================================================== Automatic Smart Monitoring
-- Ranking signals come from stored data only; rankings are customer-readable, never customer-writable.
insert into public.monitoring_queries (workspace_id, product_id, provider, stream, query, params, enabled, managed_by)
values ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'bluesky', 'posts', 'DaveApp', '{"terms":["DaveApp"]}', true, 'optimizer');
set role service_role;
select public.svc_ingest_mentions((select v from ids where k = 'p_d'), 'bluesky', jsonb_build_array(
  jsonb_build_object('external_id', 'b1', 'source_url', 'https://bsky.app/profile/a/post/b1', 'published_at', now() - interval '2 hours',
    'relevance_status', 'relevant', 'author_external_id', 'did:a', 'engagement_score', 60),
  jsonb_build_object('external_id', 'b2', 'source_url', 'https://bsky.app/profile/b/post/b2', 'published_at', now() - interval '30 hours',
    'relevance_status', 'relevant', 'author_external_id', 'did:b', 'engagement_score', 1),
  jsonb_build_object('external_id', 'b3', 'source_url', 'https://bsky.app/profile/a/post/b3', 'published_at', now() - interval '3 days',
    'relevance_status', 'user_relevant', 'author_external_id', 'did:a', 'engagement_score', 2),
  jsonb_build_object('external_id', 'b4', 'source_url', 'https://bsky.app/profile/c/post/b4', 'published_at', now() - interval '10 days',
    'relevance_status', 'relevant', 'author_external_id', 'did:c', 'engagement_score', 50),
  jsonb_build_object('external_id', 'b5', 'source_url', 'https://bsky.app/profile/d/post/b5', 'published_at', now() - interval '1 hour',
    'relevance_status', 'irrelevant', 'author_external_id', 'did:d'),
  jsonb_build_object('external_id', 'b6', 'source_url', 'https://bsky.app/profile/e/post/b6', 'published_at', now() - interval '1 hour',
    'relevance_status', 'pending', 'author_external_id', 'did:e'),
  jsonb_build_object('external_id', 'b7', 'source_url', 'https://bsky.app/profile/f/post/b7', 'published_at', now() - interval '40 days',
    'relevance_status', 'relevant', 'author_external_id', 'did:f')));
reset role;
insert into public.coverage_windows (workspace_id, product_id, provider, window_start, window_end, status) values
  ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'bluesky', now() - interval '7 days', now() - interval '1 day', 'complete'),
  ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'bluesky', now() - interval '1 day', now(), 'partial');
insert into public.buzz_spikes (workspace_id, product_id, platform, granularity, period_start, period_end, observed, expected, baseline_periods, severity)
values ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'bluesky', 'hour', now() - interval '2 hours', now() - interval '1 hour', 9, 1, 100, 'notable');

set role service_role;
create temp table st as select * from public.svc_platform_activity_stats((select v from ids where k = 'p_d')) where platform = 'bluesky';
reset role;
select t.ok((select n24 || '/' || prev24 || '/' || n7 || '/' || n28 from st) = '1/1/3/4',
  'activity stats: relevant originals only, irrelevant / needs-review / older than 28 days left out');
select t.ok((select authors7 || '/' || authored7 from st) = '2/3', 'activity stats: distinct authors over 7 days');
select t.ok((select eng_history || '/' || eng_high7 from st) = '4/1', 'activity stats: engagement vs the platform''s own 75th percentile');
select t.ok((select spike_recent from st), 'activity stats: a spike in the last 72 h is seen');
select t.ok((select complete_share7 between 0.85 and 0.86 and covered_share7 > 0.99 and complete_share_prior = 0 from st),
  'activity stats: complete vs any coverage of the last 7 days, and of the baseline weeks');
select t.ok((select completed_checks = 2 and first_monitored_at > now() - interval '25 hours' from st), 'activity stats: checks and first monitored time');
select t.ok((select count(*) from public.svc_platform_activity_stats((select v from ids where k = 'p_d')) where platform = 'youtube') = 0,
  'activity stats: only platforms with enabled query groups');
select t.ok((select (private.schedule_context((select v from ids where k = 'p_d'), 'reddit') ->> 'max_searches_per_platform')::int) = 2,
  'plan entitlement: separate searches per platform without OR (default 2)');
select t.ok(exists (select 1 from pg_indexes where indexname = 'mentions_product_published_id_idx'), 'index for numbered mention pagination');

insert into public.platform_activity (product_id, workspace_id, platform, phase, score, rank, trend, coverage_confidence, recommended_interval, interval_minutes, reasons)
values ((select v from ids where k = 'p_d'), (select v from ids where k = 'ws_d'), 'bluesky', 'ranked', 42, 1, 'stable', 'medium', 240, 1440, '{"Activity score 42/100"}');
insert into public.monitoring_interval_changes (workspace_id, product_id, platform, from_minutes, to_minutes, score, reasons)
values ((select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d'), 'bluesky', 360, 240, 42, '{"Activity increased"}');
select t.throws(format($$insert into public.monitoring_interval_changes (workspace_id, product_id, platform, from_minutes, to_minutes) values (%L, %L, 'bluesky', 240, 240)$$,
  (select v from ids where k = 'ws_d'), (select v from ids where k = 'p_d')), 'an interval change must change the interval', 'check');
select t.throws(format($$insert into public.platform_activity (product_id, workspace_id, platform, phase, trend, coverage_confidence, recommended_interval, interval_minutes) values (%L, %L, 'x', 'ranked', 'stable', 'high', 30, 60)$$,
  (select v from ids where k = 'p_d'), (select v from ids where k = 'ws_d')), 'intervals stay within 1–24 h', 'check');

select t.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select t.ok((select score from public.platform_activity where platform = 'bluesky') = 42
  and (select count(*) from public.monitoring_interval_changes) = 1, 'workspace sees its platform ranking and interval changes');
select t.throws($$update public.platform_activity set interval_minutes = 60$$, 'users cannot change their schedule', 'permission denied');
select t.throws($$insert into public.monitoring_interval_changes (workspace_id, product_id, platform, from_minutes, to_minutes) values (gen_random_uuid(), gen_random_uuid(), 'x', 60, 120)$$,
  'users cannot write interval changes', 'permission denied');
select t.throws(format($$select * from public.svc_platform_activity_stats(%L)$$, (select v from ids where k = 'p_d')), 'users cannot call the stats function', 'permission denied');
reset role;
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) from public.platform_activity where product_id = (select v from ids where k = 'p_d')) = 0
  and (select count(*) from public.monitoring_interval_changes where product_id = (select v from ids where k = 'p_d')) = 0,
  'other workspaces cannot see rankings or interval changes');
reset role;

-- ===================================================================== summary
do $$
declare passed int; failed int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into passed, failed from t.results;
  raise notice '----------------------------------------';
  raise notice '% passed, % failed', passed, failed;
  if failed > 0 then
    raise exception 'database tests failed';
  end if;
end $$;
