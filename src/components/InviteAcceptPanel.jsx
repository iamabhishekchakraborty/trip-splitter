import { useEffect, useRef, useState } from 'react';

export default function InviteAcceptPanel({ disabled, onAcceptInvite }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const autoSubmittedRef = useRef(false); // ref instead of state — synchronous, no re-render race

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('invite');
    if (urlToken) {
      setToken(urlToken);
    }
  }, []);

  useEffect(() => {
    if (!token || disabled || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true; // set synchronously before any async work
    handleAccept(token);
  }, [token, disabled]);

  async function handleAccept(t) {
    const trimmed = (t || token).trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onAcceptInvite(trimmed);
      setToken('');
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token.trim() || disabled) return;
    await handleAccept(token);
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Join group</p>
        <h2>Accept invitation</h2>
      </div>
      {disabled ? (
        <p className="muted">Sign in first to accept an invitation and join a group.</p>
      ) : null}
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste invite token"
          disabled={disabled || busy}
        />
        <button type="submit" disabled={busy || disabled || !token.trim()}>
          {busy ? 'Joining...' : 'Join'}
        </button>
      </form>
    </section>
  );
}