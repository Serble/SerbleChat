import { useState } from 'react';
import { leaveGuild } from '../../api.js';
import { ContextMenu, MenuItem } from '../ui/index.js';
import { GearIcon, DoorIcon } from '../../icons.jsx';

export default function GuildContextMenu({ guild, isOwner, currentUser, x, y, onClose, onLeave, onOpenSettings }) {
  const [busy, setBusy] = useState(false);

  async function handleLeave() {
    if (busy) return;
    if (!confirm(`Leave "${guild.name}"? You can rejoin with an invite.`)) return;
    setBusy(true);
    try {
      await leaveGuild(guild.id, currentUser.id);
      onClose();
      onLeave?.();
    } catch (err) {
      console.error(err);
      alert('Failed to leave guild: ' + err.message);
      setBusy(false);
    }
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose} zIndex={700} minWidth={180}>
      {onOpenSettings && (
        <MenuItem label="Guild Settings" icon={GearIcon} onClick={() => { onOpenSettings(); onClose(); }} />
      )}
      {/* The owner can't leave their own guild */}
      {!isOwner && (
        <MenuItem label={busy ? 'Leaving…' : 'Leave Guild'} icon={DoorIcon} variant="danger" disabled={busy} onClick={handleLeave} />
      )}
    </ContextMenu>
  );
}
