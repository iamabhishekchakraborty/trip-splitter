import { useMemo, useState } from 'react';

export default function HomeView({ trips, onAddTrip, onOpenTrip, onClaimTrip, onRestoreTrip, canCreateTrips }) {
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const activeTrips = useMemo(() => trips.filter((trip) => !trip.archived_at), [trips]);
  const archivedTrips = useMemo(() => trips.filter((trip) => trip.archived_at), [trips]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddTrip(name.trim());
    setName('');
  }

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