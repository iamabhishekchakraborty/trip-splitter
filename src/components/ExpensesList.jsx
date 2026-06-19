import { useEffect, useMemo, useState } from 'react';
import { buildEqualSplits } from '../lib/balances';

function formatLoggedAt(value) {
  if (!value) return 'Unknown time';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatExpenseDate(value) {
  if (!value) return 'Unknown date';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium'
  }).format(date);
}

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
    const editingExpense = expenses.find((item) => item.id === editingExpenseId);
    // For settlement expenses, never recalculate splits; preserve exact original amounts.
    if (editingIsSettlement || editingExpense?.is_settlement) return;

    if (splitType === 'equal') {
      setManualSplits(buildEqualSplits(selectedMemberIds, amount));
      return;
    }

    setManualSplits((current) => selectedMemberIds.map((id) => {
      const existing = current.find((item) => item.member_id === id);
      return existing || { member_id: id, share_amount: '' };
    }));
  }, [amount, editingExpenseId, editingIsSettlement, expenses, selectedMemberIds, splitType]);

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

  function startEditing(expense) {
    setEditingExpenseId(expense.id);
    setFormError('');
  }

  function toggleSplitMember(memberId) {
    setSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  }

  function updateManualShare(memberId, value) {
    setManualSplits((current) => current.map((item) => (
      item.member_id === memberId ? { ...item, share_amount: value } : item
    )));
  }

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
