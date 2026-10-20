/**
 * Application root - and the app's single "controller".
 *
 * `App` owns every piece of application state, loads all data (from
 * Supabase, or from `lib/localStore.js` in local demo mode), exposes
 * every write as a `handle*` function, and derives the numbers the UI
 * shows (member summary, suggested transfers, total spent). Everything
 * in `components/` is presentational: it receives data and callbacks as
 * props. This is the only file that imports a data source (`lib/supabase.js`
 * or `lib/localStore.js`).
 *
 * Layout of this file, roughly top to bottom:
 * 1. Module-level helpers that turn raw Supabase/PostgREST errors into
 *    actionable messages (`getFriendlyErrorMessage` and friends).
 * 2. State, mode/permission flags, and data loading (`loadHomeData`,
 *    `loadCurrentProfile`, `loadTripData`).
 * 3. Effects that bootstrap the auth session and initial data.
 * 4. `handle*` functions, grouped by feature: auth and profile,
 *    groups/invitations/roles, expenses and settlements, exports.
 * 5. Derived values (member summary, settlements, total spent) and the
 *    rendered tree: `HomeView` when no trip is open, otherwise the
 *    group view.
 *
 * Two modes, decided once by `hasSupabaseConfig` in `lib/supabase.js`:
 * - Local demo mode (`isLocalMode`): data lives in browser storage via
 *   `lib/localStore.js`. There is no sign-in, roles, invitations or
 *   archiving, and every capability flag below is simply true.
 * - Supabase mode: data, auth and permissions come from Supabase.
 *
 * Handlers report failures with `setError(...)` and successes with
 * `setInfo(...)`; both render as banners above the content. Handlers
 * generally catch and report their own errors rather than throwing to
 * the caller.
 *
 * Authorization is enforced by the database (RLS policies and RPC
 * checks). The role flags in this file only decide what the UI offers.
 */

import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import AuthPanel from './components/AuthPanel';
import HomeView from './components/HomeView';
import InviteAcceptPanel from './components/InviteAcceptPanel';
import GroupHeader from './components/GroupHeader';
import MembersPanel from './components/MembersPanel';
import ExpenseForm from './components/ExpenseForm';
import BalancesPanel from './components/BalancesPanel';
import ExpensesList from './components/ExpensesList';
import GroupAccessPanel from './components/GroupAccessPanel';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import { computeMemberSummary, simplifySettlements } from './lib/balances';
import { downloadExpensesCsv, downloadSummaryCsv, exportTripReportPdf } from './lib/exports';
import {
  addLocalExpense,
  addLocalMember,
  addLocalTrip,
  deleteLocalExpense,
  loadLocalHomeData,
  loadLocalTripData,
  updateLocalExpense
} from './lib/localStore';

/**
 * Turns membership rows into a `{ [trip_id]: role }` lookup. Null-safe:
 * a missing or empty `rows` yields `{}`.
 *
 * @param {Array<{trip_id: string, role: string}>|null|undefined} rows
 * @returns {Object<string, string>}
 */
function mapMembershipRoles(rows) {
  return Object.fromEntries((rows || []).map((item) => [item.trip_id, item.role]));
}

/**
 * Last-resort display name: the part of `email` before the `@`, or
 * `'User'` if there is no email (or nothing before the `@`). Used when
 * no profile `display_name` is available - for example the profile
 * could not be loaded, or the database predates the `display_name`
 * column. This is a simplified client-side version of the server's
 * `preferred_display_name`, which also considers the auth metadata
 * name before falling back to the email.
 *
 * @param {string} [email]
 * @returns {string}
 */
function fallbackDisplayName(email) {
  if (!email) return 'User';
  const [name] = email.split('@');
  return name || 'User';
}

/**
 * Detects the "column user_profiles.display_name does not exist" error,
 * which means the database schema is older than this code.
 *
 * @param {string|{message?: string}|null|undefined} errorLike - A message string or an error-like object.
 * @returns {boolean}
 */
function isMissingDisplayNameColumnError(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('column user_profiles.display_name does not exist');
}

/**
 * Detects a PostgREST "schema cache" error that mentions a specific
 * function - i.e. the RPC is not deployed in this database, or the API
 * cache is stale. Used to fall back gracefully when
 * `ensure_trip_member_record` is unavailable.
 *
 * @param {string|{message?: string}|null|undefined} errorLike
 * @param {string} functionName - Matched as a plain substring of the message.
 * @returns {boolean}
 */
function isSchemaCacheFunctionError(errorLike, functionName) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('schema cache') && message.includes(functionName);
}

/**
 * Detects any PostgREST "schema cache" error (missing table, column or
 * function in the API cache). Callers use it to tolerate optional
 * queries - invitations, memberships - failing while the schema is
 * behind, instead of blocking the whole screen.
 *
 * @param {string|{message?: string}|null|undefined} errorLike
 * @returns {boolean}
 */
function isSchemaCacheError(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('schema cache');
}

/**
 * Detects a "column does not exist" error for one specific column, in
 * either of the two wordings Postgres produces (`column t.c does not
 * exist` and `column "c" of relation "t" does not exist`).
 *
 * It does not match PostgREST's "Could not find the 'c' column of 't'
 * in the schema cache" wording - that case is covered by
 * {@link isSchemaCacheError}.
 *
 * @param {string|{message?: string}|null|undefined} errorLike
 * @param {string} tableName
 * @param {string} columnName
 * @returns {boolean}
 */
function isMissingColumnError(errorLike, tableName, columnName) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  const one = `column ${tableName}.${columnName} does not exist`;
  const two = `column "${columnName}" of relation "${tableName}" does not exist`;
  return message.includes(one) || message.includes(two);
}

/**
 * Pulls the missing object's name out of a schema-cache error message,
 * for display. Looks for a table first (`table 'x'`), then a function
 * (`function name(`).
 *
 * @param {string} message
 * @returns {string} A short hint sentence, or `''` if neither was found.
 */
function getSchemaCacheObjectHint(message) {
  const tableMatch = message.match(/table '([^']+)'/i);
  if (tableMatch?.[1]) return `Missing table in API cache: ${tableMatch[1]}.`;

  const functionMatch = message.match(/function ([^ ]+)\(/i);
  if (functionMatch?.[1]) return `Missing function in API cache: ${functionMatch[1]}.`;

  return '';
}

/**
 * Maps raw database/API errors to messages a user can act on. Used at
 * essentially every `setError(...)` call site in this file.
 *
 * Checks run in order, and the order matters - the specific cases come
 * before the generic schema-cache one:
 * 1. `public.trip_memberships` missing from the schema cache
 * 2. `user_profiles.display_name` column missing
 * 3. any other schema-cache error (adds the missing object's name when
 *    it can find one, plus the `NOTIFY pgrst, 'reload schema'` steps)
 * 4. "stack depth limit exceeded" (an RLS policy recursion)
 * Anything else is returned unchanged.
 *
 * The messages point at `supabase/schema.sql`; keep them in sync if
 * that file is ever renamed or moved.
 *
 * @param {string|{message?: string}|null|undefined} errorLike - A message string or an error-like object. With no usable message the result is `'Unexpected error.'`.
 * @returns {string}
 */
function getFriendlyErrorMessage(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || 'Unexpected error.';

  if (message.includes("Could not find the table 'public.trip_memberships' in the schema cache")) {
    return [
      'Database schema is not updated for this app version.',
      'In Supabase SQL Editor, run the latest `supabase/schema.sql` from this repo, then refresh and try again.'
    ].join(' ');
  }

  if (isMissingDisplayNameColumnError(message)) {
    return [
      'Your database is missing the `display_name` column in `user_profiles`.',
      "Run the latest `supabase/schema.sql`, then run `NOTIFY pgrst, 'reload schema';` and refresh localhost."
    ].join(' ');
  }

  if (message.includes('schema cache')) {
    const hint = getSchemaCacheObjectHint(message);
    return [
      'Supabase schema cache looks stale.',
      hint,
      "In SQL Editor run `NOTIFY pgrst, 'reload schema';`, wait a few seconds, then retry.",
      'If it still fails, re-run latest `supabase/schema.sql` in the same Supabase project configured in your `.env`.'
    ].filter(Boolean).join(' ');
  }

  if (message.toLowerCase().includes('stack depth limit exceeded')) {
    return [
      'Database policy recursion was triggered.',
      'Apply the latest `supabase/schema.sql` from this repo (includes RLS recursion fix), then retry.'
    ].join(' ');
  }

  return message;
}

/**
 * Root component. Takes no props. Renders the page shell (header and
 * banners) and, once data has loaded, either the home view or the open
 * group.
 *
 * @returns {import('react').ReactElement}
 */
export default function App() {
  /*
   * Data state.
   * - trips: home-screen summaries (member/expense counts, total spent,
   *   and the caller's role for each trip).
   * - selectedTripId: '' means the home view; a trip id means the group
   *   view (see isGroupView).
   * - selectedTrip / members / expenses: the open trip's data. Each
   *   expense has its `splits` attached.
   * - groupMemberships: who can sign in to the open trip, enriched with
   *   profile name and email.
   * - groupInvites / groupPastInvites: active vs used-or-expired
   *   invitations, loaded by two separate queries.
   * - membershipByTrip: { tripId: role } for the signed-in user across
   *   all their trips.
   */
  const [trips, setTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [groupMemberships, setGroupMemberships] = useState([]);
  const [groupInvites, setGroupInvites] = useState([]);
  const [groupPastInvites, setGroupPastInvites] = useState([]);
  const [membershipByTrip, setMembershipByTrip] = useState({});
  /*
   * Auth, loading and message state.
   * - session: the Supabase auth session, or null when signed out. Always
   *   null in local mode.
   * - currentProfile: the signed-in user's profile ({ user_id, email,
   *   display_name }), or null. A fallback built from the email is used
   *   when the real profile cannot be loaded.
   * - loading: true while home or trip data is being fetched (starts
   *   true). While it is true the page shows "Loading trip data..."
   *   instead of the content.
   * - authLoading: true only while the initial session check runs; shows
   *   "Checking authentication...".
   * - pdfExporting: true while a PDF report is being generated; disables
   *   the PDF button.
   * - error / info: banner texts ('' means no banner). Handlers set them;
   *   loadHomeData clears error, and loadTripData clears both.
   */
  const [session, setSession] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  /*
   * Mode and permission flags, derived on every render.
   * currentRole is the signed-in user's role in the open trip, or ''
   * when they are not a member (for example while viewing an unclaimed
   * legacy trip). In local mode there are no accounts or roles, so every
   * capability flag is true.
   * - isAdmin: owner or admin. isOwner: owner only.
   * - canAddExpenses: any member, whatever their role.
   * - canCreateTrips: any signed-in user.
   * In Supabase mode these flags only decide what the UI offers; the
   * database enforces the real rules (RLS policies and RPC checks), so a
   * flag being true never grants access by itself.
   */
  const isLocalMode = !hasSupabaseConfig;
  const isGroupView = Boolean(selectedTripId);

  const currentRole = membershipByTrip[selectedTripId] || '';
  const isAdmin = isLocalMode || currentRole === 'owner' || currentRole === 'admin';
  const isOwner = isLocalMode || currentRole === 'owner';
  const canAddExpenses = isLocalMode || Boolean(currentRole);
  const canCreateTrips = isLocalMode || Boolean(session?.user);

  /**
   * Returns the UI to "no trip open": clears the selected trip and its
   * members, expenses, memberships and both invitation lists. Leaves the
   * home-screen `trips` list, `membershipByTrip`, the loading flag and
   * the banners alone. Called at the start of `loadHomeData` and on
   * sign-out.
   */
  function clearTripState() {
    setSelectedTripId('');
    setSelectedTrip(null);
    setMembers([]);
    setExpenses([]);
    setGroupMemberships([]);
    setGroupInvites([]);
    setGroupPastInvites([]);
  }

  /**
   * Builds the home-screen tile data: every trip plus the caller's role
   * in it, how many members and expenses it has, and its total spent.
   *
   * Settlement rows are left out of `expenseCount` and `totalSpent` -
   * they are transfers between members, not spending. `memberCount`
   * counts `members` rows (the names used in splits, guests included),
   * not signed-in users. `accessRole` is `null` when the caller has no
   * membership row for the trip, which is how an unclaimed legacy trip
   * is recognised.
   *
   * The counts are computed here from the full lists `loadHomeData`
   * fetches (one `trip_id` per member row, one row per expense). That is
   * fine at this app's scale, but it would not stay cheap with very
   * large groups.
   *
   * @param {Array<Object>} tripsData - `trips` rows.
   * @param {Array<{trip_id: string}>} membersData - `members` rows; only `trip_id` is read.
   * @param {Array<{trip_id: string, amount: number, is_settlement?: boolean}>} expensesData
   * @param {Array<{trip_id: string, role: string}>} myMembershipRows - The caller's own `trip_memberships` rows.
   * @returns {Array<Object>} Each trip with `accessRole`, `memberCount`, `expenseCount` and `totalSpent` added.
   */
  function buildTripSummaries(tripsData, membersData, expensesData, myMembershipRows) {
    const roleMap = mapMembershipRoles(myMembershipRows);
    return (tripsData || []).map((trip) => {
      const tripMembers = (membersData || []).filter((member) => member.trip_id === trip.id);
      // Settlement rows are transfers between members, not spending - keep them out of totals/counts.
      const tripExpenses = (expensesData || []).filter((expense) => expense.trip_id === trip.id && !expense.is_settlement);
      const accessRole = roleMap[trip.id] || null;

      return {
        ...trip,
        accessRole,
        memberCount: tripMembers.length,
        expenseCount: tripExpenses.length,
        totalSpent: tripExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      };
    });
  }

  /**
   * Loads the home screen: the trip list with summaries, and the
   * caller's role in each trip. This is also what "All groups" and every
   * post-change refresh call, so it always closes any open trip first
   * (`clearTripState`) and clears `error` (but not `info`). It always
   * ends with `loading` false.
   *
   * - Local mode: reads `lib/localStore.js`; every trip gets the role
   *   `'owner'`.
   * - Supabase mode, signed out: an empty list.
   * - Supabase mode, signed in: four queries run in parallel - trips,
   *   members, expenses and the caller's own memberships. If one of the
   *   first three fails, the error is shown and the existing list is
   *   left as it was. A schema-cache failure of the memberships query is
   *   tolerated: the list still loads, but with no roles every trip
   *   looks unclaimed, and an info message explains why. Any other
   *   memberships error is fatal.
   *
   * @returns {Promise<void>}
   */
  async function loadHomeData() {
    setLoading(true);
    setError('');
    clearTripState();

    if (isLocalMode) {
      const localData = loadLocalHomeData();
      setTrips(localData.trips.map((trip) => ({ ...trip, accessRole: 'owner' })));
      setMembershipByTrip(Object.fromEntries(localData.trips.map((trip) => [trip.id, 'owner'])));
      setLoading(false);
      return;
    }

    if (!session?.user) {
      setTrips([]);
      setMembershipByTrip({});
      setLoading(false);
      return;
    }

    const [tripsRes, membersRes, expensesRes, membershipsRes] = await Promise.all([
      supabase.from('trips').select('*').order('created_at', { ascending: true }),
      supabase.from('members').select('trip_id'),
      supabase.from('expenses').select('trip_id, amount, is_settlement'),
      supabase.from('trip_memberships').select('trip_id, role').eq('user_id', session.user.id)
    ]);

    const firstError = tripsRes.error || membersRes.error || expensesRes.error;
    if (firstError) {
      setError(getFriendlyErrorMessage(firstError));
      setLoading(false);
      return;
    }

    if (membershipsRes.error && !isSchemaCacheError(membershipsRes.error)) {
      setError(getFriendlyErrorMessage(membershipsRes.error));
      setLoading(false);
      return;
    }

    const membershipMap = mapMembershipRoles(membershipsRes.data || []);
    setMembershipByTrip(membershipMap);
    setTrips(buildTripSummaries(tripsRes.data, membersRes.data, expensesRes.data, membershipsRes.data));

    if (membershipsRes.error && isSchemaCacheError(membershipsRes.error)) {
      setInfo(
        "Group roles are temporarily unavailable due to schema cache lag. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor and refresh."
      );
    }
    setLoading(false);
  }

  /**
   * Loads the signed-in user's profile into `currentProfile`. Clears it
   * in local mode or when there is no session.
   *
   * Reads `user_profiles`; if the database predates the `display_name`
   * column it retries without it. The resulting `display_name` is always
   * filled: when it is empty, or no profile row exists, it falls back to
   * the part of the email before the `@`. A schema-cache error becomes a
   * soft info message and the email-based fallback profile is used; any
   * other error becomes an error banner and leaves the current profile
   * unchanged.
   *
   * @param {Object|null} [activeSession=session] - The session to load for. The auth effects pass the session they have just received explicitly, because the `session` state has not been updated yet at that moment.
   * @returns {Promise<void>}
   */
  async function loadCurrentProfile(activeSession = session) {
    if (isLocalMode || !activeSession?.user?.id) {
      setCurrentProfile(null);
      return;
    }

    let profile = null;
    let profileError = null;

    const profileWithDisplayNameRes = await supabase
      .from('user_profiles')
      .select('user_id, email, display_name')
      .eq('user_id', activeSession.user.id)
      .maybeSingle();

    profile = profileWithDisplayNameRes.data;
    profileError = profileWithDisplayNameRes.error;

    if (profileError && isMissingDisplayNameColumnError(profileError)) {
      const fallbackRes = await supabase
        .from('user_profiles')
        .select('user_id, email')
        .eq('user_id', activeSession.user.id)
        .maybeSingle();

      profile = fallbackRes.data ? { ...fallbackRes.data, display_name: null } : null;
      profileError = fallbackRes.error;
    }

    if (profileError) {
      if (isSchemaCacheError(profileError)) {
        setCurrentProfile({
          user_id: activeSession.user.id,
          email: activeSession.user.email || '',
          display_name: fallbackDisplayName(activeSession.user.email || '')
        });
        setInfo(
          "Profile details are temporarily using email fallback because Supabase schema cache is still refreshing."
        );
        return;
      }

      setError(getFriendlyErrorMessage(profileError));
      return;
    }

    if (!profile) {
      setCurrentProfile({
        user_id: activeSession.user.id,
        email: activeSession.user.email || '',
        display_name: fallbackDisplayName(activeSession.user.email || '')
      });
      return;
    }

    setCurrentProfile({
      ...profile,
      display_name: profile.display_name || fallbackDisplayName(profile.email || activeSession.user.email || '')
    });
  }

  /**
   * Opens a trip: loads everything the group view needs, and only then
   * switches to it. `selectedTripId` is set at the very end, so if
   * anything fails on the way the user stays where they were, with an
   * error banner. Clears `error` and `info` first and always ends with
   * `loading` false.
   *
   * - Local mode: reads the trip, members and expenses from
   *   `lib/localStore.js`.
   * - Supabase mode needs a signed-in user. The trip row comes from
   *   `knownTrip`, else the already-loaded `trips` list, else a fetch.
   * - Five queries run in parallel: members, expenses, memberships,
   *   active invitations, and past invitations (used or expired, capped
   *   at 5). Failure of members or expenses is fatal. For memberships and
   *   both invitation queries a schema-cache error is tolerated (treated
   *   as empty) and any other error is fatal.
   * - Invitations are requested for every member, not just admins; which
   *   rows come back is up to the database's access rules.
   * - If the caller is a member (or membership could not be read),
   *   `ensureCurrentUserMember` makes sure they have a `members` row and
   *   the members are read again; if that fails the trip does not open.
   *   It is not attempted for non-members, such as someone looking at an
   *   unclaimed trip.
   * - Profiles for the group's users are fetched to give each membership
   *   a display name and email. If that hits a schema-cache error, names
   *   and emails are left blank.
   * - Splits for all of the trip's expenses are fetched in one query and
   *   attached to each expense as `splits`. A schema-cache error here is
   *   tolerated: the expenses show without split details.
   * - The caller's role is recorded in `membershipByTrip`. If
   *   memberships could not be read it defaults to `'member'`, for
   *   display only.
   *
   * @param {string} tripId
   * @param {Object} [knownTrip] - A trip object already in hand (for example one just created), so no lookup is needed.
   * @returns {Promise<void>}
   */
  async function loadTripData(tripId, knownTrip) {
    setLoading(true);
    setError('');
    setInfo('');

    if (isLocalMode) {
      const localData = loadLocalTripData(tripId);
      if (!localData.trip) {
        setError('Trip not found.');
        setLoading(false);
        return;
      }

      setSelectedTripId(tripId);
      setSelectedTrip(localData.trip);
      setMembers(localData.members);
      setExpenses(localData.expenses);
      setGroupMemberships([]);
      setGroupInvites([]);
      setLoading(false);
      return;
    }

    if (!session?.user) {
      setError('Sign in to open group details.');
      setLoading(false);
      return;
    }

    let activeTrip = knownTrip || trips.find((trip) => trip.id === tripId);
    if (!activeTrip) {
      const { data: tripData, error: tripError } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

      if (tripError) {
        setError(getFriendlyErrorMessage(tripError));
        setLoading(false);
        return;
      }
      activeTrip = tripData;
    }

    const [membersRes, expensesRes, membershipsRes, invitesRes, pastInvitesRes] = await Promise.all([
      supabase.from('members').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
      supabase
        .from('expenses')
        .select('id, description, amount, paid_by, split_type, expense_date, is_settlement, created_at, updated_at')
        .eq('trip_id', tripId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('trip_memberships').select('trip_id, user_id, role, created_at').eq('trip_id', tripId),
      // Active invites: not used, not expired
      supabase
        .from('trip_invitations')
        .select('id, token, invited_email, role, created_at, expires_at, accepted_at')
        .eq('trip_id', tripId)
        .is('revoked_at', null)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      // Past invites: used or expired, capped at 5
      supabase
        .from('trip_invitations')
        .select('id, token, invited_email, role, created_at, expires_at, accepted_at')
        .eq('trip_id', tripId)
        .is('revoked_at', null)
        .or(`accepted_at.not.is.null,expires_at.lte.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const firstError = membersRes.error || expensesRes.error;
    if (firstError) {
      setError(getFriendlyErrorMessage(firstError));
      setLoading(false);
      return;
    }

    if (membershipsRes.error && !isSchemaCacheError(membershipsRes.error)) {
      setError(getFriendlyErrorMessage(membershipsRes.error));
      setLoading(false);
      return;
    }

    if (invitesRes.error && !isSchemaCacheError(invitesRes.error)) {
      setError(getFriendlyErrorMessage(invitesRes.error));
      setLoading(false);
      return;
    }

    if (pastInvitesRes.error && !isSchemaCacheError(pastInvitesRes.error)) {
      setError(getFriendlyErrorMessage(pastInvitesRes.error));
      setLoading(false);
      return;
    }

    const membershipRows = membershipsRes.error ? [] : (membershipsRes.data || []);
    const inviteRows = invitesRes.error ? [] : (invitesRes.data || []);
    const pastInviteRows = pastInvitesRes.error ? [] : (pastInvitesRes.data || []);
    const myMembership = membershipRows.find((item) => item.user_id === session.user.id);
    let effectiveMembers = membersRes.data || [];

    // Make sure an existing member has a `members` row (the names used in expense splits).
    // This is a self-heal for members whose row is missing; it is deliberately NOT run for
    // non-members (for example someone viewing an unclaimed legacy trip) - the server only
    // allows it for the caller's own membership. If the memberships query itself failed we
    // cannot tell either way, so we still attempt it.
    if (myMembership || membershipsRes.error) {
      const ensured = await ensureCurrentUserMember(tripId);
      if (!ensured) {
        setLoading(false);
        return;
      }

      const { data: refreshedMembers, error: refreshedMembersError } = await supabase
        .from('members')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (refreshedMembersError) {
        setError(getFriendlyErrorMessage(refreshedMembersError));
        setLoading(false);
        return;
      }

      effectiveMembers = refreshedMembers || [];
    }

    const profileIds = [...new Set(membershipRows.map((item) => item.user_id))];
    let profileMap = {};
    if (profileIds.length) {
      let profileRows = [];
      let profileError = null;

      const profileWithDisplayNameRes = await supabase
        .from('user_profiles')
        .select('user_id, email, display_name')
        .in('user_id', profileIds);

      profileRows = profileWithDisplayNameRes.data || [];
      profileError = profileWithDisplayNameRes.error;

      if (profileError && isMissingDisplayNameColumnError(profileError)) {
        const fallbackRes = await supabase
          .from('user_profiles')
          .select('user_id, email')
          .in('user_id', profileIds);

        profileRows = (fallbackRes.data || []).map((item) => ({ ...item, display_name: null }));
        profileError = fallbackRes.error;
      }

      if (profileError) {
        if (isSchemaCacheError(profileError)) {
          profileRows = [];
          setInfo(
            "Group user names are temporarily using fallback values because Supabase schema cache is still refreshing."
          );
        } else {
          setError(getFriendlyErrorMessage(profileError));
          setLoading(false);
          return;
        }
      }

      profileMap = Object.fromEntries((profileRows || []).map((profile) => [
        profile.user_id,
        {
          email: profile.email || '',
          display_name: profile.display_name || fallbackDisplayName(profile.email || '')
        }
      ]));
    }

    const expenseRows = expensesRes.data || [];
    const expenseIds = expenseRows.map((expense) => expense.id);

    let splitRows = [];
    if (expenseIds.length) {
      const { data: fetchedSplits, error: splitsError } = await supabase
        .from('expense_splits')
        .select('expense_id, member_id, share_amount')
        .in('expense_id', expenseIds);

      if (splitsError) {
        if (isSchemaCacheError(splitsError)) {
          setInfo(
            "Expense split details are temporarily unavailable because Supabase schema cache is still refreshing."
          );
        } else {
          setError(getFriendlyErrorMessage(splitsError));
          setLoading(false);
          return;
        }
      }

      splitRows = splitsError ? [] : (fetchedSplits || []);
    }

    const splitMap = splitRows.reduce((acc, split) => {
      if (!acc[split.expense_id]) acc[split.expense_id] = [];
      acc[split.expense_id].push({
        member_id: split.member_id,
        share_amount: split.share_amount
      });
      return acc;
    }, {});

    const normalizedExpenses = expenseRows.map((expense) => ({
      ...expense,
      splits: splitMap[expense.id] || []
    }));

    const enrichedMemberships = membershipRows.map((membership) => ({
      ...membership,
      email: profileMap[membership.user_id]?.email || '',
      display_name: profileMap[membership.user_id]?.display_name || ''
    }));

    setSelectedTripId(tripId);
    setSelectedTrip(activeTrip);
    setMembers(effectiveMembers);
    setExpenses(normalizedExpenses);
    setGroupMemberships(enrichedMemberships);
    setGroupInvites(inviteRows);
    setGroupPastInvites(pastInviteRows);
    if (myMembership) {
      setMembershipByTrip((current) => ({ ...current, [tripId]: myMembership.role }));
    } else if (membershipsRes.error) {
      setMembershipByTrip((current) => ({ ...current, [tripId]: current[tripId] || 'member' }));
      setInfo(
        "Group role details are temporarily unavailable due to schema cache lag. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor and refresh."
      );
    }
    setLoading(false);
  }

  /*
   * Bootstrap effect, run once the mode is known.
   * - Local mode: load the home screen straight away; there is nothing
   *   to sign in to.
   * - Supabase mode: read the existing session once, then subscribe to
   *   auth changes (sign-in, sign-out, token refresh) and keep `session`
   *   and `currentProfile` in step with them. The subscription is removed
   *   on cleanup, and `active` stops the one-time session read from
   *   updating state after the effect has been torn down.
   */
  useEffect(() => {
    if (isLocalMode) {
      loadHomeData();
      return;
    }

    let active = true;
    setAuthLoading(true);

    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) setError(getFriendlyErrorMessage(authError));
      setSession(data.session || null);
      if (data.session) loadCurrentProfile(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession || null);
      if (currentSession) {
        loadCurrentProfile(currentSession);
      } else {
        setCurrentProfile(null);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [isLocalMode]);

  /*
   * Supabase mode: reload the home screen whenever the signed-in user
   * changes - on the first run with no session (an empty list) and after
   * every sign-in or sign-out. It depends on the user id, not the whole
   * session, so a token refresh for the same user does not reload.
   * `loadHomeData` also closes any open trip.
   */
  useEffect(() => {
    if (isLocalMode) return;
    loadHomeData();
  }, [isLocalMode, session?.user?.id]);

  /*
   * Supabase mode: load the profile whenever the signed-in user changes.
   * The auth callbacks in the bootstrap effect also load it directly, so
   * on a fresh page load the profile can be requested more than once.
   * That is harmless, just redundant.
   */
  useEffect(() => {
    if (isLocalMode || !session?.user?.id) return;
    loadCurrentProfile(session);
  }, [isLocalMode, session?.user?.id]);

  /**
   * Sends the sign-in email (a magic link). Does nothing in local mode.
   * Clears both banners first, then shows an info message on success or
   * an error banner on failure (including Supabase's email rate limit).
   *
   * If the page was opened from an invitation link (`?invite=<token>`),
   * the token is carried into the link's redirect URL so the invitation
   * is accepted automatically after sign-in. The redirect always lands
   * on the site root (`window.location.origin`); the original path and
   * any other query or hash are not preserved. The redirect URL must be
   * allowed under Supabase > Authentication > URL Configuration.
   *
   * @param {string} email
   * @returns {Promise<void>}
   */
  async function handleSendOtp(email) {
    if (isLocalMode) return;
    setError('');
    setInfo('');

    // Preserve ?invite= token through the magic link redirect so auto-join works after sign-in
    const redirectTo = new URL(window.location.origin);
    const inviteToken = new URLSearchParams(window.location.search).get('invite');
    if (inviteToken) redirectTo.searchParams.set('invite', inviteToken);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo.toString() }
    });

    if (otpError) {
      setError(getFriendlyErrorMessage(otpError));
      return;
    }

    setInfo(`Magic link sent to ${email}. Open your inbox to continue.`);
  }

  /**
   * Signs out. Does nothing in local mode. On success it shows an info
   * message, closes any open trip and clears the profile; the home list
   * itself is emptied by the effect that reloads it when the signed-in
   * user changes. On failure it shows an error banner and changes
   * nothing else.
   *
   * @returns {Promise<void>}
   */
  async function handleLogout() {
    if (isLocalMode) return;
    setError('');
    setInfo('');
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) {
      setError(getFriendlyErrorMessage(logoutError));
      return;
    }
    setInfo('Signed out successfully.');
    clearTripState();
    setCurrentProfile(null);
  }

  /**
   * Makes sure the signed-in user has a `members` row in the given trip
   * (the name used in expense splits). Resolves `true` if they do - or if
   * there is no session, so nothing to do - and `false` if it failed, in
   * which case an error banner is already set and the caller should stop.
   *
   * Calls the `ensure_trip_member_record` RPC, which only allows the
   * caller's own id for a trip they belong to. If that RPC is missing
   * from the database's API cache (an older or not-yet-refreshed schema)
   * it falls back to inserting the row directly, named from the profile's
   * display name or the email; if the `members.user_id` column is also
   * missing it inserts without it. A duplicate-row error (`23505`) counts
   * as success.
   *
   * @param {string} tripId
   * @returns {Promise<boolean>}
   */
  async function ensureCurrentUserMember(tripId) {
    if (!session?.user?.id) return true;

    const { error: ensureError } = await supabase.rpc('ensure_trip_member_record', {
      p_trip_id: tripId,
      p_user_id: session.user.id
    });

    if (!ensureError) return true;

    if (!isSchemaCacheFunctionError(ensureError, 'ensure_trip_member_record')) {
      setError(getFriendlyErrorMessage(ensureError));
      return false;
    }

    const { error: fallbackInsertError } = await supabase
      .from('members')
      .insert({
        trip_id: tripId,
        user_id: session.user.id,
        name: currentProfile?.display_name || fallbackDisplayName(session.user.email || '')
      });

    if (fallbackInsertError && isMissingColumnError(fallbackInsertError, 'members', 'user_id')) {
      const { error: legacyInsertError } = await supabase
        .from('members')
        .insert({
          trip_id: tripId,
          name: currentProfile?.display_name || fallbackDisplayName(session.user.email || '')
        });

      if (legacyInsertError && legacyInsertError.code !== '23505') {
        setError(getFriendlyErrorMessage(legacyInsertError));
        return false;
      }

      return true;
    }

    if (fallbackInsertError && fallbackInsertError.code !== '23505') {
      setError(getFriendlyErrorMessage(fallbackInsertError));
      return false;
    }

    return true;
  }

  /**
   * Renames the signed-in user's member row in the open trip to
   * `displayName`, then reloads that trip so the UI shows it. Does
   * nothing if no trip is open or nobody is signed in. Despite its name
   * it only updates (the user's rows in other trips keep their old
   * names); the one insert is a legacy path for databases without
   * `members.user_id`.
   *
   * If the user has no member row in this trip, the update matches
   * nothing and nothing happens. Member names are unique within a trip,
   * so renaming to a name another member already uses fails: the
   * database error is shown in the error banner while the profile name,
   * saved just before, stays changed.
   *
   * @param {string} displayName
   * @returns {Promise<void>}
   */
  async function tryUpsertMemberNameForCurrentTrip(displayName) {
    if (!selectedTripId || !session?.user?.id) return;

    const { error: memberUpdateError } = await supabase
      .from('members')
      .update({ name: displayName })
      .eq('trip_id', selectedTripId)
      .eq('user_id', session.user.id);

    if (memberUpdateError) {
      if (isMissingColumnError(memberUpdateError, 'members', 'user_id')) {
        const { error: legacyInsertError } = await supabase
          .from('members')
          .insert({
            trip_id: selectedTripId,
            name: displayName
          });

        if (legacyInsertError && legacyInsertError.code !== '23505') {
          setError(getFriendlyErrorMessage(legacyInsertError));
          return;
        }
      } else {
        setError(getFriendlyErrorMessage(memberUpdateError));
        return;
      }
    }

    await loadTripData(selectedTripId, selectedTrip);
  }

  /**
   * Saves a new display name. Does nothing in local mode or when signed
   * out.
   *
   * Saves to the profile through the `update_my_display_name` RPC and
   * refreshes `currentProfile`. If the database refuses with an
   * access-rule error (`42501` on `user_profiles`), the name is still
   * used for this session and an info message says it could not be saved
   * globally; any other error stops here with an error banner. If a trip
   * is open, the user's member row in that trip is renamed too
   * (`tryUpsertMemberNameForCurrentTrip`); their rows in other trips are
   * not.
   *
   * @param {string} displayName
   * @returns {Promise<void>}
   */
  async function handleUpdateDisplayName(displayName) {
    if (isLocalMode || !session?.user) return;

    const { data: profile, error: profileError } = await supabase
      .rpc('update_my_display_name', { p_display_name: displayName })
      .single();

    if (profileError) {
      const profileMessage = getFriendlyErrorMessage(profileError);
      if (
        profileError.code === '42501' &&
        (profileMessage.includes('user_profiles') || profileMessage.toLowerCase().includes('row-level security'))
      ) {
        setInfo(
          'Display name could not be saved to global profile due to current DB policy state. It will still be used in this session/group.'
        );
        setCurrentProfile((current) => ({
          user_id: session.user.id,
          email: current?.email || session.user.email || '',
          display_name: displayName
        }));
      } else {
        setError(profileMessage);
        return;
      }
    }

    if (profile) {
      setCurrentProfile({
        user_id: session.user.id,
        email: profile.email || session.user.email || '',
        display_name: profile.display_name || displayName
      });
    }

    if (selectedTripId) {
      await tryUpsertMemberNameForCurrentTrip(displayName);
    }
  }

  /**
   * Creates a group and opens it. Clears both banners first.
   *
   * - Local mode: adds the trip to browser storage and opens it; a
   *   duplicate name is caught and shown as an error.
   * - Supabase mode: needs a signed-in user. Calls the
   *   `create_trip_with_owner` RPC, which makes the caller the owner and
   *   gives them a member record. Trip names are unique across all
   *   users, so a name someone else has used fails here with the
   *   database's own message. On success it refreshes the home list and
   *   then opens the new trip.
   *
   * Known issue: it sets a "Group created" message before opening the
   * trip, and opening a trip clears the banners, so that message is not
   * actually seen.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  async function handleAddTrip(name) {
    setError('');
    setInfo('');

    if (isLocalMode) {
      try {
        const trip = addLocalTrip(name);
        await loadTripData(trip.id, trip);
      } catch (localError) {
        setError(localError.message);
      }
      return;
    }

    if (!session?.user) {
      setError('Sign in before creating a group.');
      return;
    }

    const { data: trip, error: tripError } = await supabase.rpc('create_trip_with_owner', {
      trip_name: name
    });

    if (tripError) {
      setError(getFriendlyErrorMessage(tripError));
      return;
    }

    setInfo('Group created. You are the owner.');
    await loadHomeData();
    await loadTripData(trip.id, { ...trip, accessRole: 'owner' });
  }

  /**
   * Claims an unclaimed (legacy) trip for the signed-in user through the
   * `claim_unowned_trip` RPC, which makes them the owner. Does nothing in
   * local mode and needs a sign-in. On success it shows an info message
   * and refreshes the home list; the trip is not opened.
   *
   * @param {string} tripId
   * @returns {Promise<void>}
   */
  async function handleClaimTrip(tripId) {
    if (isLocalMode) return;
    if (!session?.user) {
      setError('Sign in before claiming a group.');
      return;
    }

    setError('');
    setInfo('');
    const { error: claimError } = await supabase.rpc('claim_unowned_trip', {
      p_trip_id: tripId
    });

    if (claimError) {
      setError(getFriendlyErrorMessage(claimError));
      return;
    }

    setInfo('Group claimed successfully.');
    await loadHomeData();
  }

  /**
   * Archives or restores a trip through the `set_trip_archived` RPC
   * (admin/owner only - enforced by the database). Does nothing in local
   * mode, which has no archiving. Shows an info message and refreshes
   * the home list, which also closes the trip if it was open. It takes
   * any trip id, so it serves both the group header's Archive button and
   * the home screen's Restore buttons.
   *
   * @param {string} tripId
   * @param {boolean} archived - `true` to archive, `false` to restore.
   * @returns {Promise<void>}
   */
  async function handleSetTripArchived(tripId, archived) {
    if (isLocalMode) return;

    setError('');
    setInfo('');
    const { error: archiveError } = await supabase.rpc('set_trip_archived', {
      p_trip_id: tripId,
      p_archived: archived
    });

    if (archiveError) {
      setError(getFriendlyErrorMessage(archiveError));
      return;
    }

    setInfo(archived ? 'Group archived. It is now hidden from the active list.' : 'Group restored to active list.');
    await loadHomeData();
  }

  /**
   * Handler for the group header's Archive button: asks for confirmation
   * (a browser dialog), then calls `handleSetTripArchived` for the open
   * trip. Does nothing if no trip is open.
   *
   * @returns {Promise<void>}
   */
  async function handleArchiveCurrentTrip() {
    if (!selectedTripId) return;
    const confirmed = window.confirm(
      `Archive "${selectedTrip?.name || 'this group'}"?\n\nIt will be hidden from your active groups list. You can restore it anytime from "Archived groups" on the home screen.`
    );
    if (!confirmed) return;
    await handleSetTripArchived(selectedTripId, true);
  }

  /**
   * Redeems an invitation token through the `accept_trip_invitation`
   * RPC. Does nothing in local mode and needs a sign-in.
   *
   * On success it refreshes the home list and opens the trip the
   * invitation was for. Two outcomes are treated as soft results rather
   * than failures, each shown as an info message and followed by a home
   * list refresh: an "already used" invitation, and "already a member"
   * (the database refuses so an existing member's role can never be
   * changed by accepting a link, and the invitation stays unused). Any
   * other error becomes an error banner. Who may accept - expiry, reuse,
   * revocation and the email restriction - is decided by the database
   * function, not here.
   *
   * Known issue: the "Invitation accepted" message is cleared when the
   * trip opens, so it is not actually seen.
   *
   * @param {string} token
   * @returns {Promise<void>}
   */
  async function handleAcceptInvite(token) {
    if (isLocalMode) return;
    if (!session?.user) {
      setError('Sign in before accepting invites.');
      return;
    }

    setError('');
    setInfo('');
    const { data: tripId, error: inviteError } = await supabase.rpc('accept_trip_invitation', {
      p_token: token
    });

    if (inviteError) {
      const msg = inviteError.message || '';
      // The database refuses when the user is already in the group (and leaves the invitation
      // unused), so accepting a link can never change an existing member's role.
      if (msg.includes('already a member')) {
        setInfo('You are already a member of that group - open it from your list. The invitation was not used.');
        await loadHomeData();
        return;
      }
      // Already used, either by this user earlier or by someone else.
      if (msg.includes('already used') || msg.includes('already accepted')) {
        setInfo('This invitation has already been used. If you already joined, open the group from your list; otherwise ask the admin for a new invite.');
        await loadHomeData();
        return;
      }
      setError(getFriendlyErrorMessage(inviteError));
      return;
    }

    setInfo('Invitation accepted.');
    await loadHomeData();
    if (tripId) await loadTripData(tripId);
  }

  /**
   * Adds a guest member name (someone without an account) to the open
   * trip. Needs a trip to be open and admin/owner rights. The admin-only
   * rule is enforced here and in the UI; the database itself only
   * requires the caller to be a member for this insert.
   *
   * - Local mode: adds to browser storage; a duplicate name is caught
   *   and shown.
   * - Supabase mode: inserts into `members`. Names are unique within a
   *   trip, so a duplicate fails with the database's message.
   * The trip is reloaded afterwards.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  async function handleAddMember(name) {
    if (!selectedTripId) {
      setError('Create or select a trip before adding members.');
      return;
    }

    if (!isAdmin) {
      setError('Only owner/admin can add members.');
      return;
    }

    if (isLocalMode) {
      try {
        addLocalMember(selectedTripId, name);
        await loadTripData(selectedTripId);
      } catch (localError) {
        setError(localError.message);
      }
      return;
    }

    const { error: memberError } = await supabase.from('members').insert({ trip_id: selectedTripId, name });
    if (memberError) {
      setError(getFriendlyErrorMessage(memberError));
      return;
    }
    await loadTripData(selectedTripId);
  }

  /**
   * Saves one expense through the `save_expense_with_splits` RPC:
   * creates it, or updates it when `expenseId` is given. The RPC writes
   * the expense and its splits together and validates them on the
   * server. The expense always belongs to the open trip
   * (`selectedTripId`); `is_settlement` defaults to `false` when the
   * payload omits it.
   *
   * A failure shows an error banner and resolves `false`; success
   * resolves `true`. It reloads nothing - callers do that.
   *
   * @param {{description: string, amount: number, paid_by: string, split_type: string, expense_date: string, splits: Array<{member_id: string, share_amount: number}>, is_settlement?: boolean}} payload
   * @param {string|null} [expenseId=null] - Id of the expense to update, or `null` to create one.
   * @returns {Promise<boolean>}
   */
  async function saveExpenseWithRpc(payload, expenseId = null) {
    const { error: saveError } = await supabase.rpc('save_expense_with_splits', {
      p_trip_id: selectedTripId,
      p_description: payload.description,
      p_amount: payload.amount,
      p_paid_by: payload.paid_by,
      p_split_type: payload.split_type,
      p_expense_date: payload.expense_date,
      p_splits: payload.splits,
      p_expense_id: expenseId,
      p_is_settlement: payload.is_settlement || false
    });

    if (saveError) {
      setError(getFriendlyErrorMessage(saveError));
      return false;
    }

    return true;
  }

  /**
   * Adds an expense to the open trip. It checks, in order, that a trip
   * is open, that the splits add up to the amount (within 0.01), and
   * that the user may add expenses; the first failure shows an error
   * banner and stops. Otherwise it saves (to browser storage in local
   * mode, through `saveExpenseWithRpc` otherwise) and reloads the trip.
   * After a failed save nothing is reloaded.
   *
   * It resolves without a value in every case, so the caller cannot tell
   * success from failure - `ExpenseForm` clears its fields either way.
   *
   * @param {Object} payload - Same shape as the payload of {@link saveExpenseWithRpc}.
   * @returns {Promise<void>}
   */
  async function handleAddExpense(payload) {
    if (!selectedTripId) {
      setError('Create or select a trip before adding expenses.');
      return;
    }

    const totalSplit = payload.splits.reduce((sum, item) => sum + Number(item.share_amount || 0), 0);
    if (Math.abs(totalSplit - payload.amount) > 0.01) {
      setError('Split total must match expense amount.');
      return;
    }

    if (!canAddExpenses) {
      setError('Join this group before adding expenses.');
      return;
    }

    if (isLocalMode) {
      addLocalExpense(selectedTripId, payload);
      await loadTripData(selectedTripId);
      return;
    }

    const didSave = await saveExpenseWithRpc(payload);
    if (!didSave) return;
    await loadTripData(selectedTripId);
  }

  /**
   * Records a suggested transfer as paid. It checks that a trip is open,
   * that the user may add expenses and that the transfer names both
   * members, then asks for confirmation (a browser dialog) and saves a
   * settlement expense: description "Settlement: A paid B", paid by the
   * person who owed, a manual split giving the full amount to the
   * recipient, and `is_settlement: true`. The trip is reloaded
   * afterwards.
   *
   * The expense is dated with the UTC date, which can be a day behind
   * the local date for a few hours after local midnight in time zones
   * ahead of UTC (for example India).
   *
   * Known issue: in Supabase mode the "Settlement recorded" message is
   * set before the reload and cleared by it, so it is not seen; the
   * local-mode path sets it after the reload and does show it.
   *
   * @param {{from: string, to: string, fromId: string, toId: string, amount: number}} settlement - One item of the suggested-transfers list (`simplifySettlements`).
   * @returns {Promise<void>}
   */
  async function handleMarkSettled(settlement) {
    if (!selectedTripId) {
      setError('Create or select a trip first.');
      return;
    }

    if (!canAddExpenses) {
      setError('Join this group before recording a settlement.');
      return;
    }

    if (!settlement.fromId || !settlement.toId) {
      setError('Could not identify the members for this settlement.');
      return;
    }

    const confirmed = window.confirm(
      `Record that ${settlement.from} paid ${settlement.to} INR ${settlement.amount.toFixed(2)}?\n\nThis will be added as a settlement entry and the balances will update accordingly.`
    );
    if (!confirmed) return;

    const payload = {
      description: `Settlement: ${settlement.from} paid ${settlement.to}`,
      amount: settlement.amount,
      paid_by: settlement.fromId,
      split_type: 'manual',
      expense_date: new Date().toISOString().slice(0, 10),
      is_settlement: true,
      splits: [{ member_id: settlement.toId, share_amount: settlement.amount }]
    };

    if (isLocalMode) {
      addLocalExpense(selectedTripId, payload);
      await loadTripData(selectedTripId);
      setInfo('Settlement recorded.');
      return;
    }

    const didSave = await saveExpenseWithRpc(payload);
    if (!didSave) return;
    setInfo('Settlement recorded.');
    await loadTripData(selectedTripId);
  }

  /**
   * Saves changes to an existing expense. It applies the same
   * split-total check as `handleAddExpense`, saves to browser storage in
   * local mode or through `saveExpenseWithRpc` otherwise, and reloads
   * the trip. Unlike `handleAddExpense` it reports the outcome: `true`
   * when saved, `false` when a check or the save failed (an error banner
   * is set), so `ExpensesList` can keep the edit form open on failure.
   * Who may edit (the creator, or an admin/owner) is enforced by the
   * database.
   *
   * @param {string} expenseId
   * @param {Object} payload - Same shape as the payload of {@link saveExpenseWithRpc}.
   * @returns {Promise<boolean>}
   */
  async function handleEditExpense(expenseId, payload) {
    if (!selectedTripId) return false;

    const totalSplit = payload.splits.reduce((sum, item) => sum + Number(item.share_amount || 0), 0);
    if (Math.abs(totalSplit - payload.amount) > 0.01) {
      setError('Split total must match expense amount.');
      return false;
    }

    if (isLocalMode) {
      updateLocalExpense(selectedTripId, expenseId, payload);
      await loadTripData(selectedTripId);
      return true;
    }

    const didSave = await saveExpenseWithRpc(payload, expenseId);
    if (!didSave) return false;
    await loadTripData(selectedTripId);
    return true;
  }

  /**
   * Deletes an expense after a browser confirmation dialog ("cannot be
   * undone"). Local mode deletes from browser storage; otherwise it
   * calls the `delete_expense_with_permission` RPC, which allows only
   * the creator or an admin/owner. The trip is reloaded on success; a
   * failure shows an error banner.
   *
   * @param {string} expenseId
   * @returns {Promise<void>}
   */
  async function handleDeleteExpense(expenseId) {
    if (!selectedTripId) return;
    if (!window.confirm('Delete this expense? This action cannot be undone.')) return;

    if (isLocalMode) {
      deleteLocalExpense(selectedTripId, expenseId);
      await loadTripData(selectedTripId);
      return;
    }

    const { error: deleteError } = await supabase.rpc('delete_expense_with_permission', {
      p_expense_id: expenseId
    });
    if (deleteError) {
      setError(getFriendlyErrorMessage(deleteError));
      return;
    }
    await loadTripData(selectedTripId);
  }

  /**
   * Downloads the Expense CSV through `downloadExpensesCsv`: one row per
   * expense, settlements included and marked. With no expenses it shows
   * an info message instead; otherwise it shows one when the download
   * starts.
   */
  function handleDownloadDetailedCsv() {
    if (!expenses.length) {
      setInfo('Add at least one expense before downloading the detailed CSV.');
      return;
    }

    downloadExpensesCsv({
      tripName: selectedTrip?.name || 'Trip group',
      expenses,
      members
    });
    setInfo('Detailed expense CSV downloaded.');
  }

  /**
   * Downloads the Settlement CSV through `downloadSummaryCsv`: the trip
   * total, each member's paid/share/net, and the transfers still to be
   * paid. `totalSpent` excludes settlement entries, and `settlements` is
   * the list of *suggested* transfers, not the recorded settlement
   * expenses. Needs at least one member; otherwise it shows an info
   * message.
   */
  function handleDownloadSummaryCsv() {
    if (!memberSummary.length) {
      setInfo('Add at least one member before downloading the summary CSV.');
      return;
    }

    downloadSummaryCsv({
      tripName: selectedTrip?.name || 'Trip group',
      totalSpent,
      memberSummary,
      settlements
    });
    setInfo('Settlement summary CSV downloaded.');
  }

  /**
   * Generates and downloads the PDF report through `exportTripReportPdf`.
   * Needs at least one member or expense. While it runs `pdfExporting` is
   * true (which disables the button) and an info message says so; on
   * success the message changes to "PDF downloaded successfully."; on
   * failure a generic error banner is shown - the underlying error is
   * neither logged nor displayed. `pdfExporting` is reset in every case.
   *
   * @returns {Promise<void>}
   */
  async function handleExportPdf() {
    if (!memberSummary.length && !expenses.length) {
      setInfo('Add members or expenses before exporting the PDF.');
      return;
    }

    setPdfExporting(true);
    setInfo('Generating PDF, please wait...');
    try {
      await exportTripReportPdf({
        tripName: selectedTrip?.name || 'Trip group',
        totalSpent,
        memberSummary,
        settlements,
        expenses,
        members
      });
      setInfo('PDF downloaded successfully.');
    } catch (err) {
      setError('Failed to generate PDF. Please try again.');
    } finally {
      setPdfExporting(false);
    }
  }

  /**
   * Creates an invitation for the open trip through the
   * `create_trip_invitation` RPC, then reloads the trip so the new
   * invite appears in the active list. Does nothing in local mode and
   * needs admin/owner rights (checked here for a friendly message; the
   * RPC enforces it too). The invitation expires after 7 days, the RPC's
   * default.
   *
   * Known issue: the info message carrying the new link is cleared by
   * the reload, so it is not seen; the link is still in the Active
   * invites list.
   *
   * @param {{invited_email: string|null, role: string}} details - `invited_email` restricts who can accept it (`null` allows any signed-in user); `role` is `'member'` or `'admin'`.
   * @returns {Promise<void>}
   */
  async function handleCreateInvite({ invited_email, role }) {
    if (!selectedTripId || isLocalMode) return;
    if (!isAdmin) {
      setError('Only owner/admin can create invites.');
      return;
    }

    setError('');
    const { data: newInvite, error: inviteError } = await supabase.rpc('create_trip_invitation', {
      p_trip_id: selectedTripId,
      p_invited_email: invited_email,
      p_role: role
    });

    if (inviteError) {
      setError(getFriendlyErrorMessage(inviteError));
      return;
    }

    if (newInvite?.token) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${newInvite.token}`;
      setInfo(`Invite link created: ${inviteUrl}`);
    }

    await loadTripData(selectedTripId);
  }

  /**
   * Removes a user's access to the open trip through the
   * `remove_trip_member` RPC; the database refuses to remove the last
   * owner. Does nothing in local mode and needs admin/owner rights. It
   * asks for no confirmation itself - `GroupAccessPanel` does. The
   * user's `members` row (the name in past expenses) is kept. Afterwards
   * it refreshes the home list and then reopens the same trip.
   *
   * @param {string} userId - The auth user id, not the `members` id.
   * @returns {Promise<void>}
   */
  async function handleRemoveTripMember(userId) {
    if (!selectedTripId || isLocalMode) return;
    if (!isAdmin) {
      setError('Only owner/admin can remove users.');
      return;
    }
    const activeTripId = selectedTripId;

    const { error: removeError } = await supabase.rpc('remove_trip_member', {
      p_trip_id: activeTripId,
      p_user_id: userId
    });

    if (removeError) {
      setError(getFriendlyErrorMessage(removeError));
      return;
    }

    await loadHomeData();
    await loadTripData(activeTripId);
  }

  /**
   * Changes a user's role in the open trip through the
   * `update_trip_member_role` RPC. Does nothing in local mode. Owner
   * only: checked here for a friendly message and enforced by the
   * database, which also refuses to demote the last owner. It changes
   * only the target user's role - nobody else's - and reloads the trip.
   * Confirmations are `GroupAccessPanel`'s job.
   *
   * @param {string} userId - The auth user id.
   * @param {string} role - `'member'`, `'admin'` or `'owner'`.
   * @returns {Promise<void>}
   */
  async function handleUpdateRole(userId, role) {
    if (!selectedTripId || isLocalMode) return;
    if (!isOwner) {
      setError('Only owner can change roles.');
      return;
    }

    const { error: roleError } = await supabase.rpc('update_trip_member_role', {
      p_trip_id: selectedTripId,
      p_user_id: userId,
      p_role: role
    });

    if (roleError) {
      setError(getFriendlyErrorMessage(roleError));
      return;
    }

    await loadTripData(selectedTripId);
  }

  /*
   * Derived values, recomputed only when their inputs change.
   * - memberSummary: each member's paid / share / net (lib/balances.js).
   *   Settlement expenses are included, because they are real payments.
   * - balances: an unchanged copy of memberSummary; the extra step has
   *   no effect.
   * - settlements: the *suggested* transfers that would settle the
   *   group, computed from balances. These are not the recorded
   *   settlement expenses.
   * - totalSpent: the sum of real expenses; settlement entries are
   *   excluded.
   * - memberMap: a { memberId: name } lookup for ExpensesList.
   * - headerAccountSlot: the compact account panel for the header; only
   *   present when signed in (Supabase mode).
   */
  const memberSummary = useMemo(() => computeMemberSummary(members, expenses), [members, expenses]);
  const balances = useMemo(
    () => memberSummary.map((member) => ({ ...member, balance: member.balance })),
    [memberSummary]
  );
  const settlements = useMemo(() => simplifySettlements(balances), [balances]);
  // Settlement rows are transfers between members, not spending - exclude them from the total.
  const totalSpent = useMemo(
    () => expenses.filter((item) => !item.is_settlement).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [expenses]
  );
  const memberMap = useMemo(() => Object.fromEntries(members.map((member) => [member.id, member.name])), [members]);
  const headerAccountSlot = !isLocalMode && session?.user ? (
    <AuthPanel
      session={session}
      profile={currentProfile}
      onSendOtp={handleSendOtp}
      onLogout={handleLogout}
      onUpdateDisplayName={handleUpdateDisplayName}
      compact
    />
  ) : null;

  /*
   * Page layout. From the top: the header; the sign-in card (Supabase
   * mode, signed out); the notices - demo-mode note, "Checking
   * authentication...", then the info and error banners; and finally the
   * content.
   * While `loading` is true the content is a loading card. Otherwise:
   * - Group view (a trip is open): group header; an "unclaimed" notice
   *   when the trip has no owner (Supabase mode, user has no role);
   *   members and the add-expense form; the access panel (Supabase mode,
   *   user is a member); balances; expense history.
   * - Home view: the invitation box (Supabase mode) and the trip list.
   */
  return (
    <div className="app-shell">
      <main className="container stack xl">
        <Header isLocalMode={isLocalMode} accountSlot={headerAccountSlot} />
        {!isLocalMode && !session?.user ? (
          <AuthPanel
            session={session}
            profile={currentProfile}
            onSendOtp={handleSendOtp}
            onLogout={handleLogout}
            onUpdateDisplayName={handleUpdateDisplayName}
          />
        ) : null}
        {isLocalMode ? (
          <div className="info-banner">
            Running in local demo mode. Add Supabase values to <code>.env</code> when you are ready to persist shared trip data.
          </div>
        ) : null}
        {authLoading ? <div className="card"><p>Checking authentication...</p></div> : null}
        {info ? <div className="info-banner">{info}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {loading ? <div className="card"><p>Loading trip data...</p></div> : (
          isGroupView ? (
            <>
              <GroupHeader
                tripName={selectedTrip?.name || 'Trip group'}
                totalSpent={totalSpent}
                role={currentRole}
                onBack={loadHomeData}
                onDownloadDetailedCsv={handleDownloadDetailedCsv}
                onDownloadSummaryCsv={handleDownloadSummaryCsv}
                onExportPdf={handleExportPdf}
                canDownloadDetailedCsv={expenses.length > 0}
                canDownloadSummaryCsv={memberSummary.length > 0}
                canExportPdf={(memberSummary.length > 0 || expenses.length > 0) && !pdfExporting}
                pdfExporting={pdfExporting}
                onArchive={handleArchiveCurrentTrip}
                canArchive={!isLocalMode && isAdmin}
              />
              {!isLocalMode && !currentRole ? (
                <div className="info-banner">
                  This trip is unclaimed. Go back to groups and click <strong>Claim ownership</strong> to manage access.
                </div>
              ) : null}
              <section className="grid-panel main-grid">
                <MembersPanel members={members} onAddMember={handleAddMember} canManageMembers={isAdmin} />
                <ExpenseForm members={members} onAddExpense={handleAddExpense} canAddExpenses={canAddExpenses} />
              </section>
              {!isLocalMode && currentRole ? (
                <GroupAccessPanel
                  session={session}
                  isOwner={isOwner}
                  isAdmin={isAdmin}
                  tripName={selectedTrip?.name || 'Trip group'}
                  memberships={groupMemberships}
                  invites={groupInvites}
                  pastInvites={groupPastInvites}
                  onCreateInvite={handleCreateInvite}
                  onRemoveMember={handleRemoveTripMember}
                  onUpdateRole={handleUpdateRole}
                />
              ) : null}
              <BalancesPanel
                memberSummary={memberSummary}
                settlements={settlements}
                onMarkSettled={handleMarkSettled}
                canMarkSettled={canAddExpenses}
              />
              <ExpensesList
                expenses={expenses}
                members={members}
                memberMap={memberMap}
                canManageExpenses={canAddExpenses}
                onEditExpense={handleEditExpense}
                onDeleteExpense={handleDeleteExpense}
              />
            </>
          ) : (
            <>
              {!isLocalMode ? (
                <InviteAcceptPanel disabled={!session?.user} onAcceptInvite={handleAcceptInvite} />
              ) : null}
              <HomeView
                trips={trips}
                onAddTrip={handleAddTrip}
                onOpenTrip={loadTripData}
                onClaimTrip={handleClaimTrip}
                onRestoreTrip={isLocalMode ? null : (tripId) => handleSetTripArchived(tripId, false)}
                canCreateTrips={canCreateTrips}
              />
            </>
          )
        )}
      </main>
    </div>
  );
}