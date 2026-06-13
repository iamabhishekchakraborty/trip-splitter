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
  pdfExporting
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
      </div>
    </section>
  );
}