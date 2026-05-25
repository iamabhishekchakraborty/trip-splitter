import { useState } from 'react';

export default function HomeView({ trips, onAddTrip, onOpenTrip, onClaimTrip, canCreateTrips }) {
  const [name, setName] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddTrip(name.trim());
    setName('');
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
          {trips.length ? trips.map((trip) => (
            <article className="trip-tile" key={trip.id}>
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
              </div>
            </article>
          )) : (
            <div className="card">
              <p className="muted">No groups yet. Create your first trip group.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
