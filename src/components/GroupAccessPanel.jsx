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

  function handleRemove(membership) {
    const label = membership.display_name || membership.email || 'this user';
    const confirmed = window.confirm(
      `Remove ${label} from this group?\n\nThey will lose access immediately.`
    );
    if (confirmed) onRemoveMember(membership.user_id);
  }

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
    </section>
  );
}