-- Members can read the plan their workspace is actually on (additive).
-- plans_read only exposes public plans, so a workspace on a non-public plan
-- (internal testing grants such as internal_unlimited) was shown — and limited
-- in the UI — as Free. This adds read access to exactly the plans that are
-- effective for the caller's own workspaces; other non-public plans stay hidden.

create or replace function private.my_effective_plan_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct private.effective_plan_id(m.workspace_id)
    from public.workspace_members m
   where m.user_id = auth.uid();
$$;

revoke all on function private.my_effective_plan_ids() from public, anon;
grant execute on function private.my_effective_plan_ids() to authenticated;

create policy plans_read_own_effective on public.plans for select to authenticated
  using (id in (select private.my_effective_plan_ids()));
