import { useState } from 'react';

/**
 * Shows the trip's member list as chips and a form to add a new (guest)
 * member name. These `members` are the names available when logging an
 * expense - distinct from `trip_memberships` (who can sign in to the
 * group) - see the `members` vs `trip_memberships` note in the
 * project README's database reference.
 *
 * There is currently no way to remove a member from this panel (or
 * anywhere else in the UI); doing so today requires a direct SQL
 * delete, and is blocked if the member is referenced by any expense.
 *
 * `onAddMember` is awaited but not try/caught here - `App.jsx`'s
 * `handleAddMember` handles both local-mode and Supabase errors itself
 * and calls `setError`, so this component never sees a rejected
 * promise in practice.
 *
 * @param {Object} props
 * @param {Array<{id: string, name: string}>} props.members
 * @param {(name: string) => Promise<void>} props.onAddMember - Called with the trimmed name on submit.
 * @param {boolean} props.canManageMembers - Gates both the form inputs and shows an explanatory message when `false` (true for admin/owner in Supabase mode; always true in local mode, which has no roles).
 */
export default function MembersPanel({ members, onAddMember, canManageMembers }) {
  const [name, setName] = useState('');

  /** Submit handler: ignores an empty (whitespace-only) name; otherwise passes the trimmed name to `onAddMember` and clears the input once that resolves, whether or not the add succeeded - `App.jsx` reports failures such as a duplicate name in a banner. */
  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddMember(name.trim());
    setName('');
  }

  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Members</p>
        <h2>Trip group</h2>
      </div>
      <div className="chip-row">
        {members.map((member) => (
          <span className="chip" key={member.id}>{member.name}</span>
        ))}
      </div>
      {!members.length ? <p className="muted">No members yet.</p> : null}
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add member name"
          disabled={!canManageMembers}
        />
        <button type="submit" disabled={!canManageMembers}>Add</button>
      </form>
      {!canManageMembers ? <p className="muted">Only owners/admins can manage group members.</p> : null}
    </section>
  );
}