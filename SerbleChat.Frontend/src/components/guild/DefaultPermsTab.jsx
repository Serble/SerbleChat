import { useState } from 'react';
import { updateGuild } from '../../api.js';
import { SaveStatus, SectionTitle, Hint, ErrorBox, TabBody } from '../ui/index.js';
import { GUILD_PERM_GROUPS, PermissionList, PermissionLegend } from './permissions.jsx';
import useAutoSave from './useAutoSave.js';

export default function DefaultPermsTab({ guild, onSaved }) {
  // Mounted per guild (the settings modal is keyed to one guild), so the
  // initial value never needs re-syncing.
  const [perms, setPerms] = useState(guild.defaultPermissions ?? {});

  const { status, error, schedule } = useAutoSave(async next => {
    await updateGuild(guild.id, { defaultPermissions: next });
    onSaved?.(next);
  });

  function handleChange(next) {
    setPerms(next);
    schedule(next);
  }

  return (
    <TabBody>
      <SectionTitle action={<span title={error ?? undefined}><SaveStatus status={status} /></span>}>
        Default Permissions
      </SectionTitle>
      <Hint style={{ marginBottom: '0.75rem' }}>
        What every member can do before roles are taken into account. Roles and
        channel overrides can grant or take away permissions on top of these.
      </Hint>
      <div style={{ marginBottom: '1.25rem' }}>
        <PermissionLegend inheritText="not granted" />
      </div>
      <ErrorBox style={{ marginBottom: '1rem' }}>{error && `Couldn't save: ${error}`}</ErrorBox>

      <PermissionList groups={GUILD_PERM_GROUPS} perms={perms} onChange={handleChange} />
    </TabBody>
  );
}
