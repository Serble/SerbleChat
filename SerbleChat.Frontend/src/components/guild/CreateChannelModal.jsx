import { useState } from 'react';
import { createGuildChannel } from '../../api.js';
import { Modal, ModalBody, ModalFooter, Button, TextInput, ErrorBox, Field, PrefixInput, OptionGroup } from '../ui/index.js';
import { CHANNEL_TYPES } from './ChannelSettingsModal.jsx';

export default function CreateChannelModal({ guildId, onClose, onCreate }) {
  const [name, setName]                 = useState('');
  const [voiceCapable, setVoiceCapable] = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [err, setErr]                   = useState(null);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true); setErr(null);
    try {
      const ch = await createGuildChannel(guildId, trimmed, voiceCapable);
      onCreate(ch);
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal onClose={onClose} title="Create Channel" width={460} onSubmit={handleSubmit}>
      <ModalBody>
        <Field label="Channel Name" htmlFor="create-channel-name">
          <PrefixInput prefix="#">
            <TextInput id="create-channel-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} placeholder="new-channel" />
          </PrefixInput>
        </Field>

        <Field label="Channel Type">
          <OptionGroup options={CHANNEL_TYPES} value={voiceCapable} onChange={setVoiceCapable} />
        </Field>

        <ErrorBox>{err}</ErrorBox>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create Channel'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
