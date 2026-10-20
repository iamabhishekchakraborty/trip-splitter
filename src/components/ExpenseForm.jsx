/**
 * The "add expense" form: description, amount, date, payer, split
 * type (equal/manual), and which members participate.
 *
 * Two effects keep the form coherent as `members`/`amount`/`splitType`
 * change:
 * 1. Whenever `members` changes, re-pick a valid `paidBy` if the
 *    current one is no longer a member, and drop any selected member
 *    ids that no longer exist (falling back to "all members selected"
 *    if that empties the selection).
 * 2. Whenever `splitType`/`amount`/`selectedMemberIds` change,
 *    recompute `manualSplits`: for `'equal'`, via `buildEqualSplits`
 *    (see `lib/balances.js` for the remainder-rounding rule); for
 *    `'manual'`, by keeping any already-entered share for a still-
 *    selected member and giving new members an empty input, so
 *    switching split type and back does not wipe manually entered
 *    numbers.
 *
 * This component does **not** validate that manual splits sum to the
 * amount before calling `onAddExpense` - that check happens in
 * `App.jsx`'s `handleAddExpense` (and again, authoritatively, in the
 * `save_expense_with_splits` RPC in Supabase mode). A mismatched
 * manual split is only caught after submit, as a `setError` banner
 * elsewhere in the page rather than inline on this form.
 */

import { useEffect, useMemo, useState } from 'react';
import { buildEqualSplits } from '../lib/balances';

/** Today's date as a `YYYY-MM-DD` string, suitable for an `<input type="date">` value - used both as the initial `expenseDate` and to reset it after a successful submit. */
function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * @param {Object} props
 * @param {Array<{id: string, name: string}>} props.members - Trip members eligible as payer/split participants. An empty list disables every field and shows a prompt to add a member first.
 * @param {(payload: {description: string, amount: number, expense_date: string, paid_by: string, split_type: string, splits: Array<{member_id: string, share_amount: number}>}) => Promise<void>} props.onAddExpense - Called on submit with amounts already coerced to `Number`. The form resets (except `paidBy`, which is left as-is) once this resolves - it is not wrapped in try/catch here, so a rejection would propagate; in practice `App.jsx`'s `handleAddExpense` always resolves and reports errors itself via `setError`.
 * @param {boolean} props.canAddExpenses - Disables every field and the submit button, and shows an explanatory message, when `false`.
 */
export default function ExpenseForm({ members, onAddExpense, canAddExpenses }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(getTodayInputValue);
  const [paidBy, setPaidBy] = useState('');
  const [splitType, setSplitType] = useState('equal');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [manualSplits, setManualSplits] = useState([]);
  const [formError, setFormError] = useState('');
  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  const selectedMembers = useMemo(
    () => members.filter((member) => selectedMemberIds.includes(member.id)),
    [members, selectedMemberIds]
  );

  useEffect(() => {
    if (!members.length) {
      setPaidBy('');
      setSelectedMemberIds([]);
      return;
    }

    if (!memberIds.includes(paidBy)) setPaidBy(members[0].id);
    setSelectedMemberIds((current) => {
      const validCurrent = current.filter((id) => memberIds.includes(id));
      return validCurrent.length ? validCurrent : memberIds;
    });
  }, [memberIds, members, paidBy]);

  useEffect(() => {
    if (splitType === 'equal') {
      setManualSplits(buildEqualSplits(selectedMemberIds, amount));
      return;
    }

    setManualSplits((current) => selectedMemberIds.map((id) => {
      const existing = current.find((item) => item.member_id === id);
      return existing || { member_id: id, share_amount: '' };
    }));
  }, [splitType, amount, selectedMemberIds]);

    /** Adds or removes `memberId` from `selectedMemberIds`. */
  function toggleSplitMember(memberId) {
    setSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  }

    /** Updates one member's manual split amount, leaving it as the raw (possibly invalid/empty) string from the input until submit, where it is coerced with `Number(... || 0)`. */
  function updateManualShare(memberId, value) {
    setManualSplits((current) => current.map((item) => (
      item.member_id === memberId ? { ...item, share_amount: value } : item
    )));
  }

    /** Validates only what this form can check locally (membership selected, required fields present) and delegates everything else - including the split-sum check - to `onAddExpense`'s caller. See the file header for what is deliberately *not* validated here. */
  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    if (!canAddExpenses) {
      setFormError('Join or claim this group before adding expenses.');
      return;
    }

    if (!description || !amount || !expenseDate || !paidBy || !members.length) return;

    if (!selectedMemberIds.length) {
      setFormError('Select at least one member to split this expense.');
      return;
    }

    const splits = splitType === 'equal'
      ? buildEqualSplits(selectedMemberIds, amount)
      : manualSplits.map((item) => ({ ...item, share_amount: Number(item.share_amount || 0) }));

    await onAddExpense({
      description,
      amount: Number(amount),
      expense_date: expenseDate,
      paid_by: paidBy,
      split_type: splitType,
      splits
    });

    setDescription('');
    setAmount('');
    setExpenseDate(getTodayInputValue());
    setSplitType('equal');
    setSelectedMemberIds(memberIds);
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Add expense</p>
        <h2>Log a payment</h2>
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        {!members.length ? (
          <p className="muted">
            No trip members yet. Add at least one member before logging expenses.
          </p>
        ) : null}
        <label>
          <span>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Cab from airport"
            disabled={!canAddExpenses || !members.length}
          />
        </label>
        <div className="split-grid two">
          <label>
            <span>Amount</span>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1800"
              disabled={!canAddExpenses || !members.length}
            />
          </label>
          <label>
            <span>Expense date</span>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={!canAddExpenses || !members.length}
            />
          </label>
        </div>
        <div className="split-grid two">
          <label>
            <span>Paid by</span>
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} disabled={!canAddExpenses || !members.length}>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
        </div>
        <label>
          <span>Split type</span>
          <select value={splitType} onChange={(e) => setSplitType(e.target.value)} disabled={!canAddExpenses || !members.length}>
            <option value="equal">Equal</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <div className="stack subdued-panel">
          <div>
            <p className="eyebrow">Split between</p>
            <p className="muted">Selected members only are included in this expense.</p>
          </div>
          <div className="check-grid">
            {members.map((member) => (
              <label className="check-option" key={member.id}>
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(member.id)}
                  disabled={!canAddExpenses || !members.length}
                  onChange={() => toggleSplitMember(member.id)}
                />
                <span>{member.name}</span>
              </label>
            ))}
          </div>
        </div>
        {splitType === 'manual' && (
          <div className="stack subdued-panel">
            {selectedMembers.map((member) => {
              const split = manualSplits.find((item) => item.member_id === member.id);
              return (
                <label key={member.id}>
                  <span>{member.name}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={split?.share_amount ?? ''}
                    disabled={!canAddExpenses || !members.length}
                    onChange={(e) => updateManualShare(member.id, e.target.value)}
                    placeholder="0"
                  />
                </label>
              );
            })}
          </div>
        )}
        {formError ? <p className="form-error">{formError}</p> : null}
        <button type="submit" disabled={!canAddExpenses || !members.length}>Save expense</button>
        {!canAddExpenses ? <p className="muted">Only active group users can add expenses.</p> : null}
      </form>
    </section>
  );
}