-- Live database patch: invitation security. Run once in the Supabase SQL Editor.
-- Safe to re-run. Equivalent to the matching parts of supabase/schema.sql.

-- 1) Only owners/admins may read invitations. The token itself grants access to the
--    group, and until now every member could read them all.
drop policy if exists "trip members can read invitations" on trip_invitations;
drop policy if exists "trip admin can read invitations" on trip_invitations;
create policy "trip admin can read invitations" on trip_invitations
  for select to authenticated
  using (is_trip_admin(trip_id));

-- 2) accept_trip_invitation: never change an existing member's role. If the caller is
--    already in the group it now refuses, and the invitation stays unused.
create or replace function accept_trip_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_email text;
  invite_row trip_invitations;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(email) into current_email
  from auth.users
  where id = current_user_id;

  select * into invite_row
  from trip_invitations
  where token = trim(p_token)
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if invite_row.revoked_at is not null then
    raise exception 'Invitation revoked';
  end if;

  if invite_row.accepted_at is not null then
    raise exception 'Invitation already used';
  end if;

  if invite_row.expires_at < now() then
    raise exception 'Invitation expired';
  end if;

  if invite_row.invited_email is not null and current_email is null then
    raise exception 'Invitation requires an email-authenticated account';
  end if;

  if invite_row.invited_email is not null
     and lower(invite_row.invited_email) <> lower(current_email) then
    raise exception 'Invitation is tied to a different email';
  end if;

  -- Accepting an invitation must never change an existing member's role: roles change
  -- only through update_trip_member_role (owner only). If the caller is already in the
  -- group, refuse - the transaction rolls back, so the invitation stays unused.
  if exists (
    select 1 from trip_memberships tm
    where tm.trip_id = invite_row.trip_id and tm.user_id = current_user_id
  ) then
    raise exception 'You are already a member of this group';
  end if;

  insert into trip_memberships (trip_id, user_id, role, invited_by)
  values (invite_row.trip_id, current_user_id, invite_row.role, invite_row.created_by)
  on conflict (trip_id, user_id) do nothing;

  update trip_invitations
  set accepted_at = now(), accepted_by = current_user_id
  where id = invite_row.id;

  perform ensure_trip_member_record(invite_row.trip_id, current_user_id);

  return invite_row.trip_id;
end;
$$;

-- 3) Refresh the API schema cache.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------
-- OPTIONAL: revoke invitations that every member could already see. This revokes any
-- still-active admin invitation that is not tied to a specific email (the only kind a
-- member could have used to promote themselves). Remove the leading "-- " to run it.
--
-- update trip_invitations
--    set revoked_at = now()
--  where accepted_at is null and revoked_at is null and expires_at > now()
--    and role = 'admin' and invited_email is null;

-- ---------------------------------------------------------------------------------
-- VERIFY (run after the patch). Expect exactly one select policy, named
-- "trip admin can read invitations":
--
-- select policyname, cmd from pg_policies
--  where tablename = 'trip_invitations' order by policyname;
