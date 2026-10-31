import { useState } from 'react';
import {
  updateGuildChannel, deleteGuildChannel,
  getChannelIconUrl, uploadChannelIcon, deleteChannelIcon,
} from '../../api.js';
import { Modal, Button, TextInput, ErrorBox, Field } from '../ui/index.js';
import ChannelPermsTab from './ChannelPermsTab.jsx';
import useIconProbe from './useIconProbe.js';
import { TabBar, ModalBody, DangerZone, VoiceCapableToggle, IconUploadField } from './common.jsx';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'permissions', label: 'Permissions' },
];

export default function ChannelSettingsModal({ guildId, channel, canManage, onClose, onUpdated, onDeleted, channelUpdatedEvent }) {
  const [tab, setTab]               = useState('overview');
  const [name, setName]             = useState(channel.name);
  const [voiceCapable, setVoiceCapable] = useState(channel.voiceCapable ?? false);
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState(null);
  const [iconSrc, markIconMissing]  = useIconProbe(getChannelIconUrl(guildId, channel.id), channelUpdatedEvent, 'channelId', channel.id);

  async function handleSave(e) {
    e.preventDefault();
    if (!canManage) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const nameChanged  = trimmed !== channel.name;
    const voiceChanged = voiceCapable !== (channel.voiceCapable ?? false);
    if (!nameChanged && !voiceChanged) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      await updateGuildChannel(guildId, channel.id, { name: trimmed, voiceCapable });
      onUpdated({ ...channel, name: trimmed, voiceCapable });
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete #${channel.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteGuildChannel(guildId, channel.id);
      onDeleted();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const title = (
    <>
      Channel Settings
      <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        # {channel.name}
      </span>
    </>
  );

  return (
    <Modal
      onClose={onClose}
      title={title}
      width={tab === 'permissions' ? 560 : 420}
      style={{ transition: 'max-width 0.15s' }}
    >
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      <ModalBody>
        {tab === 'overview' && (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Field label="Channel Name">
              <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} disabled={!canManage} />
            </Field>

            <VoiceCapableToggle checked={voiceCapable} onChange={setVoiceCapable} disabled={!canManage} />

            {/* ChannelUpdated signal refreshes the icon */}
            {canManage && (
              <IconUploadField
                label="Channel Icon"
                src={iconSrc}
                fallback="#"
                alt="Channel icon"
                onImageError={markIconMissing}
                onUpload={file => uploadChannelIcon(guildId, channel.id, file)}
                onRemove={() => deleteChannelIcon(guildId, channel.id)}
              />
            )}

            <ErrorBox>{err}</ErrorBox>
            {canManage && (
              <>
                <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Save Changes</Button>
                <DangerZone>
                  <Button variant="danger" onClick={handleDelete} disabled={busy}>Delete Channel</Button>
                </DangerZone>
              </>
            )}
          </form>
        )}

        {tab === 'permissions' && (
          <ChannelPermsTab guildId={guildId} channelId={channel.id} canManage={canManage} />
        )}
      </ModalBody>
    </Modal>
  );
}
