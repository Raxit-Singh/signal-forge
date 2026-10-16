-- Keyword coverage across all connectors (additive: replaces two function bodies).
--
-- Hacker News, Stack Overflow, GitHub and YouTube used to get their queries from
-- private.sync_monitoring_queries, which searched only a product's first 5 keywords.
-- Their query groups now come from the same server-side planner as every other
-- source (every keyword; OR-combined where supported; fair rotation where a search
-- budget applies), written through apply_query_groups.
--
--   * sync_monitoring_queries keeps its authorization check (it is still called by
--     replace_product_aliases) but no longer writes queries.
--   * apply_query_groups now disables every group of the product that isn't in the
--     desired set, including old 'legacy' rows. Rows whose (provider, stream, query)
--     match a desired group are taken over in place, so their checkpoints survive.
--     Nothing is deleted.

create or replace function private.sync_monitoring_queries(p_product_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    return 0;
  end if;
  if (select auth.uid()) is not null and not private.has_workspace_role(ws, 'admin') then
    raise exception 'Product not found' using errcode = '42501';
  end if;
  -- Query groups are planned and written by the server (svc_apply_query_groups).
  return 0;
end;
$$;

create or replace function private.apply_query_groups(p_product_id uuid, p_groups jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  g jsonb;
  n integer := 0;
begin
  select workspace_id into ws from public.products where id = p_product_id;
  if ws is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 200 then
    raise exception 'groups must be an array of at most 200 items' using errcode = '22023';
  end if;

  -- Desired set in, everything else (optimizer and legacy rows) disabled, never deleted.
  update public.monitoring_queries set enabled = false
   where product_id = p_product_id and competitor_id is null and enabled;

  for g in select * from jsonb_array_elements(p_groups) loop
    insert into public.monitoring_queries
      (workspace_id, product_id, provider, stream, query, params, fingerprint, query_plan, managed_by, enabled)
    values (ws, p_product_id, (g ->> 'provider')::public.integration_provider, g ->> 'stream', g ->> 'query',
            coalesce(g -> 'params', '{}'::jsonb), g ->> 'fingerprint', coalesce(g -> 'plan', '{}'::jsonb), 'optimizer', true)
    on conflict (product_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, stream, lower(query))
    do update set enabled = true, params = excluded.params, fingerprint = excluded.fingerprint,
                  query_plan = excluded.query_plan, managed_by = 'optimizer';
    n := n + 1;
  end loop;
  return n;
end;
$$;
