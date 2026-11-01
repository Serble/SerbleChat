import { useState, useEffect, useRef } from 'react';
import { getGuildRoles, createGuildRole, updateGuildRole, deleteGuildRole } from '../../api.js';
import { useMobile } from '../../context/MobileContext.jsx';
import {
  Button, IconButton, TextInput, ErrorBox, Field, SaveStatus, SectionTitle, Hint,
  TabBody, SplitPane, SplitItem, EmptyState, useConfirm,
} from '../ui/index.js';
import { GUILD_PERM_GROUPS, INHERIT, PermissionList, PermissionLegend, allPerms, countSet } from './permissions.jsx';
import { MutedText, RoleDot, ColourPicker, HEX_COLOR_RE } from './common.jsx';
import useAutoSave from './useAutoSave.js';
import { PlusIcon, TagIcon, TrashIcon, LockIcon } from '../../icons.jsx';

const NEW_ROLE_NAME = 'new role';
const validColour = c => (HEX_COLOR_RE.test(c) ? c : '');

// ─── Role editor ──────────────────────────────────────────────────────────────

/**
 * Edits one role. Every change is pushed to the parent straight away (so the
 * role list updates as you type) and auto-saved once edits pause. A blank
 * name or half-typed colour isn't saved, and is reverted when you leave.
 */
function RoleEditor({ guildId, role, canManage, autoFocusName, onChange, onDelete }) {
  const nameRef = useRef(null);
  const saved = useRef({ name: role.name, color: role.color ?? '' });
  const latest = useRef(role);
  latest.current = role;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { status, error, schedule } = useAutoSave(async next => {
    await updateGuildRole(guildId, role.id, next);
    saved.current = { name: next.name, color: next.color };
  }, 700);

  useEffect(() => {
    if (autoFocusName) { nameRef.current?.focus(); nameRef.current?.select(); }
  }, [autoFocusName]);

  // Put back the last saved name / colour if we're left in an unsaveable state
  useEffect(() => () => {
    const r = latest.current;
    if (!r.name.trim() || (r.color && !HEX_COLOR_RE.test(r.color))) {
      onChangeRef.current({ ...r, name: r.name.trim() || saved.current.name, color: HEX_COLOR_RE.test(r.color) || !r.color ? r.color : saved.current.color });
    }
  }, []);

  function update(patch) {
    const next = { ...role, ...patch };
    onChange(next);
    const name = next.name.trim();
    const color = next.color ?? '';
    if (name && (color === '' || HEX_COLOR_RE.test(color))) {
      schedule({ name, color, permissions: next.permissions ?? {} });
    }
  }

  const perms = role.permissions ?? {};
  const nameEmpty = !role.name.trim();

  return (
    <TabBody>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', minHeight: 30 }}>
        <RoleDot color={validColour(role.color ?? '')} size={14} />
        <div style={{ flex: 1, minWidth: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {role.name.trim() || saved.current.name}
        </div>
        <span title={error ?? undefined}><SaveStatus status={status} /></span>
        {canManage && (
          <Button size="sm" variant="danger-outline" onClick={() => onDelete(role)}>
            <TrashIcon size={13} /> Delete
          </Button>
        )}
      </div>

      {!canManage && (
        <Hint style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.6rem 0.75rem', borderRadius: 6, background: 'var(--bg-secondary)' }}>
          <LockIcon size={14} /> You need the Manage Roles permission to edit roles.
        </Hint>
      )}
      <ErrorBox style={{ marginBottom: '1rem' }}>{error && `Couldn't save: ${error}`}</ErrorBox>

      <SectionTitle>Display</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <Field label="Role Name" error={nameEmpty && canManage ? "Role name can't be empty" : null}>
          <TextInput
            ref={nameRef}
            value={role.name}
            onChange={e => update({ name: e.target.value })}
            maxLength={64}
            disabled={!canManage}
            aria-invalid={nameEmpty}
            style={nameEmpty ? { borderColor: 'var(--danger)' } : undefined}
          />
        </Field>
        <Field label="Colour" hint="Members show up in the colour of their roles.">
          <ColourPicker value={role.color ?? ''} onChange={color => update({ color })} disabled={!canManage} />
        </Field>
      </div>

      <SectionTitle
        action={canManage && (
          <Button size="sm" variant="ghost" style={{ padding: '0 0.25rem', fontSize: '0.72rem' }}
            onClick={() => update({ permissions: allPerms(GUILD_PERM_GROUPS, INHERIT) })}
            disabled={countSet(perms).allow + countSet(perms).deny === 0}>
            Reset all
          </Button>
        )}
      >
        Permissions
      </SectionTitle>
      <div style={{ marginBottom: '0.75rem' }}>
        <PermissionLegend inheritText="leave it to other roles" />
      </div>
      <PermissionList groups={GUILD_PERM_GROUPS} perms={perms} onChange={p => update({ permissions: p })} disabled={!canManage} />
    </TabBody>
  );
}

// ─── Roles tab ────────────────────────────────────────────────────────────────

export default function RolesTab({ guildId, canManage }) {
  const { isMobile } = useMobile();
  const [roles, setRoles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [justCreated, setJustCreated] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [confirm, confirmDialog]  = useConfirm();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuildRoles(guildId)
      .then(r => {
        if (cancelled) return;
        const list = r ?? [];
        setRoles(list);
        // Open the first role straight away rather than an empty "pick one" pane
        if (!isMobile && list.length) setSelected(s => s ?? list[0].id);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (creating) return;
    setCreating(true); setCreateErr(null);
    try {
      const role = await createGuildRole(guildId, { name: NEW_ROLE_NAME });
      setRoles(p => [...p, role]);
      setSelected(role.id);
      setJustCreated(role.id);
    } catch (err) { setCreateErr(err.message); }
    finally { setCreating(false); }
  }

  function handleDelete(role) {
    confirm({
      title: 'Delete Role',
      message: <>Delete the <strong style={{ color: 'var(--text-primary)' }}>{role.name}</strong> role? Members who have it will lose its permissions. This can't be undone.</>,
      confirmLabel: 'Delete Role',
      busyLabel: 'Deleting…',
      onConfirm: async () => {
        await deleteGuildRole(guildId, role.id);
        const rest = roles.filter(r => r.id !== role.id);
        setRoles(rest);
        setSelected(isMobile ? null : rest[0]?.id ?? null);
      },
    });
  }

  const selectedRole = roles.find(r => r.id === selected);

  const list = (
    <>
      {loading && <MutedText style={{ padding: '0.4rem 0.6rem' }}>Loading…</MutedText>}
      {!loading && roles.length === 0 && <MutedText subtle style={{ padding: '0.4rem 0.6rem' }}>No roles yet</MutedText>}
      {roles.map(r => (
        <SplitItem key={r.id} active={selected === r.id} onClick={() => setSelected(r.id)} title={r.name}>
          <RoleDot color={validColour(r.color ?? '')} />
          <span className="ui-split-item-label">{r.name.trim() || <em style={{ color: 'var(--text-muted)' }}>unnamed</em>}</span>
        </SplitItem>
      ))}
    </>
  );

  let detail;
  if (loading) {
    detail = null;
  } else if (selectedRole) {
    detail = (
      <RoleEditor
        key={selectedRole.id}
        guildId={guildId}
        role={selectedRole}
        canManage={canManage}
        autoFocusName={justCreated === selectedRole.id}
        onChange={updated => setRoles(p => p.map(r => r.id === updated.id ? updated : r))}
        onDelete={handleDelete}
      />
    );
  } else {
    detail = (
      <EmptyState
        icon={TagIcon}
        title={roles.length ? 'Select a role' : 'No roles yet'}
        action={canManage && !roles.length && (
          <Button variant="primary" onClick={handleCreate} disabled={creating}><PlusIcon size={14} /> Create Role</Button>
        )}
        style={{ flex: 1 }}
      >
        Roles group members together and give them permissions and a colour.
      </EmptyState>
    );
  }

  return (
    <>
      <SplitPane
        title="Roles"
        count={loading ? null : roles.length}
        action={canManage && (
          <IconButton onClick={handleCreate} disabled={creating} title="Create role" aria-label="Create role">
            <PlusIcon size={16} />
          </IconButton>
        )}
        list={list}
        footer={createErr ? <ErrorBox>{createErr}</ErrorBox> : null}
        detail={detail}
        showDetail={!!selectedRole}
        onBack={() => setSelected(null)}
        backLabel="All roles"
      />
      {confirmDialog}
    </>
  );
}
