import { useState } from 'react';

export default function MembersPanel({ members, onAddMember }) {
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
      <form className="inline-form" onSubmit={handleSubmit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add member name" />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}
