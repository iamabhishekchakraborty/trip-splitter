function escapeCsvValue(value) {
  const normalized = value == null ? '' : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyFilePart(value) {
  return String(value || 'trip')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trip';
}

function downloadCsvFile(filename, rows) {
  const csvContent = rows
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatCurrency(value) {
  return Number(value || 0).toFixed(2);
}

function formatSplitType(value) {
  if (value === 'equal') return 'Equal split';
  if (value === 'manual') return 'Manual split';
  return value || '';
}

function formatNetStatus(value) {
  const amount = Number(value || 0);
  if (amount > 0.009) return 'Receives';
  if (amount < -0.009) return 'Pays';
  return 'Settled';
}

function formatDateValue(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTimeValue(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function downloadExpensesCsv({ tripName, expenses, members }) {
  const memberMap = Object.fromEntries((members || []).map((member) => [member.id, member.name]));
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = [
    'Trip Name',
    'Expense Date',
    'Description',
    'Total Amount',
    'Paid By',
    'Split Method',
    'Split Details',
    'Logged On',
    'Last Updated'
  ];

  const rows = (expenses || []).map((expense) => {
    const splitDetails = (expense.splits || []).length
      ? expense.splits
        .map((split) => `${memberMap[split.member_id] || 'Unknown'}: INR ${formatCurrency(split.share_amount)}`)
        .join('; ')
      : 'No split details';

    return [
      tripName || 'Trip group',
      expense.expense_date || '',
      expense.description || '',
      formatCurrency(expense.amount),
      memberMap[expense.paid_by] || 'Unknown',
      formatSplitType(expense.split_type),
      splitDetails,
      expense.created_at || '',
      expense.updated_at || ''
    ];
  });

  downloadCsvFile(`${slugifyFilePart(tripName)}-expenses-${stamp}.csv`, [headers, ...rows]);
}

export function downloadSummaryCsv({ tripName, totalSpent, memberSummary, settlements }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const generatedOn = formatDateTimeValue(new Date().toISOString());
  const memberRows = (memberSummary || []).map((member) => ([
    member.name || 'Unknown',
    formatCurrency(member.paid),
    formatCurrency(member.share),
    formatCurrency(member.balance),
    formatNetStatus(member.balance)
  ]));

  const settlementRows = (settlements || []).length
    ? settlements.map((item) => ([
      item.from,
      item.to,
      formatCurrency(item.amount)
    ]))
    : [['Everyone is settled', '', '']];

  const rows = [
    ['Trip Summary'],
    ['Trip Name', 'Total Spent', 'Generated On'],
    [tripName || 'Trip group', formatCurrency(totalSpent), generatedOn],
    [],
    ['Member Summary'],
    ['Member', 'Paid by Member', "Member's Share", 'Net Position', 'Status'],
    ...memberRows,
    [],
    ['Suggested Transfers'],
    ['From', 'To', 'Amount'],
    ...settlementRows
  ];

  downloadCsvFile(`${slugifyFilePart(tripName)}-settlement-summary-${stamp}.csv`, rows);
}

export function exportTripReportPdf({ tripName, totalSpent, memberSummary, settlements, expenses, members }) {
  const memberMap = Object.fromEntries((members || []).map((member) => [member.id, member.name]));
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');

  if (!printWindow) return false;

  const summaryRows = (memberSummary || []).map((member) => `
    <tr>
      <td>${escapeHtml(member.name)}</td>
      <td>INR ${formatCurrency(member.paid)}</td>
      <td>INR ${formatCurrency(member.share)}</td>
      <td>${member.balance >= 0 ? '+' : ''}INR ${formatCurrency(member.balance)}</td>
      <td>${formatNetStatus(member.balance)}</td>
    </tr>
  `).join('');

  const settlementRows = (settlements || []).length
    ? settlements.map((item) => `
      <tr>
        <td>${escapeHtml(item.from)}</td>
        <td>${escapeHtml(item.to)}</td>
        <td>INR ${formatCurrency(item.amount)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3">Everyone is settled.</td></tr>';

  const expenseBlocks = (expenses || []).map((expense) => {
    const splitItems = (expense.splits || []).length
      ? expense.splits.map((split) => `
        <li>${escapeHtml(memberMap[split.member_id] || 'Unknown')}: INR ${formatCurrency(split.share_amount)}</li>
      `).join('')
      : '<li>No split details</li>';

    return `
      <section class="expense-card">
        <div class="expense-head">
          <div>
            <h3>${escapeHtml(expense.description || 'Expense')}</h3>
            <p>${formatDateValue(expense.expense_date)} - Paid by ${escapeHtml(memberMap[expense.paid_by] || 'Unknown')}</p>
          </div>
          <strong>INR ${formatCurrency(expense.amount)}</strong>
        </div>
        <p>Split method: ${escapeHtml(formatSplitType(expense.split_type))}</p>
        <ul>${splitItems}</ul>
        <p class="meta">Logged ${formatDateTimeValue(expense.created_at)}${expense.updated_at && expense.updated_at !== expense.created_at ? ` - Updated ${formatDateTimeValue(expense.updated_at)}` : ''}</p>
      </section>
    `;
  }).join('');

  printWindow.document.write(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(tripName || 'Trip group')} report</title>
        <style>
          body { font-family: Arial, sans-serif; color: #28251d; margin: 32px; }
          h1, h2, h3, p { margin: 0; }
          .stack { display: grid; gap: 16px; }
          .topline { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 24px; }
          .muted { color: #6f6d67; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd7cb; font-size: 14px; }
          th { color: #6f6d67; font-weight: 600; }
          .section { margin-top: 28px; }
          .expense-card { border: 1px solid #ddd7cb; border-radius: 12px; padding: 16px; margin-top: 12px; }
          .expense-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
          ul { margin: 10px 0 0; padding-left: 18px; }
          li { margin: 4px 0; }
          .meta { margin-top: 10px; color: #6f6d67; font-size: 12px; }
          @media print {
            body { margin: 20px; }
            .expense-card { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="topline">
          <div class="stack">
            <p class="muted">Trip settlement report</p>
            <h1>${escapeHtml(tripName || 'Trip group')}</h1>
            <p class="muted">Generated ${escapeHtml(formatDateTimeValue(new Date().toISOString()))}</p>
          </div>
          <div class="stack" style="text-align:right;">
            <p class="muted">Total spent</p>
            <h2>INR ${formatCurrency(totalSpent)}</h2>
          </div>
        </div>

        <section class="section">
          <h2>Who paid what</h2>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Paid by member</th>
                <th>Member's share</th>
                <th>Net position</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${summaryRows}</tbody>
          </table>
        </section>

        <section class="section">
          <h2>How to settle up</h2>
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${settlementRows}</tbody>
          </table>
        </section>

        <section class="section">
          <h2>Expense details</h2>
          ${expenseBlocks || '<p class="muted">No expenses recorded yet.</p>'}
        </section>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
  return true;
}
