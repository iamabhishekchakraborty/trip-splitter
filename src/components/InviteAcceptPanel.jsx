/**
 * Lets a signed-in user accept a group invitation, either by pasting a
 * token or by following a link of the form `<app-url>/?invite=<token>`.
 *
 * Two effects do the "arrive via link and just join" flow:
 * 1. On mount, read `?invite=` from the URL (if present) into `token` state.
 * 2. Whenever `token`/`disabled` change, auto-submit once a token is
 *    present and the user is not `disabled` (i.e. is signed in).
 *
 * If the user is not yet signed in when they land on the link, step 2
 * is a no-op (`disabled` is true) until `App.jsx`'s `handleSendOtp`
 * carries the same `?invite=` token through the magic-link redirect -
 * when the user returns signed in, this component re-reads the URL,
 * `disabled` is now false, and auto-submit fires.
 *
 * `autoSubmittedRef` (a ref, not state) exists specifically to prevent
 * auto-submitting twice: a `useState` flag was tried first, but its
 * update is asynchronous, so the effect could re-fire (and send a
 * second `accept_trip_invitation` call for an already-consumed token,
 * surfacing a confusing "already used" error) before the state update
 * had taken effect. A ref is written synchronously, which closes that
 * race.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * @param {Object} props
 * @param {boolean} props.disabled - `true` when there is no signed-in session; disables the form and blocks auto-submit (see file header). Always `true` in local mode (invitations are a Supabase-mode-only feature - `App.jsx` does not render this component at all in local mode).
 * @param {(token: string) => Promise<void>} props.onAcceptInvite - Calls the `accept_trip_invitation` RPC. Resolving (even for an "already used" token, which `App.jsx` treats as a soft success) clears the input and strips `?invite=` from the URL; the busy state is still cleared via `finally` if it throws.
 */
export default function InviteAcceptPanel({ disabled, onAcceptInvite }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const autoSubmittedRef = useRef(false); // see file header: synchronous guard against double auto-submit

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

  /**
   * Accepts `t` (or the current input when `t` is omitted) after trimming it; an empty value is ignored. Shows the busy state while `onAcceptInvite` runs. Once it resolves - including the "already used" soft outcome, which `App.jsx` reports without throwing - it clears the input and removes `?invite=` from the address bar without reloading the page. The busy state is cleared in a `finally`, so it resets even if the call throws.
   *
   * @param {string} [t] - A token to accept; the auto-submit effect passes the token it has just read.
   * @returns {Promise<void>}
   */
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

  /** Manual submit (the Join button or Enter): ignored if the input is empty or the panel is disabled (signed out); otherwise accepts the token currently in the input. */
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