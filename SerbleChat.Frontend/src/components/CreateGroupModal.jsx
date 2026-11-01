import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { createGroupChat } from '../api.js';
import { Modal, ModalBody, ModalFooter, Button, TextInput, ErrorBox, Hint, Field } from './ui/index.js';
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

  async function handleCreate() {
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
    <Modal onClose={onClose} title="Create a Group Chat" width={460} onSubmit={handleCreate}>
      <ModalBody>
        <Hint>Give it a name and pick the friends you want in it.</Hint>

        <Field label="Group Name" htmlFor="create-group-name">
          <TextInput
            id="create-group-name"
            autoFocus
            placeholder="My Awesome Group"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={64}
          />
        </Field>

        <FriendPicker
          label="Friends"
          userIds={friendIds}
          selected={selected}
          onToggle={toggle}
          emptyText="You have no friends to add yet."
          listStyle={{ maxHeight: 280 }}
        />

        <ErrorBox>{error}</ErrorBox>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !name.trim() || picked.length === 0}>
          {busy ? 'Creating…' : 'Create Group'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
