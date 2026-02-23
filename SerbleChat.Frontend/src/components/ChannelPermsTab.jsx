import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  getChannelPermissionOverrides,
  createChannelPermissionOverride,
  updateChannelPermissionOverride,
  deleteChannelPermissionOverride,
  getGuildRoles,
  getAccountByUsername,
} from '../api.js';

// ─── Permission helpers ───────────────────────────────────────────────────────

const PERM_KEYS = [
  { key: 'viewChannel',    label: 'View Channel',    desc: 'See and read this channel' },
  { key: 'sendMessages',   label: 'Send Messages',   desc: 'Post messages in this channel' },
  { key: 'manageMessages', label: 'Manage Messages', desc: "Delete others' messages" },
  { key: 'manageChannels', label: 'Manage Channel',  desc: 'Rename or delete this channel' },
  { key: 'createInvites',  label: 'Create Invites',  desc: 'Generate invite links' },
  { key: 'joinVoice',      label: 'Join Voice',      desc: 'Connect to voice' },
  { key: 'speak',          label: 'Speak',           desc: 'Speak in voice channels' },
  { key: 'muteMembers',    label: 'Mute Members',    desc: 'Server-mute members in voice' },
  { key: 'deafenMembers',  label: 'Deafen Members',  desc: 'Server-deafen members in voice' },
  { key: 'moveMembers',    label: 'Move Members',    desc: 'Move members between voice channels' },
  { key: 'videoStream',    label: 'Video / Stream',  desc: 'Share video or screen' },
  { key: 'administrator',  label: 'Administrator',   desc: 'Grants all permissions (use carefully)' },
  { key: 'manageGuild',    label: 'Manage Guild',    desc: 'Edit guild name & settings' },
  { key: 'manageRoles',    label: 'Manage Roles',    desc: 'Create, edit and delete roles' },
  { key: 'kickMembers',    label: 'Kick Members',    desc: 'Remove members from the guild' },
  { key: 'banMembers',     label: 'Ban Members',     desc: 'Permanently ban members' },
];

// PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
function cycleState(s) { return s === 2 ? 0 : s === 0 ? 1 : 2; }
function stateLabel(s) { return s === 0 ? 'Allow' : s === 1 ? 'Deny' : 'Inherit'; }
function stateColor(s) { return s === 0 ? '#23a55a' : s === 1 ? '#f23f43' : '#72767d'; }

function PermissionsEditor({ perms, onChange, disabled }) {
  const p = perms ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {PERM_KEYS.map(({ key, label, desc }) => {
        const value = p[key] ?? 2;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid #2b2d31' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.83rem', fontWeight: 600, color: '#dbdee1' }}>{label}</div>
              <div style={{ fontSize: '0.7rem', color: '#72767d' }}>{desc}</div>
            </div>
            <button
              disabled={disabled}
              onClick={() => !disabled && onChange({ ...p, [key]: cycleState(value) })}
              style={{
                background: 'transparent', border: `1px solid ${stateColor(value)}`,
                borderRadius: '5px', padding: '0.2rem 0.55rem',
                color: stateColor(value), fontSize: '0.72rem', fontWeight: 700,
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.15s', minWidth: 58, flexShrink: 0,
                opacity: disabled ? 0.5 : 1,
              }}
            >{stateLabel(value)}</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Single Override Row ──────────────────────────────────────────────────────

function OverrideRow({ override, roles, canManage, guildId, channelId, onSaved, onDeleted }) {
  const { resolveUser, loadChannelPermissions } = useApp();
  const [expanded, setExpanded]   = useState(false);
  const [perms, setPerms]         = useState(override.permissions ?? {});
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState(null);
  const [saved, setSaved]         = useState(false);
  const [label, setLabel]         = useState(null);

  // Resolve display label
  useEffect(() => {
    if (override.roleId != null) {
      const role = roles.find(r => r.id === override.roleId);
      setLabel({ icon: '🏷', name: role?.name ?? `Role #${override.roleId}` });
    } else if (override.userId) {
      resolveUser(override.userId).then(u => setLabel({ icon: '👤', name: u?.username ?? override.userId }));
    }
  }, [override.roleId, override.userId, roles]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setBusy(true); setErr(null);
    try {
      await updateChannelPermissionOverride(guildId, channelId, override.id, perms);
      await loadChannelPermissions(guildId, channelId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved({ ...override, permissions: perms });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete this permission override for ${label?.name ?? '…'}?`)) return;
    setBusy(true);
    try {
      await deleteChannelPermissionOverride(guildId, channelId, override.id);
      await loadChannelPermissions(guildId, channelId);
      onDeleted(override.id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div style={{ border: '1px solid #3b3d43', borderRadius: '8px', overflow: 'hidden', marginBottom: '0.5rem' }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.65rem 0.85rem', cursor: 'pointer',
          background: expanded ? '#2b2d31' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#2b2d31'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ fontSize: '1rem' }}>{label?.icon ?? '…'}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '0.875rem', color: '#dbdee1' }}>
          {label?.name ?? 'Loading…'}
        </span>
        <span style={{ fontSize: '0.75rem', color: '#72767d', flexShrink: 0 }}>
          {expanded ? '▲ collapse' : '▼ expand'}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0.75rem 0.85rem', borderTop: '1px solid #3b3d43', background: '#1e1f22' }}>
          <PermissionsEditor perms={perms} onChange={setPerms} disabled={!canManage || busy} />
          {err && <div style={{ color: '#f23f43', fontSize: '0.8rem', marginTop: '0.5rem' }}>{err}</div>}
          {canManage && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={handleDelete} disabled={busy}
                style={{ background: 'transparent', border: '1px solid #f23f43', borderRadius: '6px', padding: '0.35rem 0.75rem', color: '#f23f43', fontSize: '0.8rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = '#f23f43'; e.currentTarget.style.color = '#fff'; } }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#f23f43'; }}>
                Delete Override
              </button>
              <button onClick={handleSave} disabled={busy}
                style={{ background: saved ? '#23a55a' : '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.35rem 0.9rem', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, transition: 'background 0.2s' }}>
                {busy ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Override Form ─────────────────────────────────────────────────────

function CreateOverrideForm({ guildId, channelId, roles, existingRoleIds, existingUserIds, onCreated, onCancel }) {
  const { loadChannelPermissions } = useApp();
  const [type, setType]         = useState('role');   // 'role' | 'user'
  const [roleId, setRoleId]     = useState('');
  const [username, setUsername] = useState('');
  const [resolvedUser, setResolvedUser] = useState(null);
  const [lookupErr, setLookupErr]       = useState(null);
  const [perms, setPerms]       = useState({});
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  const availableRoles = roles.filter(r => !existingRoleIds.has(r.id));

  async function lookupUser() {
    if (!username.trim()) return;
    setLookupErr(null); setResolvedUser(null);
    try {
      const u = await getAccountByUsername(username.trim());
      if (existingUserIds.has(u.id)) {
        setLookupErr('An override for this user already exists.');
      } else {
        setResolvedUser(u);
      }
    } catch {
      setLookupErr('User not found.');
    }
  }

  async function handleCreate() {
    if (type === 'role' && !roleId) return;
    if (type === 'user' && !resolvedUser) return;
    setBusy(true); setErr(null);
    try {
      await createChannelPermissionOverride(guildId, channelId, {
        roleId: type === 'role' ? Number(roleId) : undefined,
        userId: type === 'user' ? resolvedUser.id : undefined,
        permissions: perms,
      });
      await loadChannelPermissions(guildId, channelId);
      onCreated();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div style={{ border: '1px solid #5865f2', borderRadius: '8px', padding: '1rem', background: '#1e1f22', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#b5bac1' }}>New Permission Override</div>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {['role', 'user'].map(t => (
          <button key={t} onClick={() => { setType(t); setRoleId(''); setUsername(''); setResolvedUser(null); setLookupErr(null); }}
            style={{
              flex: 1, padding: '0.4rem', borderRadius: '5px', border: 'none',
              background: type === t ? '#5865f2' : '#313338',
              color: type === t ? '#fff' : '#72767d', fontWeight: 600,
              fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {t === 'role' ? '🏷 Role' : '👤 User'}
          </button>
        ))}
      </div>

      {/* Role selector */}
      {type === 'role' && (
        availableRoles.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#72767d' }}>All roles already have overrides.</div>
        ) : (
          <select value={roleId} onChange={e => setRoleId(e.target.value)}
            style={{ background: '#313338', border: '1px solid #3b3d43', borderRadius: '6px', padding: '0.5rem 0.65rem', color: '#dbdee1', fontSize: '0.875rem', outline: 'none' }}>
            <option value="">— Select role —</option>
            {availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )
      )}

      {/* User lookup */}
      {type === 'user' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={username} onChange={e => { setUsername(e.target.value); setResolvedUser(null); setLookupErr(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupUser(); } }}
              placeholder="Username…" maxLength={64}
              style={{ flex: 1, background: '#313338', border: '1px solid #3b3d43', borderRadius: '6px', padding: '0.5rem 0.65rem', color: '#dbdee1', fontSize: '0.875rem', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = '#5865f2'}
              onBlur={e => e.target.style.borderColor = '#3b3d43'}
            />
            <button onClick={lookupUser}
              style={{ background: '#383a40', border: 'none', borderRadius: '6px', padding: '0.5rem 0.85rem', color: '#dbdee1', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#404249'}
              onMouseLeave={e => e.currentTarget.style.background = '#383a40'}>
              Look up
            </button>
          </div>
          {lookupErr && <div style={{ fontSize: '0.78rem', color: '#f23f43' }}>{lookupErr}</div>}
          {resolvedUser && <div style={{ fontSize: '0.78rem', color: '#23a55a' }}>✓ Found: {resolvedUser.username}</div>}
        </div>
      )}

      {/* Permissions */}
      <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: '0.25rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>Permissions</div>
        <PermissionsEditor perms={perms} onChange={setPerms} disabled={busy} />
      </div>

      {err && <div style={{ color: '#f23f43', fontSize: '0.8rem' }}>{err}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={busy}
          style={{ background: 'transparent', border: '1px solid #3b3d43', borderRadius: '6px', padding: '0.4rem 0.85rem', color: '#72767d', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#72767d'; e.currentTarget.style.color = '#dbdee1'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#3b3d43'; e.currentTarget.style.color = '#72767d'; }}>
          Cancel
        </button>
        <button onClick={handleCreate} disabled={busy || (type === 'role' ? !roleId : !resolvedUser)}
          style={{
            background: '#7c3aed', border: 'none', borderRadius: '6px',
            padding: '0.4rem 0.9rem', color: '#fff', fontSize: '0.8rem',
            fontWeight: 600, cursor: (busy || (type === 'role' ? !roleId : !resolvedUser)) ? 'default' : 'pointer',
            opacity: (busy || (type === 'role' ? !roleId : !resolvedUser)) ? 0.5 : 1,
            transition: 'background 0.15s',
          }}>
          {busy ? 'Creating…' : 'Create Override'}
        </button>
      </div>
    </div>
  );
}

// ─── Main ChannelPermsTab ─────────────────────────────────────────────────────

export default function ChannelPermsTab({ guildId, channelId, canManage }) {
  const [overrides, setOverrides] = useState([]);
  const [roles, setRoles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr]             = useState(null);

  function loadAll() {
    setLoading(true); setErr(null);
    Promise.all([
      getChannelPermissionOverrides(guildId, channelId),
      getGuildRoles(guildId),
    ]).then(([ovs, rs]) => {
      setOverrides(ovs ?? []);
      setRoles(rs ?? []);
    }).catch(e => {
      console.error('ChannelPermsTab load failed:', e);
      setErr(e.message);
    }).finally(() => setLoading(false));
  }

  useEffect(() => { loadAll(); }, [guildId, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const existingRoleIds = new Set(overrides.filter(o => o.roleId != null).map(o => o.roleId));
  const existingUserIds = new Set(overrides.filter(o => o.userId != null).map(o => o.userId));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontSize: '0.82rem', color: '#72767d', lineHeight: 1.5 }}>
        Permission overrides let you customise what specific roles or members can do in this channel,
        overriding guild-wide defaults and role permissions.
      </div>

      {loading && <div style={{ color: '#72767d', fontSize: '0.85rem' }}>Loading overrides…</div>}
      {err && <div style={{ color: '#f23f43', fontSize: '0.83rem' }}>Failed to load: {err}</div>}

      {!loading && overrides.length === 0 && !showCreate && (
        <div style={{ color: '#4f5660', fontSize: '0.85rem', padding: '0.5rem 0' }}>
          No overrides set for this channel yet.
        </div>
      )}

      {!loading && overrides.map(ov => (
        <OverrideRow
          key={ov.id}
          override={ov}
          roles={roles}
          canManage={canManage}
          guildId={guildId}
          channelId={channelId}
          onSaved={updated => setOverrides(p => p.map(o => o.id === updated.id ? updated : o))}
          onDeleted={id => setOverrides(p => p.filter(o => o.id !== id))}
        />
      ))}

      {showCreate && (
        <CreateOverrideForm
          guildId={guildId}
          channelId={channelId}
          roles={roles}
          existingRoleIds={existingRoleIds}
          existingUserIds={existingUserIds}
          onCreated={() => { setShowCreate(false); loadAll(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {canManage && !showCreate && (
        <button onClick={() => setShowCreate(true)}
          style={{
            background: 'transparent', border: '1px dashed #3b3d43', borderRadius: '7px',
            padding: '0.55rem 1rem', color: '#72767d', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s', alignSelf: 'flex-start',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#b5bac1'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#3b3d43'; e.currentTarget.style.color = '#72767d'; }}>
          ＋ Add Permission Override
        </button>
      )}
    </div>
  );
}
