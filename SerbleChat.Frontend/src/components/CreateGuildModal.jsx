import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGuild } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Modal, ModalBody, ModalFooter, Button, TextInput, ErrorBox, Hint, Field } from './ui/index.js';

export default function CreateGuildModal({ onClose, onCreated }) {
  const { reconnectHub, setActiveGuildId } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  async function handleCreate() {
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

  const initial = name.trim()[0]?.toUpperCase();

  return (
    <Modal onClose={onClose} title="Create a Guild" width={460} onSubmit={handleCreate}>
      <ModalBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Live preview of how the guild will look in the server strip */}
          <div aria-hidden="true" style={{
            width: 56, height: 56, borderRadius: 16, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: initial ? 'var(--accent)' : 'var(--bg-secondary)',
            border: initial ? 'none' : '1px dashed var(--border)',
            color: initial ? '#fff' : 'var(--text-subtle)',
            fontSize: '1.5rem', fontWeight: 600, transition: 'background 0.15s',
          }}>
            {initial ?? '?'}
          </div>
          <Hint>
            Your guild is where you and your friends hang out. Give it a name to get started —
            you can add an icon, channels and roles afterwards.
          </Hint>
        </div>

        <Field label="Guild Name" htmlFor="create-guild-name">
          <TextInput
            id="create-guild-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Awesome Guild"
            maxLength={64}
          />
        </Field>

        <ErrorBox>{error}</ErrorBox>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create Guild'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
