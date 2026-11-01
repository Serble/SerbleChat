import { useState, useEffect } from 'react';
import {
  updateGuild, deleteGuild, leaveGuild,
  createGuildInvite, getGuildInvites, deleteGuildInvite, FRONTEND_URL,
  uploadGuildIcon, deleteGuildIcon, getGuildIconUrl,
  getGuildBans, unbanGuildMember, getAccountById,
} from '../../api.js';
import { copyToClipboard } from '../../electron-utils.js';
import {
  TabbedModal, TabBody, Button, IconButton, TextInput, ErrorBox, Field, SectionTitle, Hint,
  SaveStatus, IconUploadField, EmptyState, List, ListRow, useFlashStatus, useConfirm,
} from '../ui/index.js';
import Avatar from '../Avatar.jsx';
import RolesTab from './RolesTab.jsx';
import DefaultPermsTab from './DefaultPermsTab.jsx';
import WebhooksTab from './WebhooksTab.jsx';
import { allowed, ALLOW } from './permissions.jsx';
import useIconProbe from './useIconProbe.js';
import useAutoSave from './useAutoSave.js';
import { useDateFormat } from '../../dateFormat.js';
import { MutedText, DangerZone, DangerRow } from './common.jsx';
import {
  GearIcon, CheckIcon, TrashIcon, PlusIcon, TagIcon, ShieldIcon, LinkIcon, HammerIcon, ClipboardIcon, WebhookIcon,
} from '../../icons.jsx';

const inviteLink = id => `${FRONTEND_URL}/invite/${id}`;

/** Loads a list once per `key`; returns [items, setItems, loading]. */
function useLoadedList(load, key) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then(list => { if (!cancelled) setItems(list ?? []); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [items, setItems, loading];
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ guild, isOwner, isAdmin, currentUser, guildUpdatedEvent, onClose, onSaved, onDeleted }) {
  const [name, setName] = useState(guild.name);
  const [iconSrc, markIconMissing] = useIconProbe(getGuildIconUrl(guild.id), guildUpdatedEvent, 'guildId', guild.id);
  const [confirm, confirmDialog] = useConfirm();

  // The name saves itself once typing pauses (and when the tab/modal closes)
  const { status, error, schedule } = useAutoSave(async next => {
    await updateGuild(guild.id, { name: next });
    onSaved(next);
  }, 800);

  function handleName(value) {
    setName(value);
    if (value.trim()) schedule(value.trim());
  }

  const guildName = <strong style={{ color: 'var(--text-primary)' }}>{guild.name}</strong>;

  function handleLeave() {
    confirm({
      title: 'Leave Guild',
      message: <>Leave {guildName}? You'll need a new invite to rejoin.</>,
      confirmLabel: 'Leave Guild',
      busyLabel: 'Leaving…',
      onConfirm: async () => {
        await leaveGuild(guild.id, currentUser.id);
        // LeftGuild signal handles the cleanup, just close the modal
        onClose();
      },
    });
  }

  function handleDelete() {
    confirm({
      title: 'Delete Guild',
      message: <>Permanently delete {guildName}, along with all of its channels and messages? This can't be undone.</>,
      confirmLabel: 'Delete Guild',
      busyLabel: 'Deleting…',
      onConfirm: async () => {
        await deleteGuild(guild.id);
        onDeleted();
        onClose();
      },
    });
  }

  return (
    <TabBody>
      <SectionTitle action={<span title={error ?? undefined}><SaveStatus status={status} /></span>}>
        Guild Profile
      </SectionTitle>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <Field label="Guild Name" error={!name.trim() ? "Guild name can't be empty" : error && `Couldn't save: ${error}`}>
          <TextInput value={name} onChange={e => handleName(e.target.value)} maxLength={64} aria-invalid={!name.trim()} />
        </Field>

        {/* GuildUpdated signal refreshes the icon across all clients */}
        <Field label="Guild Icon">
          <IconUploadField
            src={iconSrc}
            fallback={(name.trim() || guild.name)?.[0]?.toUpperCase() ?? '?'}
            alt="Guild icon"
            hint="Square images work best."
            onImageError={markIconMissing}
            onUpload={file => uploadGuildIcon(guild.id, file)}
            onRemove={() => deleteGuildIcon(guild.id)}
          />
        </Field>
      </div>

      {(!isOwner || isAdmin) && (
        <>
          <SectionTitle>Danger Zone</SectionTitle>
          <DangerZone>
            {/* The owner can't leave their own guild — they can only delete it */}
            {!isOwner && (
              <DangerRow
                title="Leave guild"
                description="You'll lose access to its channels until you're invited back."
                action={<Button variant="danger" onClick={handleLeave}>Leave Guild</Button>}
              />
            )}
            {isAdmin && (
              <DangerRow
                title="Delete guild"
                description="Permanently delete this guild and everything in it. This can't be undone."
                action={<Button variant="danger" onClick={handleDelete}>Delete Guild</Button>}
              />
            )}
          </DangerZone>
        </>
      )}
      {confirmDialog}
    </TabBody>
  );
}

// ─── Invites ──────────────────────────────────────────────────────────────────

function InvitesTab({ guildId }) {
  const [invites, setInvites, loading] = useLoadedList(() => getGuildInvites(guildId), guildId);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState(null);
  const [copied, flashCopied]   = useFlashStatus(); // id of the invite just copied

  async function handleCreate() {
    setCreating(true); setError(null);
    try {
      const inv = await createGuildInvite(guildId);
      setInvites(p => [...p, inv]);
      copyLink(inv);
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  }

  async function handleDelete(inviteId) {
    setError(null);
    try { await deleteGuildInvite(inviteId); setInvites(p => p.filter(i => i.id !== inviteId)); }
    catch (err) { setError(err.message); }
  }

  function copyLink(inv) {
    copyToClipboard(inviteLink(inv.id)).catch(err => console.error('Failed to copy invite link:', err));
    flashCopied(inv.id, 2000);
  }

  const createButton = (
    <Button variant="primary" size="sm" onClick={handleCreate} disabled={creating}>
      <PlusIcon size={13} /> {creating ? 'Creating…' : 'Create Invite'}
    </Button>
  );

  return (
    <TabBody>
      <SectionTitle action={invites.length > 0 && createButton}>Invite Links</SectionTitle>
      <Hint style={{ marginBottom: '1rem' }}>
        Anyone with one of these links can join the guild. Delete a link to stop it working.
      </Hint>
      <ErrorBox style={{ marginBottom: '1rem' }}>{error}</ErrorBox>

      {loading ? <MutedText>Loading…</MutedText> : invites.length === 0 ? (
        <EmptyState icon={LinkIcon} title="No active invites" action={createButton}>
          Create an invite link to bring people into this guild.
        </EmptyState>
      ) : (
        <List>
          {invites.map(inv => (
            <ListRow
              key={inv.id}
              leading={<span className="ui-leading-icon"><LinkIcon size={16} /></span>}
              title={<span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: '0.83rem' }}>{inviteLink(inv.id)}</span>}
              subtitle={`Code ${inv.id}`}
              actions={<>
                <Button size="sm" variant={copied === inv.id ? 'success' : 'secondary'} onClick={() => copyLink(inv)} style={{ minWidth: 84 }}>
                  {copied === inv.id ? <><CheckIcon size={12} /> Copied</> : <><ClipboardIcon size={12} /> Copy</>}
                </Button>
                <IconButton onClick={() => handleDelete(inv.id)} title="Delete invite" aria-label="Delete invite" className="hov-color-danger">
                  <TrashIcon size={15} />
                </IconButton>
              </>}
            />
          ))}
        </List>
      )}
    </TabBody>
  );
}

// ─── Bans ─────────────────────────────────────────────────────────────────────

function BanRow({ ban, onUnban, unbanning }) {
  const { formatDate } = useDateFormat();
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAccountById(ban.userId)
      .then(u => { if (!cancelled) setUser(u ?? false); })
      .catch(() => { if (!cancelled) setUser(false); });
    return () => { cancelled = true; };
  }, [ban.userId]);

  const isPermanent = !ban.until || new Date(ban.until).getFullYear() >= 9999;
  const expires = isPermanent ? null : new Date(ban.until);
  const expiry = isPermanent
    ? 'Permanent'
    : expires < new Date() ? `Expired ${formatDate(expires)}` : `Until ${formatDate(expires)}`;

  return (
    <ListRow
      leading={<Avatar userId={ban.userId} name={user?.username ?? '?'} size={36} color={user?.color} />}
      title={user === null ? 'Loading…' : (user?.username ?? 'Unknown user')}
      subtitle={<span title={`User ID: ${ban.userId}`}>{expiry}</span>}
      actions={
        <Button size="sm" onClick={() => onUnban(ban.userId)} disabled={unbanning}>
          {unbanning ? 'Unbanning…' : 'Unban'}
        </Button>
      }
    />
  );
}

function BansTab({ guildId }) {
  const [bans, setBans, loading]  = useLoadedList(() => getGuildBans(guildId), guildId);
  const [unbanning, setUnbanning] = useState(null);
  const [error, setError]         = useState(null);

  async function handleUnban(userId) {
    setUnbanning(userId); setError(null);
    try {
      await unbanGuildMember(guildId, userId);
      setBans(p => p.filter(b => b.userId !== userId));
    } catch (err) {
      setError(`Failed to unban: ${err.message}`);
    } finally {
      setUnbanning(null);
    }
  }

  return (
    <TabBody>
      <SectionTitle>Bans{!loading && bans.length > 0 && ` — ${bans.length}`}</SectionTitle>
      <ErrorBox style={{ marginBottom: '1rem' }}>{error}</ErrorBox>
      {loading ? <MutedText>Loading…</MutedText> : bans.length === 0 ? (
        <EmptyState icon={HammerIcon} title="No banned users">
          Members you ban from the guild will show up here, where you can unban them.
        </EmptyState>
      ) : (
        <List>
          {bans.map(ban => (
            <BanRow key={ban.id} ban={ban} onUnban={handleUnban} unbanning={unbanning === ban.userId} />
          ))}
        </List>
      )}
    </TabBody>
  );
}

// ─── Guild Settings Modal ─────────────────────────────────────────────────────

export default function GuildSettingsModal({ guild, onClose, onSaved, onDeleted, perms, guildUpdatedEvent, currentUser }) {
  const isOwner        = !!currentUser && guild.ownerId === currentUser.id;
  const isAdmin        = perms?.administrator === ALLOW;
  const canManageGuild = allowed(perms, 'manageGuild');
  const canManageRoles = allowed(perms, 'manageRoles');
  const canManageBans  = allowed(perms, 'banMembers');
  const canManageHooks = allowed(perms, 'manageWebhooks');

  const tabs = [
    canManageGuild && { id: 'overview',     label: 'Overview',            icon: GearIcon,   section: 'Guild' },
    // Always visible (read-only without manageRoles)
    { id: 'roles', label: 'Roles', icon: TagIcon, section: 'Guild' },
    canManageGuild && { id: 'defaultPerms', label: 'Default Perms',       icon: ShieldIcon, section: 'Guild' },
    canManageHooks && { id: 'webhooks',     label: 'Webhooks',            icon: WebhookIcon, section: 'Guild' },
    canManageGuild && { id: 'invites',      label: 'Invites',             icon: LinkIcon,   section: 'Members' },
    canManageBans  && { id: 'bans',         label: 'Bans',                icon: HammerIcon, section: 'Members' },
  ].filter(Boolean);

  const [selectedTab, setTab] = useState(tabs[0].id);
  // Fall back to the first tab if permissions change and hide the selected one
  const tab = tabs.some(t => t.id === selectedTab) ? selectedTab : tabs[0].id;

  return (
    <TabbedModal
      onClose={onClose}
      title="Guild Settings"
      subtitle={guild.name}
      icon={GearIcon}
      tabs={tabs}
      active={tab}
      onChange={setTab}
    >
      {tab === 'overview' && (
        <OverviewTab
          guild={guild}
          isOwner={isOwner}
          isAdmin={isAdmin}
          currentUser={currentUser}
          guildUpdatedEvent={guildUpdatedEvent}
          onClose={onClose}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
      {tab === 'roles'        && <RolesTab guildId={guild.id} canManage={canManageRoles} />}
      {tab === 'defaultPerms' && <DefaultPermsTab guild={guild} onSaved={onSaved} />}
      {tab === 'invites'      && <InvitesTab guildId={guild.id} />}
      {tab === 'bans'         && <BansTab guildId={guild.id} />}
      {tab === 'webhooks'     && <WebhooksTab guildId={guild.id} />}
    </TabbedModal>
  );
}
