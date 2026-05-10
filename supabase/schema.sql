create extension if not exists pgcrypto;

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into trips(id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'Goa2026'),
  ('00000000-0000-0000-0000-000000000002', 'Darjeeling2026')
on conflict (id) do nothing;

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references members(id) on delete restrict,
  split_type text not null check (split_type in ('equal', 'manual')),
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id) on delete restrict,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  created_at timestamptz not null default now(),
  unique (expense_id, member_id)
);

alter table members add column if not exists trip_id uuid references trips(id) on delete cascade;
alter table expenses add column if not exists trip_id uuid references trips(id) on delete cascade;
alter table expenses add column if not exists expense_date date;

update members
set trip_id = '00000000-0000-0000-0000-000000000001'
where trip_id is null;

update expenses
set trip_id = '00000000-0000-0000-0000-000000000001'
where trip_id is null;

update expenses
set expense_date = created_at::date
where expense_date is null;

alter table members alter column trip_id set not null;
alter table expenses alter column trip_id set not null;
alter table expenses alter column expense_date set default current_date;
alter table expenses alter column expense_date set not null;

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

alter table trips enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

drop policy if exists "public read trips" on trips;
drop policy if exists "public insert trips" on trips;
drop policy if exists "public read members" on members;
drop policy if exists "public insert members" on members;
drop policy if exists "public read expenses" on expenses;
drop policy if exists "public insert expenses" on expenses;
drop policy if exists "public read splits" on expense_splits;
drop policy if exists "public insert splits" on expense_splits;

create policy "public read trips" on trips for select using (true);
create policy "public insert trips" on trips for insert with check (true);
create policy "public read members" on members for select using (true);
create policy "public insert members" on members for insert with check (true);
create policy "public read expenses" on expenses for select using (true);
create policy "public insert expenses" on expenses for insert with check (true);
create policy "public read splits" on expense_splits for select using (true);
create policy "public insert splits" on expense_splits for insert with check (true);

insert into members(trip_id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'Abhishek'),
  ('00000000-0000-0000-0000-000000000001', 'Kazi'),
  ('00000000-0000-0000-0000-000000000001', 'Sayantan'),
  ('00000000-0000-0000-0000-000000000002', 'Snehasish'),
  ('00000000-0000-0000-0000-000000000002', 'Abhishek')
on conflict (trip_id, name) do nothing;
