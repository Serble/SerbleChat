import { useState, useEffect } from 'react';
import { getGuildRoles, createGuildRole, updateGuildRole, deleteGuildRole } from '../../api.js';
import { Button, TextInput, ErrorBox, Field } from '../ui/index.js';
import { GUILD_PERMS, PermissionList } from './permissions.jsx';
import { MutedText } from './common.jsx';

const DEFAULT_ROLE_COLOR = '#99aab5';

function RoleDot({ color, style }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
      background: color || 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)',
      ...style,
    }} />
  );
}

// ─── Role editor panel ────────────────────────────────────────────────────────

function RoleEditor({ guildId, role, onSaved, onDeleted }) {
  const [name, setName]   = useState(role.name);
  const [color, setColor] = useState(role.color || DEFAULT_ROLE_COLOR);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <Field label="Role Name">
        <TextInput value={name} onChange={e => setName(e.target.value)} maxLength={64} />
      </Field>

      <Field label="Role Colour">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <input type="color" value={color || DEFAULT_ROLE_COLOR} onChange={e => setColor(e.target.value)}
            style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
          <TextInput mono value={color} onChange={e => setColor(e.target.value)} maxLength={7} placeholder="none"
            style={{ width: 100 }} />
          <Button variant="outline" size="sm" onClick={() => setColor('')}>Clear</Button>
        </div>
      </Field>

      <Field label="Permissions">
        <PermissionList keys={GUILD_PERMS} perms={perms} onChange={setPerms} disabled={busy} />
      </Field>

      <ErrorBox>{err}</ErrorBox>

      <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.25rem' }}>
        <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save Role'}
        </Button>
        <Button variant="danger" onClick={del} disabled={busy}>Delete</Button>
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
  const [createErr, setCreateErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuildRoles(guildId)
      .then(r => { if (!cancelled) setRoles(r ?? []); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true); setCreateErr(null);
    try {
      const role = await createGuildRole(guildId, { name: newName.trim() });
      setRoles(p => [...p, role]);
      setNewName('');
      setSelected(role.id);
    } catch (err) { setCreateErr(err.message); }
    finally { setCreating(false); }
  }

  const selectedRole = roles.find(r => r.id === selected);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Left: role list */}
      <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '0.5rem 0.25rem 0.5rem 0' }}>
        {loading && <MutedText style={{ fontSize: '0.82rem', padding: '0.5rem 0.75rem' }}>Loading…</MutedText>}
        {roles.map(r => {
          const active = selected === r.id;
          return (
            <button key={r.id} type="button" onClick={() => setSelected(r.id)}
              className={active ? undefined : 'hov-bg'}
              style={{
                width: '100%', textAlign: 'left', background: active ? 'var(--bg-active)' : 'transparent',
                border: 'none', padding: '0.4rem 0.75rem', borderRadius: 4,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '0.875rem',
                transition: 'background 0.1s',
              }}>
              <RoleDot color={r.color} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            </button>
          );
        })}

        {canManage && (
          <form onSubmit={handleCreate} style={{ padding: '0.5rem 0.5rem 0' }}>
            <TextInput value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="New role…" maxLength={64} disabled={creating}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }} />
            {createErr && <div style={{ color: 'var(--danger)', fontSize: '0.72rem', marginTop: '0.3rem' }}>{createErr}</div>}
          </form>
        )}
      </div>

      {/* Right: role editor */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '1rem' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                <RoleDot color={selectedRole.color} />
                {selectedRole.name}
              </div>
              <MutedText style={{ fontSize: '0.82rem' }}>You don't have permission to edit roles.</MutedText>
            </div>
          )
        ) : (
          <MutedText subtle>
            {roles.length === 0 && !loading ? (canManage ? 'No roles yet. Type a name on the left and press Enter.' : 'No roles in this guild.') : 'Select a role to edit.'}
          </MutedText>
        )}
      </div>
    </div>
  );
}
