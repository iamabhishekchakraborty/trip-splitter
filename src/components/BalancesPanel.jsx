export default function BalancesPanel({ balances, settlements }) {
  return (
    <section className="grid-panel">
      <article className="card stack">
        <div>
          <p className="eyebrow">Balances</p>
          <h2>Net position</h2>
        </div>
        <div className="stack compact">
          {balances.map((member) => (
            <div className="row between" key={member.id}>
              <span>{member.name}</span>
              <strong className={member.balance >= 0 ? 'positive' : 'negative'}>
                ₹{member.balance.toFixed(2)}
              </strong>
            </div>
          ))}
        </div>
      </article>
      <article className="card stack">
        <div>
          <p className="eyebrow">Settle up</p>
          <h2>Suggested transfers</h2>
        </div>
        <div className="stack compact">
          {settlements.length ? settlements.map((item, index) => (
            <div className="settlement" key={index}>
              <span>{item.from}</span>
              <span>pays</span>
              <span>{item.to}</span>
              <strong>₹{item.amount.toFixed(2)}</strong>
            </div>
          )) : <p className="muted">Everyone is settled.</p>}
        </div>
      </article>
    </section>
  );
}
