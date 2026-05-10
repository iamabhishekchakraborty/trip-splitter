# Trip Splitter

A lightweight React + Supabase expense splitting MVP for small trusted trip groups.

## What is included

- React frontend built with Vite
- Supabase Postgres schema and policies
- Multiple trip groups with separate members and expenses
- Home screen with group tiles and per-group totals
- Equal and manual expense splitting
- Per-expense participant selection for full-group or subset splits
- Backdated expense dates plus logged timestamps for audit history
- Live balance calculation in the frontend
- Settlement simplification suggestions
- Mobile-friendly single-page UI

## Local setup

For a first local run, you can start without Supabase. The app will use browser-local demo data until real Supabase values are added to `.env`.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/schema.sql`.
3. In Supabase, go to Project Settings > API and copy:
   - Project URL
   - anon public key
4. Copy `.env.example` to `.env` and fill the values.
5. Run:

```bash
npm install
npm run dev
```

## How the app works

### Tables

- `trips`: one row per trip or expense group
- `members`: people in one trip group; names are unique within a trip
- `expenses`: one row per expense
- `expense_splits`: one row per member share per expense

### Frontend flow

- Fetch trip group summaries for the home screen
- Create or select a trip group
- Open a group workspace for members, expenses, balances, settlements, and history
- Add members directly into `members` for the active trip
- Add an expense into `expenses`; each row keeps an editable `expense_date` and automatic `created_at` timestamp
- Insert split rows into `expense_splits`
- Recompute balances and settlement suggestions in the UI

## Deployment guide

This app has two parts:

- **Frontend**: the website that users open in a browser.
- **Database**: Supabase stores trips, members, expenses, and split rows so everyone sees the same shared data.

For a real deployment that end users can use together, deploy both parts. If the frontend is deployed without Supabase environment variables, the app still opens, but it runs in browser-local demo mode. In demo mode, data stays only in each user's browser and is not shared.

### 1. Prepare the GitHub repo

The project should be pushed to GitHub before deploying. The deployment service will read the code from GitHub.

Current repo:

```text
https://github.com/iamabhishekchakraborty/trip-splitter
```

Before deploying, make sure the latest code is pushed:

```bash
git status
git push
```

### 2. Create the Supabase database

1. Go to [Supabase](https://supabase.com).
2. Sign in or create an account.
3. Create a new project.
4. Choose a project name, database password, and region.
5. Wait for Supabase to finish provisioning the project.

After the project is ready:

1. Open the project dashboard.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` from this repo.
4. Copy the full SQL file.
5. Paste it into the Supabase SQL Editor.
6. Run the SQL.

This creates the required tables:

- `trips`
- `members`
- `expenses`
- `expense_splits`

It also creates the first sample groups:

- `Goa2026`
- `Darjeeling2026`

### 3. Get Supabase connection values

In Supabase:

1. Go to **Project Settings**.
2. Open **API**.
3. Copy these two values:
   - Project URL
   - anon public key

They will be used as frontend environment variables:

```text
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Do not use the Supabase service role key in the frontend. Only use the anon public key.

### 4. Deploy frontend on Vercel

Vercel is the simplest recommended option for this Vite app.

1. Go to [Vercel](https://vercel.com).
2. Sign in with GitHub.
3. Choose **Add New Project**.
4. Import `iamabhishekchakraborty/trip-splitter`.
5. Vercel should detect the project as a Vite app.
6. Confirm these settings:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
7. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
8. Click **Deploy**.

After deployment, Vercel will provide a public URL. That URL is what end users can open.

### 5. Deploy frontend on Netlify

Netlify is also supported.

1. Go to [Netlify](https://www.netlify.com).
2. Sign in with GitHub.
3. Choose **Add new site**.
4. Import `iamabhishekchakraborty/trip-splitter`.
5. Set:
   - Build command: `npm run build`
   - Publish directory: `dist`
6. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Deploy the site.

### 6. Verify the live app

After the frontend deploys:

1. Open the live site URL.
2. Confirm the local demo banner is not shown.
3. Confirm the home screen shows trip groups.
4. Create a new trip group.
5. Open the group.
6. Add members.
7. Add an expense with today's date.
8. Add another expense with a backdated expense date.
9. Check that:
   - balances update,
   - settlement suggestions update,
   - expense history shows both expense date and logged timestamp,
   - refreshing the page keeps the data.

If data disappears after refresh, the app is probably running without Supabase env vars and is using browser-local demo mode.

### 7. Sharing with end users

Once deployed with Supabase configured, users only need the live website URL. They do not need to install anything.

Current MVP behavior:

- Anyone with the URL can see and add trips, members, and expenses.
- There is no login yet.
- Use it only for a small trusted group until authentication is added.

Recommended before using with a wider audience:

- Add authentication or a group PIN.
- Restrict database access per group/user.
- Add edit/delete support for mistakes.
- Add export or backup options.

## Production notes

- This MVP intentionally skips auth for speed.
- Because it uses public insert/select policies, use it only for a trusted small group demo.
- The next hardening step is group-based auth plus row-level access control.
- You can later move balance logic into a Supabase Edge Function if you want server-side validation.

## Recommended next enhancements

1. Edit and delete expense.
2. Add PIN or auth.
3. Add settlement marking.
4. Add export to CSV.
