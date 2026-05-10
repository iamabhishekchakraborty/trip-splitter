export default function Header({ isLocalMode }) {
  return (
    <header className="topbar card">
      <div>
        <p className="eyebrow">Trip Splitter</p>
        <h1>Shared expenses, settled cleanly.</h1>
        <p className="muted">
          {isLocalMode ? 'Draft mode with browser-local data.' : 'Live shared data powered by Supabase.'}
        </p>
      </div>
    </header>
  );
}
