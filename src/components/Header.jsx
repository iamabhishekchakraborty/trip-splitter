export default function Header({ isLocalMode, accountSlot }) {
  return (
    <header className="topbar card">
      <div>
        <p className="eyebrow">Trip Splitter</p>
        <h1>Shared expenses, settled cleanly.</h1>
        <p className="muted">
          {isLocalMode ? 'Draft mode with browser-local data.' : 'Live shared data powered by Supabase.'}
        </p>
      </div>
      {accountSlot ? <div className="account-slot">{accountSlot}</div> : null}
    </header>
  );
}
