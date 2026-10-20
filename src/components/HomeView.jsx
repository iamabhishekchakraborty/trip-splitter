/**
 * Home screen: create a trip, browse active trips as tiles, and (in
 * Supabase mode) a collapsed list of archived trips with a restore
 * action. `trips` already carries a per-trip summary (member/expense
 * counts, total spent) computed upstream - `App.jsx`'s
 * `buildTripSummaries` in Supabase mode, `lib/localStore.js`'s
 * `getTripSummaries` in local mode - this component only renders it.
 *
 * Local mode has no archiving (there is no `trips.archived_at` concept
 * in `lib/localStore.js`), so `archivedTrips` is always empty there
 * and the "Show archived groups" section never renders - not a
 * special case this component handles, just a consequence of every
 * local-mode trip having a falsy `archived_at`.
 */

import { useMemo, useState } from 'react';

/**
 * @param {Object} props
 * @param {Array<Object>} props.trips - Trip summaries; each may have `accessRole` (`'owner'`/`'admin'`/`'member'`, or falsy for an unclaimed legacy trip) and `archived_at`.
 * @param {(name: string) => Promise<void>} props.onAddTrip
 * @param {(tripId: string) => void} props.onOpenTrip
 * @param {(tripId: string) => void} props.onClaimTrip - Shown only on trips with no `accessRole`.
 * @param {((tripId: string) => void)|null} [props.onRestoreTrip] - `null` in local mode (no archiving there); shown per-trip only when truthy **and** the trip is archived **and** the caller's `accessRole` is `'owner'`/`'admin'`.
 * @param {boolean} props.canCreateTrips
 */
export default function HomeView({ trips, onAddTrip, onOpenTrip, onClaimTrip, onRestoreTrip, canCreateTrips }) {
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const activeTrips = useMemo(() => trips.filter((trip) => !trip.archived_at), [trips]);
  const archivedTrips = useMemo(() => trips.filter((trip) => trip.archived_at), [trips]);

  /** Create-group submit: ignores an empty (whitespace-only) name; otherwise passes the trimmed name to `onAddTrip` and clears the input once that resolves, whether or not the group was created - `App.jsx` reports failures such as a duplicate trip name in a banner, so the typed name is lost in that case. */
  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddTrip(name.trim());
    setName('');
  }

    /** Renders one trip tile. `{ archived }` only controls the visual dimming and whether a Restore button can appear - it does not re-derive "is this trip archived" from `trip.archived_at` itself, so it must be passed consistently by the caller (it is: `true` only from the archived-trips map below). */
  function renderTripTile(trip, { archived } = {}) {
    const canManage = trip.accessRole === 'owner' || trip.accessRole === 'admin';
    return (
      <article className="trip-tile" key={trip.id} style={archived ? { opacity: 0.7 } : undefined}>
        <span>
          <strong>{trip.name}</strong>
          <small>{trip.memberCount} members - {trip.expenseCount} expenses</small>
          <small>{trip.accessRole ? `Your role: ${trip.accessRole}` : 'Unclaimed group'}</small>
        </span>
        <span className="trip-total">
          <small>Total spent</small>
          <strong>INR {Number(trip.totalSpent || 0).toFixed(2)}</strong>
        </span>
        <div className="row wrap-gap">
          <button className="secondary-button" type="button" onClick={() => onOpenTrip(trip.id)}>
            Open
          </button>
          {!trip.accessRole ? (
            <button className="secondary-button" type="button" onClick={() => onClaimTrip(trip.id)}>
              Claim ownership
            </button>
          ) : null}
          {archived && canManage && onRestoreTrip ? (
            <button className="secondary-button" type="button" onClick={() => onRestoreTrip(trip.id)}>
              Restore
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="stack xl">
      <section className="card stack">
        <div>
          <p className="eyebrow">Groups</p>
          <h2>Create trip group</h2>
        </div>
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goa2026"
            disabled={!canCreateTrips}
          />
          <button type="submit" disabled={!canCreateTrips}>Create</button>
        </form>
        {!canCreateTrips ? <p className="muted">Sign in to create a new group.</p> : null}
      </section>

      <section className="stack">
        <div>
          <p className="eyebrow">Your groups</p>
          <h2>Select a trip</h2>
        </div>
        <div className="trip-grid">
          {activeTrips.length ? activeTrips.map((trip) => renderTripTile(trip)) : (
            <div className="card">
              <p className="muted">No active groups yet. Create your first trip group.</p>
            </div>
          )}
        </div>
      </section>

      {archivedTrips.length ? (
        <section className="stack">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived groups' : `Show archived groups (${archivedTrips.length})`}
          </button>
          {showArchived ? (
            <div className="trip-grid">
              {archivedTrips.map((trip) => renderTripTile(trip, { archived: true }))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}