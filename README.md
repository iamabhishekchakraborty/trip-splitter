# Trip Splitter

A lightweight React + Supabase expense splitting MVP for small trusted trip groups.

## What is included

- React frontend built with Vite
- Supabase Postgres schema and policies
- Multiple trip groups with separate members and expenses
- Home screen with group tiles and per-group totals
- Equal and manual expense splitting
- Per-expense participant selection for full-group or subset splits
- Logged timestamps for expense history
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
- Add an expense into `expenses`; each row keeps a `created_at` timestamp
- Insert split rows into `expense_splits`
- Recompute balances and settlement suggestions in the UI

## Hosting

### Supabase

1. Create a free project at [Supabase](https://supabase.com/pricing).
2. Run the SQL from `supabase/schema.sql` in the SQL Editor.
3. Keep the project URL and anon key ready for the frontend.

### Frontend on Vercel

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. Set framework preset to Vite.
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Build command: `npm run build`
6. Output directory: `dist`

### Frontend on Netlify

1. Push to GitHub.
2. Import the repo into Netlify.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add the same two environment variables.

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
