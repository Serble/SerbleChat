import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGuild } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Modal, Button, TextInput, ErrorBox, Hint } from './ui/index.js';
import { FieldLabel } from './ui/index.js';

export default function CreateGuildModal({ onClose, onCreated }) {
  const { reconnectHub, setActiveGuildId } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  async function handleCreate(e) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const guild = await createGuild(name.trim());
      await onCreated?.();
      await reconnectHub();
      setActiveGuildId(String(guild.id));
      onClose();
      nav(`/app/guild/${guild.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Create a Guild" width={460}>
      <form onSubmit={handleCreate} style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', flex: 1, overflowY: 'auto' }}>
        <Hint>Your guild is where you and your friends hang out. Give it a name and start chatting.</Hint>

        <div>
          <FieldLabel htmlFor="create-guild-name">Guild Name</FieldLabel>
          <TextInput
            id="create-guild-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Awesome Guild"
            maxLength={64}
          />
        </div>

        <ErrorBox>{error}</ErrorBox>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create Guild'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
