import { useState, useEffect } from 'react';
import {
  updateGuild, deleteGuild, leaveGuild,
  createGuildInvite, getGuildInvites, deleteGuildInvite, FRONTEND_URL,
  uploadGuildIcon, deleteGuildIcon, getGuildIconUrl,
  getGuildBans, unbanGuildMember, getAccountById,
} from '../../api.js';
import { copyToClipboard } from '../../electron-utils.js';
import { Modal, Button, IconButton, TextInput, ErrorBox, Field, useFlashStatus } from '../ui/index.js';
import Avatar from '../Avatar.jsx';
import RolesTab from './RolesTab.jsx';
import DefaultPermsTab from './DefaultPermsTab.jsx';
import { allowed, ALLOW } from './permissions.jsx';
import useIconProbe from './useIconProbe.js';
import { MutedText, TabBar, ModalBody, DangerZone, IconUploadField } from './common.jsx';
import { GearIcon, CheckIcon, TrashIcon, PlusIcon } from '../../icons.jsx';

const inviteLink = id => `${FRONTEND_URL}/invite/${id}`;

// ─── Overview ─────────────────────────────────────────────────────────────────

// `name` lives in the modal so an unsaved edit survives switching tabs
function OverviewTab({ guild, name, setName, isOwner, isAdmin, currentUser, guildUpdatedEvent, onClose, onSaved, onDeleted }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [iconSrc, markIconMissing] = useIconProbe(getGuildIconUrl(guild.id), guildUpdatedEvent, 'guildId', guild.id);

  async function handleSave(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === guild.name) { onClose(); return; }
    setBusy(true); setError(null);
    try { await updateGuild(guild.id, { name: trimmed }); onSaved(trimmed); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${guild.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteGuild(guild.id); onDeleted(); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function handleLeave() {
    if (!confirm(`Leave "${guild.name}"? You can rejoin with an invite.`)) return;
    setBusy(true);
    try {
      await leaveGuild(guild.id, currentUser.id);
      // LeftGuild signal will handle cleanup, just close the modal
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Field label="Guild Name">
        <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} />
      </Field>

      {/* GuildUpdated signal refreshes the icon across all clients */}
      <IconUploadField
        label="Guild Icon"
        src={iconSrc}
        fallback={guild.name?.[0]?.toUpperCase() ?? '?'}
        alt="Guild icon"
        onImageError={markIconMissing}
        onUpload={file => uploadGuildIcon(guild.id, file)}
        onRemove={() => deleteGuildIcon(guild.id)}
      />

      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Save Changes</Button>

      {(!isOwner || isAdmin) && (
        <DangerZone>
          {/* The owner can't leave their own guild — they can only delete it */}
          {!isOwner && <Button variant="danger" onClick={handleLeave} disabled={busy}>Leave Guild</Button>}
          {isAdmin && <Button variant="danger" onClick={handleDelete} disabled={busy}>Delete Guild</Button>}
        </DangerZone>
      )}
    </form>
  );
}

// ─── Invites ──────────────────────────────────────────────────────────────────

function InvitesTab({ guildId }) {
  const [invites, setInvites]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, flashCopied]   = useFlashStatus(); // id of the invite just copied

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuildInvites(guildId)
      .then(list => { if (!cancelled) setInvites(list ?? []); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]);

  async function handleCreate() {
    setCreating(true);
    try { const inv = await createGuildInvite(guildId); setInvites(p => [...p, inv]); }
    catch (err) { console.error(err); }
    finally { setCreating(false); }
  }

  async function handleDelete(inviteId) {
    try { await deleteGuildInvite(inviteId); setInvites(p => p.filter(i => i.id !== inviteId)); }
    catch (err) { console.error(err); }
  }

  function copyLink(inv) {
    copyToClipboard(inviteLink(inv.id)).catch(err => console.error('Failed to copy invite link:', err));
    flashCopied(inv.id, 2000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Button variant="primary" onClick={handleCreate} disabled={creating} style={{ alignSelf: 'flex-start' }}>
        {creating ? 'Creating…' : <><PlusIcon size={14} /> Create Invite</>}
      </Button>
      {loading && <MutedText>Loading…</MutedText>}
      {!loading && invites.length === 0 && <MutedText subtle>No active invites. Create one above.</MutedText>}
      {invites.map(inv => (
        <div key={inv.id} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Invite #{inv.id}</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inviteLink(inv.id)}
            </div>
          </div>
          <Button size="sm" variant={copied === inv.id ? 'success' : 'secondary'} onClick={() => copyLink(inv)}>
            {copied === inv.id ? <><CheckIcon size={12} /> Copied</> : 'Copy'}
          </Button>
          <IconButton onClick={() => handleDelete(inv.id)} title="Delete invite" className="hov-color-danger">
            <TrashIcon size={16} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

// ─── Bans ─────────────────────────────────────────────────────────────────────

function BanCard({ ban, onUnban, unbanning }) {
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAccountById(ban.userId)
      .then(u => { if (!cancelled) setUserInfo(u); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ban.userId]);

  const isPermanent = !ban.until || new Date(ban.until).getFullYear() >= 9999;
  const expiresDate = isPermanent ? null : new Date(ban.until);
  const isExpired = expiresDate && expiresDate < new Date();

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <Avatar userId={ban.userId} name={userInfo?.username ?? 'Unknown'} size={40} color={userInfo?.color} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : (userInfo?.username ?? 'Unknown User')}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
          {isPermanent ? 'Permanent ban' : isExpired ? `Expired ${expiresDate.toLocaleDateString()}` : `Until ${expiresDate.toLocaleDateString()}`}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '0.05rem' }}>
          User ID: {ban.userId}
        </div>
      </div>
      <Button size="sm" variant="success" onClick={() => onUnban(ban.userId)} disabled={unbanning}>
        {unbanning ? '…' : 'Unban'}
      </Button>
    </div>
  );
}

function BansTab({ guildId }) {
  const [bans, setBans]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [unbanning, setUnbanning] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuildBans(guildId)
      .then(list => { if (!cancelled) setBans(list ?? []); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]);

  async function handleUnban(userId) {
    setUnbanning(userId);
    try {
      await unbanGuildMember(guildId, userId);
      setBans(p => p.filter(b => b.userId !== userId));
    } catch (err) {
      console.error(err);
      alert('Failed to unban user: ' + err.message);
    } finally {
      setUnbanning(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {loading && <MutedText>Loading bans…</MutedText>}
      {!loading && bans.length === 0 && <MutedText subtle>No banned users.</MutedText>}
      {bans.map(ban => (
        <BanCard key={ban.id} ban={ban} onUnban={handleUnban} unbanning={unbanning === ban.userId} />
      ))}
    </div>
  );
}

// ─── Guild Settings Modal ─────────────────────────────────────────────────────

export default function GuildSettingsModal({ guild, onClose, onSaved, onDeleted, perms, guildUpdatedEvent, currentUser }) {
  const isOwner        = !!currentUser && guild.ownerId === currentUser.id;
  const isAdmin        = perms?.administrator === ALLOW;
  const canManageGuild = allowed(perms, 'manageGuild');
  const canManageRoles = allowed(perms, 'manageRoles');
  const canManageBans  = allowed(perms, 'banMembers');

  const tabs = [
    canManageGuild && { id: 'overview',     label: 'Overview' },
    canManageGuild && { id: 'invites',      label: 'Invites' },
    canManageGuild && { id: 'defaultPerms', label: 'Default Perms' },
    { id: 'roles', label: 'Roles' }, // always visible (read-only without manageRoles)
    canManageBans  && { id: 'bans',         label: 'Bans' },
  ].filter(Boolean);

  const [selectedTab, setTab] = useState(tabs[0].id);
  const [name, setName] = useState(guild.name);
  // Fall back to the first tab if permissions change and hide the selected one
  const tab = tabs.some(t => t.id === selectedTab) ? selectedTab : tabs[0].id;

  return (
    <Modal
      onClose={onClose}
      title="Guild Settings"
      icon={GearIcon}
      // Roles tab is a two-pane layout and needs more width
      width={tab === 'roles' ? 680 : 460}
      style={{ transition: 'max-width 0.15s' }}
    >
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'roles' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0.75rem 1rem 1rem' }}>
          <RolesTab guildId={guild.id} canManage={canManageRoles} />
        </div>
      ) : (
        <ModalBody>
          {tab === 'overview' && (
            <OverviewTab
              guild={guild}
              name={name}
              setName={setName}
              isOwner={isOwner}
              isAdmin={isAdmin}
              currentUser={currentUser}
              guildUpdatedEvent={guildUpdatedEvent}
              onClose={onClose}
              onSaved={onSaved}
              onDeleted={onDeleted}
            />
          )}
          {tab === 'invites'      && <InvitesTab guildId={guild.id} />}
          {tab === 'defaultPerms' && <DefaultPermsTab guild={guild} />}
          {tab === 'bans'         && <BansTab guildId={guild.id} />}
        </ModalBody>
      )}
    </Modal>
  );
}
