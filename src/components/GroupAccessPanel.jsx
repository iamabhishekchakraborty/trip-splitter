import { useMemo, useState } from 'react';

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function GroupAccessPanel({
  session,
  isOwner,
  isAdmin,
  memberships,
  invites,
  onCreateInvite,
  onRemoveMember,
  onUpdateRole
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [busyInvite, setBusyInvite] = useState(false);
  const currentUserId = session?.user?.id;

  const sortedMembers = useMemo(
    () => [...memberships].sort((a, b) => {
      if (a.user_id === currentUserId) return -1;
      if (b.user_id === currentUserId) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    }),
    [memberships, currentUserId]
  );

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

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Group access</p>
        <h2>Roles and invitations</h2>
      </div>

      <div className="stack compact">
        {sortedMembers.length ? sortedMembers.map((membership) => {
          const isCurrentUser = membership.user_id === currentUserId;
          const canRemove = isAdmin && !isCurrentUser;
          return (
            <article className="subdued-panel stack compact" key={membership.user_id}>
              <div className="row between wrap-gap">
                <div className="stack mini">
                  <strong>{membership.display_name || membership.email || membership.user_id}</strong>
                  <p className="muted">{membership.email || membership.user_id}</p>
                  <p className="muted">
                    Role: {membership.role}{isCurrentUser ? ' (you)' : ''}
                  </p>
                </div>
                <div className="row wrap-gap">
                  {isOwner ? (
                    <select
                      value={membership.role}
                      onChange={(e) => onUpdateRole(membership.user_id, e.target.value)}
                      disabled={isCurrentUser && membership.role === 'owner'}
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
                      onClick={() => onRemoveMember(membership.user_id)}
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

      <div className="stack compact">
        <p className="eyebrow">Recent invites</p>
        {invites.length ? invites.map((invite) => (
          <article key={invite.id} className="subdued-panel stack compact">
            <strong>{invite.token}</strong>
            <p className="muted">Role: {invite.role}</p>
            <p className="muted">Email: {invite.invited_email || 'Any authenticated user'}</p>
            <p className="muted">Expires: {formatDateTime(invite.expires_at)}</p>
            <p className="muted">Used: {invite.accepted_at ? formatDateTime(invite.accepted_at) : 'No'}</p>
          </article>
        )) : <p className="muted">No invites yet.</p>}
      </div>
    </section>
  );
}
