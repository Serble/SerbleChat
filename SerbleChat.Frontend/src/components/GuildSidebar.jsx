import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import {
  getGuildChannels, createGuildChannel, deleteGuildChannel,
  updateGuildChannel, updateGuild, deleteGuild,
  createGuildInvite, getGuildInvites, deleteGuildInvite,
  reorderGuildChannel, FRONTEND_URL, uploadGuildIcon, deleteGuildIcon, getGuildIconUrl,
  getChannelIconUrl, uploadChannelIcon, deleteChannelIcon,
} from '../api.js';
import RolesTab from './RolesTab.jsx';
import DefaultPermsTab from './DefaultPermsTab.jsx';
import ChannelPermsTab from './ChannelPermsTab.jsx';
import ChannelNotifContextMenu from './ChannelNotifContextMenu.jsx';
import VoicePanel from './VoicePanel.jsx';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
function allowed(perms, key) {
  if (!perms) return false;
  return perms.administrator === 0 || perms[key] === 0;
}

// ─── Guild Notifications Tab ──────────────────────────────────────────────────

// NotificationPreference: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
const GUILD_NOTIF_OPTIONS = [
  { value: 0, icon: '↩', label: 'Inherit',       desc: 'Use your user default' },
  { value: 1, icon: '🔔', label: 'All Messages',  desc: 'Every message in every channel' },
  { value: 2, icon: '💬', label: 'Mentions Only', desc: 'Only when @mentioned' },
  { value: 3, icon: '🔕', label: 'Nothing',       desc: 'Never' },
];

function GuildPrefPicker({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
        {GUILD_NOTIF_OPTIONS.map(opt => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              title={opt.desc}
              onClick={() => onChange(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.3rem 0.65rem', borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(124,58,237,0.12)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '0.8rem', fontWeight: active ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.1s',
            }}
            className={!active ? 'hov-bg' : undefined}
          >
              <span>{opt.icon}</span> <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GuildNotifTab({ guildId }) {
  const { guildNotifPrefs, loadGuildNotifPrefs, updateGuildNotifPrefs } = useApp();
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const key = String(guildId);
  const cached = guildNotifPrefs[key];

  const [notif,   setNotif]   = useState(cached?.preferences?.notifications ?? 0);
  const [unreads, setUnreads] = useState(cached?.preferences?.unreads       ?? 0);

  useEffect(() => {
    if (!cached) {
      setLoading(true);
      loadGuildNotifPrefs(guildId)
        .then(data => {
          if (data) {
            setNotif(data.preferences?.notifications ?? 0);
            setUnreads(data.preferences?.unreads     ?? 0);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setNotif(cached.preferences?.notifications ?? 0);
      setUnreads(cached.preferences?.unreads     ?? 0);
    }
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    await updateGuildNotifPrefs(guildId, { notifications: notif, unreads });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', lineHeight: 1.6 }}>
        Override notification settings for this server. Channels can further override these.
        <br />Choose <strong style={{ color: 'var(--text-secondary)' }}>Inherit</strong> to use your user defaults.
      </div>
      <GuildPrefPicker label="🔔 Notifications" value={notif}   onChange={setNotif} />
      <GuildPrefPicker label="🔴 Unread Badge"  value={unreads} onChange={setUnreads} />
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          background: saved ? 'var(--success)' : 'var(--accent)', border: 'none',
          borderRadius: 6, padding: '0.55rem 1.25rem', color: '#fff',
          fontSize: '0.875rem', fontWeight: 600,
          cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
          alignSelf: 'flex-start', transition: 'background 0.2s',
        }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save'}
      </button>
    </div>
  );
}

// ─── Guild Settings Modal ─────────────────────────────────────────────────────

function GuildSettingsModal({ guild, onClose, onSaved, onDeleted, perms, guildUpdatedEvent }) {
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState(null);
  const [hasIcon, setHasIcon] = useState(false);
  const iconFileRef = useRef(null);
  const backdropRef = useRef(null);
  const { isMobile } = useMobile();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Check if guild icon exists when modal opens
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getGuildIconUrl(guild.id);
  }, [guild.id]);

  // Refresh icon preview when guild is updated
  useEffect(() => {
    if (!guildUpdatedEvent) return;
    if (String(guildUpdatedEvent.guildId) === String(guild.id)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getGuildIconUrl(guild.id) + '?t=' + guildUpdatedEvent.ts;
    }
  }, [guildUpdatedEvent]);

  const isOwner      = perms?.administrator === 0 && guild; // owner has all perms set Allow
  const canManageGuild = isOwner || allowed(perms, 'manageGuild');
  const canManageRoles = isOwner || allowed(perms, 'manageRoles');
  const canManageInvites = isOwner || allowed(perms, 'manageGuild');

  // Default to first visible tab
  const firstTab = canManageGuild ? 'overview' : canManageRoles ? 'roles' : 'roles';
  const [tab, setTab]         = useState(firstTab);
  const [name, setName]       = useState(guild.name);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [invites, setInvites] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [copied, setCopied]         = useState(null);

  useEffect(() => {
    if (tab !== 'invites') return;
    setInvLoading(true);
    getGuildInvites(guild.id)
      .then(setInvites)
      .catch(console.error)
      .finally(() => setInvLoading(false));
  }, [tab, guild.id]);

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim() || name.trim() === guild.name) { onClose(); return; }
    setBusy(true); setError(null);
    try { await updateGuild(guild.id, { name: name.trim() }); onSaved(name.trim()); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${guild.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteGuild(guild.id); onDeleted(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function handleCreateInvite() {
    setCreating(true);
    try { const inv = await createGuildInvite(guild.id); setInvites(p => [...p, inv]); }
    catch (err) { console.error(err); }
    finally { setCreating(false); }
  }

  async function handleDeleteInvite(inviteId) {
    try { await deleteGuildInvite(inviteId); setInvites(p => p.filter(i => i.id !== inviteId)); }
    catch (err) { console.error(err); }
  }

  function copyLink(inv) {
    navigator.clipboard.writeText(`${FRONTEND_URL}/invite/${inv.id}`);
    setCopied(inv.id);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleIconUpload(file) {
    if (!file) return;
    setUploadingIcon(true);
    setIconError(null);
    try {
      await uploadGuildIcon(guild.id, file);
      setError(null);
      // GuildUpdated signal will handle refreshing the icon across all clients
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  async function handleIconDelete() {
    setUploadingIcon(true);
    setIconError(null);
    try {
      await deleteGuildIcon(guild.id);
      setError(null);
      // GuildUpdated signal will handle refreshing the icon across all clients
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  const tabStyle = active => ({
    background: active ? 'var(--bg-active)' : 'transparent', border: 'none',
    padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
    fontSize: '0.875rem', fontWeight: 600, color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    transition: 'background 0.1s, color 0.1s', whiteSpace: 'nowrap',
  });

  // Roles tab needs more width
  const modalWidth = tab === 'roles' ? 680 : 460;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '1rem' }}
    >
      <div style={{ background: 'var(--bg-base)', borderRadius: isMobile ? 0 : '12px', width: '100%', maxWidth: isMobile ? '100%' : modalWidth, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden', height: isMobile ? '100%' : 'auto', maxHeight: isMobile ? '100%' : '90vh', display: 'flex', flexDirection: 'column', transition: 'max-width 0.15s' }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Guild Settings</div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            className="hov-text-primary">✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.75rem 1.5rem 0', flexShrink: 0, flexWrap: 'wrap' }}>
          {canManageGuild && <button style={tabStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>}
          {canManageInvites && <button style={tabStyle(tab === 'invites')} onClick={() => setTab('invites')}>Invites</button>}
          {canManageGuild  && <button style={tabStyle(tab === 'defaultPerms')} onClick={() => setTab('defaultPerms')}>Default Perms</button>}
          <button style={tabStyle(tab === 'roles')} onClick={() => setTab('roles')}>Roles</button>
        </div>

        {/* Content */}
        <div style={{ overflowY: tab === 'roles' ? 'hidden' : 'auto', flex: 1, padding: tab === 'roles' ? 0 : '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: tab === 'roles' ? 0 : '1rem' }}>

          {/* Overview */}
          {tab === 'overview' && (
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Guild Name</label>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              </div>

              {/* Guild Icon Upload */}
              {canManageGuild && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={labelStyle}>Guild Icon</label>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '8px',
                      background: 'var(--bg-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '2rem', overflow: 'hidden', flexShrink: 0,
                      border: '1px solid var(--border)',
                    }}>
                      {hasIcon ? (
                        <img
                          key={`guild-icon-${guild.id}-${guildUpdatedEvent?.ts || 0}`}
                          src={getGuildIconUrl(guild.id) + (guildUpdatedEvent?.ts ? '?t=' + guildUpdatedEvent.ts : '')}
                          alt="Guild icon"
                          onError={() => setHasIcon(false)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        guild.name?.[0]?.toUpperCase() ?? '?'
                      )}
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <input
                        ref={iconFileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleIconUpload(file);
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => iconFileRef.current?.click()}
                        disabled={uploadingIcon}
                        style={{
                          background: 'var(--bg-active)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          padding: '0.45rem 0.75rem',
                          color: 'var(--text-secondary)',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          cursor: uploadingIcon ? 'default' : 'pointer',
                          opacity: uploadingIcon ? 0.6 : 1,
                          transition: 'background 0.15s, color 0.15s',
                        }}
                        className={!uploadingIcon ? 'hov-bg' : undefined}
                      >
                        {uploadingIcon ? 'Uploading…' : 'Upload Image'}
                      </button>
                      {hasIcon && (
                        <button
                          type="button"
                          onClick={handleIconDelete}
                          disabled={uploadingIcon}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.45rem 0.75rem',
                            color: 'var(--danger)',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: uploadingIcon ? 'default' : 'pointer',
                            opacity: uploadingIcon ? 0.6 : 1,
                            transition: 'background 0.15s, color 0.15s',
                          }}
                          className={!uploadingIcon ? 'hov-danger-fill' : undefined}
                        >
                          Remove Icon
                        </button>
                      )}
                    </div>
                  </div>
                  {iconError && (
                    <div style={{
                      background: 'rgba(242,63,67,0.1)',
                      border: '1px solid rgba(242,63,67,0.3)',
                      borderRadius: '6px',
                      padding: '0.5rem 0.75rem',
                      color: 'var(--danger)',
                      fontSize: '0.83rem'
                    }}>
                      {iconError}
                    </div>
                  )}
                </div>
              )}

              {error && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--danger)', fontSize: '0.83rem' }}>{error}</div>}
              <button type="submit" disabled={busy || !name.trim()}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
                className={!busy && name.trim() ? 'hov-accent' : undefined}>Save Changes</button>
              {isOwner && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Danger Zone</div>
                  <button type="button" onClick={handleDelete} disabled={busy}
                    style={{ background: 'transparent', border: '1px solid var(--danger)', borderRadius: '6px', padding: '0.5rem 1rem', color: 'var(--danger)', fontSize: '0.875rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', alignSelf: 'flex-start', transition: 'background 0.15s, color 0.15s' }}
                    className={!busy ? 'hov-danger-fill' : undefined}>Delete Guild</button>
                </div>
              )}
            </form>
          )}

          {/* Invites */}
          {tab === 'invites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button onClick={handleCreateInvite} disabled={creating}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.55rem 1rem', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1, alignSelf: 'flex-start', transition: 'background 0.15s' }}
                className={!creating ? 'hov-accent' : undefined}>
                {creating ? 'Creating…' : '+ Create Invite'}
              </button>
              {invLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>}
              {!invLoading && invites.length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No active invites. Create one above.</div>}
              {invites.map(inv => {
                const link = `${FRONTEND_URL}/invite/${inv.id}`;
                return (
                  <div key={inv.id} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Invite #{inv.id}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
                    </div>
                    <button onClick={() => copyLink(inv)}
                      style={{ background: copied === inv.id ? 'var(--success)' : 'var(--bg-active)', border: 'none', borderRadius: '5px', padding: '0.35rem 0.65rem', color: '#fff', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', fontWeight: 600 }}>
                      {copied === inv.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <button onClick={() => handleDeleteInvite(inv.id)} title="Delete invite"
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem', borderRadius: '4px', flexShrink: 0, lineHeight: 1 }}
                      className="hov-color-danger">🗑</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Default Permissions */}
          {tab === 'defaultPerms' && (
            <DefaultPermsTab guild={guild} onSaved={() => {}} />
          )}

          {/* Roles — full-height split layout */}
          {tab === 'roles' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0.75rem 1rem 1rem' }}>
              <RolesTab guildId={guild.id} canManage={canManageRoles} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Quick-invite popup ───────────────────────────────────────────────────────

function InvitePopup({ guildId, onClose }) {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy]     = useState(true);
  const [copied, setCopied] = useState(false);
  const backdropRef = useRef(null);
  const { isMobile } = useMobile();
  // Prevent double POST in React StrictMode (effect fires twice in dev)
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    createGuildInvite(guildId)
      .then(setInvite)
      .catch(console.error)
      .finally(() => setBusy(false));
  }, [guildId]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const link = invite ? `${FRONTEND_URL}/invite/${invite.id}` : '';

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return createPortal(
    <div ref={backdropRef} onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '1rem' }}>
      <div style={{ background: 'var(--bg-base)', borderRadius: isMobile ? 0 : '12px', width: '100%', maxWidth: isMobile ? '100%' : 400, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: isMobile ? '100%' : 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>🔗 Invite People</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            className="hov-text-primary">✕</button>
        </div>
        {busy && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Creating invite link…</div>}
        {!busy && invite && (
          <>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Share this link with people you want to invite:</div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '0.65rem 0.75rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{link}</div>
            <button onClick={copyLink}
              style={{ background: copied ? 'var(--success)' : 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}>
              {copied ? '✓ Copied to Clipboard!' : 'Copy Invite Link'}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Create Channel Modal ─────────────────────────────────────────────────────

function CreateChannelModal({ guildId, onClose, onCreate }) {
  const [name, setName]               = useState('');
  const [voiceCapable, setVoiceCapable] = useState(false);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState(null);
  const backdropRef                   = useRef(null);
  const { isMobile }                  = useMobile();
  const inputRef                      = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true); setErr(null);
    try {
      const ch = await createGuildChannel(guildId, trimmed, voiceCapable);
      onCreate(ch);
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '1rem' }}
    >
      <div style={{ background: 'var(--bg-base)', borderRadius: isMobile ? 0 : '12px', width: '100%', maxWidth: isMobile ? '100%' : 420, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden', height: isMobile ? '100%' : 'auto' }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Create Channel</div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            className="hov-text-primary">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div>
            <label style={labelStyle}>Channel Name</label>
            <input ref={inputRef} value={name} onChange={e => setName(e.target.value)} maxLength={64}
              placeholder="new-channel"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'} />
          </div>

          {/* Voice capable toggle */}
          <div
            onClick={() => setVoiceCapable(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: '8px', cursor: 'pointer', userSelect: 'none', border: '1px solid var(--border)' }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Voice Channel</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Enable voice &amp; video capabilities</div>
            </div>
            <Toggle on={voiceCapable} />
          </div>

          {err && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--danger)', fontSize: '0.83rem' }}>{err}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: 'border-color 0.15s' }}
              className="hov-border-only">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.55rem 1.1rem', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
              className={!busy && name.trim() ? 'hov-accent' : undefined}>
              {busy ? 'Creating…' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ on }) {
  return (
    <div style={{
      width: 40, height: 22, borderRadius: 11, flexShrink: 0,
      background: on ? '#7c3aed' : '#4f5660',
      position: 'relative', transition: 'background 0.2s',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: on ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }} />
    </div>
  );
}

// ─── Channel Settings Modal ───────────────────────────────────────────────────

function ChannelSettingsModal({ guildId, channel, canManage, onClose, onUpdated, onDeleted, channelUpdatedEvent }) {
  const [tab, setTab]               = useState('overview');
  const [name, setName]             = useState(channel.name);
  const [voiceCapable, setVoiceCapable] = useState(channel.voiceCapable ?? false);
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState(null);
  const [hasIcon, setHasIcon] = useState(false);
  const iconFileRef = useRef(null);
  const backdropRef                 = useRef(null);
  const { isMobile }                = useMobile();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Check if channel icon exists when modal opens
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getChannelIconUrl(guildId, channel.id);
  }, [channel.id, guildId]);

  // Refresh icon preview when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent) return;
    if (String(channelUpdatedEvent.channelId) === String(channel.id)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getChannelIconUrl(guildId, channel.id) + '?t=' + channelUpdatedEvent.ts;
    }
  }, [channelUpdatedEvent, channel.id, guildId]);

  async function handleSave(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const nameChanged  = trimmed !== channel.name;
    const voiceChanged = voiceCapable !== (channel.voiceCapable ?? false);
    if (!nameChanged && !voiceChanged) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      await updateGuildChannel(guildId, channel.id, { name: trimmed, voiceCapable });
      onUpdated({ ...channel, name: trimmed, voiceCapable });
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete #${channel.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteGuildChannel(guildId, channel.id);
      onDeleted();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function handleIconUpload(file) {
    if (!file) return;
    setUploadingIcon(true);
    setIconError(null);
    try {
      await uploadChannelIcon(guildId, channel.id, file);
      setErr(null);
      // ChannelUpdated signal will handle refreshing the icon
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  async function handleIconDelete() {
    setUploadingIcon(true);
    setIconError(null);
    try {
      await deleteChannelIcon(guildId, channel.id);
      setErr(null);
      // ChannelUpdated signal will handle refreshing the icon
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  const tabStyle = active => ({
    background: active ? 'var(--bg-active)' : 'transparent', border: 'none',
    padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
    fontSize: '0.875rem', fontWeight: 600, color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    transition: 'background 0.1s, color 0.1s', whiteSpace: 'nowrap',
  });

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '1rem' }}
    >
      <div style={{ background: 'var(--bg-base)', borderRadius: isMobile ? 0 : '12px', width: '100%', maxWidth: isMobile ? '100%' : (tab === 'permissions' ? 560 : 420), maxHeight: isMobile ? '100%' : '85vh', height: isMobile ? '100%' : 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'max-width 0.15s' }}>
        {/* Header */}
        <div style={{ padding: '1.1rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Channel Settings</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}># {channel.name}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            className="hov-text-primary">✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.75rem 1.5rem 0', flexShrink: 0 }}>
          <button style={tabStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={tabStyle(tab === 'permissions')} onClick={() => setTab('permissions')}>Permissions</button>
        </div>

        {/* Content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {tab === 'overview' && (
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Channel Name</label>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              </div>

              {/* Voice capable toggle */}
              <div
                onClick={() => canManage && setVoiceCapable(v => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: '8px', cursor: canManage ? 'pointer' : 'default', userSelect: 'none', border: '1px solid var(--border)', opacity: canManage ? 1 : 0.5 }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Voice Channel</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Enable voice &amp; video capabilities</div>
                </div>
                <Toggle on={voiceCapable} />
              </div>

              {/* Channel Icon Upload */}
              {canManage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={labelStyle}>Channel Icon</label>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '8px',
                      background: 'var(--bg-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '2rem', overflow: 'hidden', flexShrink: 0,
                      border: '1px solid var(--border)',
                    }}>
                      {hasIcon ? (
                        <img
                          key={`channel-icon-${channel.id}-${channelUpdatedEvent?.ts || 0}`}
                          src={getChannelIconUrl(guildId, channel.id) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
                          alt="Channel icon"
                          onError={() => setHasIcon(false)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        '#'
                      )}
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <input
                        ref={iconFileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleIconUpload(file);
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => iconFileRef.current?.click()}
                        disabled={uploadingIcon}
                        style={{
                          background: 'var(--bg-active)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          padding: '0.45rem 0.75rem',
                          color: 'var(--text-secondary)',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          cursor: uploadingIcon ? 'default' : 'pointer',
                          opacity: uploadingIcon ? 0.6 : 1,
                          transition: 'background 0.15s, color 0.15s',
                        }}
                        className={!uploadingIcon ? 'hov-bg' : undefined}
                      >
                        {uploadingIcon ? 'Uploading…' : 'Upload Image'}
                      </button>
                      {hasIcon && (
                        <button
                          type="button"
                          onClick={handleIconDelete}
                          disabled={uploadingIcon}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.45rem 0.75rem',
                            color: 'var(--danger)',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: uploadingIcon ? 'default' : 'pointer',
                            opacity: uploadingIcon ? 0.6 : 1,
                            transition: 'background 0.15s, color 0.15s',
                          }}
                          className={!uploadingIcon ? 'hov-danger-fill' : undefined}
                        >
                          Remove Icon
                        </button>
                      )}
                    </div>
                  </div>
                  {iconError && (
                    <div style={{
                      background: 'rgba(242,63,67,0.1)',
                      border: '1px solid rgba(242,63,67,0.3)',
                      borderRadius: '6px',
                      padding: '0.5rem 0.75rem',
                      color: 'var(--danger)',
                      fontSize: '0.83rem',
                    }}>
                      {iconError}
                    </div>
                  )}
                </div>
              )}

              {err && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--danger)', fontSize: '0.83rem' }}>{err}</div>}
              {canManage && (
                <button type="submit" disabled={busy || !name.trim()}
                  style={{ background: 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
                  className={!busy && name.trim() ? 'hov-accent' : undefined}>Save Changes</button>
              )}
              {canManage && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Danger Zone</div>
                  <button type="button" onClick={handleDelete} disabled={busy}
                    style={{ background: 'transparent', border: '1px solid var(--danger)', borderRadius: '6px', padding: '0.5rem 1rem', color: 'var(--danger)', fontSize: '0.875rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', alignSelf: 'flex-start', transition: 'background 0.15s, color 0.15s' }}
                    className={!busy ? 'hov-danger-fill' : undefined}>Delete Channel</button>
                </div>
              )}
            </form>
          )}

          {tab === 'permissions' && (
            <ChannelPermsTab guildId={guildId} channelId={channel.id} canManage={canManage} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Channel Row ──────────────────────────────────────────────────────────────

function VoiceParticipantsBelow({ channelId }) {
  const [users, setUsers] = useState({});
  const { resolveUser, voiceUsersByChannel, primeVoiceUsers } = useApp();
  const userIds = voiceUsersByChannel[String(channelId)] ?? [];

  useEffect(() => {
    primeVoiceUsers(channelId);
  }, [channelId, primeVoiceUsers]);

  useEffect(() => {
    userIds.forEach(id => {
      if (!users[id]) {
        resolveUser(id).then(user => {
          setUsers(prev => ({ ...prev, [id]: user }));
        });
      }
    });
  }, [userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (userIds.length === 0) {
    return null;
  }

  return (
    <div style={{
      paddingLeft: '2rem',
      paddingRight: '0.4rem',
      paddingTop: '0.2rem',
      paddingBottom: '0.2rem',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.35rem',
      alignItems: 'center',
    }}>
      {userIds.map(id => {
        const user = users[id];
        const name = user?.username ?? id.slice(0, 10);
        
        return (
          <UserInteraction key={id} userId={user?.id} username={name}>
            <div
              title={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.2rem 0.35rem',
                borderRadius: '3px',
                background: 'rgba(124,58,237,0.08)',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
              }}
            >
              <Avatar userId={user?.id} name={name} size={16} color={user?.color} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>
                {name}
              </span>
            </div>
          </UserInteraction>
        );
      })}
    </div>
  );
}

function ChannelRow({ ch, canManage, active, onNavigate, onSettings, onVoiceJoin,
                       onDragStart, onDragEnter, onDragEnd, isDragOver }) {
  const { unreads, channelUpdatedEvent } = useApp();
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }
  const [hasIcon, setHasIcon] = useState(false);
  const unread = unreads[String(ch.id)] ?? 0;

  // Check if channel icon exists
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getChannelIconUrl(ch.guildId, ch.id);
  }, [ch.id, ch.guildId]);

  // Refresh icon when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent) return;
    if (String(channelUpdatedEvent.channelId) === String(ch.id)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getChannelIconUrl(ch.guildId, ch.id) + '?t=' + channelUpdatedEvent.ts;
    }
  }, [channelUpdatedEvent, ch.id, ch.guildId]);

  function handleContextMenu(e) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <div
        draggable={canManage}
        onDragStart={canManage ? onDragStart : undefined}
        onDragEnter={canManage ? onDragEnter : undefined}
        onDragEnd={canManage ? onDragEnd : undefined}
        onDragOver={canManage ? e => e.preventDefault() : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.1rem 0.25rem 0.1rem 0',
          borderRadius: '6px',
          background: isDragOver ? 'rgba(88,101,242,0.15)' : 'transparent',
          borderTop: isDragOver ? '2px solid #5865f2' : '2px solid transparent',
          transition: 'background 0.1s',
          cursor: canManage ? 'grab' : 'default',
        }}
      >
        {/* Drag handle */}
        {canManage && (
          <span style={{
            color: hovered ? '#4f5660' : 'transparent',
            fontSize: '0.75rem', lineHeight: 1, padding: '0 0.1rem',
            flexShrink: 0, cursor: 'grab', userSelect: 'none',
            transition: 'color 0.1s',
          }}>⠿</span>
        )}

        <button
          onClick={onNavigate}
          onContextMenu={handleContextMenu}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.3rem 0.4rem', borderRadius: '5px', flex: 1,
            background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontSize: '0.875rem', fontWeight: active || unread > 0 ? 600 : 400,
            transition: 'background 0.1s, color 0.1s',
            minWidth: 0,
          }}
        >
          {/* Channel icon or default symbol */}
          {hasIcon ? (
            <img
              key={`channel-icon-${ch.id}-${channelUpdatedEvent?.ts || 0}`}
              src={getChannelIconUrl(ch.guildId, ch.id) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
              alt="Channel icon"
              onError={() => setHasIcon(false)}
              style={{
                width: 16, height: 16, borderRadius: '4px', flexShrink: 0,
                objectFit: 'cover',
              }}
            />
          ) : (
            <span style={{ color: hovered || active ? 'var(--text-muted)' : 'var(--text-subtle)', fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 }}>
              {ch.voiceCapable ? '🔊' : '#'}
            </span>
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
          {unread > 0 && !active && (
            <span style={{
              background: 'var(--danger)', color: '#fff', borderRadius: '9999px',
              padding: '0.1rem 0.38rem', fontSize: '0.68rem', fontWeight: 700,
              minWidth: 18, textAlign: 'center', flexShrink: 0,
            }}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {ch.voiceCapable && onVoiceJoin && (
          <button
            title="Join Voice"
            onClick={e => { e.stopPropagation(); onVoiceJoin(); }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
              padding: '0.15rem 0.25rem', borderRadius: '3px', lineHeight: 1,
              fontSize: '0.9rem', flexShrink: 0, transition: 'color 0.1s',
            }}
            className="hov-text-primary"
          >🎙️</button>
        )}

        {/* Settings icon — only visible to managers on hover */}
        {canManage && hovered && (
          <span
            title="Channel Settings"
            onClick={e => { e.stopPropagation(); onSettings(); }}
            style={{ cursor: 'pointer', color: '#72767d', fontSize: '0.9rem', padding: '0.15rem 0.25rem', borderRadius: '3px', lineHeight: 1, flexShrink: 0, transition: 'color 0.1s' }}
            className="hov-text-primary"
          >⚙</span>
        )}
      </div>
      {ctxMenu && (
        <ChannelNotifContextMenu
          channelId={ch.id}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      
      {/* Voice participants below voice-capable channels */}
      {ch.voiceCapable && (
        <VoiceParticipantsBelow channelId={ch.id} />
      )}
    </>
  );
}

// ─── Main GuildSidebar ────────────────────────────────────────────────────────

export default function GuildSidebar({ guildId }) {
  const { guilds, currentUser, refreshGuilds, guildChannelEvent, loadGuildPermissions, getMyPerms, isConnected, guildUpdatedEvent, rolesUpdatedEvent, channelUpdatedEvent } = useApp();
  const { voiceSession, voiceMuted, voiceDeafened, toggleMute, toggleDeafen, leaveVoice, joinVoice, voiceChannelId, voiceParticipants, remoteScreenShares, voiceStatus, voiceError } = useVoice();
  const [channels, setChannels]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showSettings, setShowSettings]   = useState(false);
  const [showInvite, setShowInvite]       = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelSettings, setChannelSettings] = useState(null); // channel object or null
  // Drag-to-reorder state
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const dragIndexRef = useRef(null); // index being dragged
  const nav = useNavigate();
  const loc = useLocation();

  const guild = guilds.find(g => String(g.id) === String(guildId));
  const currentChannelId = loc.pathname.match(/\/channel\/(\d+)/)?.[1];

  // Resolved permissions for this guild
  const perms = getMyPerms(guildId);
  const canManageChannels = allowed(perms, 'manageChannels');
  const canCreateInvites  = allowed(perms, 'createInvites');
  const canManageGuild    = allowed(perms, 'manageGuild');
  const canManageRoles    = allowed(perms, 'manageRoles');
  const canOpenSettings   = canManageGuild || canManageRoles;

  // Load permissions whenever the guild changes
  useEffect(() => {
    if (guildId) loadGuildPermissions(guildId);
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadChannels() {
    if (!guildId) return;
    setLoading(true);
    try { setChannels((await getGuildChannels(guildId)) ?? []); }
    catch (e) { console.error('loadChannels failed:', e); setChannels([]); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    setChannels([]); setShowSettings(false);
    loadChannels();
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to SignalR guild channel events
  useEffect(() => {
    if (!guildChannelEvent) return;
    if (guildChannelEvent.type === 'NewChannel' && String(guildChannelEvent.guildId) === String(guildId)) {
      loadChannels();
    } else if (guildChannelEvent.type === 'ChannelDeleted') {
      setChannels(p => p.filter(c => String(c.id) !== String(guildChannelEvent.channelId)));
    }
  }, [guildChannelEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to GuildUpdated event - reload channels and guild info
  useEffect(() => {
    if (!guildUpdatedEvent) return;
    if (String(guildUpdatedEvent.guildId) === String(guildId)) {
      loadChannels();
    }
  }, [guildUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to RolesUpdated event - reload channels to refresh permissions
  useEffect(() => {
    if (!rolesUpdatedEvent) return;
    if (String(rolesUpdatedEvent.guildId) === String(guildId)) {
      loadChannels();
      loadGuildPermissions(guildId);
    }
  }, [rolesUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const ch = channels[fromIndex];
    if (!ch) return;

    // Optimistic update
    setChannels(prev => {
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, ch);
      return next;
    });

    try {
      await reorderGuildChannel(guildId, ch.id, toIndex);
    } catch (err) {
      console.error('reorderGuildChannel failed:', err);
      // Roll back by re-fetching
      loadChannels();
    }
  }

  return (
    <div style={{ width: 240, background: 'var(--bg-secondary)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
      {/* Guild header */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 0.75rem 0 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: '0.25rem' }}>
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {guild?.name ?? '…'}
        </span>
        {canCreateInvites && (
          <button title="Create Invite" onClick={() => setShowInvite(true)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.2rem 0.3rem', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0 }}
            className="hov-text-primary">🔗</button>
        )}
        {canOpenSettings && (
          <button title="Guild Settings" onClick={() => setShowSettings(true)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem 0.3rem', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0 }}
            className="hov-text-primary">⚙</button>
        )}
      </div>

      {/* Channel list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.25rem', marginBottom: '0.2rem' }}>
          <span style={{ flex: 1, fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', userSelect: 'none' }}>Text Channels</span>
          {canManageChannels && (
            <button title="Create Channel" onClick={() => setShowCreateChannel(true)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.1rem', borderRadius: '4px', transition: 'color 0.15s' }}
              className="hov-text-secondary">＋</button>
          )}
        </div>

        {loading && <div style={{ color: 'var(--text-subtle)', fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>Loading…</div>}
        {!loading && channels.length === 0 && (
          <div style={{ color: 'var(--text-subtle)', fontSize: '0.82rem', padding: '0.4rem 0.5rem', lineHeight: 1.5 }}>
            No channels yet.{canManageChannels ? ' Use ＋ to add one.' : ''}
          </div>
        )}

        {channels.map((ch, i) => (
          <ChannelRow key={ch.id} ch={ch} canManage={canManageChannels}
            active={String(currentChannelId) === String(ch.id)}
            onNavigate={() => nav(`/app/channel/${ch.id}`)}
            onVoiceJoin={() => {
              nav(`/app/channel/${ch.id}`);
              joinVoice(Number(ch.id));
            }}
            onSettings={() => setChannelSettings(ch)}
            isDragOver={dragOverIndex === i}
            onDragStart={() => { dragIndexRef.current = i; }}
            onDragEnter={() => setDragOverIndex(i)}
            onDragEnd={() => {
              const from = dragIndexRef.current;
              const to   = dragOverIndex;
              dragIndexRef.current = null;
              setDragOverIndex(null);
              if (from !== null && to !== null) handleReorder(from, to);
            }}
          />
        ))}
      </div>

      {/* Voice Panel - shown when connected to voice */}
      {(voiceSession || voiceStatus !== 'idle' || voiceError) && (
        <VoicePanel
          channelId={voiceChannelId}
          voiceSession={voiceSession}
          participants={voiceParticipants}
          voiceMuted={voiceMuted}
          voiceDeafened={voiceDeafened}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          onToggleMute={toggleMute}
          onToggleDeafen={toggleDeafen}
          onLeave={leaveVoice}
          onRetry={() => voiceChannelId && joinVoice(voiceChannelId)}
          remoteScreenShares={remoteScreenShares}
        />
      )}

      {/* User panel */}
      {currentUser && (
        <div style={{
          padding: '0.6rem 0.75rem', background: 'var(--bg-user-panel)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          flexShrink: 0,
        }}>
          <div style={{ position: 'relative' }}>
            <Avatar userId={currentUser.id} name={currentUser.username} size={32} color={currentUser.color} />
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 10, height: 10, borderRadius: '50%',
              background: isConnected ? 'var(--success)' : 'var(--text-subtle)',
              border: '2px solid var(--bg-user-panel)',
            }} />
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{
              fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {currentUser.username}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {isConnected ? '● Online' : '○ Offline'}
            </div>
          </div>
          <button
            title="Log out"
            onClick={() => { localStorage.removeItem('jwt'); window.location.href = '/'; }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '0.3rem', borderRadius: '4px',
              fontSize: '1rem', flexShrink: 0, lineHeight: 1,
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(242,63,67,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            ⏻
          </button>
        </div>
      )}

      {showSettings && guild && (
        <GuildSettingsModal
          guild={guild}
          perms={perms}
          guildUpdatedEvent={guildUpdatedEvent}
          onClose={() => setShowSettings(false)}
          onSaved={() => refreshGuilds()}
          onDeleted={() => { refreshGuilds(); nav('/app/friends', { replace: true }); }}
        />
      )}

      {showInvite && (
        <InvitePopup guildId={guildId} onClose={() => setShowInvite(false)} />
      )}

      {showCreateChannel && (
        <CreateChannelModal
          guildId={guildId}
          onClose={() => setShowCreateChannel(false)}
          onCreate={ch => {
            setChannels(p => [...p, ch]);
            nav(`/app/channel/${ch.id}`);
          }}
        />
      )}

      {channelSettings && (
        <ChannelSettingsModal
          guildId={guildId}
          channel={channelSettings}
          canManage={canManageChannels}
          onClose={() => setChannelSettings(null)}
          onUpdated={updated => {
            setChannels(p => p.map(c => c.id === updated.id ? { ...c, ...updated } : c));
            setChannelSettings(null);
          }}
          onDeleted={() => {
            setChannels(p => p.filter(c => c.id !== channelSettings.id));
            if (String(currentChannelId) === String(channelSettings.id)) nav(`/app/guild/${guildId}`, { replace: true });
            setChannelSettings(null);
          }}
          channelUpdatedEvent={channelUpdatedEvent}
        />
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.4rem',
};
const inputStyle = {
  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.65rem 0.75rem', color: 'var(--text-primary)',
  fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};
