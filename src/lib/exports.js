/**
 * Client-side report generation: CSV and PDF exports for a trip group.
 * Everything here runs entirely in the browser - there is no server
 * round-trip for exports, which keeps them working the same way in
 * both Supabase mode and local demo mode. Files are produced as Blobs
 * (CSV) or an in-memory canvas (PDF) and handed to the browser's
 * native download mechanism.
 *
 * Settlement expenses (`expense.is_settlement === true`) are included
 * alongside regular ones in every export - they are never filtered
 * out, which matches `computeMemberSummary` in `lib/balances.js`
 * (also including settlements in each member's paid/share/net). Only
 * `App.jsx`'s "Total spent" figure excludes them, not the exports.
 *
 * Where an export lists individual expenses - {@link
 * downloadExpensesCsv} and the PDF's expense-details section in
 * {@link buildReportHtml} - a settlement row is explicitly marked
 * (a "Type" column in the CSV; the same money-with-wings icon and
 * "Settlement" label `ExpensesList.jsx` uses, in the PDF) so it can be
 * told apart from a real expense without having to parse its
 * description text. {@link downloadSummaryCsv} needs no such marking
 * since it never lists individual expenses - only aggregate per-member
 * totals and suggested transfers.
 */

/** Quotes a CSV field per RFC 4180 if it contains a comma, quote or newline; doubles any internal quotes. `null`/`undefined` become an empty string. */
function escapeCsvValue(value) {
  const normalized = value == null ? '' : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

/** Turns a trip name into a safe filename fragment (lowercase, `[a-z0-9]` and `-` only, no leading/trailing dashes). Falls back to `'trip'` for an empty or entirely non-alphanumeric name. Shared by all three export functions so filenames stay consistent, e.g. `goa-2026-expenses-2026-06-13.csv`. */
function slugifyFilePart(value) {
  return String(value || 'trip')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trip';
}

/**
 * Joins `rows` (array of arrays) into CSV text and triggers a browser
 * download via a temporary `Blob` URL - no network request, no
 * server-side file generation. The anchor element and object URL are
 * both discarded immediately after `click()`.
 *
 * @param {string} filename
 * @param {Array<Array<*>>} rows - Each inner array is one CSV row; cells are stringified and escaped by {@link escapeCsvValue}.
 */
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

/** Formats a number as a 2-decimal string (no currency symbol or thousands separator); `null`/`undefined`/`NaN` become `'0.00'`. */
function formatCurrency(value) {
  return Number(value || 0).toFixed(2);
}

/** Maps the raw `split_type` value (`'equal'` / `'manual'`) to the human-readable label used in exports. */
function formatSplitType(value) {
  if (value === 'equal') return 'Equal split';
  if (value === 'manual') return 'Manual split';
  return value || '';
}

/** Labels a member's net balance as `'Receives'`, `'Pays'` or `'Settled'`. Uses the same +/-0.009 epsilon as the "already settled" check in `lib/balances.js` so a member who nets to (near) zero is never mislabeled due to floating-point rounding. */
function formatNetStatus(value) {
  const amount = Number(value || 0);
  if (amount > 0.009) return 'Receives';
  if (amount < -0.009) return 'Pays';
  return 'Settled';
}

/** Formats a date-only value (e.g. `expense_date`) as `DD Mon YYYY` in the `en-IN` locale. Empty string for a falsy input. */
function formatDateValue(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

/** Formats a timestamp (e.g. `created_at`) as `DD Mon YYYY, HH:MM` in the `en-IN` locale. Empty string for a falsy input. */
function formatDateTimeValue(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Escapes a value for safe interpolation into the PDF report's HTML template (`&`, `<`, `>`, `"`, `'`). `null`/`undefined` become an empty string. Every piece of user-entered text (trip name, member names, descriptions) goes through this before being injected into `buildReportHtml`'s template strings. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── CSV exports ──────────────────────────────────────────────────────────────

/**
 * Downloads one CSV row per expense (including settlements - see file
 * header), with a readable summary of that expense's splits in a
 * single "Split Details" cell (`"Alice: INR 500.00; Bob: INR 300.00"`),
 * rather than one row per split. A "Type" column marks each row
 * `'Settlement'` or `'Expense'` so the two are distinguishable without
 * parsing the description text. Best for reviewing what made up the
 * trip total, as opposed to {@link downloadSummaryCsv} which is for
 * settling up.
 *
 * @param {{tripName?: string, expenses: Array<Object>, members: Array<{id: string, name: string}>}} params - `expenses` need their `splits` already attached (see `App.jsx`'s expense normalization).
 */
export function downloadExpensesCsv({ tripName, expenses, members }) {
  const memberMap = Object.fromEntries((members || []).map((m) => [m.id, m.name]));
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = [
    'Trip Name', 'Type', 'Expense Date', 'Description', 'Total Amount',
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
      expense.is_settlement ? 'Settlement' : 'Expense',
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

/**
 * Downloads a CSV with three sections: the trip total, one row per
 * member from {@link module:lib/balances.computeMemberSummary} (paid /
 * share / net / status), and the suggested transfers from
 * {@link module:lib/balances.simplifySettlements}. If the group is
 * already settled, the transfers section has a single
 * "Everyone is settled" row instead of being empty.
 *
 * @param {{tripName?: string, totalSpent: number, memberSummary: Array<{name: string, paid: number, share: number, balance: number}>, settlements: Array<{from: string, to: string, amount: number}>}} params
 */
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

/**
 * Builds the self-contained, inline-styled HTML (and a scoped
 * `<style>` block) that {@link exportTripReportPdf} rasterizes into a
 * PDF. Kept separate from `exportTripReportPdf` so the markup/styling
 * can be read and adjusted without touching the canvas/pagination
 * logic. Not exported - only used internally for the PDF path, not
 * for an on-screen preview.
 *
 * @param {Object} params - Same shape as {@link exportTripReportPdf}.
 * @returns {string} HTML markup for a single off-screen container element.
 */
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

    const settlementBadge = expense.is_settlement
      ? ' <span style="background:#e8f5ec;color:#1f8a4c;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;">Settlement</span>'
      : '';

    return `
      <div class="expense-card">
        <div class="expense-head">
          <div>
            <h3>${expense.is_settlement ? '\u{1F4B8} ' : ''}${escapeHtml(expense.description || 'Expense')}${settlementBadge}</h3>
            <p>${formatDateValue(expense.expense_date)} · Paid by ${escapeHtml(memberMap[expense.paid_by] || 'Unknown')}</p>
          </div>
          <strong>INR ${formatCurrency(expense.amount)}</strong>
        </div>
        <p>Split: ${expense.is_settlement ? 'Settlement payment' : escapeHtml(formatSplitType(expense.split_type))}</p>
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

/**
 * Renders the same data as {@link downloadSummaryCsv} plus the full
 * expense list into a styled HTML report, rasterizes it with
 * `html2canvas`, and saves it as a downloaded PDF with `jspdf` -
 * entirely client-side, with no print dialog or popup window (earlier
 * versions used `window.print()`, which was blocked by popup blockers
 * and was unreliable with `document.write`; this replaced it).
 *
 * `jspdf` and `html2canvas` are dynamically imported, so they are only
 * fetched/parsed when a PDF is actually requested, not on initial
 * page load.
 *
 * Implementation notes:
 * - The report HTML is rendered into an off-screen container
 *   (`position: fixed; left: -9999px`) so `html2canvas` has real
 *   layout to measure without it ever being visible to the user; the
 *   container is removed again in a `finally` block even if rendering
 *   throws.
 * - If the rendered report is taller than one A4 page, the same
 *   captured image is redrawn on successive pages with a progressively
 *   larger negative y-offset, which is a simple way to paginate a
 *   single tall raster image without re-measuring per-page content.
 *
 * @param {{tripName?: string, totalSpent: number, memberSummary: Array<Object>, settlements: Array<Object>, expenses: Array<Object>, members: Array<Object>}} params - Same data shapes as {@link downloadExpensesCsv} and {@link downloadSummaryCsv} combined.
 * @returns {Promise<void>} Resolves once the PDF has been handed to the browser's download mechanism.
 */
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