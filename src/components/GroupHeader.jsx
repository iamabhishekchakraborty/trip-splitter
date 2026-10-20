/**
 * Banner shown at the top of an open trip: name, caller's role, total
 * spent, the three export buttons, and (for admins/owners) archive.
 * Purely presentational - every button here is a callback into
 * `App.jsx`; this component has no state of its own.
 *
 * `totalSpent` is expected to already exclude settlement expenses
 * (`App.jsx` filters `is_settlement` rows out before computing it) -
 * this component just renders whatever number it is given.
 *
 * @param {Object} props
 * @param {string} props.tripName
 * @param {number} props.totalSpent - Pre-computed, pre-filtered total; rendered with `.toFixed(2)`.
 * @param {string} [props.role] - Caller's role in this trip; falls back to the literal text `'member'` if falsy (e.g. an unclaimed/local-mode trip with no role concept).
 * @param {() => void} props.onBack - Despite the “← All groups” label, this re-runs `App.jsx`'s `loadHomeData` rather than just switching views - leaving a trip always re-fetches the home list.
 * @param {() => void} props.onDownloadDetailedCsv
 * @param {() => void} props.onDownloadSummaryCsv
 * @param {() => void} props.onExportPdf
 * @param {boolean} props.canDownloadDetailedCsv
 * @param {boolean} props.canDownloadSummaryCsv
 * @param {boolean} props.canExportPdf - Should already account for `pdfExporting` (`App.jsx` passes `false` while a PDF is being generated); this component also disables the button directly on `pdfExporting` as a second guard against double-clicks.
 * @param {boolean} [props.pdfExporting] - Swaps the PDF button's label to "Generating PDF..." and disables it.
 * @param {() => void} [props.onArchive]
 * @param {boolean} [props.canArchive] - Archive is Supabase-mode and admin/owner only; when `false` the whole archive button (and its wrapping div) is omitted, not just disabled.
 */
export default function GroupHeader({
  tripName,
  totalSpent,
  role,
  onBack,
  onDownloadDetailedCsv,
  onDownloadSummaryCsv,
  onExportPdf,
  canDownloadDetailedCsv,
  canDownloadSummaryCsv,
  canExportPdf,
  pdfExporting,
  onArchive,
  canArchive
}) {
  return (
    <section className="group-header card">
      <button className="secondary-button" type="button" onClick={onBack}>← All groups</button>
      <div>
        <p className="eyebrow">Active group</p>
        <h2>{tripName}</h2>
        <p className="muted">Your role: {role || 'member'}</p>
      </div>
      <div className="total-box">
        <span>Total spent</span>
        <strong>INR {totalSpent.toFixed(2)}</strong>
        <div className="export-actions" aria-label="Export trip report">
          <span className="export-label">Export report</span>
          <button
            className="secondary-button"
            type="button"
            onClick={onDownloadSummaryCsv}
            disabled={!canDownloadSummaryCsv}
          >
            Settlement CSV
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onDownloadDetailedCsv}
            disabled={!canDownloadDetailedCsv}
          >
            Expense CSV
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onExportPdf}
            disabled={!canExportPdf || pdfExporting}
            title="Downloads a PDF report directly — no popup required."
          >
            {pdfExporting ? 'Generating PDF...' : 'PDF report'}
          </button>
        </div>
        {canArchive ? (
          <div className="export-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onArchive}
              title="Hide this group from your active list once the trip is settled. You can restore it anytime."
            >
              Archive trip
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}