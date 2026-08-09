export default function BalancesPanel({ memberSummary, settlements, onMarkSettled, canMarkSettled }) {
  return (
    <section className="grid-panel">
      <article className="card stack">
        <div>
          <p className="eyebrow">Member summary</p>
          <h2>Who paid what</h2>
        </div>
        <div className="stack compact">
          <div className="summary-header">
            <span>Member</span>
            <span>Paid</span>
            <span>Share</span>
            <span>Net position</span>
          </div>
          {memberSummary.map((member) => (
            <div className="summary-row" key={member.id}>
              <span>{member.name}</span>
              <span>INR {member.paid.toFixed(2)}</span>
              <span>INR {member.share.toFixed(2)}</span>
              <strong className={member.balance >= 0 ? 'positive' : 'negative'}>
                INR {member.balance.toFixed(2)}
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
            <div className="settlement row between wrap-gap" key={index}>
              <div className="row wrap-gap">
                <span>{item.from}</span>
                <span>pays</span>
                <span>{item.to}</span>
                <strong>INR {item.amount.toFixed(2)}</strong>
              </div>
              {onMarkSettled ? (
                <button
                  type="button"
                  className="secondary-button small"
                  disabled={!canMarkSettled}
                  onClick={() => onMarkSettled(item)}
                  title={canMarkSettled ? 'Record this payment as settled' : 'Join this group to record settlements'}
                >
                  Mark as settled
                </button>
              ) : null}
            </div>
          )) : <p className="muted">Everyone is settled.</p>}
        </div>
      </article>
    </section>
  );
}