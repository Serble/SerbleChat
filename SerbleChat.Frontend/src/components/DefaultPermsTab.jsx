import { useState, useEffect, useRef } from 'react';
import { updateGuild } from '../api.js';

const PERM_KEYS = [
  { key: 'administrator',  label: 'Administrator',   desc: 'Grants all permissions (careful!)' },
  { key: 'manageGuild',    label: 'Manage Guild',    desc: 'Edit guild name & default perms' },
  { key: 'manageRoles',    label: 'Manage Roles',    desc: 'Create, edit and delete roles' },
  { key: 'manageChannels', label: 'Manage Channels', desc: 'Create, rename and delete channels' },
  { key: 'kickMembers',    label: 'Kick Members',    desc: 'Remove members from the guild' },
  { key: 'banMembers',     label: 'Ban Members',     desc: 'Permanently ban members' },
  { key: 'createInvites',  label: 'Create Invites',  desc: 'Generate invite links' },
  { key: 'sendMessages',   label: 'Send Messages',   desc: 'Post messages in channels' },
  { key: 'manageMessages', label: 'Manage Messages', desc: 'Delete others\' messages' },
  { key: 'joinVoice',      label: 'Join Voice',      desc: 'Connect to voice channels' },
  { key: 'speak',          label: 'Speak',           desc: 'Speak in voice channels' },
  { key: 'muteMembers',    label: 'Mute Members',    desc: 'Server-mute members in voice' },
  { key: 'deafenMembers',  label: 'Deafen Members',  desc: 'Server-deafen members in voice' },
  { key: 'moveMembers',    label: 'Move Members',    desc: 'Move members between voice channels' },
  { key: 'videoStream',    label: 'Video / Stream',  desc: 'Share video or screen' },
];

function cycleState(s) { return s === 2 ? 0 : s === 0 ? 1 : 2; }
function stateLabel(s) { return s === 0 ? 'Allow' : s === 1 ? 'Deny' : 'Inherit'; }
function stateColor(s) { return s === 0 ? '#23a55a' : s === 1 ? '#f23f43' : '#72767d'; }

export default function DefaultPermsTab({ guild, onSaved }) {
  const [perms, setPerms] = useState(guild.defaultPermissions ?? {});
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  const [err, setErr]       = useState(null);
  const timerRef            = useRef(null);
  const latestPermsRef      = useRef(perms);

  // Sync when guild changes
  useEffect(() => { setPerms(guild.defaultPermissions ?? {}); }, [guild.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever perms change (skip the initial mount value)
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    latestPermsRef.current = perms;
    clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = setTimeout(async () => {
      try {
        await updateGuild(guild.id, { defaultPermissions: latestPermsRef.current });
        setErr(null);
        setStatus('saved');
        if (onSaved) onSaved(latestPermsRef.current);
        setTimeout(() => setStatus(null), 2000);
      } catch (e) {
        setErr(e.message);
        setStatus('error');
      }
    }, 600);
    return () => clearTimeout(timerRef.current);
  }, [perms]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ fontSize: '0.82rem', color: '#72767d', lineHeight: 1.5, flex: 1 }}>
          Default permissions apply to all members that don't have a role overriding them.
        </div>
        {status === 'saving' && <span style={{ fontSize: '0.72rem', color: '#72767d', flexShrink: 0 }}>Saving…</span>}
        {status === 'saved'  && <span style={{ fontSize: '0.72rem', color: '#23a55a', flexShrink: 0 }}>✓ Saved</span>}
        {status === 'error'  && <span style={{ fontSize: '0.72rem', color: '#f23f43', flexShrink: 0 }} title={err}>✗ Error</span>}
      </div>

      {PERM_KEYS.map(({ key, label, desc }) => {
        const value = perms[key] ?? 2;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0', borderBottom: '1px solid #2b2d31' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dbdee1' }}>{label}</div>
              <div style={{ fontSize: '0.72rem', color: '#72767d' }}>{desc}</div>
            </div>
            <button
              onClick={() => setPerms(p => ({ ...p, [key]: cycleState(value) }))}
              style={{
                background: 'transparent', border: `1px solid ${stateColor(value)}`,
                borderRadius: '5px', padding: '0.25rem 0.65rem',
                color: stateColor(value), fontSize: '0.75rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s', minWidth: 64, flexShrink: 0,
              }}
            >{stateLabel(value)}</button>
          </div>
        );
      })}
    </div>
  );
}