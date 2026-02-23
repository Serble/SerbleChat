import { useState, useEffect } from 'react';
import {
  getGuildRoles, createGuildRole, updateGuildRole, deleteGuildRole,
  getUserGuildRoles, addUserGuildRole, removeUserGuildRole,
} from '../api.js';

// ─── Permission toggle ────────────────────────────────────────────────────────

const PERM_KEYS = [
  { key: 'administrator',  label: 'Administrator',   desc: 'Grants all permissions' },
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

// PermissionState enum: 0 = Allow, 1 = Deny, 2 = Inherit
function cycleState(s) { return s === 2 ? 0 : s === 0 ? 1 : 2; }
function stateLabel(s) { return s === 0 ? 'Allow' : s === 1 ? 'Deny' : 'Inherit'; }
function stateColor(s) { return s === 0 ? '#23a55a' : s === 1 ? '#f23f43' : '#72767d'; }

function PermToggle({ label, desc, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0', borderBottom: '1px solid #2b2d31' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dbdee1' }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: '#72767d' }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(cycleState(value))}
        style={{
          background: 'transparent', border: `1px solid ${stateColor(value)}`,
          borderRadius: '5px', padding: '0.25rem 0.65rem',
          color: stateColor(value), fontSize: '0.75rem', fontWeight: 700,
          cursor: 'pointer', transition: 'all 0.15s', minWidth: 64, flexShrink: 0,
        }}
      >{stateLabel(value)}</button>
    </div>
  );
}

function PermissionsEditor({ perms, onChange }) {
  const p = perms ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {PERM_KEYS.map(({ key, label, desc }) => (
        <PermToggle
          key={key}
          label={label}
          desc={desc}
          value={p[key] ?? 2}
          onChange={v => onChange({ ...p, [key]: v })}
        />
      ))}
    </div>
  );
}

// ─── Role editor panel ────────────────────────────────────────────────────────

function RoleEditor({ guildId, role, onSaved, onDeleted }) {
  const [name, setName]   = useState(role.name);
  const [color, setColor] = useState(role.color || '#99aab5');
  const [perms, setPerms] = useState(role.permissions ?? {});
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await updateGuildRole(guildId, role.id, { name: name.trim(), color, permissions: perms });
      onSaved({ ...role, name: name.trim(), color, permissions: perms });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function del() {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setBusy(true);
    try { await deleteGuildRole(guildId, role.id); onDeleted(role.id); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label style={labelStyle}>Role Name</label>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={64}
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = '#7c3aed'}
          onBlur={e => e.target.style.borderColor = '#3b3d43'} />
      </div>

      <div>
        <label style={labelStyle}>Role Colour</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <input type="color" value={color || '#99aab5'} onChange={e => setColor(e.target.value)}
            style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
          <input value={color} onChange={e => setColor(e.target.value)} maxLength={7}
            style={{ ...inputStyle, width: 90, flex: 'none' }}
            onFocus={e => e.target.style.borderColor = '#7c3aed'}
            onBlur={e => e.target.style.borderColor = '#3b3d43'} />
          <button onClick={() => setColor('')}
            style={{ background: 'transparent', border: '1px solid #3b3d43', borderRadius: '5px', padding: '0.3rem 0.6rem', color: '#72767d', fontSize: '0.78rem', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>

      <div>
        <label style={{ ...labelStyle, marginBottom: '0.5rem', display: 'block' }}>Permissions</label>
        <PermissionsEditor perms={perms} onChange={setPerms} />
      </div>

      {err && <div style={{ color: '#f23f43', fontSize: '0.82rem' }}>{err}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.5rem' }}>
        <button onClick={save} disabled={busy || !name.trim()}
          style={{ ...btnStyle('#7c3aed'), opacity: busy || !name.trim() ? 0.6 : 1 }}>
          {busy ? 'Saving…' : 'Save Role'}
        </button>
        <button onClick={del} disabled={busy}
          style={{ ...btnStyle('transparent'), border: '1px solid #f23f43', color: '#f23f43', opacity: busy ? 0.6 : 1 }}>
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function RolesTab({ guildId, canManage }) {
  const [roles, setRoles]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');

  useEffect(() => {
    setLoading(true);
    getGuildRoles(guildId)
      .then(r => { setRoles(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [guildId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const role = await createGuildRole(guildId, { name: newName.trim() });
      setRoles(p => [...p, role]);
      setNewName('');
      setSelected(role.id);
    } catch (err) { console.error(err); }
    finally { setCreating(false); }
  }

  const selectedRole = roles.find(r => r.id === selected);

  return (
    <div style={{ display: 'flex', gap: '0', flex: 1, overflow: 'hidden' }}>
      {/* Left: role list */}
      <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid #3b3d43', overflowY: 'auto', padding: '0.5rem 0' }}>
        {loading && <div style={{ color: '#72767d', fontSize: '0.82rem', padding: '0.5rem 0.75rem' }}>Loading…</div>}
        {roles.map(r => (
          <button key={r.id} onClick={() => setSelected(r.id)}
            style={{
              width: '100%', textAlign: 'left', background: selected === r.id ? '#404249' : 'transparent',
              border: 'none', padding: '0.4rem 0.75rem', borderRadius: '4px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
              color: selected === r.id ? '#f2f3f5' : '#b5bac1', fontSize: '0.875rem',
              transition: 'background 0.1s',
            }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: r.color || '#99aab5', border: '1px solid rgba(255,255,255,0.1)',
            }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          </button>
        ))}

        {canManage && (
          <form onSubmit={handleCreate} style={{ padding: '0.5rem 0.5rem 0' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="New role…" maxLength={64} disabled={creating}
              style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#3b3d43'} />
          </form>
        )}
      </div>

      {/* Right: role editor */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {selectedRole ? (
          canManage ? (
            <RoleEditor
              key={selectedRole.id}
              guildId={guildId}
              role={selectedRole}
              onSaved={updated => setRoles(p => p.map(r => r.id === updated.id ? updated : r))}
              onDeleted={id => { setRoles(p => p.filter(r => r.id !== id)); setSelected(null); }}
            />
          ) : (
            <div>
              <div style={{ fontWeight: 700, color: '#f2f3f5', marginBottom: '0.35rem' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: selectedRole.color || '#99aab5', marginRight: '0.5rem' }} />
                {selectedRole.name}
              </div>
              <div style={{ color: '#72767d', fontSize: '0.82rem' }}>You don't have permission to edit roles.</div>
            </div>
          )
        ) : (
          <div style={{ color: '#4f5660', fontSize: '0.85rem' }}>
            {roles.length === 0 && !loading ? (canManage ? 'No roles yet. Type a name above and press Enter.' : 'No roles in this guild.') : 'Select a role to edit.'}
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: '#72767d', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.35rem',
};
const inputStyle = {
  width: '100%', background: '#1e1f22', border: '1px solid #3b3d43',
  borderRadius: '6px', padding: '0.55rem 0.7rem', color: '#f2f3f5',
  fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};
function btnStyle(bg) {
  return {
    background: bg, border: 'none', borderRadius: '6px',
    padding: '0.55rem 1.1rem', color: '#fff', fontSize: '0.875rem',
    fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
  };
}
