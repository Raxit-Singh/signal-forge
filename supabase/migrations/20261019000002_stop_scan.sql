-- Stop scan / Resume scanning (additive). A workspace admin can stop all
-- collection for a product — its live monitoring, its competitors' tracking
-- and any running historical search — and resume it later. Stored data,
-- keywords and settings are kept.
--
-- Stopping moves every search's next run to 'infinity' (the scheduler never
-- picks it), ends the running historical search ("Stopped" on its unfinished
-- platforms), and records products.scan_paused_at; queued jobs that are
-- already in flight check the flag and exit without calling any source.
-- Resuming makes every enabled search due at once.

alter table public.products add column scan_paused_at timestamptz;

create or replace function public.set_product_scanning(p_product_id uuid, p_stop boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  parent uuid;
  ids uuid[];
  result timestamptz;
begin
  select workspace_id, competitor_of into ws, parent from public.products where id = p_product_id and archived_at is null;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if parent is not null then
    raise exception 'Stop the product this competitor belongs to' using errcode = '22023';
  end if;
  if not private.has_workspace_role(ws, 'admin') then
    raise exception 'Only workspace admins can stop or resume scanning' using errcode = '42501';
  end if;

  -- The product and its competitors' tracking products.
  select array_agg(id) into ids from public.products where id = p_product_id or competitor_of = p_product_id;

  if p_stop then
    result := now();
    update public.products set scan_paused_at = coalesce(scan_paused_at, result) where id = any (ids);
    update public.monitoring_queries set next_run_at = 'infinity' where product_id = any (ids);
    update public.backfill_tasks
       set status = 'partial', next_run_at = 'infinity', note = 'Stopped with Stop scan; what was collected is kept.'
     where product_id = any (ids) and status in ('queued', 'searching', 'paused');
    update public.backfill_runs set status = 'canceled', pause_reason = null, completed_at = now()
     where product_id = any (ids) and status in ('queued', 'searching', 'paused');
    select scan_paused_at into result from public.products where id = p_product_id;
  else
    update public.products set scan_paused_at = null where id = any (ids);
    update public.monitoring_queries set next_run_at = now() where product_id = any (ids) and enabled;
    result := null;
  end if;
  perform private.emit_workspace_event(ws, p_product_id, 'monitoring', jsonb_build_object('scanning', not p_stop));
  return result;
end;
$$;

revoke all on function public.set_product_scanning(uuid, boolean) from public, anon;
grant execute on function public.set_product_scanning(uuid, boolean) to authenticated;
