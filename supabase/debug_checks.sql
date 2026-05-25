-- Trip Splitter - Debug Checks
-- Run in Supabase SQL Editor when local app behavior looks wrong.
-- Safe: read-only checks only.

-- 1) Confirm core tables exist
select
  to_regclass('public.trips') as trips_table,
  to_regclass('public.members') as members_table,
  to_regclass('public.expenses') as expenses_table,
  to_regclass('public.expense_splits') as expense_splits_table,
  to_regclass('public.trip_memberships') as trip_memberships_table,
  to_regclass('public.trip_invitations') as trip_invitations_table,
  to_regclass('public.user_profiles') as user_profiles_table;

-- 2) Quick row counts
select 'trips' as table_name, count(*) as row_count from public.trips
union all
select 'members', count(*) from public.members
union all
select 'expenses', count(*) from public.expenses
union all
select 'expense_splits', count(*) from public.expense_splits
union all
select 'trip_memberships', count(*) from public.trip_memberships
union all
select 'trip_invitations', count(*) from public.trip_invitations
union all
select 'user_profiles', count(*) from public.user_profiles
order by table_name;

-- 3) Group summary with member/membership counts
select
  t.id,
  t.name,
  t.created_at,
  count(distinct tm.user_id) as membership_users,
  count(distinct m.id) as members_rows,
  count(distinct e.id) as expenses_rows
from public.trips t
left join public.trip_memberships tm on tm.trip_id = t.id
left join public.members m on m.trip_id = t.id
left join public.expenses e on e.trip_id = t.id
group by t.id, t.name, t.created_at
order by t.created_at desc;

-- 4) Membership users missing corresponding members rows (should be empty)
select
  tm.trip_id,
  tm.user_id,
  up.email,
  up.display_name
from public.trip_memberships tm
left join public.members m
  on m.trip_id = tm.trip_id
 and m.user_id = tm.user_id
left join public.user_profiles up
  on up.user_id = tm.user_id
where m.id is null
order by tm.created_at desc;

-- 5) Members rows not linked to user_id (manual-only members are expected)
select
  m.trip_id,
  m.id as member_id,
  m.name,
  m.user_id,
  m.created_at
from public.members m
where m.user_id is null
order by m.created_at desc
limit 50;

-- 6) Expense rows with payer not found in members (should be empty)
select
  e.id as expense_id,
  e.trip_id,
  e.paid_by
from public.expenses e
left join public.members m on m.id = e.paid_by
where m.id is null
order by e.created_at desc;

-- 7) Split sum mismatch check (should be empty)
select
  e.id as expense_id,
  e.amount as expense_amount,
  coalesce(sum(es.share_amount), 0)::numeric(12,2) as split_sum
from public.expenses e
left join public.expense_splits es on es.expense_id = e.id
group by e.id, e.amount
having abs(coalesce(sum(es.share_amount), 0) - e.amount) > 0.01
order by e.created_at desc;

-- 8) PostgREST notification queue health
select pg_notification_queue_usage() as notification_queue_usage;

-- 9) user_profiles policies required for display-name editing
select
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'user_profiles'
order by policyname;

-- 10) Required RPC functions visible in Postgres
select
  proname as function_name,
  pg_get_function_identity_arguments(oid) as arguments
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'create_trip_with_owner',
    'claim_unowned_trip',
    'accept_trip_invitation',
    'create_trip_invitation',
    'ensure_trip_member_record',
    'save_expense_with_splits',
    'delete_expense_with_permission',
    'remove_trip_member',
    'update_trip_member_role'
  )
order by proname;
