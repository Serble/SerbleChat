import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useMobile } from '../../context/MobileContext.jsx';
import { ShieldIcon, PlusIcon, TrashIcon, LockIcon } from '../../icons.jsx';
import {
  getChannelPermissionOverrides,
  createChannelPermissionOverride,
  updateChannelPermissionOverride,
  deleteChannelPermissionOverride,
  getGuildRoles,
  getAccountByUsername,
} from '../../api.js';
import {
  Button, IconButton, TextInput, SaveStatus, ErrorBox, SectionTitle, Hint,
  TabBody, SplitPane, SplitItem, EmptyState, PopupMenu, MenuDivider, useConfirm,
} from '../ui/index.js';
import Avatar from '../Avatar.jsx';
import { CHANNEL_PERM_GROUPS, PermissionList, PermissionLegend } from './permissions.jsx';
import { MutedText, RoleDot, HEX_COLOR_RE } from './common.jsx';
import useAutoSave from './useAutoSave.js';

// ─── Add-override menu ────────────────────────────────────────────────────────

/** Popup listing roles without an override, plus a username box for members. */
function AddOverrideMenu({ anchor, roles, existingUserIds, onPick, onClose }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  async function run(action) {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await action(); } // the menu closes on success
    catch (e) { setErr(e.message); setBusy(false); }
  }

  function addUser(e) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    run(async () => {
      let user;
      try { user = await getAccountByUsername(name); }
      catch { throw new Error('No user with that username.'); }
      if (existingUserIds.has(user.id)) throw new Error('That member already has an override.');
      await onPick({ userId: user.id });
    });
  }

  return (
    <PopupMenu x={anchor.x} y={anchor.y} onClose={onClose} width={250} className="ui-menu">
      <div className="ui-menu-label">Role</div>
      {roles.length === 0 && <MutedText subtle style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>Every role already has an override</MutedText>}
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {roles.map(r => (
          <button key={r.id} type="button" role="menuitem" className="ui-menu-item" disabled={busy} onClick={() => run(() => onPick({ roleId: r.id }))}>
            <span className="ui-menu-icon"><RoleDot color={HEX_COLOR_RE.test(r.color ?? '') ? r.color : ''} /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          </button>
        ))}
      </div>
      <MenuDivider />
      <div className="ui-menu-label">Member</div>
      <form onSubmit={addUser} style={{ display: 'flex', gap: '0.35rem', padding: '0.15rem 0.35rem 0.35rem' }}>
        <TextInput
          autoFocus
          value={username}
          onChange={e => { setUsername(e.target.value); setErr(null); }}
          placeholder="Username"
          maxLength={64}
          style={{ padding: '0.35rem 0.55rem', fontSize: '0.85rem' }}
        />
        <Button type="submit" size="sm" variant="primary" disabled={!username.trim() || busy}>Add</Button>
      </form>
      {err && <div style={{ padding: '0 0.75rem 0.4rem', fontSize: '0.78rem', color: 'var(--danger)' }}>{err}</div>}
    </PopupMenu>
  );
}

// ─── Override editor ──────────────────────────────────────────────────────────

function OverrideEditor({ guildId, channelId, override, label, leading, kind, canManage, onChange, onDelete }) {
  const { loadChannelPermissions } = useApp();

  const { status, error, schedule } = useAutoSave(async next => {
    await updateChannelPermissionOverride(guildId, channelId, override.id, next);
    await loadChannelPermissions(guildId, channelId);
  });

  function handleChange(perms) {
    onChange({ ...override, permissions: perms });
    schedule(perms);
  }

  return (
    <TabBody>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.5rem', minHeight: 30 }}>
        {leading}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <div className="ui-hint" style={{ fontSize: '0.75rem' }}>{kind === 'role' ? 'Role override' : 'Member override'}</div>
        </div>
        <span title={error ?? undefined}><SaveStatus status={status} /></span>
        {canManage && (
          <Button size="sm" variant="danger-outline" onClick={() => onDelete(override, label)}>
            <TrashIcon size={13} /> Remove
          </Button>
        )}
      </div>

      {!canManage && (
        <Hint style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.6rem 0.75rem', borderRadius: 6, background: 'var(--bg-secondary)' }}>
          <LockIcon size={14} /> You need the Manage Channels permission to change overrides.
        </Hint>
      )}
      <ErrorBox style={{ marginBottom: '1rem' }}>{error && `Couldn't save: ${error}`}</ErrorBox>

      <SectionTitle>Permissions in this channel</SectionTitle>
      <div style={{ marginBottom: '1rem' }}>
        <PermissionLegend inheritText={kind === 'role' ? "use the role's guild setting" : 'use their roles'} />
      </div>
      <PermissionList channel groups={CHANNEL_PERM_GROUPS} perms={override.permissions} onChange={handleChange} disabled={!canManage} />
    </TabBody>
  );
}

// ─── Channel permissions tab ──────────────────────────────────────────────────

export default function ChannelPermsTab({ guildId, channelId, canManage }) {
  const { resolveUser, loadChannelPermissions } = useApp();
  const { isMobile } = useMobile();
  const [overrides, setOverrides] = useState([]);
  const [roles, setRoles]         = useState([]);
  const [userNames, setUserNames] = useState({});
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState(null);
  const [selected, setSelected]   = useState(null);
  const [menu, setMenu]           = useState(null); // { x, y } while the add menu is open
  const [confirm, confirmDialog]  = useConfirm();
  const addBtnRef = useRef(null);

  async function loadAll(selectWhere) {
    setErr(null);
    try {
      const [ovs, rs] = await Promise.all([
        getChannelPermissionOverrides(guildId, channelId),
        getGuildRoles(guildId),
      ]);
      const list = ovs ?? [];
      setOverrides(list);
      setRoles(rs ?? []);
      const match = selectWhere && list.find(selectWhere);
      if (match) setSelected(match.id);
      else if (!isMobile) setSelected(s => (list.some(o => o.id === s) ? s : list[0]?.id ?? null));
    } catch (e) {
      console.error('ChannelPermsTab load failed:', e);
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [guildId, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // User overrides are labelled by username, which needs a lookup
  const userIdsKey = overrides.filter(o => o.roleId == null && o.userId).map(o => o.userId).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of userIdsKey ? userIdsKey.split(',') : []) {
      resolveUser(id).then(u => { if (!cancelled) setUserNames(p => ({ ...p, [id]: u })); });
    }
    return () => { cancelled = true; };
  }, [userIdsKey, resolveUser]);

  const existingRoleIds = new Set(overrides.filter(o => o.roleId != null).map(o => o.roleId));
  const existingUserIds = new Set(overrides.filter(o => o.userId != null).map(o => o.userId));

  function describe(ov) {
    if (ov.roleId != null) {
      const role = roles.find(r => r.id === ov.roleId);
      const color = HEX_COLOR_RE.test(role?.color ?? '') ? role.color : '';
      return { kind: 'role', label: role?.name ?? `Role #${ov.roleId}`, leading: <RoleDot color={color} size={12} style={{ margin: '0 2px' }} />, big: <RoleDot color={color} size={14} /> };
    }
    const u = userNames[ov.userId];
    return {
      kind: 'user',
      label: u?.username ?? '…',
      leading: <Avatar userId={ov.userId} name={u?.username} size={20} color={u?.color} />,
      big: <Avatar userId={ov.userId} name={u?.username} size={32} color={u?.color} />,
    };
  }

  function openMenu() {
    const r = addBtnRef.current?.getBoundingClientRect();
    setMenu(r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 });
  }

  async function handlePick(target) {
    await createChannelPermissionOverride(guildId, channelId, { ...target, permissions: {} });
    await loadChannelPermissions(guildId, channelId);
    setMenu(null);
    await loadAll(o => (target.roleId != null ? o.roleId === target.roleId : o.userId === target.userId));
  }

  function handleDelete(ov, label) {
    confirm({
      title: 'Remove Override',
      message: <>Remove the override for <strong style={{ color: 'var(--text-primary)' }}>{label}</strong>? They'll go back to their guild-wide permissions in this channel.</>,
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      onConfirm: async () => {
        await deleteChannelPermissionOverride(guildId, channelId, ov.id);
        await loadChannelPermissions(guildId, channelId);
        const rest = overrides.filter(o => o.id !== ov.id);
        setOverrides(rest);
        setSelected(isMobile ? null : rest[0]?.id ?? null);
      },
    });
  }

  const addButton = canManage && (
    <IconButton ref={addBtnRef} onClick={openMenu} title="Add override" aria-label="Add override">
      <PlusIcon size={16} />
    </IconButton>
  );

  // Roles first, then members
  const sorted = [...overrides].sort((a, b) => (a.roleId == null) - (b.roleId == null));
  const selectedOv = overrides.find(o => o.id === selected);

  const list = (
    <>
      {loading && <MutedText style={{ padding: '0.4rem 0.6rem' }}>Loading…</MutedText>}
      {!loading && overrides.length === 0 && <MutedText subtle style={{ padding: '0.4rem 0.6rem' }}>No overrides</MutedText>}
      {sorted.map(ov => {
        const d = describe(ov);
        return (
          <SplitItem key={ov.id} active={selected === ov.id} onClick={() => setSelected(ov.id)} title={d.label}>
            {d.leading}
            <span className="ui-split-item-label">{d.label}</span>
          </SplitItem>
        );
      })}
    </>
  );

  let detail = null;
  if (err) {
    detail = <div style={{ padding: '1.5rem' }}><ErrorBox>Failed to load overrides: {err}</ErrorBox></div>;
  } else if (!loading && selectedOv) {
    const d = describe(selectedOv);
    detail = (
      <OverrideEditor
        key={selectedOv.id}
        guildId={guildId}
        channelId={channelId}
        override={selectedOv}
        label={d.label}
        leading={d.big}
        kind={d.kind}
        canManage={canManage}
        onChange={updated => setOverrides(p => p.map(o => o.id === updated.id ? updated : o))}
        onDelete={handleDelete}
      />
    );
  } else if (!loading) {
    detail = (
      <EmptyState
        icon={ShieldIcon}
        title={overrides.length ? 'Select an override' : 'No overrides yet'}
        action={canManage && !overrides.length && <Button variant="primary" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}><PlusIcon size={14} /> Add Override</Button>}
        style={{ flex: 1 }}
      >
        Overrides change what a specific role or member can do in this channel,
        on top of their guild-wide permissions.
      </EmptyState>
    );
  }

  return (
    <>
      <SplitPane
        title="Overrides"
        count={loading ? null : overrides.length}
        action={addButton}
        list={list}
        detail={detail}
        showDetail={!!selectedOv}
        onBack={() => setSelected(null)}
        backLabel="All overrides"
      />
      {menu && (
        <AddOverrideMenu
          anchor={menu}
          roles={roles.filter(r => !existingRoleIds.has(r.id))}
          existingUserIds={existingUserIds}
          onPick={handlePick}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmDialog}
    </>
  );
}
