/**
 * Handles both sides of auth: the signed-out email magic-link form,
 * and (once signed in) an account summary with a sign-out button and
 * an editable display name.
 *
 * `App.jsx` renders it in two mutually exclusive places: while signed
 * out, the full-size card in the main content area (the sign-in
 * form); once signed in, the `compact` version in the page header's
 * account slot (via `Header.jsx`'s `accountSlot`). The branch below
 * for a signed-in, non-compact panel is therefore not currently
 * reached by the app.
 *
 * Not rendered at all in local mode (`App.jsx` only mounts this when
 * Supabase is configured) - local mode has no authentication.
 */

import { useEffect, useState } from 'react';

/**
 * @param {Object} props
 * @param {Object|null} props.session - Supabase auth session; falsy means signed out (renders the email form instead of the account view).
 * @param {{display_name?: string}|null} [props.profile] - The caller's `user_profiles` row. `display_name` seeds the editable name field and is re-synced into it via `useEffect` whenever a fresh `profile` arrives (e.g. after `onUpdateDisplayName` resolves and `App.jsx` reloads it) - a local edit the user hasn't saved yet would be overwritten by this, same as any controlled-from-above field.
 * @param {(email: string) => Promise<void>} props.onSendOtp - Sends the magic link; subject to Supabase's email rate limit (very low on the free tier with the built-in sender - see the README's Supabase setup section).
 * @param {() => void} props.onLogout
 * @param {(displayName: string) => Promise<void>} props.onUpdateDisplayName - Saves the trimmed name via the `update_my_display_name` RPC. Does not, by itself, rename the caller's `members` row in any currently-open trip - `App.jsx` does that separately via `ensure_trip_member_record` / a direct `members` update where applicable.
 * @param {boolean} [props.compact=false] - `true` renders the condensed account summary used in the page header (`App.jsx` only passes it when signed in); `false` renders the full-size card - the sign-in form when signed out. The signed-in, non-compact variant exists but `App.jsx` does not currently use it.
 */
export default function AuthPanel({ session, profile, onSendOtp, onLogout, onUpdateDisplayName, compact = false }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const userEmail = session?.user?.email || '';

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
  }, [profile?.display_name]);

  /** Sign-in submit: ignores an empty email; otherwise shows the busy state while `onSendOtp` runs and then clears the email field, whether or not the email was actually sent - `App.jsx` reports failures such as the rate limit in a banner. */
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

  /** Display-name submit: ignores an empty name; otherwise passes the trimmed name to `onUpdateDisplayName`. The field is not cleared - it re-syncs from `profile` when the updated profile arrives. */
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