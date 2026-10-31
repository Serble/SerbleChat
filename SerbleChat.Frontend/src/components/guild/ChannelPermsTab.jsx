import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { TagIcon, PersonIcon, CheckIcon, PlusIcon } from '../../icons.jsx';
import {
  getChannelPermissionOverrides,
  createChannelPermissionOverride,
  updateChannelPermissionOverride,
  deleteChannelPermissionOverride,
  getGuildRoles,
  getAccountByUsername,
} from '../../api.js';
import { Button, TextInput, Select, SaveStatus, ErrorBox, FieldLabel } from '../ui/index.js';
import { CHANNEL_PERMS, PermissionList } from './permissions.jsx';
import { MutedText } from './common.jsx';
import useAutoSave from './useAutoSave.js';

// ─── Single Override Row ──────────────────────────────────────────────────────

function OverrideRow({ override, roles, canManage, guildId, channelId, onSaved, onDeleted }) {
  const { resolveUser, loadChannelPermissions } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [perms, setPerms]       = useState(override.permissions ?? {});
  const [delBusy, setDelBusy]   = useState(false);
  const [delErr, setDelErr]     = useState(null);
  const [userName, setUserName] = useState(null);

  // Role overrides are labelled from the roles list; user overrides need a lookup
  useEffect(() => {
    if (override.roleId != null || !override.userId) return;
    let cancelled = false;
    resolveUser(override.userId).then(u => { if (!cancelled) setUserName(u?.username ?? override.userId); });
    return () => { cancelled = true; };
  }, [override.roleId, override.userId, resolveUser]);

  const isRole = override.roleId != null;
  const LabelIcon = isRole ? TagIcon : PersonIcon;
  const labelName = isRole
    ? (roles.find(r => r.id === override.roleId)?.name ?? `Role #${override.roleId}`)
    : userName;

  const { status, error, schedule } = useAutoSave(async next => {
    await updateChannelPermissionOverride(guildId, channelId, override.id, next);
    await loadChannelPermissions(guildId, channelId);
    onSaved({ ...override, permissions: next });
  });

  function handleChange(next) {
    setPerms(next);
    schedule(next);
  }

  async function handleDelete() {
    if (!confirm(`Delete this permission override for ${labelName ?? '…'}?`)) return;
    setDelBusy(true); setDelErr(null);
    try {
      await deleteChannelPermissionOverride(guildId, channelId, override.id);
      await loadChannelPermissions(guildId, channelId);
      onDeleted(override.id);
    } catch (e) { setDelErr(e.message); setDelBusy(false); }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header row */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className={expanded ? undefined : 'hov-bg'}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
          padding: '0.65rem 0.85rem', cursor: 'pointer', border: 'none', textAlign: 'left',
          background: expanded ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-secondary)',
          font: 'inherit', transition: 'background 0.1s',
        }}
      >
        <LabelIcon size={16} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: '0.875rem' }}>
          {labelName ?? 'Loading…'}
        </span>
        <span title={error ?? undefined}><SaveStatus status={status} errorText="Error" /></span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '0.25rem' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0.75rem 0.85rem', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <PermissionList keys={CHANNEL_PERMS} perms={perms} onChange={handleChange} disabled={!canManage || delBusy} />
          <ErrorBox style={{ marginTop: '0.5rem' }}>{delErr || error}</ErrorBox>
          {canManage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={delBusy}>Delete Override</Button>
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
  // Latest typed username, so a slow lookup for an old value is ignored
  const usernameRef = useRef('');

  const availableRoles = roles.filter(r => !existingRoleIds.has(r.id));
  const canCreate = type === 'role' ? !!roleId : !!resolvedUser;

  function switchType(t) {
    setType(t); setRoleId(''); setUsername(''); usernameRef.current = '';
    setResolvedUser(null); setLookupErr(null);
  }

  async function lookupUser() {
    const name = username.trim();
    if (!name) return;
    setLookupErr(null); setResolvedUser(null);
    try {
      const u = await getAccountByUsername(name);
      if (usernameRef.current.trim() !== name) return;
      if (existingUserIds.has(u.id)) setLookupErr('An override for this user already exists.');
      else setResolvedUser(u);
    } catch {
      if (usernameRef.current.trim() === name) setLookupErr('User not found.');
    }
  }

  async function handleCreate() {
    if (!canCreate) return;
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
    <div style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: '1rem', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>New Permission Override</div>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[['role', TagIcon, 'Role'], ['user', PersonIcon, 'User']].map(([t, Icon, label]) => (
          <Button key={t} size="sm" variant={type === t ? 'primary' : 'secondary'} onClick={() => switchType(t)} style={{ flex: 1 }}>
            <Icon size={14} /> {label}
          </Button>
        ))}
      </div>

      {/* Role selector */}
      {type === 'role' && (
        availableRoles.length === 0 ? (
          <MutedText style={{ fontSize: '0.8rem' }}>All roles already have overrides.</MutedText>
        ) : (
          <Select value={roleId} onChange={e => setRoleId(e.target.value)}>
            <option value="">— Select role —</option>
            {availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        )
      )}

      {/* User lookup */}
      {type === 'user' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <TextInput
              value={username}
              onChange={e => { setUsername(e.target.value); usernameRef.current = e.target.value; setResolvedUser(null); setLookupErr(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupUser(); } }}
              placeholder="Username…" maxLength={64}
              style={{ flex: 1 }}
            />
            <Button onClick={lookupUser} disabled={!username.trim()}>Look up</Button>
          </div>
          {lookupErr && <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{lookupErr}</div>}
          {resolvedUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--success)' }}>
              <CheckIcon size={12} /> Found: {resolvedUser.username}
            </div>
          )}
        </div>
      )}

      {/* Permissions */}
      <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: '0.25rem' }}>
        <FieldLabel>Permissions</FieldLabel>
        <PermissionList keys={CHANNEL_PERMS} perms={perms} onChange={setPerms} disabled={busy} />
      </div>

      <ErrorBox>{err}</ErrorBox>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleCreate} disabled={busy || !canCreate}>
          {busy ? 'Creating…' : 'Create Override'}
        </Button>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Permission overrides let you customise what specific roles or members can do in this channel,
        overriding guild-wide defaults and role permissions.
      </div>

      {loading && <MutedText>Loading overrides…</MutedText>}
      <ErrorBox>{err && `Failed to load: ${err}`}</ErrorBox>

      {!loading && overrides.length === 0 && !showCreate && (
        <MutedText subtle style={{ padding: '0.5rem 0' }}>No overrides set for this channel yet.</MutedText>
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
        <button type="button" onClick={() => setShowCreate(true)}
          className="hov-border-accent"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            background: 'transparent', border: '1px dashed var(--border)', borderRadius: 7,
            padding: '0.55rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s', alignSelf: 'flex-start',
          }}>
          <PlusIcon size={14} /> Add Permission Override
        </button>
      )}
    </div>
  );
}
