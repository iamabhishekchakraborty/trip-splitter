-- Trip Splitter - Full App Reset (Data + Objects)
-- WARNING: This removes Trip Splitter app tables/functions/policies/triggers.
-- It does NOT delete Supabase auth users.
--
-- After running this file:
-- 1) run supabase/schema.sql
-- 2) optionally run supabase/seed.sql

-- Remove auth sync trigger/function first
drop trigger if exists on_auth_user_synced on auth.users;
drop function if exists public.sync_user_profile() cascade;

-- Remove app RPC/helper functions
drop function if exists public.update_my_display_name(text) cascade;
drop function if exists public.ensure_trip_member_record(uuid, uuid) cascade;
drop function if exists public.preferred_display_name(uuid) cascade;
drop function if exists public.delete_expense_with_permission(uuid) cascade;
drop function if exists public.save_expense_with_splits(uuid, text, numeric, uuid, text, date, jsonb, uuid) cascade;
drop function if exists public.update_trip_member_role(uuid, uuid, text) cascade;
drop function if exists public.remove_trip_member(uuid, uuid) cascade;
drop function if exists public.accept_trip_invitation(text) cascade;
drop function if exists public.create_trip_invitation(uuid, text, text, integer) cascade;
drop function if exists public.claim_unowned_trip(uuid) cascade;
drop function if exists public.create_trip_with_owner(text) cascade;
drop function if exists public.is_trip_owner(uuid) cascade;
drop function if exists public.can_view_user_profile(uuid) cascade;
drop function if exists public.is_trip_unowned(uuid) cascade;
drop function if exists public.is_trip_admin(uuid) cascade;
drop function if exists public.is_trip_member(uuid) cascade;

-- Remove app tables
drop table if exists public.expense_splits cascade;
drop table if exists public.expenses cascade;
drop table if exists public.members cascade;
drop table if exists public.trip_invitations cascade;
drop table if exists public.trip_memberships cascade;
drop table if exists public.trips cascade;
drop table if exists public.user_profiles cascade;

-- Optional visibility confirmation
select
  to_regclass('public.trips') as trips_table,
  to_regclass('public.members') as members_table,
  to_regclass('public.expenses') as expenses_table,
  to_regclass('public.expense_splits') as expense_splits_table,
  to_regclass('public.trip_memberships') as trip_memberships_table,
  to_regclass('public.trip_invitations') as trip_invitations_table,
  to_regclass('public.user_profiles') as user_profiles_table;
