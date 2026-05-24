import { useState } from 'react';

export default function InviteAcceptPanel({ disabled, onAcceptInvite }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token.trim() || disabled) return;

    setBusy(true);
    try {
      await onAcceptInvite(token.trim());
      setToken('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Join group</p>
        <h2>Accept invitation</h2>
      </div>
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste invite token"
          disabled={disabled}
        />
        <button type="submit" disabled={busy || disabled}>
          {busy ? 'Joining...' : 'Join'}
        </button>
      </form>
    </section>
  );
}
