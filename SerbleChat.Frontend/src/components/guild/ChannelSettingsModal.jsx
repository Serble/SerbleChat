import { useState } from 'react';
import {
  updateGuildChannel, deleteGuildChannel,
  getChannelIconUrl, uploadChannelIcon, deleteChannelIcon,
} from '../../api.js';
import {
  TabbedModal, TabBody, Button, TextInput, Field, PrefixInput, SectionTitle, SaveStatus,
  OptionGroup, IconUploadField, useConfirm,
} from '../ui/index.js';
import ChannelPermsTab from './ChannelPermsTab.jsx';
import useIconProbe from './useIconProbe.js';
import useAutoSave from './useAutoSave.js';
import { DangerZone, DangerRow } from './common.jsx';
import { GearIcon, ShieldIcon, HashIcon, SpeakerIcon } from '../../icons.jsx';

export const CHANNEL_TYPES = [
  { value: false, label: 'Text',         icon: HashIcon,    description: 'Messages, images and files.' },
  { value: true,  label: 'Text & Voice', icon: SpeakerIcon, description: 'A text channel with a voice call members can join to talk, stream and share video.' },
];

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: GearIcon },
  { id: 'permissions', label: 'Permissions', icon: ShieldIcon },
];

function OverviewTab({ guildId, channel, canManage, onUpdated, onDeleted, onClose, channelUpdatedEvent }) {
  const [name, setName]                 = useState(channel.name);
  const [voiceCapable, setVoiceCapable] = useState(channel.voiceCapable ?? false);
  const [iconSrc, markIconMissing]      = useIconProbe(getChannelIconUrl(guildId, channel.id), channelUpdatedEvent, 'channelId', channel.id);
  const [confirm, confirmDialog]        = useConfirm();

  // Changes save themselves once edits pause (and when the tab/modal closes)
  const { status, error, schedule } = useAutoSave(async next => {
    await updateGuildChannel(guildId, channel.id, next);
    onUpdated({ ...channel, ...next });
  }, 800);

  function save(nextName, nextVoice) {
    if (nextName.trim()) schedule({ name: nextName.trim(), voiceCapable: nextVoice });
  }

  function handleDelete() {
    confirm({
      title: 'Delete Channel',
      message: <>Delete <strong style={{ color: 'var(--text-primary)' }}>#{channel.name}</strong> and all of its messages? This can't be undone.</>,
      confirmLabel: 'Delete Channel',
      busyLabel: 'Deleting…',
      onConfirm: async () => {
        await deleteGuildChannel(guildId, channel.id);
        onDeleted();
        onClose();
      },
    });
  }

  return (
    <TabBody>
      <SectionTitle action={<span title={error ?? undefined}><SaveStatus status={status} /></span>}>Channel</SectionTitle>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <Field label="Channel Name" error={!name.trim() ? "Channel name can't be empty" : error && `Couldn't save: ${error}`}>
          <PrefixInput prefix="#">
            <TextInput
              value={name}
              onChange={e => { setName(e.target.value); save(e.target.value, voiceCapable); }}
              maxLength={64}
              disabled={!canManage}
              aria-invalid={!name.trim()}
            />
          </PrefixInput>
        </Field>

        <Field label="Channel Type">
          {canManage ? (
            <OptionGroup
              options={CHANNEL_TYPES}
              value={voiceCapable}
              onChange={v => { setVoiceCapable(v); save(name, v); }}
            />
          ) : (
            <div className="ui-hint">{CHANNEL_TYPES.find(t => t.value === voiceCapable).label}</div>
          )}
        </Field>

        {/* ChannelUpdated signal refreshes the icon */}
        {canManage && (
          <Field label="Channel Icon">
            <IconUploadField
              src={iconSrc}
              fallback={<HashIcon size={30} />}
              alt="Channel icon"
              size={72}
              hint="Shown next to the channel name."
              onImageError={markIconMissing}
              onUpload={file => uploadChannelIcon(guildId, channel.id, file)}
              onRemove={() => deleteChannelIcon(guildId, channel.id)}
            />
          </Field>
        )}
      </div>

      {canManage && (
        <>
          <SectionTitle>Danger Zone</SectionTitle>
          <DangerZone>
            <DangerRow
              title="Delete channel"
              description="Permanently delete this channel and its message history."
              action={<Button variant="danger" onClick={handleDelete}>Delete Channel</Button>}
            />
          </DangerZone>
        </>
      )}
      {confirmDialog}
    </TabBody>
  );
}

export default function ChannelSettingsModal({ guildId, channel, canManage, onClose, onUpdated, onDeleted, channelUpdatedEvent }) {
  const [tab, setTab] = useState('overview');

  return (
    <TabbedModal
      onClose={onClose}
      title="Channel Settings"
      subtitle={`# ${channel.name}`}
      icon={GearIcon}
      tabs={TABS}
      active={tab}
      onChange={setTab}
      width={820}
      height="min(640px, 100%)"
    >
      {tab === 'overview' && (
        <OverviewTab
          guildId={guildId}
          channel={channel}
          canManage={canManage}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onClose={onClose}
          channelUpdatedEvent={channelUpdatedEvent}
        />
      )}
      {tab === 'permissions' && (
        <ChannelPermsTab guildId={guildId} channelId={channel.id} canManage={canManage} />
      )}
    </TabbedModal>
  );
}
