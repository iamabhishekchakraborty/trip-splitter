import { useState } from 'react';

export default function HomeView({ trips, onAddTrip, onOpenTrip }) {
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa2026" />
          <button type="submit">Create</button>
        </form>
      </section>

      <section className="stack">
        <div>
          <p className="eyebrow">Your groups</p>
          <h2>Select a trip</h2>
        </div>
        <div className="trip-grid">
          {trips.length ? trips.map((trip) => (
            <button className="trip-tile" type="button" key={trip.id} onClick={() => onOpenTrip(trip.id)}>
              <span>
                <strong>{trip.name}</strong>
                <small>{trip.memberCount} members · {trip.expenseCount} expenses</small>
              </span>
              <span className="trip-total">
                <small>Total spent</small>
                <strong>₹{Number(trip.totalSpent || 0).toFixed(2)}</strong>
              </span>
            </button>
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
