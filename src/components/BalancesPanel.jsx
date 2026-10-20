/**
 * Two-card balances view: each member's paid/share/net position, and
 * the suggested transfers (from `lib/balances.js`'s
 * `simplifySettlements`) that bring the group to zero.
 *
 * `settlements` items (`{amount, from, fromId, to, toId}`) also carry
 * `fromId`/`toId`, which this component doesn't use directly but
 * passes straight through via `onMarkSettled(item)` - `App.jsx`'s
 * `handleMarkSettled` needs them to record a real settlement expense
 * without having to re-resolve a display name back to a member id.
 *
 * The CSV/PDF exports (`lib/exports.js`) currently include settlement
 * expenses indistinguishable from regular ones (by description text
 * only) - not something this component controls, but worth knowing
 * when reading "Mark as settled" alongside the export buttons in
 * `GroupHeader.jsx`.
 *
 * @param {Object} props
 * @param {Array<{id: string, name: string, paid: number, share: number, balance: number}>} props.memberSummary - From `lib/balances.js`'s `computeMemberSummary`.
 * @param {Array<{from: string, to: string, fromId: string, toId: string, amount: number}>} props.settlements - From `lib/balances.js`'s `simplifySettlements`. Empty array renders "Everyone is settled." instead of the transfer list.
 * @param {(settlement: Object) => void} [props.onMarkSettled] - Called with one `settlements` item when its button is clicked. When omitted, no "Mark as settled" button is rendered at all (not just disabled) - not currently exercised by `App.jsx`, which always passes a handler, but supported for a read-only use of this panel.
 * @param {boolean} [props.canMarkSettled] - Disables (but still renders, with an explanatory tooltip) the button when `false` - distinct from omitting `onMarkSettled`, which hides the button entirely.
 */
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