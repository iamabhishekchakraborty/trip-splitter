import { useState } from 'react';

export default function MembersPanel({ members, onAddMember, canManageMembers }) {
  const [name, setName] = useState('');

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
