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
-- Query sync: replacing keywords derives monitoring queries.
select t.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.replace_product_aliases((select v from ids where k = 'p_a'),
  '[{"term":"FocusFlow","kind":"exact_name"},{"term":"focusflow.app","kind":"domain"},{"term":"Flow","kind":"custom","is_ambiguous":true,"context_terms":["pomodoro"]},{"term":"off","kind":"custom","enabled":false}]');
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled and provider = 'hackernews') = 3,
  'one HN query per enabled keyword');
select t.ok((select query from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled and provider = 'github') = 'FocusFlow | focusflow.app | Flow',
  'GitHub gets one combined query, exact name first');
select t.ok(not exists (select 1 from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled and query = 'off'),
  'disabled keywords are not monitored');
select public.replace_product_aliases((select v from ids where k = 'p_a'), '[{"term":"FocusFlow","kind":"exact_name"}]');
select t.ok((select count(*) from public.monitoring_queries where product_id = (select v from ids where k = 'p_a') and enabled) = 4,
  'removing keywords disables their queries (1 per source left)');
reset role;

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
