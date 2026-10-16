-- Retries after a failed check (additive: replaces the scheduler function body).
-- The job idempotency key was query + interval bucket, so after a job died (e.g. a
-- transient 403) the quicker retry scheduled by the worker was swallowed until the
-- next bucket — up to 24 h on daily plans. The key now also carries the query's
-- consecutive failure count: each new failure allows one more attempt in the bucket,
-- while repeated ticks for the same state stay idempotent.
create or replace function private.schedule_due_queries(p_providers text[], p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  scheduled integer := 0;
  mins integer;
begin
  for q in
    select mq.id, mq.workspace_id, mq.product_id, mq.provider, mq.interval_minutes, mq.consecutive_failures, pl.monitoring_interval_minutes
      from public.monitoring_queries mq
      join public.products p on p.id = mq.product_id and p.archived_at is null
      join public.plans pl on pl.id = private.effective_plan_id(mq.workspace_id)
     where mq.enabled
       and mq.competitor_id is null
       and mq.next_run_at <= now()
       and mq.provider::text = any (p_providers)
     order by mq.next_run_at
     limit greatest(1, least(p_limit, 1000))
     for update of mq skip locked
  loop
    mins := coalesce(q.interval_minutes, q.monitoring_interval_minutes);
    mins := greatest(mins, case when q.provider = 'youtube' then 1440 else 60 end);
    perform private.enqueue_job(
      'monitor.query',
      'mq:' || q.id || ':' || floor(extract(epoch from now()) / (mins * 60))::bigint
        || case when q.consecutive_failures > 0 then ':f' || q.consecutive_failures else '' end,
      jsonb_build_object('query_id', q.id),
      q.workspace_id, q.product_id, now(), 4, 100::smallint);
    -- Provisional; the job's completion replaces it with the adaptive choice.
    update public.monitoring_queries
       set next_run_at = now() + make_interval(secs => mins * 60 * (1 + random() * 0.05))
     where id = q.id;
    scheduled := scheduled + 1;
  end loop;
  return scheduled;
end;
$$;
