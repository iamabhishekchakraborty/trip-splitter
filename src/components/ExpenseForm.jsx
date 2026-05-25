import { useEffect, useMemo, useState } from 'react';
import { buildEqualSplits } from '../lib/balances';

function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
