# Trip Splitter

Trip Splitter is a React + Supabase web app for splitting shared trip expenses. Create a group, invite friends, log who paid what (equal or custom splits), watch balances update, record settlement payments, and export reports. It is designed to run entirely on free tiers (Vercel Hobby + Supabase Free) and can be installed on a phone or desktop as a Progressive Web App.

## Contents

- [Features](#features)
- [Tech stack and architecture](#tech-stack-and-architecture)
- [Quick start](#quick-start)
- [Supabase setup](#supabase-setup)
- [Using the app](#using-the-app)
- [Roles and permissions](#roles-and-permissions)
- [Auth and security model](#auth-and-security-model)
- [Database reference](#database-reference)
- [Progressive Web App (PWA)](#progressive-web-app-pwa)
- [Deployment](#deployment)
- [Free tier operations and guardrails](#free-tier-operations-and-guardrails)
- [Testing](#testing)
- [Release workflow](#release-workflow)
- [SQL utilities](#sql-utilities)
- [Troubleshooting](#troubleshooting)
- [Known limitations and ideas](#known-limitations-and-ideas)
- [Developer notes](#developer-notes)

## Features

**Groups and access**

- Multiple trip groups, each with its own members, expenses and balances
- Email magic-link sign-in (no passwords)
- Group-level data isolation enforced by Postgres Row Level Security (RLS)
- Roles (`owner`, `admin`, `member`) with role management and user removal
- Single-use, expiring invitation links, shareable by copy or WhatsApp, with an optional email restriction
- Archive finished trips and restore them later
- Legacy/unowned trips can be claimed once by a signed-in user

**Expenses**

- Equal or manual (custom) splits, with per-expense participant selection
- Backdated expense dates plus logged/updated timestamps for an audit trail
- Edit and delete, restricted to the expense creator or a group admin/owner
- A member record is created automatically for every user who creates, claims or joins a group, so the expense form works immediately; display names are editable

**Settling up**

- Per-member summary of paid, share and net position
- Suggested transfers that settle the group in as few payments as possible
- "Mark as settled" records a transfer as a settlement entry so balances update

**Reports**

- Settlement CSV, Expense CSV, and a PDF report generated in the browser and downloaded directly (no print dialog or popup)

**Platform**

- Local demo mode (browser storage) when Supabase is not configured
- Installable PWA with an offline-capable app shell
- Free-tier friendly: static frontend, direct Supabase calls, no servers or cron jobs

## Tech stack and architecture

| Layer | Choice |
| --- | --- |
| UI | React 18 + Vite 7 (JavaScript/JSX, plain CSS, no router or state library) |
| Backend | Supabase: Postgres, Auth (email magic link), PostgREST, Row Level Security |
| PDF export | `jspdf` + `html2canvas`, lazy-loaded only when the PDF button is used |
| Hosting | Vercel Hobby (static build) |
| Auth email | Supabase built-in sender, or custom SMTP (for example Resend) |
| Installable / offline shell | Hand-written `manifest.json` + service worker (no PWA plugin dependency) |

```text
 Browser (React SPA, installable PWA)
        |  supabase-js (anon key + user JWT)
        v
 Supabase
   |- Auth ................ email magic links, sessions
   |- PostgREST ........... table access + RPC (Postgres functions)
   '- Postgres ............ tables, RLS policies, SECURITY DEFINER functions
```

Design principles:

- **Frontend-first.** There is no custom server. The browser talks to Supabase directly.
- **Authorization lives in the database.** RLS policies and `SECURITY DEFINER` functions decide what a user may do; frontend checks only improve the UX and are never relied on for security.
- **Multi-step writes are single RPCs.** Saving an expense and its splits, accepting an invite, or archiving a trip each happen in one database function so data stays consistent.

### Project structure

```text
.
|- index.html                  # entry HTML, PWA manifest + meta tags
|- package.json
|- vite.config.js
|- public/
|  |- manifest.json            # PWA manifest
|  |- sw.js                    # service worker (app shell only)
|  '- favicon*, apple-touch-icon.png, maskable-icon-*.png
|- src/
|  |- main.jsx                 # entry point; registers the service worker in production builds
|  |- App.jsx                  # owns all state, data loading and write handlers
|  |- styles.css
|  |- components/              # presentational components (props in, callbacks out)
|  '- lib/                     # framework-free logic (balances, exports, local store, Supabase client)
'- supabase/
   |- schema.sql               # tables, RLS, functions (safe to re-run)
   |- seed.sql                 # optional demo data
   |- debug_checks.sql         # read-only diagnostics
   '- reset_app.sql            # drops all app objects (dev/test only)
```

### Components and modules

| File | Responsibility |
| --- | --- |
| `App.jsx` | Top-level state; `loadHomeData` / `loadTripData`; every write handler (expenses, settlements, invites, roles, archive, exports) |
| `components/AuthPanel.jsx` | Magic-link sign-in form; signed-in account chip with sign-out and editable display name |
| `components/Header.jsx` | Page banner, shows demo/live mode and hosts the account slot |
| `components/HomeView.jsx` | Create group, list active groups, collapsed archived groups with restore, claim ownership |
| `components/GroupHeader.jsx` | Group title, your role, total spent, export buttons, archive, back to groups |
| `components/MembersPanel.jsx` | Member names used in expenses; add guest names |
| `components/ExpenseForm.jsx` | Add an expense (equal or manual split) |
| `components/ExpensesList.jsx` | Expense history, inline edit, delete, settlement styling |
| `components/BalancesPanel.jsx` | Member summary and suggested transfers with "Mark as settled" |
| `components/GroupAccessPanel.jsx` | Roles, user removal, invite creation, active invites (copy / WhatsApp), invite history |
| `components/InviteAcceptPanel.jsx` | Accept an invite from a pasted token or a `?invite=` link |
| `lib/balances.js` | Pure functions: per-member totals, settlement suggestions, equal splits |
| `lib/exports.js` | CSV and PDF generation |
| `lib/localStore.js` | `localStorage` persistence for local demo mode |
| `lib/supabase.js` | Supabase client creation and configuration detection |

### Local demo mode vs Supabase mode

| | Local demo mode | Supabase mode |
| --- | --- | --- |
| Enabled when | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing or still placeholders | Both are set |
| Data storage | Browser `localStorage` (key `trip-splitter:data`) | Supabase Postgres |
| Sign-in, roles, invitations, archiving | Not available | Available |
| Expenses, balances, settling up, exports | Available | Available |

## Quick start

### Prerequisites

- Node.js 20.19+ (or 22.12+) and npm - required by Vite 7
- (Supabase mode only) a free Supabase project

### Local demo mode (no backend)

Data is stored in your browser's local storage. Nothing leaves your machine.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The header says "Draft mode with browser-local data" when the app is in demo mode.

### Supabase mode

Complete the [Supabase setup](#supabase-setup) first, then create a `.env` file in the project root (copy `.env.example` if your checkout has one):

```text
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase dashboard > Project Settings > API > Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard > Project Settings > API > `anon` `public` key |

Notes:

- Both variables must be set. If either is missing, or still holds a placeholder such as `your-project-ref` / `your-anon-key`, the app silently falls back to local demo mode.
- Restart `npm run dev` after editing `.env`.
- Use only the `anon` key in the frontend. Never put the `service_role` key in frontend code.

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173. The service worker is **not** registered in dev. |
| `npm run build` | Production build into `dist/`. Run this before every push. |
| `npm run preview` | Serves the production build locally. Use it to test the PWA and service worker. |

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/schema.sql`.
3. Optionally run `supabase/seed.sql` for sample trips and members (development only).
4. Copy the Project URL and the `anon` public key from Project Settings > API into your `.env` (see [Quick start](#quick-start)).
5. Configure authentication (below).
6. Run `npm install` and `npm run dev`.

### Applying schema updates

`supabase/schema.sql` is written to be re-run safely: it uses `create ... if not exists`, `create or replace`, migration guards (`add column if not exists`) and drop-then-create for policies. **Pushing code does not change your database.** Whenever you pull changes that touch `supabase/schema.sql`, run the latest file in the SQL Editor of every Supabase project you use (test and production), then refresh the API schema cache if needed:

```sql
NOTIFY pgrst, 'reload schema';
```

### Authentication settings

In the Supabase dashboard, go to Authentication:

- **Providers**: keep Email enabled (the app signs in with email magic links).
- **URL Configuration**:
  - *Site URL*: your production URL, for example `https://your-app.vercel.app`.
  - *Redirect URLs*: add the production URL (and `https://your-app.vercel.app/**`), plus `http://localhost:5173` for local development. Add a wildcard pattern for Vercel preview URLs if you want sign-in to work on preview deployments.
- **Magic link validity** (OTP expiry) is configurable under the Auth settings; the default is about one hour. Sessions persist in the browser until the user signs out or the refresh token expires.

### Auth email delivery

- Supabase's **built-in email sender is heavily rate limited** on the Free plan (on this project the dashboard showed 2 emails per hour). Repeated sign-in attempts during testing will hit `email rate limit exceeded`.
- For anything beyond personal testing, configure **custom SMTP** (Authentication > SMTP settings), for example with Resend. Things to know:
  - To send to arbitrary recipients you must **verify a sending domain** with the provider. Resend's shared test sender (`onboarding@resend.dev`) only delivers to the account owner's own email address.
  - The *sender email* must be a complete, valid address on that verified domain. An incomplete sender (for example `name@`) makes every send fail with "Error sending magic link email".
  - Provider logs (for example Resend's Logs page) show the exact reason when a send fails.

## Using the app

### Groups and members

- Sign in with your email (Supabase mode), then create a group. The creator becomes the group `owner` and gets a member record automatically.
- **Members** are the names that appear in expense splits. Every user who creates, claims or joins a group gets one automatically (named after their display name). Owners and admins can also add *guest* names for people who don't have accounts.
- Set your display name from the account panel in the header. It is stored on your profile and applied to your member name in the current group where possible.

### Expenses

- Add an expense with a description, amount, date (backdating is allowed), who paid, and how it is split.
  - **Equal split**: choose the participants; the amount is divided evenly and any rounding remainder goes to the last participant.
  - **Manual split**: enter each participant's share; the shares must add up to the amount (within 0.01).
- Each expense records when it was logged and, if changed, when it was last updated.
- Edit and delete are available in the expense history. Only the expense creator or a group admin/owner may edit or delete. Editing updates the amount, description, date, payer and splits in one database call, and the server re-validates the split total and group membership.

### Settling up

The Balances panel shows each member's paid, share and net position, plus the **suggested transfers**: the smallest set of payments that brings everyone to zero.

- Click **Mark as settled** next to a suggestion (any group member can) and confirm.
- The app records a *settlement entry*: description `Settlement: A paid B`, dated today, paid by the debtor, with a single split assigned to the recipient for the full amount.
- A settlement is stored as an ordinary expense row with `is_settlement = true`. There is no separate settlements table, so balances, history, permissions and exports all work unchanged and no extra security surface was added.
- Settlement entries show a money-with-wings icon and a "Settlement" label in the history. They are **excluded from "Total spent" and from a group's expense count**, because a settlement moves money between members rather than spending it. They still appear in the expense history and in the exports, where they are explicitly marked (see [Exports](#exports)).
- When editing a settlement, its split type and participants are fixed and not shown as editable controls - only description, amount, date and payer can change. Editing the amount correctly updates the single recipient's share to match (no rounding drift); to change who is involved, delete the entry and record a new settlement instead.

### Exports

Use the buttons in the group header:

- **Settlement CSV**: trip total, one row per member with paid / share / net and a status (Receives / Pays / Settled), and the suggested transfers. Best for sharing how to settle up.
- **Expense CSV**: one row per expense with a `Type` column (`Expense` or `Settlement`), payer, split method, readable split details and timestamps. Best for reviewing what made up the total.
- **PDF report**: total spent, member summary, suggested transfers and the detailed expense history (settlements are labelled). It is rendered in the browser (`jspdf` + `html2canvas`) and downloaded directly as a `.pdf`, with no print dialog and no popup, so popup blockers are not an issue.

### Invitations

1. **Create**: in Group access, enter an optional email and choose the role on join (member or admin). Only owners and admins can create invites.
2. **Share**: each active invite shows a link of the form `https://<your-app>/?invite=<token>` with two actions:
   - **Copy** copies the link.
   - **Share via WhatsApp** opens WhatsApp with a ready-to-send message via the public `wa.me` link scheme. No API key, backend call or third-party account is involved; the sender presses send in WhatsApp.
3. **Join**: opening the link pre-fills the token. If the user is already signed in they join immediately. Otherwise they sign in with a magic link; the invite token is carried through the sign-in redirect and accepted automatically afterwards. A token can also be pasted into Join group > Accept invitation.

Rules:

- Invites are single-use and expire after 7 days by default.
- If an email was specified, only that account's email can accept it. Without an email, any signed-in user holding the link can.
- Used or expired invites move to a collapsed **Invite history** list.
- Only owners and admins can see invitations and their links; the database does not return them to plain members.
- Accepting an invitation never changes an existing member's role. If you are already in the group you are told so and the invitation stays unused; roles change only through the owner-only role control.
- Sharing by email or SMS is manual (copy the link). There is intentionally no automated SMS or auto-sent WhatsApp feature: that needs a paid, metered messaging API and a business verification process, which is disproportionate for a peer-to-peer trip splitter.

### Archiving trips

- Owners and admins can **Archive trip** (group header) once a trip is settled. This sets `trips.archived_at` and hides the group from the main list.
- Nothing is deleted. Archived groups appear under a collapsed **Show archived groups (N)** toggle on the home screen, where they can be opened or **restored**.
- Archiving is purely a visibility flag; it does not free database space or change any data. It is available in Supabase mode only.

## Roles and permissions

| Capability | member | admin | owner |
| --- | :---: | :---: | :---: |
| View group data (expenses, balances, members) | Yes | Yes | Yes |
| Add expenses and mark transfers as settled | Yes | Yes | Yes |
| Edit / delete **own** expenses | Yes | Yes | Yes |
| Edit / delete **anyone's** expenses | No | Yes | Yes |
| Add guest member names (UI-restricted to admin/owner) | No | Yes | Yes |
| Create invitations | No | Yes | Yes |
| See invitations and invite links | No | Yes | Yes |
| Remove users from the group | No | Yes | Yes |
| Change user roles | No | No | Yes |
| Archive / restore the group | No | Yes | Yes |

Safeguards:

- The last owner of a group can never be removed or demoted. This is enforced by the database; the UI also disables the role dropdown for a sole owner.
- Users cannot change their own role or remove themselves from the Group access panel.
- Role changes and removals ask for confirmation. Promoting someone to `owner` shows a stronger warning.
- Removing a user revokes their access to the group. Their member record (the name used in past expenses) is kept so history and balances stay intact.
- Anyone signed in can claim a legacy "unowned" group once; after that, only group users have access.

## Auth and security model

### Authentication

- Supabase mode requires sign-in via email OTP (magic link).
- The app uses `supabase.auth.signInWithOtp` and `signOut`.
- Sessions are stored and refreshed by `supabase-js` in the browser, so users stay signed in until they sign out or the refresh token expires.
- When sign-in is requested from an invite link, the `?invite=` token is carried through the magic-link redirect so the invite is accepted automatically after sign-in.
- Magic-link emails are subject to Supabase's email limits; see [Auth email delivery](#auth-email-delivery).

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
- Tokens are single-use and expire (7 days by default). Expiry, reuse, revocation and the email restriction are all checked server-side in `accept_trip_invitation`.
- A token grants access to the group, so only owners/admins can read invitations at all, and accepting one never alters an existing member's role.

### Legacy/unowned trips

- Trips inserted before memberships exist (or from `seed.sql`) are "unowned".
- Any authenticated user can claim ownership once.
- Anyone signed in can read an unowned trip, but merely viewing it does not add you as a member; claiming it does (it makes you the owner and creates your member record).
- After claim, only group members retain access.

## Database reference

All objects live in the `public` schema and are created by `supabase/schema.sql`.

### Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `trips` | A trip group | `id`, `name` (globally unique), `created_by`, `archived_at` (non-null = archived), `created_at` |
| `members` | Names used in expense splits (guests and group users) | `id`, `trip_id`, `user_id` (null for guests), `name` (unique per trip), `created_at` |
| `expenses` | One row per expense or settlement | `id`, `trip_id`, `description`, `amount` (> 0), `paid_by` (member), `split_type` (`equal`/`manual`), `expense_date`, `is_settlement`, `created_by`/`updated_by`, `created_at`/`updated_at` |
| `expense_splits` | Each member's share of an expense | `expense_id`, `member_id`, `share_amount` (>= 0); unique per expense + member |
| `trip_memberships` | Which authenticated users belong to which trip, and their role | `trip_id`, `user_id`, `role` (`owner`/`admin`/`member`), `invited_by`; unique per trip + user |
| `trip_invitations` | Invite tokens | `trip_id`, `token` (unique), `invited_email`, `role` (`admin`/`member`), `expires_at`, `accepted_at`/`accepted_by`, `revoked_at` |
| `user_profiles` | Safe mirror of `auth.users` for showing names/emails to group users | `user_id`, `email`, `display_name` |

`members` (names in expenses) and `trip_memberships` (who can log in and see the group) are deliberately separate: a guest can appear in expenses without an account, and removing a user from a group does not erase their name from past expenses.

### Functions

Application RPCs (called by the frontend):

| Function | What it does | Who can call it |
| --- | --- | --- |
| `create_trip_with_owner(trip_name)` | Creates a trip, makes the caller `owner`, creates their member record | Signed-in user |
| `claim_unowned_trip(p_trip_id)` | Claims a legacy trip that has no members yet | Signed-in user, once |
| `set_trip_archived(p_trip_id, p_archived)` | Archives or restores a trip | Admin / owner |
| `create_trip_invitation(p_trip_id, p_invited_email, p_role, p_expiry_hours)` | Creates an invite token (default 168 hours). Uses `gen_random_bytes`, so its `search_path` includes `extensions` | Admin / owner |
| `accept_trip_invitation(p_token)` | Validates the token, adds the user to the trip and creates their member record. Refuses if the caller is already a member, leaving the invitation unused and their role unchanged | Signed-in user |
| `remove_trip_member(p_trip_id, p_user_id)` | Removes a user's access; refuses to remove the last owner | Admin / owner |
| `update_trip_member_role(p_trip_id, p_user_id, p_role)` | Changes a role; refuses to demote the last owner | Owner |
| `save_expense_with_splits(...)` | Creates or edits an expense and its splits in one call; validates membership and that splits sum to the amount; accepts `p_is_settlement` | Group member (edit: creator or admin/owner) |
| `delete_expense_with_permission(p_expense_id)` | Deletes an expense | Creator or admin / owner |
| `update_my_display_name(p_display_name)` | Updates the caller's profile name (validated, max 80 chars) | Signed-in user |
| `ensure_trip_member_record(p_trip_id, p_user_id)` | Creates the caller's `members` row for a trip if missing. Refuses any user id other than the caller's, and any trip the caller is not already a member of | Signed-in trip member (for themselves only) |
| `preferred_display_name(target_user_id)` | Resolves the best available display name for a user | Internal helper |

Internal helpers and triggers:

- `is_trip_member`, `is_trip_admin`, `is_trip_owner`, `is_trip_unowned`, `can_view_user_profile`: `SECURITY DEFINER` helpers used by RLS policies. They avoid the recursive-policy `stack depth limit exceeded` error.
- `sync_user_profile` + trigger `on_auth_user_synced` on `auth.users`: keeps `user_profiles` in sync with signed-up users.

> **Changing a function's parameters?** In Postgres, `create or replace function` with a different argument list creates an *overload*; it does not replace the old function. Add a `drop function if exists <old signature>` first (see how `save_expense_with_splits` is handled in `schema.sql`) and add the new signature to `reset_app.sql`.

### Row Level Security

RLS is enabled on every table; all policies apply to the `authenticated` role.

| Table | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `trips` | Member, or trip is unowned | Blocked (use `create_trip_with_owner`) | None (use `set_trip_archived`) | None |
| `members` | Member, or trip is unowned | Member | Own row only (`user_id = auth.uid()`) | Admin / owner |
| `expenses` | Member, or trip is unowned | Member | Creator or admin / owner | Creator or admin / owner |
| `expense_splits` | Via parent expense | Via parent expense (member) | Via parent expense (creator or admin / owner) | Via parent expense (creator or admin / owner) |
| `trip_memberships` | Member | Admin / owner | Owner | Admin / owner |
| `trip_invitations` | Admin / owner | Admin / owner | Admin / owner | None |
| `user_profiles` | Self, or someone who shares a group with you | Own row | Own row | None |

## Progressive Web App (PWA)

The app is installable: on Android/Chrome and desktop Chrome/Edge use the install prompt or menu, on iOS Safari use Share > Add to Home Screen.

How it is built:

- `public/manifest.json` provides the name, theme colours, `display: standalone` and icons. Both regular and **maskable** icons are included (`public/maskable-icon-*.png`, artwork padded inside the safe zone) so the launcher icon is not clipped by circular or squircle masks.
- `public/sw.js` is a small hand-written service worker. It precaches the static app shell (HTML and icons) and serves same-origin `GET` requests network-first, falling back to the cache when offline. Cross-origin requests (Supabase API and auth calls) and every non-`GET` request are passed straight through, so the service worker can never cache or interfere with live data.
- `src/main.jsx` registers the worker **only in production builds**, so it cannot interfere with the Vite dev server.
- No PWA plugin is used, which avoids an extra dependency and Vite peer-dependency conflicts.

What works offline today:

- The app shell loads without a network connection.
- Trip data is fetched live from Supabase and is **not** cached, so after a reload with no connection you see the app but not your trips.
- Writes (adding an expense, settling, and so on) require a connection. An offline write queue is a possible future enhancement (see [Known limitations and ideas](#known-limitations-and-ideas)).

Maintenance notes:

- Service workers only run in production builds. To test: `npm run build && npm run preview`, then check DevTools > Application > Service Workers, and try the Network > Offline toggle.
- If you change the list of precached files (`APP_SHELL` in `public/sw.js`), bump `CACHE_VERSION` so old caches are removed on activation.

## Deployment

For end users, deploy both:

- The frontend (Vercel, Netlify or any static host)
- A Supabase project with `supabase/schema.sql` applied

### Vercel

1. Import the repository; the Vite framework preset works with the defaults (`npm run build`, output `dist`).
2. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production** and **Preview**. Variables are baked in at build time, so **redeploy after changing them**.
3. In Supabase > Authentication > URL Configuration, set the Site URL and Redirect URLs to your deployed URL (see [Supabase setup](#authentication-settings)).
4. Merging to the production branch deploys to production; other branches get preview deployments.
5. Optional: attach a custom domain in Vercel and add it to the Supabase Site/Redirect URLs.

### Things to remember

- Ensure Supabase Auth allows email sign-in.
- Never expose service role keys in frontend code.
- **Keep Vite on 7.x.** `@vitejs/plugin-react` 4.x declares peer support up to Vite 7. Installing Vite 8 makes `npm install` fail on Vercel with an `ERESOLVE` error. Upgrade Vite and the React plugin together, in a separate change.
- `npm audit` currently reports `esbuild` advisories that are only fixable by moving to Vite 8. They affect the dev server/build tooling, not the code shipped to browsers; revisit them when upgrading Vite.
- A free-tier Supabase project can be paused after a period of inactivity. If the app suddenly fails with network errors, check the project status in the dashboard and restore it.

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
   - Custom SMTP providers still need a verified sending domain to reach arbitrary recipients (see [Auth email delivery](#auth-email-delivery)).

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

## Testing

Validate every change on localhost first, then push. Use at least two accounts (an owner and a member) for the full plan.

### Localhost testing guide

This section is the default workflow for every feature branch.

#### Goal

Validate all changes on localhost first, then push only after tests pass.

#### Prerequisites

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

#### Run locally against Supabase

1. Start dev server:

```bash
npm run dev
```

2. Open `http://127.0.0.1:5173`.
3. Confirm app is in Supabase mode:
   - You should NOT see the local demo mode banner.
4. Sign in with email OTP and run the full test plan from the section above.
5. Confirm your account appears as a member in a newly created group.

### 5-minute localhost re-test

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

#### Optional local demo mode check

To verify fallback behavior:

1. Temporarily remove/rename Supabase vars in `.env`.
2. Restart `npm run dev`.
3. Confirm local demo banner appears and core local flows still work.

### End-to-end test plan

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

10. Settling up
   - With non-zero balances, click `Mark as settled` on a suggested transfer and confirm.
   - Confirm a settlement entry appears in the history, that transfer disappears from the suggestions, and `Total spent` does not change.
   - Edit the settlement's date and confirm it saves.

11. Invitation links and sharing
   - Create an invite, use `Copy` and `Share via WhatsApp`, and confirm the link looks like `<app-url>/?invite=<token>`.
   - Open the link in a private window while signed out, sign in with a magic link, and confirm you join the group automatically.
   - Open the same link again and confirm you see the "already used" message instead of an error banner.

12. Archiving
   - As owner/admin, archive the group and confirm it leaves the main list.
   - Open `Show archived groups`, open the group, then restore it.

13. PWA (production build only)
   - Run `npm run build && npm run preview` and confirm the service worker registers (DevTools > Application).
   - Toggle DevTools > Network > Offline and reload; the app shell should still load.

## Release workflow

### Branch-to-release workflow

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

### Are changes live immediately after push?

Short answer: not always.

#### Supabase

- SQL/function/RLS changes are live only in the Supabase project where you executed `schema.sql` (or migration SQL).
- Pushing code to GitHub does NOT automatically change Supabase schema.

#### Vercel

- If Git integration is enabled, pushing to branches may trigger Preview deploys.
- Production usually updates when code is merged/pushed to the production branch configured in Vercel (commonly `master`).
- So "push to feature branch" is usually preview/testing, not production-live.

### Recommended release safety checks

Before merge:

1. Localhost E2E checklist passed.
2. Build succeeds locally (`npm run build`).
3. SQL migration reviewed for RLS and role safety.

After merge/deploy:

1. Sign in on live URL.
2. Validate one invite flow.
3. Validate one expense edit and one delete flow.
4. Confirm no cross-group visibility issues.

### Release checklist

1. Confirm the feature scope and update docs/screenshots if needed.
2. Run local verification for the affected flows.
3. Run `npm run build` and fix any build issues before pushing.
4. Open a PR with a clear summary of user-visible changes.
5. Merge after review/approval.
6. Verify the deployed app behavior in the real environment.
7. Smoke-test the key path again after deploy if the change affects shared/group flows.
8. If the list of precached files changed, bump `CACHE_VERSION` in `public/sw.js`.

## SQL utilities

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
3. `seed.sql`
   - Optional demo trips and members for development. Seeded trips are "unowned" until a signed-in user claims them.
   - Never run it against a production project.

## Troubleshooting

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

### If you see: `Could not find the function public.<name>(...) in the schema cache` (PGRST202)

The function does not exist in the connected project, or its parameter names differ from what the app sends. This is schema drift: the code is newer than the database.

1. Re-run the latest `supabase/schema.sql`.
2. Run `NOTIFY pgrst, 'reload schema';` and retry.
3. To list what exists: `select routine_name from information_schema.routines where routine_schema = 'public' order by 1;`

### If you see: `Could not find the '<column>' column of '<table>' in the schema cache` (PGRST204)

Same cause as above for a missing column (for example `members.user_id`, `expenses.is_settlement`, `trips.archived_at`). Re-run `supabase/schema.sql`; its migration guards use `add column if not exists`.

### If you see: `function gen_random_bytes(integer) does not exist`

On Supabase the `pgcrypto` extension lives in the `extensions` schema. `create_trip_invitation` therefore declares `set search_path = public, extensions`. Re-run the latest `supabase/schema.sql` to pick that up.

### If you see: `column reference "expense_id" is ambiguous`

This came from an older `save_expense_with_splits` that used a local variable named `expense_id`. The current version uses `v_expense_id`. Re-run `supabase/schema.sql`.

### If you see: `Could not choose the best candidate function` (PGRST203) for `save_expense_with_splits`

The database has two overloads of the function (the old 8-parameter one and the current one with `p_is_settlement`). Remove the old one; the latest `schema.sql` does this for you, or run once:

```sql
drop function if exists public.save_expense_with_splits(uuid, text, numeric, uuid, text, date, jsonb, uuid);
NOTIFY pgrst, 'reload schema';
```

### If you see: `email rate limit exceeded` or `Error sending magic link email`

- `email rate limit exceeded`: Supabase's built-in email sender is limited (check Authentication > Rate Limits). Wait for the window to reset, reuse an existing session, or configure custom SMTP.
- `Error sending magic link email` after configuring custom SMTP: check the SMTP provider's logs. Typical causes are an incomplete sender address, a sender on an unverified domain, or a test sender that can only deliver to the account owner. See [Auth email delivery](#auth-email-delivery).

### If you see: `TypeError: Failed to fetch`, `403` on `/auth/v1/user`, or `ERR_CONNECTION_*`

1. If the browser says `ERR_CONNECTION_REFUSED` for `localhost:5173`, the dev server is not running (`npm run dev`).
2. Check `.env` (or the Vercel environment variables): correct project URL, no trailing slash, `anon` key, and a restart/redeploy after editing.
3. Check that the Supabase project is not paused (free-tier projects can pause after inactivity).
4. Make sure your site URL is in Supabase > Authentication > URL Configuration.

### If you see: `You are already a member of that group`

You opened an invitation link while signed in to an account that is already in the group (for example an owner testing their own link). Nothing was changed and the invitation was not used; open the group from your list.

### If you see: `Invitation already used`

Invite tokens are single-use. If you already joined, open the group from your list. Otherwise ask an owner/admin to create a new invite.

### If a Vercel build fails with `ERESOLVE` (Vite vs `@vitejs/plugin-react`)

`@vitejs/plugin-react` 4.x does not support Vite 8 yet. Keep `vite` on `^7` in `package.json` and commit the matching `package-lock.json`.

## Known limitations and ideas

Known limitations:

- **Single currency display.** Amounts are shown as `INR`; there is no multi-currency support.
- **Trip names are globally unique.** The `trips.name` column is unique across all users, so two different people cannot both create a group called "Goa2026".
- **Guest members cannot be deleted from the UI.** They can be added, and removing a *user* revokes access while keeping their member record. Cleaning up a mistaken guest name currently needs SQL.
- **Invites cannot be revoked from the UI.** The `revoked_at` column and the server check exist; set it via SQL if needed. Revoked invites are hidden.
- **Settlements in exports.** Settlement entries are kept in the exports (they are real payments, and the per-member paid/share/net figures depend on them) but are excluded from the total spent. In the Expense CSV a `Type` column reads `Settlement` or `Expense`, so you can filter them in a spreadsheet; in the PDF they carry the same icon and "Settlement" label as in the app.
- **No offline data or offline writes.** See [Progressive Web App (PWA)](#progressive-web-app-pwa).
- **Auth email limits.** The built-in sender is very limited; see [Auth email delivery](#auth-email-delivery).

Ideas under consideration (none are committed work):

- Verify a sending domain and configure custom SMTP so any friend can sign in
- Delete guest members from the UI (blocked when referenced by expenses)
- Offline write queue for a single designated "expense keeper" per group, replayed through the existing RPCs on reconnect
- Receipt photo uploads (the main feature that would pressure the free-tier storage quota)
- Custom Supabase email templates and a mobile layout audit

## Developer notes

- **Data flow.** `App.jsx` is the only module that talks to Supabase or local storage. Components are presentational: they receive data and callbacks as props. Business logic that doesn't need React lives in `src/lib/`.
- **Authorization is a database concern.** Add RLS and `SECURITY DEFINER` functions for anything new; use frontend checks only for UX.
- **Schema changes.** Keep `supabase/schema.sql` idempotent, update `reset_app.sql` and this README, and remember the function-overload gotcha described in [Database reference](#database-reference).
- **Local mode.** New user-facing flows should degrade safely in local demo mode where practical, or be clearly gated as Supabase-only.
- **Service worker.** Bump `CACHE_VERSION` in `public/sw.js` when changing the precached file list.
- **Before pushing.** Run `npm run build`; it is also what Vercel runs.