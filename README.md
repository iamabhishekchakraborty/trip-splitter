# Trip Splitter

A React + Supabase expense splitting app for trip groups.

This iteration upgrades the MVP with:

- Group-level data isolation with Supabase Auth + RLS
- Role-based group access (`owner`, `admin`, `member`)
- Invitation-based group onboarding
- User removal and role management
- Expense edit and delete support
- Per-member paid/share/net summary
- Detailed CSV, summary CSV, and PDF exports

## What is included

- React frontend built with Vite
- Supabase Postgres schema and RLS policies
- Local demo mode fallback when `.env` is not configured
- Multiple trip groups with separate members and expenses
- Equal and manual expense splitting
- Per-expense participant selection for full-group or subset splits
- Backdated expense dates plus logged timestamps for audit history
- Group-level invitation flow with token acceptance
- Owner/admin controls for membership and roles
- Expense create/edit/delete flows
- Per-member summary showing paid, share, and net position
- Suggested transfer settlements
- Export options:
  - Settlement CSV with total spent, member paid/share/net values, and suggested transfers
  - Expense CSV with one row per expense and readable split details
  - PDF report with total spent, member summary, suggested transfers, and expense details
- Automatic creator/joiner member record so expense form works immediately
- User-friendly display names (with editable profile name)

## How exports work

- `Settlement CSV`
  - Best for sharing how the group should settle up.
  - Contains trip total, one row per member with `paid`, `share`, `net`, and settlement status, plus suggested transfers.
- `Expense CSV`
  - Best for reviewing what made up the total.
  - Contains one row per expense with payer, split method, readable split details, and timestamps.
- `PDF`
  - Best for sharing a complete trip snapshot with the group.
  - Includes total spent, member summary, suggested transfers, and detailed expense history.
  - Opens the browser print dialog; choose `Save as PDF` to download.

## Local setup

You can run the UI without Supabase. In this mode, data is stored in browser local storage.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Optionally run `supabase/seed.sql` for sample trips and members.
4. In Supabase, go to Project Settings > API and copy:
   - Project URL
   - anon public key
5. Copy `.env.example` to `.env` and set:

```text
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

6. Run:

```bash
npm install
npm run dev
```

Important:

- Whenever you pull new branch changes that include SQL updates, re-run the latest `supabase/schema.sql` in your Supabase project before testing.

## Auth and security model

### Authentication

- Supabase mode requires sign-in via email OTP (magic link).
- The app uses `supabase.auth.signInWithOtp` and `signOut`.

### Access model

- `trip_memberships` maps authenticated users to trips with role:
  - `owner`
  - `admin`
  - `member`
- Access to trips, members, expenses, and splits is restricted by RLS to group users.
- When a user creates/claims/joins a trip, a matching row is auto-created in `members` for easier expense entry.

### Invitations

- Admins/owners can create invitation tokens from inside a group.
- Invite can optionally be tied to a specific email.
- Invite acceptance adds the user to `trip_memberships` with the chosen role.

### Legacy/unowned trips

- Trips inserted before memberships exist (or from `seed.sql`) are "unowned".
- Any authenticated user can claim ownership once.
- After claim, only group members retain access.

## Database objects added for this phase

- `trip_memberships`
- `trip_invitations`
- `user_profiles` (safe mirror for displaying group user emails)
- Helper functions:
  - `create_trip_with_owner`
  - `claim_unowned_trip`
  - `create_trip_invitation`
  - `accept_trip_invitation`
  - `remove_trip_member`
  - `update_trip_member_role`
  - `save_expense_with_splits`
  - `delete_expense_with_permission`

## Group permissions

- `owner`
  - Full admin rights
  - Can change user roles (`member`/`admin`/`owner`)
- `admin`
  - Can invite users
  - Can remove users (except last-owner constraints still enforced)
- `member`
  - Can view group data
  - Can add expenses

## Expense edit/delete behavior

- Edit and delete are now available in expense history.
- The server validates split totals and group membership.
- Only expense creator or group admin/owner can edit/delete an expense.
- Expense edit updates amount/description/date/payer/splits in one RPC call.

## Deployment notes

For end users, deploy both:

- Frontend (Vercel/Netlify)
- Supabase project with schema applied

Important:

- Ensure your Supabase Auth settings allow email OTP.
- Set your site URL and redirect URL in Supabase Auth config to match deployed frontend URL.
- Never expose service role keys in frontend code.

## Free tier operations and guardrails

This project is currently designed to run on:

- Supabase Free plan
- Vercel Hobby plan

Treat this as a non-negotiable engineering constraint unless explicitly changed.

### Why this matters

Most product regressions on free-tier stacks come from introducing features that are technically valid but operationally expensive (for example high-frequency polling, always-on background jobs, excessive email sends, or large payload writes).

To avoid accidental cost/limit regressions, every new feature should be checked against the guardrails below before implementation.

### Guardrails for future changes

1. Keep frontend-first architecture:
   - Prefer static Vite React frontend + direct Supabase client calls.
   - Avoid adding server-side middle tiers unless absolutely needed.

2. Keep backend workloads light:
   - Prefer Postgres constraints/RLS/functions over long-running compute.
   - Avoid heavy cron-style workloads and large batch jobs.

3. Be intentional with authentication email flows:
   - Supabase built-in email sending has strict limits on Free.
   - Avoid workflows that trigger many OTP or auth emails in a short period.
   - If growth requires frequent auth mails, migrate to custom SMTP before scaling usage.

4. Minimize chatty database patterns:
   - Avoid unnecessary auto-refresh loops.
   - Batch related reads where possible.
   - Use single RPC for multi-step writes that must be consistent.

5. Keep payload sizes moderate:
   - Avoid storing large blobs or files in the core transactional tables.
   - Keep expense/membership/invite records compact and query-friendly.

6. Preserve RLS-first security:
   - Any new table/function must be reviewed for RLS compatibility.
   - Never rely on frontend-only permission checks.

7. Preserve local mode:
   - New user-facing flows should degrade safely in local demo mode where practical.
   - If a feature must be Supabase-only, gate it clearly in UI and docs.

8. Track complexity creep:
   - If a feature needs queues, workers, streaming pipelines, or high-throughput analytics, stop and assess whether free-tier constraints are still appropriate.

### Operational checklist before merging new features

1. Does this change increase auth email volume?
2. Does it add frequent background calls (polling/webhooks/cron)?
3. Does it add large response payloads or high-frequency writes?
4. Does it require secrets or privileged backend runtimes?
5. Does it bypass, weaken, or complicate existing RLS patterns?
6. Can it run safely on Supabase Free + Vercel Hobby without reliability issues?

If any answer is "yes" to risk increase, document the tradeoff in the PR and include fallback mitigation.

### Practical free-tier usage guidance

1. Supabase Auth:
   - During QA, avoid repeatedly requesting OTP links from the same accounts.
   - Reuse signed-in sessions when testing multiple scenarios.

2. Database:
   - Prefer indexed filters (`trip_id`, `user_id`) for all list queries.
   - Keep expensive joins bounded by group context and limits.

3. Invitations:
   - Prefer token reuse patterns during internal testing to reduce repeated invite generation load.

4. Vercel deploy hygiene:
   - Avoid unnecessary repeated deployments during a single debug loop.
   - Validate locally (`npm run build`) before pushing to reduce failed Hobby builds.

### When to consider upgrading plan

Consider Supabase Pro and/or Vercel Pro when one or more conditions are consistently true:

1. OTP/auth email throughput becomes a frequent bottleneck.
2. Group and expense volume makes current query latency noticeable.
3. You need stronger observability/log retention than free tiers provide.
4. You need predictable headroom for higher concurrent usage.

## Verification checklist

1. Sign in with email OTP.
2. Create a trip and confirm owner role.
3. Add members and expenses.
4. Edit an expense and confirm balances update.
5. Delete an expense and confirm balances update.
6. Download detailed CSV, summary CSV, and PDF export.
7. Create invite token from owner/admin account.
8. Accept invite from another account and confirm restricted visibility.
9. Remove a user as owner/admin and confirm access revocation.

## Local testing flow

1. Start the app locally with `npm run dev`.
2. Open `http://127.0.0.1:5173`.
3. Create or open a trip.
4. Add 2-3 members.
5. Add at least one equal split expense and one manual split expense.
6. Confirm the member summary shows `paid`, `share`, and `net`.
7. Confirm suggested transfers update correctly.
8. Download `Settlement CSV` and verify member totals plus suggested transfers.
9. Download `Expense CSV` and verify one row per expense with readable split details.
10. Export `PDF` and confirm it includes total spent, member summary, suggested transfers, and expense details.

## Release checklist

1. Confirm the feature scope and update docs/screenshots if needed.
2. Run local verification for the affected flows.
3. Run `npm run build` and fix any build issues before pushing.
4. Open a PR with a clear summary of user-visible changes.
5. Merge after review/approval.
6. Verify the deployed app behavior in the real environment.
7. Smoke-test the key path again after deploy if the change affects shared/group flows.

## End-to-end test plan (recommended run order)

Use at least two user accounts: `owner_user` and `member_user`.

1. Authentication baseline
   - Sign in as `owner_user`.
   - Sign out and sign back in once to verify stable auth flow.

2. Group creation and ownership
   - Create a group.
   - Confirm creator role is `owner`.
   - Confirm group appears on home after refresh.

3. Member + expense happy path
   - Add 2-3 members.
   - Add equal split expense.
   - Add manual split expense.
   - Confirm balances and settlement suggestions update.

4. Expense edit/delete checks
   - Edit one expense (amount/date/splits).
   - Confirm updated values and recalculated balances.
   - Delete one expense.
   - Confirm history and totals are consistent.

5. Summary + export checks
   - Confirm per-member paid/share/net summary matches current expenses.
   - Download detailed CSV and verify participant split rows.
   - Download summary CSV and verify paid/share/net values.
   - Export PDF and verify it includes total spent, member summary, suggested transfers, and expense details.

6. Invitation flow
   - Create invite from `owner_user`.
   - Sign in as `member_user` and accept invite token.
   - Confirm `member_user` can view group and add expense.

7. Role controls
   - As `owner_user`, promote `member_user` to `admin`.
   - Confirm `admin` can create invites/remove users.
   - Confirm only `owner` can change roles.

8. Access revocation
   - Remove `member_user` from the group.
   - Confirm `member_user` loses access after refresh/re-login.

9. Guardrail checks
   - Verify no direct unauthorized cross-group data access.
   - Verify unclaimed seed group behavior and ownership claim flow.
   - Verify local mode still works when Supabase env vars are absent.

## Localhost testing guide (before any deployment)

This section is the default workflow for every feature branch.

### Goal

Validate all changes on localhost first, then push only after tests pass.

### Prerequisites

1. Supabase project already created.
2. Latest `supabase/schema.sql` already run in that project.
3. `.env` configured with:

```text
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

4. Node dependencies installed:

```bash
npm install
```

If you recently pulled branch updates, run `supabase/schema.sql` again before starting `npm run dev`.

### Run locally against Supabase

1. Start dev server:

```bash
npm run dev
```

2. Open `http://127.0.0.1:5173`.
3. Confirm app is in Supabase mode:
   - You should NOT see the local demo mode banner.
4. Sign in with email OTP and run the full test plan from the section above.
5. Confirm your account appears as a member in a newly created group.

## 5-minute localhost re-test script

Use this quick run after pulling branch changes.

1. In Supabase SQL Editor, run:
   - `supabase/schema.sql`
2. Start local app:
   - `npm run dev`
3. Open `http://127.0.0.1:5173`.
4. Sign in via email OTP.
5. Create a new group and verify:
   - group opens without error
   - you appear under `Members`
   - `Paid by` dropdown is populated
6. Add one expense and verify balances update.
7. Edit that expense and confirm totals rebalance.
8. Delete that expense and confirm history/totals update.

If anything looks wrong, run `supabase/debug_checks.sql` and inspect the result sets.

### Optional local demo mode check

To verify fallback behavior:

1. Temporarily remove/rename Supabase vars in `.env`.
2. Restart `npm run dev`.
3. Confirm local demo banner appears and core local flows still work.

## SQL utilities for local debugging

These helper SQL files are included in `supabase/`:

1. `debug_checks.sql`
   - Read-only diagnostics for table existence, counts, membership/member consistency, and split validation.
2. `reset_app.sql`
   - Full Trip Splitter app reset for Supabase project (drops app tables/functions/triggers).
   - Does not remove Supabase auth users.
   - Run only in a development/test Supabase project.
   - After reset, always run:
     1. `schema.sql`
     2. optional `seed.sql`

## Branch-to-release workflow

Use this as the default delivery sequence:

1. Create/switch to feature branch.
2. Implement code + SQL changes.
3. Re-run latest `supabase/schema.sql` on the target Supabase test project.
4. Run local validation on localhost (full E2E checklist).
5. If tests pass:
   - commit changes
   - push branch to GitHub
6. Open PR and review.
7. Merge to `master` only after approval and passing checks.
8. Apply SQL migration to production Supabase (if not already applied to prod).
9. Confirm production deployment state on Vercel.

## Are changes live immediately after push?

Short answer: not always.

### Supabase

- SQL/function/RLS changes are live only in the Supabase project where you executed `schema.sql` (or migration SQL).
- Pushing code to GitHub does NOT automatically change Supabase schema.

### Vercel

- If Git integration is enabled, pushing to branches may trigger Preview deploys.
- Production usually updates when code is merged/pushed to the production branch configured in Vercel (commonly `master`).
- So "push to feature branch" is usually preview/testing, not production-live.

## Recommended release safety checks

Before merge:

1. Localhost E2E checklist passed.
2. Build succeeds locally (`npm run build`).
3. SQL migration reviewed for RLS and role safety.

After merge/deploy:

1. Sign in on live URL.
2. Validate one invite flow.
3. Validate one expense edit and one delete flow.
4. Confirm no cross-group visibility issues.

## Troubleshooting local signup/login errors

If you sign in and see:

`Could not find the table 'public.trip_memberships' in the schema cache`

this usually means your Supabase project does not yet have the latest schema required by this branch.

### What happened in plain language

- Email OTP signup/signin worked correctly.
- After redirect back to localhost, the app tried reading new access tables.
- Your connected Supabase database does not currently expose `trip_memberships` to the API.

### Fix steps (safe for first-time users)

1. Open your Supabase project dashboard.
2. Go to SQL Editor.
3. Open this repo file locally: `supabase/schema.sql`.
4. Copy full file contents and run it in SQL Editor.
5. Wait 5-10 seconds and refresh localhost.
6. Sign in again.

### If error still appears

Run this in SQL Editor once:

```sql
NOTIFY pgrst, 'reload schema';
```

Then wait a few seconds and refresh localhost again.

### Quick verification query

To confirm schema is applied:

```sql
select to_regclass('public.trip_memberships') as trip_memberships_table;
```

Expected result should include `public.trip_memberships` (not `null`).

### If you see: `stack depth limit exceeded`

This is typically caused by an RLS recursion loop in an older schema version.

Fix:

1. Re-run the latest `supabase/schema.sql` from this repo (it includes recursion-safe helper functions).
2. Refresh localhost.
3. Try creating the group again.

### If you see: `column user_profiles.display_name does not exist`

Your project has older schema objects while app code expects newer profile fields.

Fix steps:

1. Re-run latest `supabase/schema.sql`.
2. Run:

```sql
NOTIFY pgrst, 'reload schema';
```

3. Refresh localhost and retry.

### If you see: `new row violates row-level security policy for table "user_profiles"`

This means your `user_profiles` RLS insert/update policy is not active in the connected project.

Fix steps:

1. Re-run latest `supabase/schema.sql`.
2. Run:

```sql
NOTIFY pgrst, 'reload schema';
```

3. Refresh localhost and retry.

Quick policy verification:

```sql
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'user_profiles'
order by policyname;
```

You should see insert/update policies for authenticated users on own profile rows.

If you only see the SELECT policy, your schema update was only partially applied.
Run this idempotent repair block:

```sql
alter table public.user_profiles enable row level security;

drop policy if exists "users can read own and group profiles" on public.user_profiles;
drop policy if exists "users can insert own profile" on public.user_profiles;
drop policy if exists "users can update own profile" on public.user_profiles;

create policy "users can read own and group profiles"
on public.user_profiles
for select
to authenticated
using (can_view_user_profile(user_id));

create policy "users can insert own profile"
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can update own profile"
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
```

### If free-tier limits are reached

Typical symptoms:

- OTP emails are delayed/throttled
- Data API calls intermittently fail during high usage windows
- Deploy/build quotas are exhausted

Immediate actions:

1. Pause repeated OTP attempts; reuse active signed-in sessions for testing.
2. Run tests in smaller batches (avoid parallel invite/login stress loops).
3. Delay non-critical deploys until quota windows reset.

If limits are repeatedly hit:

1. Configure custom SMTP for auth email volume control.
2. Move from free-tier to paid tier for predictable throughput.
3. Keep this project’s RLS + RPC model unchanged when upgrading, only scale infra.

## Developer notes

- Current branch introduces a secure default for Supabase mode.
- Local mode remains available for quick demo/testing without backend configuration.
