function formatLoggedAt(value) {
  if (!value) return 'Unknown time';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export default function ExpensesList({ expenses, memberMap }) {
  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">History</p>
        <h2>Expenses</h2>
      </div>
      <div className="stack compact">
        {expenses.length ? expenses.map((expense) => (
          <article className="expense-item" key={expense.id}>
            <div className="row between wrap-gap">
              <div className="stack mini">
                <strong>{expense.description}</strong>
                <p className="muted">
                  Paid by {memberMap[expense.paid_by] || 'Unknown'} - {expense.split_type}
                </p>
                <p className="muted">Logged {formatLoggedAt(expense.created_at)}</p>
              </div>
              <strong>₹{Number(expense.amount).toFixed(2)}</strong>
            </div>
            <div className="chip-row">
              {expense.splits.map((split, index) => (
                <span className="chip subtle" key={index}>
                  {memberMap[split.member_id]}: ₹{Number(split.share_amount).toFixed(2)}
                </span>
              ))}
            </div>
          </article>
        )) : <p className="muted">No expenses yet. Add the first shared spend.</p>}
      </div>
    </section>
  );
}
