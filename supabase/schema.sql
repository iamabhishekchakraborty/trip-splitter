create extension if not exists pgcrypto;

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists members (/*  */
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references members(id) on delete restrict,
  split_type text not null check (split_type in ('equal', 'manual')),
  expense_date date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id) on delete restrict,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  created_at timestamptz not null default now(),
  unique (expense_id, member_id)
);

create table if not exists trip_memberships (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table if not exists user_profiles (
  user_id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  token text not null unique,
  invited_email text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);

alter table trips add column if not exists created_by uuid;
alter table members add column if not exists trip_id uuid references trips(id) on delete cascade;
alter table expenses add column if not exists trip_id uuid references trips(id) on delete cascade;
alter table expenses add column if not exists expense_date date;
alter table expenses add column if not exists created_by uuid;
alter table expenses add column if not exists updated_by uuid;
alter table expenses add column if not exists updated_at timestamptz;

update members
set trip_id = '00000000-0000-0000-0000-000000000001'
where trip_id is null;

update expenses
set trip_id = '00000000-0000-0000-0000-000000000001'
where trip_id is null;

update expenses
set expense_date = created_at::date
where expense_date is null;

update expenses
set updated_at = created_at
where updated_at is null;

alter table members alter column trip_id set not null;
alter table expenses alter column trip_id set not null;
alter table expenses alter column expense_date set default current_date;
alter table expenses alter column expense_date set not null;
alter table expenses alter column updated_at set default now();
alter table expenses alter column updated_at set not null;

alter table members drop constraint if exists members_name_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'members_trip_id_name_key'
  ) then
    alter table members add constraint members_trip_id_name_key unique (trip_id, name);
  end if;
end $$;

create index if not exists idx_members_trip_id on members(trip_id);
create index if not exists idx_expenses_trip_id on expenses(trip_id);
create index if not exists idx_expenses_paid_by on expenses(paid_by);
create index if not exists idx_expense_splits_expense_id on expense_splits(expense_id);
create index if not exists idx_expense_splits_member_id on expense_splits(member_id);
create index if not exists idx_trip_memberships_trip_id on trip_memberships(trip_id);
create index if not exists idx_trip_memberships_user_id on trip_memberships(user_id);
create index if not exists idx_user_profiles_email on user_profiles(email);
create index if not exists idx_trip_invitations_trip_id on trip_invitations(trip_id);
create index if not exists idx_trip_invitations_token on trip_invitations(token);

insert into user_profiles (user_id, email, created_at, updated_at)
select id, lower(email), created_at, now()
from auth.users
on conflict (user_id)
do update set
  email = excluded.email,
  updated_at = now();

create or replace function sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_profiles (user_id, email, created_at, updated_at)
  values (new.id, lower(new.email), coalesce(new.created_at, now()), now())
  on conflict (user_id)
  do update set
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_synced on auth.users;
create trigger on_auth_user_synced
after insert or update of email
on auth.users
for each row
execute function public.sync_user_profile();

create or replace function is_trip_member(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from trip_memberships tm
    where tm.trip_id = target_trip_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function is_trip_admin(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from trip_memberships tm
    where tm.trip_id = target_trip_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
  );
$$;

create or replace function is_trip_unowned(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from trip_memberships tm
    where tm.trip_id = target_trip_id
  );
$$;

create or replace function can_view_user_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id = auth.uid()
    or exists (
      select 1
      from trip_memberships mine
      join trip_memberships theirs
        on mine.trip_id = theirs.trip_id
      where mine.user_id = auth.uid()
        and theirs.user_id = target_user_id
    );
$$;

create or replace function is_trip_owner(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from trip_memberships tm
    where tm.trip_id = target_trip_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  );
$$;

create or replace function create_trip_with_owner(trip_name text)
returns trips
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  new_trip trips;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into trips (name, created_by)
  values (trim(trip_name), current_user_id)
  returning * into new_trip;

  insert into trip_memberships (trip_id, user_id, role, invited_by)
  values (new_trip.id, current_user_id, 'owner', current_user_id)
  on conflict (trip_id, user_id) do nothing;

  return new_trip;
end;
$$;

create or replace function claim_unowned_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (select 1 from trips where id = p_trip_id) then
    raise exception 'Trip not found';
  end if;

  if exists (
    select 1
    from trip_memberships tm
    where tm.trip_id = p_trip_id
  ) then
    raise exception 'Trip already has members';
  end if;

  insert into trip_memberships (trip_id, user_id, role, invited_by)
  values (p_trip_id, current_user_id, 'owner', current_user_id)
  on conflict (trip_id, user_id) do nothing;
end;
$$;

create or replace function create_trip_invitation(
  p_trip_id uuid,
  p_invited_email text default null,
  p_role text default 'member',
  p_expiry_hours integer default 168
)
returns trip_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  invite_row trip_invitations;
  normalized_role text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not is_trip_admin(p_trip_id) then
    raise exception 'Only owner/admin can create invites';
  end if;

  normalized_role := case
    when lower(coalesce(p_role, 'member')) = 'admin' then 'admin'
    else 'member'
  end;

  insert into trip_invitations (
    trip_id,
    token,
    invited_email,
    role,
    created_by,
    expires_at
  )
  values (
    p_trip_id,
    encode(gen_random_bytes(12), 'hex'),
    case when p_invited_email is null then null else lower(trim(p_invited_email)) end,
    normalized_role,
    current_user_id,
    now() + make_interval(hours => greatest(p_expiry_hours, 1))
  )
  returning * into invite_row;

  return invite_row;
end;
$$;

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

  select lower(email)
  into current_email
  from auth.users
  where id = current_user_id;

  select *
  into invite_row
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

  insert into trip_memberships (trip_id, user_id, role, invited_by)
  values (invite_row.trip_id, current_user_id, invite_row.role, invite_row.created_by)
  on conflict (trip_id, user_id)
  do update set role = excluded.role;

  update trip_invitations
  set accepted_at = now(),
      accepted_by = current_user_id
  where id = invite_row.id;

  return invite_row.trip_id;
end;
$$;

create or replace function remove_trip_member(
  p_trip_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  target_role text;
  owner_count integer;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not is_trip_admin(p_trip_id) then
    raise exception 'Only owner/admin can remove users';
  end if;

  select role
  into target_role
  from trip_memberships
  where trip_id = p_trip_id and user_id = p_user_id;

  if target_role is null then
    raise exception 'User is not part of this group';
  end if;

  if target_role = 'owner' then
    select count(*)
    into owner_count
    from trip_memberships
    where trip_id = p_trip_id and role = 'owner';

    if owner_count <= 1 then
      raise exception 'Cannot remove last owner from group';
    end if;
  end if;

  delete from trip_memberships
  where trip_id = p_trip_id and user_id = p_user_id;
end;
$$;

create or replace function update_trip_member_role(
  p_trip_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  new_role text;
  target_role text;
  owner_count integer;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not is_trip_owner(p_trip_id) then
    raise exception 'Only owner can change roles';
  end if;

  new_role := case
    when lower(coalesce(p_role, 'member')) = 'owner' then 'owner'
    when lower(coalesce(p_role, 'member')) = 'admin' then 'admin'
    else 'member'
  end;

  select role
  into target_role
  from trip_memberships
  where trip_id = p_trip_id and user_id = p_user_id;

  if target_role is null then
    raise exception 'User is not part of this group';
  end if;

  if target_role = 'owner' and new_role <> 'owner' then
    select count(*)
    into owner_count
    from trip_memberships
    where trip_id = p_trip_id and role = 'owner';

    if owner_count <= 1 then
      raise exception 'Cannot demote last owner';
    end if;
  end if;

  update trip_memberships
  set role = new_role
  where trip_id = p_trip_id and user_id = p_user_id;
end;
$$;

create or replace function save_expense_with_splits(
  p_trip_id uuid,
  p_description text,
  p_amount numeric,
  p_paid_by uuid,
  p_split_type text,
  p_expense_date date,
  p_splits jsonb,
  p_expense_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  expense_id uuid;
  existing_creator uuid;
  split_sum numeric(12,2);
  split_row jsonb;
  split_member_id uuid;
  split_share numeric(12,2);
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not is_trip_member(p_trip_id) then
    raise exception 'You are not part of this trip';
  end if;

  if coalesce(trim(p_description), '') = '' then
    raise exception 'Description is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if p_split_type not in ('equal', 'manual') then
    raise exception 'Invalid split type';
  end if;

  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'At least one split is required';
  end if;

  if not exists (
    select 1 from members m
    where m.id = p_paid_by and m.trip_id = p_trip_id
  ) then
    raise exception 'Payer must be a member in this trip';
  end if;

  split_sum := 0;
  for split_row in select value from jsonb_array_elements(p_splits) loop
    split_member_id := (split_row->>'member_id')::uuid;
    split_share := round(coalesce((split_row->>'share_amount')::numeric, 0), 2);

    if split_share < 0 then
      raise exception 'Split amount cannot be negative';
    end if;

    if not exists (
      select 1 from members m
      where m.id = split_member_id and m.trip_id = p_trip_id
    ) then
      raise exception 'Split member is not part of this trip';
    end if;

    split_sum := split_sum + split_share;
  end loop;

  if abs(split_sum - round(p_amount, 2)) > 0.01 then
    raise exception 'Split total must match expense amount';
  end if;

  if p_expense_id is null then
    insert into expenses (
      trip_id,
      description,
      amount,
      paid_by,
      split_type,
      expense_date,
      created_by,
      updated_by,
      updated_at
    )
    values (
      p_trip_id,
      trim(p_description),
      round(p_amount, 2),
      p_paid_by,
      p_split_type,
      p_expense_date,
      current_user_id,
      current_user_id,
      now()
    )
    returning id into expense_id;
  else
    select created_by
    into existing_creator
    from expenses
    where id = p_expense_id
      and trip_id = p_trip_id;

    if existing_creator is null then
      raise exception 'Expense not found';
    end if;

    if existing_creator <> current_user_id and not is_trip_admin(p_trip_id) then
      raise exception 'Only creator or admin can edit this expense';
    end if;

    update expenses
    set description = trim(p_description),
        amount = round(p_amount, 2),
        paid_by = p_paid_by,
        split_type = p_split_type,
        expense_date = p_expense_date,
        updated_by = current_user_id,
        updated_at = now()
    where id = p_expense_id;

    expense_id := p_expense_id;

    delete from expense_splits
    where expense_id = p_expense_id;
  end if;

  insert into expense_splits (expense_id, member_id, share_amount)
  select
    expense_id,
    (value->>'member_id')::uuid,
    round(coalesce((value->>'share_amount')::numeric, 0), 2)
  from jsonb_array_elements(p_splits);

  return expense_id;
end;
$$;

create or replace function delete_expense_with_permission(
  p_expense_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  expense_trip_id uuid;
  expense_creator uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select trip_id, created_by
  into expense_trip_id, expense_creator
  from expenses
  where id = p_expense_id;

  if expense_trip_id is null then
    raise exception 'Expense not found';
  end if;

  if expense_creator <> current_user_id and not is_trip_admin(expense_trip_id) then
    raise exception 'Only creator or admin can delete this expense';
  end if;

  delete from expenses
  where id = p_expense_id;
end;
$$;

alter table trips enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table trip_memberships enable row level security;
alter table trip_invitations enable row level security;
alter table user_profiles enable row level security;

drop policy if exists "public read trips" on trips;
drop policy if exists "public insert trips" on trips;
drop policy if exists "public read members" on members;
drop policy if exists "public insert members" on members;
drop policy if exists "public read expenses" on expenses;
drop policy if exists "public insert expenses" on expenses;
drop policy if exists "public read splits" on expense_splits;
drop policy if exists "public insert splits" on expense_splits;

drop policy if exists "trip members can read trips" on trips;
drop policy if exists "authenticated cannot direct insert trips" on trips;
drop policy if exists "trip members can read members" on members;
drop policy if exists "trip members can add members" on members;
drop policy if exists "trip admin can delete members" on members;
drop policy if exists "trip members can read expenses" on expenses;
drop policy if exists "trip members can add expenses" on expenses;
drop policy if exists "creator or admin can edit expenses" on expenses;
drop policy if exists "creator or admin can delete expenses" on expenses;
drop policy if exists "trip members can read splits" on expense_splits;
drop policy if exists "trip members can add splits" on expense_splits;
drop policy if exists "creator or admin can edit splits" on expense_splits;
drop policy if exists "creator or admin can delete splits" on expense_splits;
drop policy if exists "trip members can read memberships" on trip_memberships;
drop policy if exists "trip admin can insert memberships" on trip_memberships;
drop policy if exists "trip owner can update memberships" on trip_memberships;
drop policy if exists "trip admin can delete memberships" on trip_memberships;
drop policy if exists "trip members can read invitations" on trip_invitations;
drop policy if exists "trip admin can create invitations" on trip_invitations;
drop policy if exists "trip admin can update invitations" on trip_invitations;
drop policy if exists "users can read own and group profiles" on user_profiles;

create policy "trip members can read trips"
on trips
for select
to authenticated
using (is_trip_member(id) or is_trip_unowned(id));

create policy "authenticated cannot direct insert trips"
on trips
for insert
to authenticated
with check (false);

create policy "trip members can read members"
on members
for select
to authenticated
using (is_trip_member(trip_id) or is_trip_unowned(trip_id));

create policy "trip members can add members"
on members
for insert
to authenticated
with check (is_trip_member(trip_id));

create policy "trip admin can delete members"
on members
for delete
to authenticated
using (is_trip_admin(trip_id));

create policy "trip members can read expenses"
on expenses
for select
to authenticated
using (is_trip_member(trip_id) or is_trip_unowned(trip_id));

create policy "trip members can add expenses"
on expenses
for insert
to authenticated
with check (is_trip_member(trip_id));

create policy "creator or admin can edit expenses"
on expenses
for update
to authenticated
using (created_by = auth.uid() or is_trip_admin(trip_id))
with check (is_trip_member(trip_id));

create policy "creator or admin can delete expenses"
on expenses
for delete
to authenticated
using (created_by = auth.uid() or is_trip_admin(trip_id));

create policy "trip members can read splits"
on expense_splits
for select
to authenticated
using (
  exists (
    select 1
    from expenses e
    where e.id = expense_splits.expense_id
      and (is_trip_member(e.trip_id) or is_trip_unowned(e.trip_id))
  )
);

create policy "trip members can add splits"
on expense_splits
for insert
to authenticated
with check (
  exists (
    select 1
    from expenses e
    where e.id = expense_splits.expense_id
      and is_trip_member(e.trip_id)
  )
);

create policy "creator or admin can edit splits"
on expense_splits
for update
to authenticated
using (
  exists (
    select 1
    from expenses e
    where e.id = expense_splits.expense_id
      and (e.created_by = auth.uid() or is_trip_admin(e.trip_id))
  )
)
with check (
  exists (
    select 1
    from expenses e
    where e.id = expense_splits.expense_id
      and is_trip_member(e.trip_id)
  )
);

create policy "creator or admin can delete splits"
on expense_splits
for delete
to authenticated
using (
  exists (
    select 1
    from expenses e
    where e.id = expense_splits.expense_id
      and (e.created_by = auth.uid() or is_trip_admin(e.trip_id))
  )
);

create policy "trip members can read memberships"
on trip_memberships
for select
to authenticated
using (is_trip_member(trip_id));

create policy "trip admin can insert memberships"
on trip_memberships
for insert
to authenticated
with check (is_trip_admin(trip_id));

create policy "trip owner can update memberships"
on trip_memberships
for update
to authenticated
using (is_trip_owner(trip_id))
with check (is_trip_owner(trip_id));

create policy "trip admin can delete memberships"
on trip_memberships
for delete
to authenticated
using (is_trip_admin(trip_id));

create policy "trip members can read invitations"
on trip_invitations
for select
to authenticated
using (is_trip_member(trip_id));

create policy "trip admin can create invitations"
on trip_invitations
for insert
to authenticated
with check (is_trip_admin(trip_id));

create policy "trip admin can update invitations"
on trip_invitations
for update
to authenticated
using (is_trip_admin(trip_id))
with check (is_trip_admin(trip_id));

create policy "users can read own and group profiles"
on user_profiles
for select
to authenticated
using (can_view_user_profile(user_id));
