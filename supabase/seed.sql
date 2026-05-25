-- Demo seed data (optional)
-- Run this file after schema.sql to populate the database with sample data for development
-- For production deployments, do NOT run this file
--
-- Note:
-- Trips inserted by this file are intentionally unowned. After signing in,
-- open the app and click "Claim ownership" on a trip tile to take owner role.
-- Once claimed, access to that trip is restricted to its trip_memberships users.

insert into trips(id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'Goa2026'),
  ('00000000-0000-0000-0000-000000000002', 'Darjeeling2026')
on conflict (id) do nothing;

insert into members(trip_id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'Abhishek'),
  ('00000000-0000-0000-0000-000000000001', 'Kazi'),
  ('00000000-0000-0000-0000-000000000001', 'Sayantan'),
  ('00000000-0000-0000-0000-000000000002', 'Snehasish'),
  ('00000000-0000-0000-0000-000000000002', 'Subrata'),
  ('00000000-0000-0000-0000-000000000002', 'Abhishek')
on conflict (trip_id, name) do nothing;
