-- Member invitations and member management (additive).
--
--   * An invitation is a single-use link bound to one email address and role,
--     valid for 7 days. Only a SHA-256 hash of its token is stored; the server
--     generates the token and shows it to the inviter once.
--   * Admins invite members, viewers and admins; only owners invite admins.
--     Nobody is invited as owner.
--   * Accepting requires being signed in with the invited email address.
--   * Role changes and removals: admins manage members and viewers; owners
--     manage everyone. The existing trigger keeps at least one owner.
--   * No seat limit: plans don't define one (pricing unchanged).

create table public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         public.workspace_role not null check (role in ('admin', 'member', 'viewer')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  check (expires_at > created_at)
);
-- One open invitation per address and workspace.
create unique index workspace_invitations_open_uniq on public.workspace_invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;
create index workspace_invitations_ws_idx on public.workspace_invitations (workspace_id, created_at desc);

alter table public.workspace_invitations enable row level security;
-- Admins see their workspace's invitations (never the token hash).
grant select (id, workspace_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.workspace_invitations to authenticated;
create policy invitations_read on public.workspace_invitations for select to authenticated
  using (workspace_id in (select private.user_workspace_ids('admin')));

create or replace function private.can_grant_role(ws uuid, target public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target = 'owner' then false
    when target = 'admin' then private.has_workspace_role(ws, 'owner')
    else private.has_workspace_role(ws, 'admin')
  end;
$$;

-- Invite (the server passes the hash of a token it generated).
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

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.workspace_invitations where id = p_invitation_id;
  if ws is null or not private.has_workspace_role(ws, 'admin') then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  update public.workspace_invitations set revoked_at = now() where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

-- What an invitation is for, for the person holding the link (signed in).
create or replace function public.get_invitation(p_token_hash text)
returns table (workspace_name text, role public.workspace_role, email text, invited_by_name text, expires_at timestamptz, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, i.role, i.email, coalesce(p.display_name, p.email), i.expires_at,
         case when i.revoked_at is not null then 'revoked'
              when i.accepted_at is not null then 'accepted'
              when i.expires_at <= now() then 'expired'
              else 'open' end
    from public.workspace_invitations i
    join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.token_hash = p_token_hash and (select auth.uid()) is not null;
$$;

create or replace function public.accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
  uid uuid := (select auth.uid());
  my_email text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into inv from public.workspace_invitations where token_hash = p_token_hash for update;
  if inv.id is null or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at <= now() then
    raise exception 'This invitation is no longer valid.' using errcode = '22023';
  end if;
  select lower(email) into my_email from auth.users where id = uid;
  if my_email is distinct from inv.email then
    raise exception 'This invitation is for a different email address.' using errcode = '42501';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (inv.workspace_id, uid, inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.workspace_id;
end;
$$;

create or replace function public.set_member_role(p_workspace_id uuid, p_user_id uuid, p_role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.workspace_role;
begin
  select role into target_role from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  if target_role is null or not private.has_workspace_role(p_workspace_id, 'admin') then
    raise exception 'Member not found' using errcode = '42501';
  end if;
  -- Admins manage members and viewers; owners manage everyone (including making owners).
  if not private.has_workspace_role(p_workspace_id, 'owner')
     and (target_role in ('owner', 'admin') or p_role in ('owner', 'admin')) then
    raise exception 'Only an owner can change admins or owners.' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.workspace_role;
  uid uuid := (select auth.uid());
begin
  select role into target_role from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  if target_role is null then
    raise exception 'Member not found' using errcode = '42501';
  end if;
  -- Anyone may leave; removing others needs admin (members/viewers) or owner (admins/owners).
  if p_user_id <> uid then
    if not private.has_workspace_role(p_workspace_id, 'admin') then
      raise exception 'Member not found' using errcode = '42501';
    end if;
    if target_role in ('owner', 'admin') and not private.has_workspace_role(p_workspace_id, 'owner') then
      raise exception 'Only an owner can remove admins or owners.' using errcode = '42501';
    end if;
  end if;
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

revoke all on function private.can_grant_role(uuid, public.workspace_role) from public;
grant execute on function private.can_grant_role(uuid, public.workspace_role) to authenticated;
revoke all on function public.create_invitation(uuid, text, public.workspace_role, text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.get_invitation(text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.workspace_role) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.workspace_role, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.get_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
