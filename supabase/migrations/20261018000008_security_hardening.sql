-- Security hardening from the pre-launch review (additive).
--   * Invitations: at most 30 per workspace per 24 hours (each can send an email
--     to an arbitrary address once email is configured).
--   * public.rls_auto_enable() belongs to Supabase's "automatically enable RLS"
--     event trigger; it never needs to be called through the API. Revoke direct
--     execution (the event trigger still fires).

create or replace function public.create_invitation(p_workspace_id uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text := lower(btrim(coalesce(p_email, '')));
  inv_id uuid;
begin
  if not private.has_workspace_role(p_workspace_id, 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not private.can_grant_role(p_workspace_id, p_role) then
    raise exception 'Only an owner can invite admins, and nobody can be invited as owner.' using errcode = '42501';
  end if;
  -- Abuse limit: invitation emails go to arbitrary addresses.
  if (select count(*) from public.workspace_invitations i where i.workspace_id = p_workspace_id and i.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'This workspace has sent 30 invitations in the last 24 hours. Try again tomorrow.' using errcode = 'P0001', hint = 'limit:invitations';
  end if;
  if exists (select 1 from public.workspace_members m join public.profiles p on p.id = m.user_id
              where m.workspace_id = p_workspace_id and lower(p.email) = addr) then
    raise exception 'That person is already a member of this workspace.' using errcode = '23505';
  end if;
  -- A new invitation to the same address replaces the open one.
  update public.workspace_invitations set revoked_at = now()
   where workspace_id = p_workspace_id and email = addr and accepted_at is null and revoked_at is null;
  insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by)
  values (p_workspace_id, addr, p_role, p_token_hash, (select auth.uid()))
  returning id into inv_id;
  return inv_id;
end;
$$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
