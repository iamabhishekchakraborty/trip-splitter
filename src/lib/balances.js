/**
 * Pure, framework-free balance and split calculations shared by both
 * Supabase mode and local demo mode (`lib/localStore.js`). Nothing in
 * this file reads or writes state - every function takes plain data in
 * and returns plain data out, which is what keeps it usable from either
 * data source and easy to unit test in isolation.
 *
 * All monetary values are plain JavaScript numbers rounded to 2 decimal
 * places with `Number(x.toFixed(2))`. This is adequate for the amounts
 * typically involved in trip-splitting, but is not exact decimal
 * arithmetic - see the note on `buildEqualSplits` for the one place
 * rounding behaviour actually matters to correctness.
 */

/**
 * Computes how much each member paid, how much they owe (their share),
 * and their net balance across a set of expenses.
 *
 * Settlement rows (`expense.is_settlement === true`) are **not** filtered
 * out here - they are ordinary expenses as far as this function is
 * concerned, which is exactly what makes "Mark as settled" work: a
 * settlement is a real expense where the debtor pays the creditor's
 * share in full, so including it nets their balance back towards zero
 * using the same math as any other expense. Callers that need a
 * spending total that excludes settlements (for example "Total spent"
 * on the group header) must filter `expenses` before calling this.
 *
 * A member who does not appear as a payer or in any split still gets a
 * `{ paid: 0, share: 0, balance: 0 }` entry, so the result always has
 * one row per member in `members`, in the same order.
 *
 * @param {Array<{id: string, name: string}>} members - Group members. Only `id` is read; other member fields (e.g. `name`) are passed through onto the result.
 * @param {Array<{paid_by: string, amount: number, is_settlement?: boolean, splits: Array<{member_id: string, share_amount: number}>}>} expenses - Expenses with their splits already attached (see `splits` normalization in `App.jsx`).
 * @returns {Array<Object>} One entry per input member, each the original member object plus `paid`, `share` and `balance` (all numbers rounded to 2 decimals). `balance = paid - share`; positive means the member is owed money, negative means they owe money.
 */
export function computeMemberSummary(members, expenses) {
  const summaryMap = Object.fromEntries(
    members.map((member) => [member.id, { paid: 0, share: 0 }])
  );

  expenses.forEach((expense) => {
    const amount = Number(expense.amount || 0);
    if (!summaryMap[expense.paid_by]) {
      summaryMap[expense.paid_by] = { paid: 0, share: 0 };
    }
    summaryMap[expense.paid_by].paid += amount;

    expense.splits.forEach((split) => {
      const shareAmount = Number(split.share_amount || 0);
      if (!summaryMap[split.member_id]) {
        summaryMap[split.member_id] = { paid: 0, share: 0 };
      }
      summaryMap[split.member_id].share += shareAmount;
    });
  });

  return members.map((member) => {
    const summary = summaryMap[member.id] || { paid: 0, share: 0 };
    const paid = Number(summary.paid.toFixed(2));
    const share = Number(summary.share.toFixed(2));

    return {
      ...member,
      paid,
      share,
      balance: Number((paid - share).toFixed(2))
    };
  });
}

/**
 * Convenience wrapper around {@link computeMemberSummary} that re-rounds
 * `balance` to 2 decimals.
 *
 * `computeMemberSummary` already returns a rounded `balance`, which makes
 * this function's extra rounding step a no-op in practice - and as of
 * this writing it is not called anywhere in the app (`App.jsx` calls
 * `computeMemberSummary` directly and derives its own `balances` value
 * from the result). It is kept here as a small, self-contained
 * convenience function in case a caller wants the summary and balances
 * in one call; remove it if it is still unused next time this file is
 * revisited.
 *
 * @param {Array<{id: string, name: string}>} members
 * @param {Array<Object>} expenses - Same shape as {@link computeMemberSummary}.
 * @returns {Array<Object>} Same shape as {@link computeMemberSummary}.
 */
export function computeBalances(members, expenses) {
  return computeMemberSummary(members, expenses).map((member) => ({
    ...member,
    balance: Number(member.balance.toFixed(2))
  }));
}

/**
 * Reduces a set of member balances to the minimum number of
 * peer-to-peer transfers that settle the group - the classic
 * debtors-pay-creditors greedy matching (largest debtor paired against
 * largest creditor, repeated until both lists are exhausted). This is
 * not guaranteed to be the global minimum number of transactions in
 * every possible balance configuration, but it is a good, simple
 * approximation and is what every "suggested transfers" list and the
 * `Mark as settled` button in `BalancesPanel.jsx` are built on.
 *
 * `fromId`/`toId` are included specifically so `App.jsx`'s
 * `handleMarkSettled` can record a real settlement expense (see
 * {@link computeMemberSummary}) without having to re-resolve a member
 * name back to an id.
 *
 * @param {Array<{id: string, name: string, balance: number}>} balances - Typically the output of {@link computeMemberSummary}.
 * @returns {Array<{from: string, to: string, fromId: string, toId: string, amount: number}>} One entry per suggested transfer, largest first. Empty array if the group is already settled (all balances within 0.009 of zero).
 */
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
      fromId: debtors[i].id,
      toId: creditors[j].id,
      amount
    });
    debtors[i].amount = Number((debtors[i].amount - amount).toFixed(2));
    creditors[j].amount = Number((creditors[j].amount - amount).toFixed(2));
    if (debtors[i].amount <= 0.009) i += 1;
    if (creditors[j].amount <= 0.009) j += 1;
  }

  return settlements;
}

/**
 * Splits an amount evenly across a set of members, with any leftover
 * paise from rounding assigned to the **last** member in `memberIds` so
 * the splits always sum exactly to `totalAmount`. This matters because
 * `save_expense_with_splits` (the Postgres RPC) rejects an expense if
 * its splits do not sum to the amount within 0.01 - without this
 * remainder correction, an equal split of e.g. 100 among 3 members
 * (33.33 x 3 = 99.99) would fail that server-side check.
 *
 * Used both when first choosing "Equal split" and whenever the amount
 * or participant list changes afterwards (`ExpenseForm.jsx`,
 * `ExpensesList.jsx`) - it is *not* applied to settlement expenses,
 * which always use a single manual split for the exact settled amount.
 *
 * @param {Array<string>} memberIds - Member ids to split across, in the order the remainder should be assigned (last id gets the remainder).
 * @param {number|string} totalAmount - The amount to split. Coerced with `Number(...)`.
 * @returns {Array<{member_id: string, share_amount: number}>} Empty array if `memberIds` is empty or `totalAmount` is falsy/zero.
 */
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