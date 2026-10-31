import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { createGroupChat } from '../api.js';
import { Modal, Button, TextInput, ErrorBox, Hint } from './ui/index.js';
import { FieldLabel } from './ui/index.js';
import FriendPicker, { friendIdOf } from './FriendPicker.jsx';

export default function CreateGroupModal({ onClose }) {
  const { friends, currentUser, refreshDms } = useApp();
  const nav = useNavigate();

  const [name, setName]         = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);

  // Accepted friends only
  const friendIds = friends.filter(f => !f.pending).map(f => friendIdOf(f, currentUser?.id));
  // Ignore selections for anyone who stopped being a friend while the modal was open
  const picked = friendIds.filter(id => selected.has(id));

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError('Please enter a group name.'); return; }
    if (picked.length === 0) { setError('Select at least one friend.'); return; }
    setBusy(true);
    setError(null);
    try {
      const chat = await createGroupChat(name.trim(), picked);
      await refreshDms();
      onClose();
      nav(`/app/channel/${chat.channelId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Create a Group Chat" width={460}>
      <form onSubmit={handleCreate} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', flex: '1 1 auto', minHeight: 0 }}>
        <Hint>Give it a name and pick your friends.</Hint>

        {/* Group name */}
        <div>
          <FieldLabel htmlFor="create-group-name">Group Name</FieldLabel>
          <TextInput
            id="create-group-name"
            autoFocus
            placeholder="My Awesome Group"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={64}
          />
        </div>

        {/* Friend picker */}
        <FriendPicker
          label="Add Friends"
          userIds={friendIds}
          selected={selected}
          onToggle={toggle}
          emptyText="You have no friends to add yet."
        />

        <ErrorBox>{error}</ErrorBox>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem', flexShrink: 0 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim() || picked.length === 0}>
            {busy ? 'Creating…' : 'Create Group'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
