import { useState } from 'react';
import { createGuildChannel } from '../../api.js';
import { Modal, Button, TextInput, ErrorBox, Field } from '../ui/index.js';
import { VoiceCapableToggle } from './common.jsx';

export default function CreateChannelModal({ guildId, onClose, onCreate }) {
  const [name, setName]                 = useState('');
  const [voiceCapable, setVoiceCapable] = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [err, setErr]                   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true); setErr(null);
    try {
      const ch = await createGuildChannel(guildId, trimmed, voiceCapable);
      onCreate(ch);
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal onClose={onClose} title="Create Channel" width={420}>
      <form onSubmit={handleSubmit} style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <Field label="Channel Name">
          <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} placeholder="new-channel" />
        </Field>

        <VoiceCapableToggle checked={voiceCapable} onChange={setVoiceCapable} />

        <ErrorBox>{err}</ErrorBox>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create Channel'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
