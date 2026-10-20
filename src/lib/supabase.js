/**
 * Supabase client setup and local/Supabase mode detection.
 *
 * `App.jsx` derives `isLocalMode` as `!hasSupabaseConfig` (see
 * `lib/localStore.js` for what local mode means) - this file is the
 * single source of truth for that decision, so checking configuration
 * in exactly one place instead of scattering `import.meta.env` reads
 * through the rest of the app.
 *
 * Only the `anon`/`public` key belongs here. The `service_role` key
 * must never be imported into frontend code - it bypasses Row Level
 * Security entirely.
 */

import { createClient } from '@supabase/supabase-js';

/** Read at build time by Vite from `VITE_SUPABASE_URL` in `.env` (or the host's environment variables). `undefined` if not set. */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
/** Read at build time from `VITE_SUPABASE_ANON_KEY`. This is the public `anon` key, safe to ship to the browser - it has no access beyond what RLS policies grant it. `undefined` if not set. */
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Whether the app has real Supabase credentials and should run in
 * Supabase mode, as opposed to local demo mode
 * (`lib/localStore.js`, browser-only storage).
 *
 * `false` when either variable is missing, **or** when either still
 * holds the literal placeholder value from the example `.env`
 * (`your-project-ref` / `your-anon-key`) - this is what makes an
 * un-configured checkout fall back to local mode automatically
 * instead of throwing on startup.
 *
 * @type {boolean}
 */
export const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project-ref') &&
  supabaseAnonKey !== 'your-anon-key'
);

/**
 * The Supabase client, or `null` in local demo mode.
 *
 * Every Supabase call site in the app is already guarded by
 * `isLocalMode` checks in `App.jsx` before `supabase` is touched, so
 * `supabase` is never actually invoked while `null` - but it is not
 * itself null-checked at the call sites, so a new code path that
 * calls `supabase.*` without first checking `isLocalMode` /
 * `hasSupabaseConfig` will throw at runtime rather than fail
 * gracefully.
 *
 * @type {import('@supabase/supabase-js').SupabaseClient|null}
 */
export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;