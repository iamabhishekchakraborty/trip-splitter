function escapeCsvValue(value) {
  const normalized = value == null ? '' : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
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
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function formatDateTimeValue(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── CSV exports ──────────────────────────────────────────────────────────────

export function downloadExpensesCsv({ tripName, expenses, members }) {
  const memberMap = Object.fromEntries((members || []).map((m) => [m.id, m.name]));
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = [
    'Trip Name', 'Expense Date', 'Description', 'Total Amount',
    'Paid By', 'Split Method', 'Split Details', 'Logged On', 'Last Updated'
  ];

  const rows = (expenses || []).map((expense) => {
    const splitDetails = (expense.splits || []).length
      ? expense.splits
          .map((s) => `${memberMap[s.member_id] || 'Unknown'}: INR ${formatCurrency(s.share_amount)}`)
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

  const memberRows = (memberSummary || []).map((m) => ([
    m.name || 'Unknown',
    formatCurrency(m.paid),
    formatCurrency(m.share),
    formatCurrency(m.balance),
    formatNetStatus(m.balance)
  ]));

  const settlementRows = (settlements || []).length
    ? settlements.map((s) => ([s.from, s.to, formatCurrency(s.amount)]))
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

// ─── PDF export — direct download, no popup ───────────────────────────────────

function buildReportHtml({ tripName, totalSpent, memberSummary, settlements, expenses, members }) {
  const memberMap = Object.fromEntries((members || []).map((m) => [m.id, m.name]));

  const summaryRows = (memberSummary || []).map((m) => `
    <tr>
      <td>${escapeHtml(m.name)}</td>
      <td>INR ${formatCurrency(m.paid)}</td>
      <td>INR ${formatCurrency(m.share)}</td>
      <td>${m.balance >= 0 ? '+' : ''}INR ${formatCurrency(m.balance)}</td>
      <td>${formatNetStatus(m.balance)}</td>
    </tr>
  `).join('');

  const settlementRows = (settlements || []).length
    ? settlements.map((s) => `
        <tr>
          <td>${escapeHtml(s.from)}</td>
          <td>${escapeHtml(s.to)}</td>
          <td>INR ${formatCurrency(s.amount)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3">Everyone is settled.</td></tr>';

  const expenseBlocks = (expenses || []).map((expense) => {
    const splitItems = (expense.splits || []).length
      ? expense.splits.map((s) => `
          <li>${escapeHtml(memberMap[s.member_id] || 'Unknown')}: INR ${formatCurrency(s.share_amount)}</li>
        `).join('')
      : '<li>No split details</li>';

    return `
      <div class="expense-card">
        <div class="expense-head">
          <div>
            <h3>${escapeHtml(expense.description || 'Expense')}</h3>
            <p>${formatDateValue(expense.expense_date)} · Paid by ${escapeHtml(memberMap[expense.paid_by] || 'Unknown')}</p>
          </div>
          <strong>INR ${formatCurrency(expense.amount)}</strong>
        </div>
        <p>Split: ${escapeHtml(formatSplitType(expense.split_type))}</p>
        <ul>${splitItems}</ul>
        <p class="meta">Logged ${formatDateTimeValue(expense.created_at)}${expense.updated_at && expense.updated_at !== expense.created_at ? ` · Updated ${formatDateTimeValue(expense.updated_at)}` : ''}</p>
      </div>
    `;
  }).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#28251d;padding:32px;width:860px;background:#fff;">

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;border-bottom:2px solid #ddd7cb;padding-bottom:16px;">
        <div>
          <p style="color:#6f6d67;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Trip settlement report</p>
          <h1 style="margin:0 0 6px;font-size:22px;">${escapeHtml(tripName || 'Trip group')}</h1>
          <p style="color:#6f6d67;font-size:12px;margin:0;">Generated ${escapeHtml(formatDateTimeValue(new Date().toISOString()))}</p>
        </div>
        <div style="text-align:right;">
          <p style="color:#6f6d67;font-size:12px;margin:0 0 4px;">Total spent</p>
          <h2 style="margin:0;font-size:20px;">INR ${formatCurrency(totalSpent)}</h2>
        </div>
      </div>

      <h2 style="font-size:15px;margin:0 0 10px;">Who paid what</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="border-bottom:1px solid #ddd7cb;">
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Member</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Paid</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Share</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Net</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Status</th>
          </tr>
        </thead>
        <tbody style="font-size:13px;">${summaryRows}</tbody>
      </table>

      <h2 style="font-size:15px;margin:0 0 10px;">How to settle up</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="border-bottom:1px solid #ddd7cb;">
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">From</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">To</th>
            <th style="text-align:left;padding:7px 6px;color:#6f6d67;font-size:12px;font-weight:600;">Amount</th>
          </tr>
        </thead>
        <tbody style="font-size:13px;">${settlementRows}</tbody>
      </table>

      <h2 style="font-size:15px;margin:0 0 10px;">Expense details</h2>
      ${expenseBlocks || '<p style="color:#6f6d67;font-size:13px;">No expenses recorded yet.</p>'}

      <style>
        .expense-card { border:1px solid #ddd7cb; border-radius:8px; padding:14px; margin-bottom:10px; font-size:13px; }
        .expense-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:6px; }
        .expense-head h3 { margin:0 0 3px; font-size:14px; }
        .expense-head p { margin:0; color:#6f6d67; font-size:12px; }
        .expense-card p { margin:4px 0; }
        .expense-card ul { margin:6px 0 0; padding-left:16px; }
        .expense-card li { margin:2px 0; }
        .meta { color:#6f6d67; font-size:11px; margin-top:8px !important; }
        tr td { padding:7px 6px; border-bottom:1px solid #f0ece4; }
      </style>
    </div>
  `;
}

export async function exportTripReportPdf({ tripName, totalSpent, memberSummary, settlements, expenses, members }) {
  // Dynamically import — only loaded when PDF button is clicked
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas')
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${slugifyFilePart(tripName)}-report-${stamp}.pdf`;

  // Mount an off-screen container so html2canvas can render it
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:#fff;';
  container.innerHTML = buildReportHtml({ tripName, totalSpent, memberSummary, settlements, expenses, members });
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container.firstElementChild, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: 860
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    // Paginate if report spans multiple pages
    let yOffset = 0;
    let remainingHeight = imgHeight;
    while (remainingHeight > 0) {
      pdf.addImage(imgData, 'PNG', 0, -yOffset, imgWidth, imgHeight);
      remainingHeight -= pageHeight;
      yOffset += pageHeight;
      if (remainingHeight > 0) pdf.addPage();
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}