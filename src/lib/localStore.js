/**
 * "Local demo mode" data layer: the same trips/members/expenses shape
 * Supabase mode uses, persisted to a single `localStorage` key instead
 * of a database. This is what powers the app when `lib/supabase.js`
 * reports `hasSupabaseConfig === false` (no `.env`, or a placeholder
 * URL/key) - see `App.jsx`'s `isLocalMode` branches.
 *
 * There is no authentication, no roles, no invitations and no RLS in
 * this mode - every function here operates on one single shared
 * dataset in the current browser, as a single implicit "owner" user.
 * Functions that can fail (e.g. a duplicate name) `throw` a plain
 * `Error` with a user-facing message; callers in `App.jsx` catch it
 * and surface `error.message` directly, so throw messages should
 * always be safe to show as-is.
 */

/** localStorage key holding the entire local-mode dataset as a single JSON blob ({@link readData} / {@link writeData}). */
const STORAGE_KEY = 'trip-splitter:data';

/** Default dataset used the very first time the app runs in local mode (empty `localStorage`), and as the fallback if saved data is unreadable (see {@link readData}). Two sample trips with members already added so the app is not an empty screen on first run; no expenses, so balances start at zero. */
const seedData = {
  trips: [
    { id: 'trip-goa-2026', name: 'Goa2026', created_at: '2026-05-08T08:40:00.000Z' },
    { id: 'trip-darjeeling-2026', name: 'Darjeeling2026', created_at: '2026-05-08T08:41:00.000Z' }
  ],
  members: [
    { id: 'local-abhishek-goa', trip_id: 'trip-goa-2026', name: 'Abhishek', created_at: '2026-05-08T08:45:00.000Z' },
    { id: 'local-kazi-goa', trip_id: 'trip-goa-2026', name: 'Kazi', created_at: '2026-05-08T08:46:00.000Z' },
    { id: 'local-sayantan-goa', trip_id: 'trip-goa-2026', name: 'Sayantan', created_at: '2026-05-08T08:47:00.000Z' },
    { id: 'local-snehasish-darjeeling', trip_id: 'trip-darjeeling-2026', name: 'Snehasish', created_at: '2026-05-08T08:48:00.000Z' },
    { id: 'local-abhishek-darjeeling', trip_id: 'trip-darjeeling-2026', name: 'Abhishek', created_at: '2026-05-08T08:49:00.000Z' }
  ],
  expenses: []
};

/** Generates a locally-unique id (`crypto.randomUUID()` where available, otherwise a timestamp+random fallback for older browsers). Not a real UUID in the fallback path, but unique enough for one browser's local storage. */
function createId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Reads the local-mode dataset from `localStorage`, normalizing it
 * through {@link normalizeData} and writing the normalized result
 * back. Called at the start of every exported function in this file,
 * so storage is effectively re-validated on every read rather than
 * once at startup.
 *
 * Falls back to {@link seedData} (and clears `localStorage`) if
 * nothing is saved yet, or if the saved value fails to parse -
 * this is deliberately permissive so a corrupted local-mode dataset
 * degrades to "fresh demo data" instead of a crash.
 *
 * @returns {{trips: Array, members: Array, expenses: Array}}
 */
function readData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = normalizeData(JSON.parse(saved));
      writeData(parsed);
      return parsed;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  writeData(seedData);
  return seedData;
}

/** Serializes `data` and saves it to {@link STORAGE_KEY}. No validation - callers are expected to pass data already shaped like {@link seedData}. */
function writeData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Migrates older local-mode data shapes forward so a browser that has
 * been using the app since before multi-trip support still works.
 *
 * - If `data.trips` is already an array, the dataset is current-shape;
 *   the only normalization applied is backfilling `expense_date` on
 *   any expense that predates that field (derived from `created_at`,
 *   or today's date as a last resort).
 * - Otherwise this is pre-multi-trip data (a flat `members`/`expenses`
 *   list with no trips at all). If it is the *untouched* original
 *   three-name seed (`Amit`, `Priya`, `Rahul`, no expenses), it is
 *   discarded in favor of the current {@link seedData} rather than
 *   migrated, on the assumption the user never actually used it.
 *   Otherwise everything is wrapped into one synthesized
 *   `"First Trip"` trip so real user data is never silently dropped.
 *
 * @param {Object} data - Parsed `localStorage` content, old or new shape.
 * @returns {{trips: Array, members: Array, expenses: Array}}
 */
function normalizeData(data) {
  if (Array.isArray(data.trips)) {
    return {
      ...data,
      expenses: (data.expenses || []).map((expense) => ({
        ...expense,
        expense_date: expense.expense_date || (expense.created_at ? expense.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
      }))
    };
  }

  const legacySeedNames = ['Amit', 'Priya', 'Rahul'];
  const memberNames = (data.members || []).map((member) => member.name).sort();
  const isUntouchedLegacySeed =
    !(data.expenses || []).length &&
    legacySeedNames.length === memberNames.length &&
    legacySeedNames.every((name, index) => name === memberNames[index]);

  if (isUntouchedLegacySeed) return seedData;

  const defaultTrip = {
    id: 'trip-default',
    name: 'First Trip',
    created_at: new Date().toISOString()
  };

  return {
    trips: [defaultTrip],
    members: (data.members || []).map((member) => ({ ...member, trip_id: defaultTrip.id })),
    expenses: (data.expenses || []).map((expense) => ({
      ...expense,
      trip_id: defaultTrip.id,
      expense_date: expense.expense_date || (expense.created_at ? expense.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
    }))
  };
}

/**
 * Builds the per-trip summary cards shown on the home screen: member
 * count, expense count and total spent, oldest trip first. Mirrors
 * what `App.jsx`'s `buildTripSummaries` computes from Supabase data,
 * so the two modes present trips the same way.
 *
 * As in Supabase mode, settlement expenses
 * (`expense.is_settlement === true`) are excluded from both
 * `expenseCount` and `totalSpent` here, since they represent a
 * transfer between members rather than new spending.
 *
 * @param {{trips: Array, members: Array, expenses: Array}} data
 * @returns {Array<Object>} Each trip plus `memberCount`, `expenseCount`, `totalSpent`.
 */
function getTripSummaries(data) {
  return [...data.trips]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((trip) => {
      const tripMembers = data.members.filter((member) => member.trip_id === trip.id);
      // Settlement rows are transfers between members, not spending - keep them out of totals/counts.
      const tripExpenses = data.expenses.filter((expense) => expense.trip_id === trip.id && !expense.is_settlement);

      return {
        ...trip,
        memberCount: tripMembers.length,
        expenseCount: tripExpenses.length,
        totalSpent: tripExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      };
    });
}

/** Local-mode equivalent of `App.jsx`'s `loadHomeData`: returns the trip summary cards for the home screen. @returns {{trips: Array<Object>}} */
export function loadLocalHomeData() {
  const data = readData();
  return {
    trips: getTripSummaries(data)
  };
}

/**
 * Local-mode equivalent of `App.jsx`'s `loadTripData`: the full data
 * for one trip, with members and expenses pre-sorted the way the UI
 * expects them (members oldest-first, expenses newest-first by
 * expense date, then by creation time as a tiebreaker).
 *
 * @param {string} tripId
 * @returns {{trip: Object|undefined, members: Array, expenses: Array}} `trip` is `undefined` if `tripId` does not exist.
 */
export function loadLocalTripData(tripId) {
  const data = readData();
  const trip = data.trips.find((item) => item.id === tripId);

  return {
    trip,
    members: data.members
      .filter((member) => member.trip_id === tripId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    expenses: data.expenses
      .filter((expense) => expense.trip_id === tripId)
      .sort((a, b) => {
        const dateDiff = new Date(b.expense_date) - new Date(a.expense_date);
        if (dateDiff) return dateDiff;
        return new Date(b.created_at) - new Date(a.created_at);
      })
  };
}

/**
 * Creates a trip in local mode. Trip names are unique case-insensitively, matching the `trips.name` uniqueness constraint in the Supabase schema.
 * @param {string} name
 * @returns {Object} The newly created trip.
 * @throws {Error} `'That trip already exists.'` if the (trimmed, case-insensitive) name is already in use.
 */
export function addLocalTrip(name) {
  const data = readData();
  const normalizedName = name.trim();
  const existing = data.trips.some((trip) => trip.name.toLowerCase() === normalizedName.toLowerCase());
  if (existing) throw new Error('That trip already exists.');

  const trip = {
    id: createId('trip'),
    name: normalizedName,
    created_at: new Date().toISOString()
  };

  writeData({
    ...data,
    trips: [...data.trips, trip]
  });

  return trip;
}

/**
 * Adds a guest member name to a trip in local mode. There is no concept of a signed-in "member" here (no auth in local mode), so every member is effectively a guest name.
 * @param {string} tripId
 * @param {string} name
 * @throws {Error} `'That member already exists in this trip.'` if the (trimmed, case-insensitive) name is already a member of this trip.
 */
export function addLocalMember(tripId, name) {
  const data = readData();
  const normalizedName = name.trim();
  const existing = data.members.some(
    (member) => member.trip_id === tripId && member.name.toLowerCase() === normalizedName.toLowerCase()
  );
  if (existing) throw new Error('That member already exists in this trip.');

  writeData({
    ...data,
    members: [
      ...data.members,
      {
        id: createId('member'),
        trip_id: tripId,
        name: normalizedName,
        created_at: new Date().toISOString()
      }
    ]
  });
}

/**
 * Creates an expense (or settlement, if `payload.is_settlement` is
 * true) in local mode and prepends it to the trip's expense list.
 * Mirrors the shape `save_expense_with_splits` produces in Supabase
 * mode, including the `is_settlement` flag used by
 * `handleMarkSettled` in `App.jsx`.
 *
 * Unlike the Supabase RPC, this performs no server-side validation
 * (split totals summing to the amount, payer/split members actually
 * belonging to the trip, etc.) - `App.jsx` and `ExpenseForm.jsx`
 * validate before calling this.
 *
 * @param {string} tripId
 * @param {{description: string, amount: number|string, paid_by: string, split_type: string, expense_date: string, is_settlement?: boolean, splits: Array<{member_id: string, share_amount: number|string}>}} payload
 */
export function addLocalExpense(tripId, payload) {
  const data = readData();
  const expense = {
    id: createId('expense'),
    trip_id: tripId,
    description: payload.description,
    amount: Number(payload.amount),
    paid_by: payload.paid_by,
    split_type: payload.split_type,
    expense_date: payload.expense_date,
    is_settlement: Boolean(payload.is_settlement),
    created_at: new Date().toISOString(),
    splits: payload.splits.map((split) => ({
      member_id: split.member_id,
      share_amount: Number(split.share_amount)
    }))
  };

  writeData({
    ...data,
    expenses: [expense, ...data.expenses]
  });
}

/**
 * Edits an existing expense in local mode in place, replacing its
 * splits with `payload.splits`. A no-op if `expenseId`/`tripId` do not
 * match any existing expense (silently leaves the dataset unchanged,
 * same as if nothing happened - there is no "not found" error here).
 *
 * `is_settlement` is only overwritten if `payload.is_settlement` is
 * explicitly provided; otherwise the expense's existing value is kept
 * as-is. This matters for `ExpensesList.jsx`'s edit form, which always
 * passes the current `is_settlement` value through on save, so a
 * settlement entry cannot accidentally lose its flag mid-edit.
 *
 * @param {string} tripId
 * @param {string} expenseId
 * @param {Object} payload - Same shape as {@link addLocalExpense}'s `payload`, minus `is_settlement` being optional here.
 */
export function updateLocalExpense(tripId, expenseId, payload) {
  const data = readData();
  const updatedExpenses = data.expenses.map((expense) => {
    if (expense.id !== expenseId || expense.trip_id !== tripId) return expense;

    return {
      ...expense,
      description: payload.description,
      amount: Number(payload.amount),
      paid_by: payload.paid_by,
      split_type: payload.split_type,
      expense_date: payload.expense_date,
      is_settlement: payload.is_settlement !== undefined ? Boolean(payload.is_settlement) : expense.is_settlement,
      updated_at: new Date().toISOString(),
      splits: payload.splits.map((split) => ({
        member_id: split.member_id,
        share_amount: Number(split.share_amount)
      }))
    };
  });

  writeData({
    ...data,
    expenses: updatedExpenses
  });
}

/** Removes one expense from local mode. A no-op if no expense matches both `tripId` and `expenseId`.
 * @param {string} tripId
 * @param {string} expenseId
 */
export function deleteLocalExpense(tripId, expenseId) {
  const data = readData();
  writeData({
    ...data,
    expenses: data.expenses.filter((expense) => !(expense.id === expenseId && expense.trip_id === tripId))
  });
}