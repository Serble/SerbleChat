import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import {
  getGuildChannels, createGuildChannel, deleteGuildChannel,
  updateGuildChannel, updateGuild, deleteGuild,
  createGuildInvite, getGuildInvites, deleteGuildInvite,
  reorderGuildChannel, FRONTEND_URL,
} from '../api.js';
import RolesTab from './RolesTab.jsx';
import DefaultPermsTab from './DefaultPermsTab.jsx';
import ChannelPermsTab from './ChannelPermsTab.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
function allowed(perms, key) {
  if (!perms) return false;
  return perms.administrator === 0 || perms[key] === 0;
}

// ─── Guild Settings Modal ─────────────────────────────────────────────────────

function GuildSettingsModal({ guild, onClose, onSaved, onDeleted, perms }) {
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
  const backdropRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const tabStyle = active => ({
    background: active ? '#404249' : 'transparent', border: 'none',
    padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
    fontSize: '0.875rem', fontWeight: 600, color: active ? '#f2f3f5' : '#72767d',
    transition: 'background 0.1s, color 0.1s', whiteSpace: 'nowrap',
  });

  // Roles tab needs more width
  const modalWidth = tab === 'roles' ? 680 : 460;

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: '#313338', borderRadius: '12px', width: '100%', maxWidth: modalWidth, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column', transition: 'max-width 0.15s' }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f2f3f5' }}>Guild Settings</div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#72767d', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>✕</button>
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
                  onFocus={e => e.target.style.borderColor = '#7c3aed'}
                  onBlur={e => e.target.style.borderColor = '#3b3d43'} />
              </div>
              {error && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#f23f43', fontSize: '0.83rem' }}>{error}</div>}
              <button type="submit" disabled={busy || !name.trim()}
                style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!busy && name.trim()) e.currentTarget.style.background = '#6d28d9'; }}
                onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>Save Changes</button>
              {isOwner && (
                <div style={{ borderTop: '1px solid #3b3d43', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f23f43', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Danger Zone</div>
                  <button type="button" onClick={handleDelete} disabled={busy}
                    style={{ background: 'transparent', border: '1px solid #f23f43', borderRadius: '6px', padding: '0.5rem 1rem', color: '#f23f43', fontSize: '0.875rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', alignSelf: 'flex-start', transition: 'background 0.15s, color 0.15s' }}
                    onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = '#f23f43'; e.currentTarget.style.color = '#fff'; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#f23f43'; }}>Delete Guild</button>
                </div>
              )}
            </form>
          )}

          {/* Invites */}
          {tab === 'invites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button onClick={handleCreateInvite} disabled={creating}
                style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.55rem 1rem', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1, alignSelf: 'flex-start', transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!creating) e.currentTarget.style.background = '#6d28d9'; }}
                onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>
                {creating ? 'Creating…' : '+ Create Invite'}
              </button>
              {invLoading && <div style={{ color: '#72767d', fontSize: '0.85rem' }}>Loading…</div>}
              {!invLoading && invites.length === 0 && <div style={{ color: '#4f5660', fontSize: '0.85rem' }}>No active invites. Create one above.</div>}
              {invites.map(inv => {
                const link = `${FRONTEND_URL}/invite/${inv.id}`;
                return (
                  <div key={inv.id} style={{ background: '#1e1f22', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '0.7rem', color: '#72767d', marginBottom: '0.15rem' }}>Invite #{inv.id}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#b5bac1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
                    </div>
                    <button onClick={() => copyLink(inv)}
                      style={{ background: copied === inv.id ? '#23a55a' : '#383a40', border: 'none', borderRadius: '5px', padding: '0.35rem 0.65rem', color: '#fff', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', fontWeight: 600 }}>
                      {copied === inv.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <button onClick={() => handleDeleteInvite(inv.id)} title="Delete invite"
                      style={{ background: 'transparent', border: 'none', color: '#72767d', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem', borderRadius: '4px', flexShrink: 0, lineHeight: 1 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#f23f43'}
                      onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>🗑</button>
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
    </div>
  );
}

// ─── Quick-invite popup ───────────────────────────────────────────────────────

function InvitePopup({ guildId, onClose }) {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy]     = useState(true);
  const [copied, setCopied] = useState(false);
  const backdropRef = useRef(null);
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

  return (
    <div ref={backdropRef} onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: '#313338', borderRadius: '12px', width: '100%', maxWidth: 400, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f2f3f5' }}>🔗 Invite People</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#72767d', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>✕</button>
        </div>
        {busy && <div style={{ color: '#72767d', fontSize: '0.85rem' }}>Creating invite link…</div>}
        {!busy && invite && (
          <>
            <div style={{ fontSize: '0.82rem', color: '#72767d' }}>Share this link with people you want to invite:</div>
            <div style={{ background: '#1e1f22', borderRadius: '6px', padding: '0.65rem 0.75rem', fontFamily: 'monospace', fontSize: '0.82rem', color: '#b5bac1', wordBreak: 'break-all' }}>{link}</div>
            <button onClick={copyLink}
              style={{ background: copied ? '#23a55a' : '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}>
              {copied ? '✓ Copied to Clipboard!' : 'Copy Invite Link'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Create Channel Modal ─────────────────────────────────────────────────────

function CreateChannelModal({ guildId, onClose, onCreate }) {
  const [name, setName]               = useState('');
  const [voiceCapable, setVoiceCapable] = useState(false);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState(null);
  const backdropRef                   = useRef(null);
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

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: '#313338', borderRadius: '12px', width: '100%', maxWidth: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f2f3f5' }}>Create Channel</div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#72767d', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div>
            <label style={labelStyle}>Channel Name</label>
            <input ref={inputRef} value={name} onChange={e => setName(e.target.value)} maxLength={64}
              placeholder="new-channel"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#3b3d43'} />
          </div>

          {/* Voice capable toggle */}
          <div
            onClick={() => setVoiceCapable(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: '#2b2d31', borderRadius: '8px', cursor: 'pointer', userSelect: 'none', border: '1px solid #3b3d43' }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#dbdee1' }}>Voice Channel</div>
              <div style={{ fontSize: '0.72rem', color: '#72767d', marginTop: '0.1rem' }}>Enable voice &amp; video capabilities</div>
            </div>
            <Toggle on={voiceCapable} />
          </div>

          {err && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#f23f43', fontSize: '0.83rem' }}>{err}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ background: 'transparent', border: '1px solid #3b3d43', borderRadius: '6px', padding: '0.55rem 1rem', color: '#b5bac1', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#72767d'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#3b3d43'}>Cancel</button>
            <button type="submit" disabled={busy || !name.trim()}
              style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.55rem 1.1rem', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
              onMouseEnter={e => { if (!busy && name.trim()) e.currentTarget.style.background = '#6d28d9'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>
              {busy ? 'Creating…' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

function ChannelSettingsModal({ guildId, channel, canManage, onClose, onUpdated, onDeleted }) {
  const [tab, setTab]               = useState('overview');
  const [name, setName]             = useState(channel.name);
  const [voiceCapable, setVoiceCapable] = useState(channel.voiceCapable ?? false);
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState(null);
  const backdropRef                 = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const tabStyle = active => ({
    background: active ? '#404249' : 'transparent', border: 'none',
    padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
    fontSize: '0.875rem', fontWeight: 600, color: active ? '#f2f3f5' : '#72767d',
    transition: 'background 0.1s, color 0.1s', whiteSpace: 'nowrap',
  });

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: '#313338', borderRadius: '12px', width: '100%', maxWidth: tab === 'permissions' ? 560 : 420, maxHeight: '85vh', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'max-width 0.15s' }}>
        {/* Header */}
        <div style={{ padding: '1.1rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: '#f2f3f5' }}>Channel Settings</div>
            <div style={{ fontSize: '0.75rem', color: '#72767d', marginTop: '0.1rem' }}># {channel.name}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#72767d', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>✕</button>
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
                  onFocus={e => e.target.style.borderColor = '#7c3aed'}
                  onBlur={e => e.target.style.borderColor = '#3b3d43'} />
              </div>

              {/* Voice capable toggle */}
              <div
                onClick={() => canManage && setVoiceCapable(v => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: '#2b2d31', borderRadius: '8px', cursor: canManage ? 'pointer' : 'default', userSelect: 'none', border: '1px solid #3b3d43', opacity: canManage ? 1 : 0.5 }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#dbdee1' }}>Voice Channel</div>
                  <div style={{ fontSize: '0.72rem', color: '#72767d', marginTop: '0.1rem' }}>Enable voice &amp; video capabilities</div>
                </div>
                <Toggle on={voiceCapable} />
              </div>

              {err && <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#f23f43', fontSize: '0.83rem' }}>{err}</div>}
              {canManage && (
                <button type="submit" disabled={busy || !name.trim()}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s' }}
                  onMouseEnter={e => { if (!busy && name.trim()) e.currentTarget.style.background = '#6d28d9'; }}
                  onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>Save Changes</button>
              )}
              {canManage && (
                <div style={{ borderTop: '1px solid #3b3d43', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f23f43', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Danger Zone</div>
                  <button type="button" onClick={handleDelete} disabled={busy}
                    style={{ background: 'transparent', border: '1px solid #f23f43', borderRadius: '6px', padding: '0.5rem 1rem', color: '#f23f43', fontSize: '0.875rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', alignSelf: 'flex-start', transition: 'background 0.15s, color 0.15s' }}
                    onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = '#f23f43'; e.currentTarget.style.color = '#fff'; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#f23f43'; }}>Delete Channel</button>
                </div>
              )}
            </form>
          )}

          {tab === 'permissions' && (
            <ChannelPermsTab guildId={guildId} channelId={channel.id} canManage={canManage} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Channel Row ──────────────────────────────────────────────────────────────

function ChannelRow({ ch, canManage, active, onNavigate, onSettings,
                       onDragStart, onDragEnter, onDragEnd, isDragOver }) {
  const [hovered, setHovered] = useState(false);

  return (
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
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          padding: '0.3rem 0.4rem', borderRadius: '5px', flex: 1,
          background: active ? '#404249' : hovered ? '#35363c' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          color: active ? '#f2f3f5' : hovered ? '#dbdee1' : '#949ba4',
          fontSize: '0.875rem', fontWeight: active ? 600 : 400,
          transition: 'background 0.1s, color 0.1s',
          minWidth: 0,
        }}
      >
        <span style={{ color: hovered || active ? '#72767d' : '#4f5660', fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 }}>
          {ch.voiceCapable ? '🔊' : '#'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
      </button>

      {/* Settings icon — only visible to managers on hover */}
      {canManage && hovered && (
        <span
          title="Channel Settings"
          onClick={e => { e.stopPropagation(); onSettings(); }}
          style={{ cursor: 'pointer', color: '#72767d', fontSize: '0.9rem', padding: '0.15rem 0.25rem', borderRadius: '3px', lineHeight: 1, flexShrink: 0, transition: 'color 0.1s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#dbdee1'}
          onMouseLeave={e => e.currentTarget.style.color = '#72767d'}
        >⚙</span>
      )}
    </div>
  );
}

// ─── Main GuildSidebar ────────────────────────────────────────────────────────

export default function GuildSidebar({ guildId }) {
  const { guilds, currentUser, refreshGuilds, guildChannelEvent, loadGuildPermissions, getMyPerms } = useApp();
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
    <div style={{ width: 240, background: '#2b2d31', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #111213' }}>
      {/* Guild header */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 0.75rem 0 1rem', borderBottom: '1px solid #1e1f22', flexShrink: 0, gap: '0.25rem' }}>
        <span style={{ flex: 1, fontWeight: 700, color: '#f2f3f5', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {guild?.name ?? '…'}
        </span>
        {canCreateInvites && (
          <button title="Create Invite" onClick={() => setShowInvite(true)}
            style={{ background: 'transparent', border: 'none', color: '#72767d', cursor: 'pointer', fontSize: '0.9rem', padding: '0.2rem 0.3rem', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>🔗</button>
        )}
        {canOpenSettings && (
          <button title="Guild Settings" onClick={() => setShowSettings(true)}
            style={{ background: 'transparent', border: 'none', color: '#72767d', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem 0.3rem', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>⚙</button>
        )}
      </div>

      {/* Channel list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.25rem', marginBottom: '0.2rem' }}>
          <span style={{ flex: 1, fontSize: '0.68rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', userSelect: 'none' }}>Text Channels</span>
          {canManageChannels && (
            <button title="Create Channel" onClick={() => setShowCreateChannel(true)}
              style={{ background: 'transparent', border: 'none', color: '#72767d', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.1rem', borderRadius: '4px', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#dbdee1'}
              onMouseLeave={e => e.currentTarget.style.color = '#72767d'}>＋</button>
          )}
        </div>

        {loading && <div style={{ color: '#4f5660', fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>Loading…</div>}
        {!loading && channels.length === 0 && (
          <div style={{ color: '#4f5660', fontSize: '0.82rem', padding: '0.4rem 0.5rem', lineHeight: 1.5 }}>
            No channels yet.{canManageChannels ? ' Use ＋ to add one.' : ''}
          </div>
        )}

        {channels.map((ch, i) => (
          <ChannelRow key={ch.id} ch={ch} canManage={canManageChannels}
            active={String(currentChannelId) === String(ch.id)}
            onNavigate={() => nav(`/app/channel/${ch.id}`)}
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

      {showSettings && guild && (
        <GuildSettingsModal
          guild={guild}
          perms={perms}
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
        />
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: '#72767d', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.4rem',
};
const inputStyle = {
  width: '100%', background: '#1e1f22', border: '1px solid #3b3d43',
  borderRadius: '6px', padding: '0.65rem 0.75rem', color: '#f2f3f5',
  fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};