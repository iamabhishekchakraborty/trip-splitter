/**
 * Expense history: one card per expense (settlements styled
 * distinctly - money-with-wings icon, "Settlement" chip - per
 * `expense.is_settlement`), each with an inline edit form and delete.
 *
 * The edit form shares its two-effect split-recalculation pattern with
 * `ExpenseForm.jsx` (load the record into form state, then keep
 * `manualSplits` in sync as `amount`/`splitType`/`selectedMemberIds`
 * change) - with a deliberately different sync rule when editing a
 * settlement (`editingIsSettlement`): a settlement always has exactly
 * one fixed recipient and no participant list, so instead of running
 * `buildEqualSplits`/the multi-member manual-recompute path, the
 * single existing split's amount is kept directly in sync with the
 * `amount` field (no division, so no rounding drift). This both fixes
 * the original bug (editing an unrelated field like the date used to
 * reintroduce floating-point drift, e.g. 8480.77 -> 8480.7699999...,
 * which failed `App.jsx`'s "split total must match amount" check) and
 * makes editing a settlement's amount work correctly, which the
 * original fix did not support.
 *
 * To keep the UI honest about what editing a settlement can and can't
 * change, the Split type selector and participant checkboxes are not
 * rendered at all while `editingIsSettlement` is true (replaced with a
 * short explanatory note) - both would otherwise let a save discard
 * the settlement's fixed recipient (checkboxes) or, worse, silently
 * re-split the amount across multiple members via `buildEqualSplits`
 * (switching Split type to "equal"). `editingIsSettlement` itself is
 * seeded from `expense.is_settlement` when editing starts and passed
 * straight back through on save - there is no control anywhere in
 * this form that changes whether an expense is a settlement.
 */

import { useEffect, useMemo, useState } from 'react';
import { buildEqualSplits } from '../lib/balances';

/** Formats a full timestamp (e.g. `created_at`/`updated_at`) for display, or `'Unknown time'` for a falsy/unparseable value. */
function formatLoggedAt(value) {
  if (!value) return 'Unknown time';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

/** Formats a date-only value (`expense_date`) for display. Appends `T00:00:00` before parsing so the date is interpreted in the local timezone rather than as UTC midnight (which could otherwise display as the previous day in timezones behind UTC). `'Unknown date'` for a falsy/unparseable value. */
function formatExpenseDate(value) {
  if (!value) return 'Unknown date';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium'
  }).format(date);
}

/**
 * @param {Object} props
 * @param {Array<Object>} props.expenses - Newest-first (by the sort order `App.jsx`/`lib/localStore.js` already applied). Each needs `splits` already attached.
 * @param {Array<{id: string, name: string}>} props.members - All trip members, for the "Paid by" / participant selectors in the edit form (distinct from `memberMap`, which is for display).
 * @param {Object<string, string>} props.memberMap - `member_id -> name` lookup, used to render "Paid by X" and each split chip without re-scanning `members`.
 * @param {boolean} props.canManageExpenses - Shows/hides the Edit and Delete buttons entirely (not just disables them). Server-side, edit/delete is further restricted to the expense's creator or a group admin/owner - this prop does not encode that distinction, so a `true` here does not guarantee every edit/delete will succeed.
 * @param {(expenseId: string, payload: Object) => Promise<boolean>} props.onEditExpense - Resolves `true` on success (closes the edit form) or `false` on failure (leaves it open so the user can retry) - unlike `ExpenseForm.jsx`'s `onAddExpense`, which has no return value contract.
 * @param {(expenseId: string) => void} props.onDeleteExpense - Called when Delete is clicked. This component asks for no confirmation itself; `App.jsx`'s `handleDeleteExpense` shows the confirmation dialog before anything is deleted.
 */
export default function ExpensesList({
  expenses,
  members,
  memberMap,
  canManageExpenses,
  onEditExpense,
  onDeleteExpense
}) {
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [editingIsSettlement, setEditingIsSettlement] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitType, setSplitType] = useState('equal');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [manualSplits, setManualSplits] = useState([]);
  const [formError, setFormError] = useState('');
  const memberIds = useMemo(() => members.map((member) => member.id), [members]);

  useEffect(() => {
    if (!editingExpenseId) return;

    const expense = expenses.find((item) => item.id === editingExpenseId);
    if (!expense) {
      cancelEditing();
      return;
    }

    setDescription(expense.description);
    setAmount(String(expense.amount));
    setExpenseDate(expense.expense_date);
    setPaidBy(expense.paid_by);
    setSplitType(expense.split_type);
    setEditingIsSettlement(Boolean(expense.is_settlement));
    const splitMemberIds = expense.splits.map((split) => split.member_id);
    setSelectedMemberIds(splitMemberIds);
    setManualSplits(expense.splits.map((split) => ({
      member_id: split.member_id,
      share_amount: split.share_amount
    })));
  }, [editingExpenseId, expenses]);

  useEffect(() => {
    if (!editingExpenseId) return;

    if (editingIsSettlement) {
      // A settlement has exactly one fixed recipient (whoever the
      // original split named) and no participant picker applies to it.
      // Keep that single split's amount in sync with the amount field
      // directly (no division, so no rounding drift) - this makes
      // editing a settlement's amount work correctly, while editing
      // anything else (date, description, payer) leaves the split
      // numerically untouched, same as before.
      setManualSplits((current) => {
        const recipientId = current[0]?.member_id;
        return recipientId ? [{ member_id: recipientId, share_amount: amount }] : current;
      });
      return;
    }

    if (splitType === 'equal') {
      setManualSplits(buildEqualSplits(selectedMemberIds, amount));
      return;
    }
    setManualSplits((current) => selectedMemberIds.map((id) => {
      const existing = current.find((item) => item.member_id === id);
      return existing || { member_id: id, share_amount: '' };
    }));
  }, [amount, editingExpenseId, editingIsSettlement, selectedMemberIds, splitType]);

  /** Resets every edit-form field and exits edit mode. Called directly on Cancel, and also from the load-expense effect below if the expense being edited disappears from `expenses` (e.g. it was deleted in another tab/session). */
  function cancelEditing() {
    setEditingExpenseId('');
    setDescription('');
    setAmount('');
    setExpenseDate('');
    setPaidBy('');
    setSplitType('equal');
    setEditingIsSettlement(false);
    setSelectedMemberIds([]);
    setManualSplits([]);
    setFormError('');
  }

  /** Enters edit mode for one expense; the effect above then populates the form fields from it. */
  function startEditing(expense) {
    setEditingExpenseId(expense.id);
    setFormError('');
  }

  /** Adds `memberId` to `selectedMemberIds`, or removes it if already selected, while editing. Only reachable for regular expenses - the participant checkboxes are not rendered when editing a settlement. */
  function toggleSplitMember(memberId) {
    setSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  }

  /** Stores one member's manual share while editing, keeping the raw input string as typed (it is converted with `Number(...)` on save) and touching only that member's `manualSplits` entry. Not used for settlements, whose single split follows the amount field instead. */
  function updateManualShare(memberId, value) {
    setManualSplits((current) => current.map((item) => (
      item.member_id === memberId ? { ...item, share_amount: value } : item
    )));
  }

  /** Builds the splits payload the same way `ExpenseForm.jsx` does (no split-sum validation here either - see this file's header and `ExpenseForm.jsx`'s header for where that check actually happens) and calls `onEditExpense`, exiting edit mode only if it reports success. */
  async function handleSaveEdit(e) {
    e.preventDefault();
    setFormError('');

    if (!description || !amount || !expenseDate || !paidBy || !memberIds.length) return;
    if (!selectedMemberIds.length) {
      setFormError('Select at least one member for split.');
      return;
    }

    const splits = splitType === 'equal'
      ? buildEqualSplits(selectedMemberIds, amount)
      : manualSplits.map((item) => ({ ...item, share_amount: Number(item.share_amount || 0) }));

    const didSave = await onEditExpense(editingExpenseId, {
      description,
      amount: Number(amount),
      expense_date: expenseDate,
      paid_by: paidBy,
      split_type: splitType,
      is_settlement: editingIsSettlement,
      splits
    });

    if (didSave) cancelEditing();
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">History</p>
        <h2>Expenses</h2>
      </div>
      <div className="stack compact">
        {expenses.length ? expenses.map((expense) => (
          <article className={`expense-item${expense.is_settlement ? ' settlement-item' : ''}`} key={expense.id}>
            <div className="row between wrap-gap">
              <div className="stack mini">
                <strong>
                  {expense.is_settlement ? '\ud83d\udcb8 ' : ''}{expense.description}
                  {expense.is_settlement ? <span className="chip subtle settlement-chip">Settlement</span> : null}
                </strong>
                <p className="muted">
                  Paid by {memberMap[expense.paid_by] || 'Unknown'} - {expense.is_settlement ? 'Settlement payment' : expense.split_type}
                </p>
                <p className="muted">Expense date {formatExpenseDate(expense.expense_date)}</p>
                <p className="muted">Logged {formatLoggedAt(expense.created_at)}</p>
                {expense.updated_at && expense.updated_at !== expense.created_at ? (
                  <p className="muted">Updated {formatLoggedAt(expense.updated_at)}</p>
                ) : null}
              </div>
              <div className="stack mini align-end-text">
                <strong>INR {Number(expense.amount).toFixed(2)}</strong>
                {canManageExpenses ? (
                  <div className="row wrap-gap">
                    <button className="secondary-button small" type="button" onClick={() => startEditing(expense)}>
                      Edit
                    </button>
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() => onDeleteExpense(expense.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="chip-row">
              {expense.splits.map((split, index) => (
                <span className="chip subtle" key={index}>
                  {memberMap[split.member_id]}: INR {Number(split.share_amount).toFixed(2)}
                </span>
              ))}
            </div>
            {editingExpenseId === expense.id ? (
              <form className="stack subdued-panel" onSubmit={handleSaveEdit}>
                <div className="split-grid two">
                  <label>
                    <span>Description</span>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} />
                  </label>
                  <label>
                    <span>Amount</span>
                    <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                </div>
                <div className="split-grid two">
                  <label>
                    <span>Expense date</span>
                    <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
                  </label>
                  <label>
                    <span>Paid by</span>
                    <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {editingIsSettlement ? (
                  <p className="muted">
                    This is a settlement payment to {memberMap[manualSplits[0]?.member_id] || 'the recipient'} for the full amount.
                    Its split type and participants are fixed - to change who is involved, delete this entry and record a new settlement instead.
                  </p>
                ) : (
                  <>
                    <label>
                      <span>Split type</span>
                      <select value={splitType} onChange={(e) => setSplitType(e.target.value)}>
                        <option value="equal">Equal</option>
                        <option value="manual">Manual</option>
                      </select>
                    </label>
                    <div className="check-grid">
                      {members.map((member) => (
                        <label className="check-option" key={member.id}>
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.includes(member.id)}
                            onChange={() => toggleSplitMember(member.id)}
                          />
                          <span>{member.name}</span>
                        </label>
                      ))}
                    </div>
                    {splitType === 'manual' ? (
                      <div className="stack compact">
                        {selectedMemberIds.map((memberId) => {
                          const split = manualSplits.find((item) => item.member_id === memberId);
                          return (
                            <label key={memberId}>
                              <span>{memberMap[memberId] || 'Unknown'}</span>
                              <input
                                type="number"
                                step="0.01"
                                value={split?.share_amount ?? ''}
                                onChange={(e) => updateManualShare(memberId, e.target.value)}
                              />
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                )}
                {formError ? <p className="form-error">{formError}</p> : null}
                <div className="row wrap-gap">
                  <button type="submit">Save changes</button>
                  <button type="button" className="secondary-button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </article>
        )) : <p className="muted">No expenses yet. Add the first shared spend.</p>}
      </div>
    </section>
  );
}