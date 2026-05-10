export function computeBalances(members, expenses) {
  const balanceMap = Object.fromEntries(members.map((member) => [member.id, 0]));

  expenses.forEach((expense) => {
    balanceMap[expense.paid_by] = (balanceMap[expense.paid_by] || 0) + Number(expense.amount);
    expense.splits.forEach((split) => {
      balanceMap[split.member_id] = (balanceMap[split.member_id] || 0) - Number(split.share_amount);
    });
  });

  return members.map((member) => ({
    ...member,
    balance: Number((balanceMap[member.id] || 0).toFixed(2))
  }));
}

export function simplifySettlements(balances) {
  const debtors = balances
    .filter((member) => member.balance < -0.009)
    .map((member) => ({ ...member, amount: Math.abs(member.balance) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((member) => member.balance > 0.009)
    .map((member) => ({ ...member, amount: member.balance }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Number(Math.min(debtors[i].amount, creditors[j].amount).toFixed(2));
    settlements.push({
      from: debtors[i].name,
      to: creditors[j].name,
      amount
    });
    debtors[i].amount = Number((debtors[i].amount - amount).toFixed(2));
    creditors[j].amount = Number((creditors[j].amount - amount).toFixed(2));
    if (debtors[i].amount <= 0.009) i += 1;
    if (creditors[j].amount <= 0.009) j += 1;
  }

  return settlements;
}

export function buildEqualSplits(memberIds, totalAmount) {
  const amount = Number(totalAmount || 0);
  if (!memberIds.length || !amount) return [];
  const base = Number((amount / memberIds.length).toFixed(2));
  const splits = memberIds.map((memberId) => ({ member_id: memberId, share_amount: base }));
  const assigned = Number((base * memberIds.length).toFixed(2));
  const diff = Number((amount - assigned).toFixed(2));
  if (diff !== 0) splits[splits.length - 1].share_amount = Number((splits[splits.length - 1].share_amount + diff).toFixed(2));
  return splits;
}
