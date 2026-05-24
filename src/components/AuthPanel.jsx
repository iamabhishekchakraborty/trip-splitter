import { useEffect, useState } from 'react';

export default function AuthPanel({ session, profile, onSendOtp, onLogout, onUpdateDisplayName, compact = false }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const userEmail = session?.user?.email || '';

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
  }, [profile?.display_name]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;

    setBusy(true);
    try {
      await onSendOtp(email.trim());
      setEmail('');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisplayNameSave(e) {
    e.preventDefault();
    if (!displayName.trim()) return;
    await onUpdateDisplayName(displayName.trim());
  }

  if (session?.user) {
    if (compact) {
      return (
        <section className="account-compact">
          <p className="eyebrow">Account</p>
          <strong>{profile?.display_name || userEmail || 'Signed in user'}</strong>
          <p className="muted">{userEmail}</p>
          <form className="inline-form align-end" onSubmit={handleDisplayNameSave}>
            <label>
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
              />
            </label>
            <button type="submit">Save</button>
          </form>
          <button className="secondary-button" type="button" onClick={onLogout}>
            Sign out
          </button>
        </section>
      );
    }

    return (
      <section className="card stack compact">
        <div className="row between wrap-gap">
          <div>
            <p className="eyebrow">Account</p>
            <h2>{profile?.display_name || userEmail || 'Signed in user'}</h2>
            <p className="muted">{userEmail}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
        <form className="inline-form align-end" onSubmit={handleDisplayNameSave}>
          <label>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </label>
          <button type="submit">Save name</button>
        </form>
      </section>
    );
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Sign in</p>
        <h2>Secure your groups</h2>
        <p className="muted">Use email OTP to receive a magic login link.</p>
      </div>
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Sending...' : 'Send login link'}
        </button>
      </form>
    </section>
  );
}
