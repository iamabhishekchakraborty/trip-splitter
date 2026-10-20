/**
 * Top-of-page banner: app title, a one-line mode indicator, and a slot
 * for whatever account UI `App.jsx` wants shown on the right (the
 * sign-in form or the signed-in account chip from `AuthPanel.jsx`).
 * Purely presentational - no state, no Supabase/local-store access.
 *
 * @param {Object} props
 * @param {boolean} props.isLocalMode - `true` when running on browser-local data (`lib/localStore.js`) instead of Supabase; flips the mode-indicator text under the title.
 * @param {import('react').ReactNode} [props.accountSlot] - Arbitrary content rendered top-right; omitted entirely (no empty slot markup) when not provided.
 */
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