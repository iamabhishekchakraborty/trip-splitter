export default function GroupHeader({ tripName, totalSpent, role, onBack }) {
  return (
    <section className="group-header card">
      <button className="secondary-button" type="button" onClick={onBack}>Back to groups</button>
      <div>
        <p className="eyebrow">Active group</p>
        <h2>{tripName}</h2>
        <p className="muted">Your role: {role || 'member'}</p>
      </div>
      <div className="total-box">
        <span>Total spent</span>
        <strong>INR {totalSpent.toFixed(2)}</strong>
      </div>
    </section>
  );
}
