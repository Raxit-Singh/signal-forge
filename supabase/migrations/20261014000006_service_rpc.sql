-- Server-only RPC entry points.
-- The `private` schema is not exposed through the Supabase Data API, so the
-- server (service role) reaches private functions through these thin public
-- wrappers. They are executable by service_role ONLY.

create or replace function public.svc_prepare_account_deletion(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.prepare_account_deletion(p_user_id);
$$;

revoke all on function public.svc_prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.svc_prepare_account_deletion(uuid) to service_role;
