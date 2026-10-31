import { useState } from 'react';
import { updateGuild } from '../../api.js';
import { SaveStatus } from '../ui/index.js';
import { GUILD_PERMS, PermissionList } from './permissions.jsx';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>
          Default permissions apply to all members that don't have a role overriding them.
        </div>
        <span title={error ?? undefined} style={{ flexShrink: 0 }}>
          <SaveStatus status={status} errorText="Error" />
        </span>
      </div>

      <PermissionList keys={GUILD_PERMS} perms={perms} onChange={handleChange} />
    </div>
  );
}
