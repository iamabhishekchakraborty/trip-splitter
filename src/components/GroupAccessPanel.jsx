/**
 * The group's admin panel: member list with role management and
 * removal, an invite-creation form, and active/past invitations.
 * Supabase-mode only - `App.jsx` does not render this in local mode,
 * which has no auth, roles or invitations.
 *
 * All of the guard rails below (last-owner protection, no self-role-
 * change, confirmation dialogs) are **frontend UX only** - the
 * authoritative checks live server-side in the `update_trip_member_role`
 * and `remove_trip_member` Postgres functions, which independently
 * refuse to demote/remove the last owner regardless of what the UI
 * allows. The frontend checks exist to give an immediate, specific
 * message (via `alert()`/`window.confirm()` - plain browser dialogs,
 * not custom UI) instead of a generic RLS/RPC error round-trip.
 *
 * `invites` and `pastInvites` are expected to already be split by the
 * caller (`App.jsx` runs them as two separate queries: active =
 * `accepted_at IS NULL AND expires_at > now()`, past = the inverse).
 * `renderInviteCard`'s `isActive` flag is purely positional - which
 * array an invite came from - not re-derived from the invite's own
 * `accepted_at`/`expires_at` here, so a caller that merges the two
 * lists incorrectly would mislabel every invite in the merged list.
 *
 * Invitations are shown to admins/owners only (`isAdmin`). A token grants
 * access to the group, so the database also refuses to return invitations
 * to anyone else - a plain member never receives them, and this panel
 * does not render the invitations section for them.
 */

import { useMemo, useState } from 'react';

/** Formats a timestamp for display (e.g. invite expiry/used-at), or `'N/A'` for a falsy or unparseable value. */
function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * @param {Object} props
 * @param {Object} props.session - Supabase auth session; used only for `session.user.id` to identify "you" in the member list.
 * @param {boolean} props.isOwner - Shows the role `<select>` on each member row. Owner-only, not admin - matches the server-side rule that only an owner can change roles.
 * @param {boolean} props.isAdmin - Gates the invite-creation form, the per-member Remove button, and the whole invitations section (active invites and history).
 * @param {string} [props.tripName] - Used only to compose the WhatsApp share message text; falls back to `'our trip group'`.
 * @param {Array<{user_id: string, role: string, display_name?: string, email?: string, created_at: string}>} props.memberships - Rendered with the caller's own row pinned first, then by join date.
 * @param {Array<{id: string, token: string, role: string, invited_email?: string, expires_at: string, accepted_at?: string}>} props.invites - Active invites (see file header for what "active" means here).
 * @param {Array<Object>} [props.pastInvites] - Used/expired invites, shown collapsed behind a "Show invite history" toggle.
 * @param {(details: {invited_email: string|null, role: string}) => Promise<void>} props.onCreateInvite
 * @param {(userId: string) => void} props.onRemoveMember
 * @param {(userId: string, newRole: string) => void} props.onUpdateRole
 */
export default function GroupAccessPanel({
  session,
  isOwner,
  isAdmin,
  tripName,
  memberships,
  invites,
  pastInvites,
  onCreateInvite,
  onRemoveMember,
  onUpdateRole
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [busyInvite, setBusyInvite] = useState(false);
  const [showPastInvites, setShowPastInvites] = useState(false);
  const currentUserId = session?.user?.id;

  const ownerCount = useMemo(
    () => memberships.filter((m) => m.role === 'owner').length,
    [memberships]
  );

  const sortedMembers = useMemo(
    () => [...memberships].sort((a, b) => {
      if (a.user_id === currentUserId) return -1;
      if (b.user_id === currentUserId) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    }),
    [memberships, currentUserId]
  );

  /** Create-invite submit: admin/owner only (a plain member's submit is ignored). Shows the busy state while `onCreateInvite` runs, passing the trimmed email (or `null` when blank) and the chosen role, then resets the form fields whether or not creation succeeded - `App.jsx` reports failures in a banner, not here. */
  async function handleInviteSubmit(e) {
    e.preventDefault();
    if (!isAdmin) return;

    setBusyInvite(true);
    try {
      await onCreateInvite({
        invited_email: inviteEmail.trim() || null,
        role: inviteRole
      });
      setInviteEmail('');
      setInviteRole('member');
    } finally {
      setBusyInvite(false);
    }
  }

  /**
   * Frontend-side guards before calling `onUpdateRole`, in order: block
   * demoting the sole remaining owner, block changing your own role at
   * all, then (for an actual change) a `window.confirm` - a stronger
   * one when the new role is `'owner'`. That stronger text says the
   * caller "will be demoted to admin", but nothing on the server does
   * that: `update_trip_member_role` changes only the target's row, so
   * after promoting someone both people are owners (a known mismatch
   * between the wording and the behavior). See the file header: these
   * checks mirror, but do not replace, the server-side enforcement.
   */
  function handleRoleChange(membership, newRole) {
    const label = membership.display_name || membership.email || 'this user';
    const isCurrentUser = membership.user_id === currentUserId;
    const isLastOwner = membership.role === 'owner' && ownerCount <= 1;

    if (isLastOwner && newRole !== 'owner') {
      alert('Cannot demote the last owner. Promote another member to owner first.');
      return;
    }

    if (isCurrentUser && newRole !== membership.role) {
      alert('You cannot change your own role.');
      return;
    }

    if (newRole === 'owner') {
      const confirmed = window.confirm(
        `Transfer ownership to ${label}?\n\nThey will become the owner and you will be demoted to admin. This cannot be undone without their cooperation.`
      );
      if (!confirmed) return;
    } else if (newRole !== membership.role) {
      const confirmed = window.confirm(
        `Change ${label}'s role from ${membership.role} to ${newRole}?`
      );
      if (!confirmed) return;
    }

    onUpdateRole(membership.user_id, newRole);
  }

  /** Confirms via `window.confirm` before calling `onRemoveMember`. The server independently refuses to remove the last owner - see the file header. */
  function handleRemove(membership) {
    const label = membership.display_name || membership.email || 'this user';
    const confirmed = window.confirm(
      `Remove ${label} from this group?\n\nThey will lose access immediately.`
    );
    if (confirmed) onRemoveMember(membership.user_id);
  }

  /**
   * Renders one invite as a card. Only an active invite shows the
   * shareable link, Copy button, and WhatsApp share button - a
   * used/expired invite shows its status (✅ Used / ⏱ Expired) and
   * metadata only, since its token can no longer be redeemed.
   *
   * The WhatsApp button opens the public `https://wa.me/?text=...`
   * link scheme with `noopener,noreferrer` - standard practice for
   * opening an external URL in a new tab, and unrelated to the
   * `document.write`-based popup issues the PDF export in
   * `lib/exports.js` used to have (that was a different problem:
   * writing content *into* a popup, not opening an external link).
   *
   * @param {Object} invite
   * @param {boolean} isActive - Positional, not recomputed from `invite` - see file header.
   */
  function renderInviteCard(invite, isActive) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${invite.token}`;
    return (
      <article
        key={invite.id}
        className="subdued-panel stack compact"
        style={{ opacity: isActive ? 1 : 0.55 }}
      >
        <p className="eyebrow">
          {isActive ? '🟢 Active' : invite.accepted_at ? '✅ Used' : '⏱ Expired'}
        </p>
        {isActive ? (
          <>
            <p className="eyebrow">Invite link</p>
            <div className="inline-form">
              <input readOnly value={inviteUrl} style={{ fontSize: '0.8rem' }} />
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigator.clipboard.writeText(inviteUrl)}
              >
                Copy
              </button>
            </div>
            <button
              type="button"
              className="secondary-button whatsapp-share"
              onClick={() => {
                const message = `You're invited to join "${tripName || 'our trip group'}" on Trip Splitter!\n${inviteUrl}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
              }}
              title="Opens WhatsApp with the invite link ready to send"
            >
              Share via WhatsApp
            </button>
          </>
        ) : null}
        <p className="muted">Role: {invite.role}</p>
        <p className="muted">Email: {invite.invited_email || 'Any authenticated user'}</p>
        <p className="muted">Expires: {formatDateTime(invite.expires_at)}</p>
        <p className="muted">
          {invite.accepted_at ? `Used: ${formatDateTime(invite.accepted_at)}` : 'Not yet used'}
        </p>
      </article>
    );
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Group access</p>
        <h2>Roles and invitations</h2>
      </div>

      {/* Members list */}
      <div className="stack compact">
        {sortedMembers.length ? sortedMembers.map((membership) => {
          const isCurrentUser = membership.user_id === currentUserId;
          const isLastOwner = membership.role === 'owner' && ownerCount <= 1;
          const canRemove = isAdmin && !isCurrentUser;
          const roleDropdownDisabled = isCurrentUser || isLastOwner;

          return (
            <article className="subdued-panel stack compact" key={membership.user_id}>
              <div className="row between wrap-gap">
                <div className="stack mini">
                  <strong>{membership.display_name || membership.email || membership.user_id}</strong>
                  <p className="muted">{membership.email || membership.user_id}</p>
                  <p className="muted">
                    Role: {membership.role}{isCurrentUser ? ' (you)' : ''}
                    {isLastOwner ? ' · sole owner' : ''}
                  </p>
                </div>
                <div className="row wrap-gap">
                  {isOwner ? (
                    <select
                      value={membership.role}
                      disabled={roleDropdownDisabled}
                      onChange={(e) => handleRoleChange(membership, e.target.value)}
                      title={
                        isCurrentUser ? 'You cannot change your own role' :
                        isLastOwner ? 'Promote another member to owner before changing this role' :
                        'Change role'
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  ) : null}
                  {canRemove ? (
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => handleRemove(membership)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        }) : <p className="muted">No group users found yet.</p>}
      </div>

      {/* Create invite form */}
      {isAdmin ? (
        <form className="stack subdued-panel" onSubmit={handleInviteSubmit}>
          <div>
            <p className="eyebrow">Create invite</p>
            <p className="muted">Leave email blank for a reusable token. Optionally restrict by email.</p>
          </div>
          <div className="split-grid two">
            <label>
              <span>Invite email (optional)</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="friend@example.com"
              />
            </label>
            <label>
              <span>Role on join</span>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busyInvite}>
            {busyInvite ? 'Creating...' : 'Create invite token'}
          </button>
        </form>
      ) : (
        <p className="muted">Only owners/admins can manage invitations.</p>
      )}

      {/* Invitations: owners/admins only. The database also refuses to return them to
          anyone else, so a plain member would only ever see an empty list here. */}
      {isAdmin ? (
        <>
          {/* Active invites */}
          <div className="stack compact">
            <p className="eyebrow">Active invites</p>
            {invites.length
              ? invites.map((invite) => renderInviteCard(invite, true))
              : <p className="muted">No active invites. Create one above.</p>
            }
          </div>

          {/* Past invites — collapsed by default */}
          {pastInvites && pastInvites.length ? (
            <div className="stack compact">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowPastInvites((v) => !v)}
              >
                {showPastInvites
                  ? 'Hide invite history'
                  : `Show invite history (${pastInvites.length})`}
              </button>
              {showPastInvites
                ? pastInvites.map((invite) => renderInviteCard(invite, false))
                : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}