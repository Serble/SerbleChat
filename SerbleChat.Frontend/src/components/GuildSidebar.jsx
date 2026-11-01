import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { getGuildChannels, reorderGuildChannel } from '../api.js';
import { navigateToRoot } from '../electron-utils.js';
import { IconButton } from './ui/index.js';
import VoicePanel from './VoicePanel.jsx';
import Avatar from './Avatar.jsx';
import ChannelRow from './guild/ChannelRow.jsx';
import GuildContextMenu from './guild/GuildContextMenu.jsx';
import GuildSettingsModal from './guild/GuildSettingsModal.jsx';
import ChannelSettingsModal from './guild/ChannelSettingsModal.jsx';
import CreateChannelModal from './guild/CreateChannelModal.jsx';
import InvitePopup from './guild/InvitePopup.jsx';
import { allowed } from './guild/permissions.jsx';
import { LinkIcon, GearIcon, PlusIcon } from '../icons.jsx';

// Custom drag type so a dragged channel can't be dropped as text elsewhere
const CHANNEL_DRAG_TYPE = 'application/x-serblechat-channel';

export default function GuildSidebar({ guildId }) {
  const { guilds, currentUser, refreshGuilds, guildChannelEvent, loadGuildPermissions, getMyPerms, isConnected, guildUpdatedEvent, rolesUpdatedEvent, channelUpdatedEvent } = useApp();
  const { voiceSession, voiceMuted, voiceDeafened, toggleMute, toggleDeafen, leaveVoice, joinVoice, voiceChannelId, voiceParticipants, remoteScreenShares, localScreenShare, voiceStatus, voiceError } = useVoice();
  const [channels, setChannels]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showSettings, setShowSettings]   = useState(false);
  const [showInvite, setShowInvite]       = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelSettings, setChannelSettings] = useState(null); // channel object or null
  const [guildContextMenu, setGuildContextMenu] = useState(null); // { x, y } or null
  // Drag-to-reorder state: { from, over } channel indices while dragging
  const [drag, setDrag] = useState(null);
  const nav = useNavigate();
  const loc = useLocation();

  const guild = guilds.find(g => String(g.id) === String(guildId));
  const currentChannelId = loc.pathname.match(/\/channel\/(\d+)/)?.[1];

  // Resolved permissions for this guild
  const perms = getMyPerms(guildId);
  const isOwner           = !!guild && !!currentUser && guild.ownerId === currentUser.id;
  const canManageChannels = allowed(perms, 'manageChannels');
  const canCreateInvites  = allowed(perms, 'createInvites');
  const canManageGuild    = allowed(perms, 'manageGuild');
  const canManageRoles    = allowed(perms, 'manageRoles');
  const canOpenSettings   = canManageGuild || canManageRoles;

  // Load permissions whenever the guild changes
  useEffect(() => {
    if (guildId) loadGuildPermissions(guildId);
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each load gets a sequence number so a slow response for a previous guild
  // (or an older reload) can't overwrite a newer one.
  const loadSeqRef = useRef(0);
  const loadChannels = useCallback(async () => {
    if (!guildId) return;
    const seq = ++loadSeqRef.current;
    try {
      const list = (await getGuildChannels(guildId)) ?? [];
      if (seq === loadSeqRef.current) setChannels(list);
    } catch (e) {
      console.error('loadChannels failed:', e);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [guildId]);

  // Switching guild: clear everything tied to the previous one
  useEffect(() => {
    setChannels([]);
    setLoading(true);
    setShowSettings(false);
    setShowInvite(false);
    setShowCreateChannel(false);
    setChannelSettings(null);
    setGuildContextMenu(null);
    setDrag(null);
    loadChannels();
  }, [loadChannels]);

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

  // Navigate away if guild is removed (kicked, banned, or left). `guilds` is
  // empty until the first load, so also remember whether we ever saw this
  // guild — otherwise leaving your *last* guild would strand you here.
  const sawGuildRef = useRef(false);
  useEffect(() => { sawGuildRef.current = false; }, [guildId]);
  useEffect(() => {
    if (guild) { sawGuildRef.current = true; return; }
    if (guilds.length > 0 || sawGuildRef.current) {
      nav('/app/friends', { replace: true });
    }
  }, [guild, guilds, nav]);

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

  // The dragged channel takes the hovered channel's index, so it lands below
  // the target when moving down and above it when moving up.
  function dropEdgeFor(i) {
    if (!drag || drag.over !== i || drag.from === i) return null;
    return drag.from < i ? 'bottom' : 'top';
  }

  return (
    <div style={{ width: 240, background: 'var(--bg-secondary)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
      {/* Guild header */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 0.75rem 0 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: '0.25rem' }}>
        <span
          onContextMenu={e => { e.preventDefault(); setGuildContextMenu({ x: e.clientX, y: e.clientY }); }}
          style={{ flex: 1, fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'context-menu' }}>
          {guild?.name ?? '…'}
        </span>
        {canCreateInvites && (
          <IconButton title="Create Invite" onClick={() => setShowInvite(true)}><LinkIcon size={16} /></IconButton>
        )}
        {canOpenSettings && (
          <IconButton title="Guild Settings" onClick={() => setShowSettings(true)}><GearIcon size={16} /></IconButton>
        )}
      </div>

      {/* Channel list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.25rem', marginBottom: '0.2rem' }}>
          <span style={{ flex: 1, fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', userSelect: 'none' }}>Text Channels</span>
          {canManageChannels && (
            <IconButton title="Create Channel" onClick={() => setShowCreateChannel(true)} style={{ padding: '0.1rem' }}>
              <PlusIcon size={14} />
            </IconButton>
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
            dropEdge={dropEdgeFor(i)}
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(CHANNEL_DRAG_TYPE, String(ch.id)); // Firefox won't start a drag without data
              setDrag({ from: i, over: i });
            }}
            onDragEnter={() => setDrag(d => d && { ...d, over: i })}
            onDrop={e => e.preventDefault()}
            onDragEnd={e => {
              const d = drag;
              setDrag(null);
              // dropEffect is 'none' when the drag was cancelled (Escape / dropped outside the list)
              if (d && e.dataTransfer.dropEffect !== 'none') handleReorder(d.from, d.over);
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
          localScreenShare={localScreenShare}
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
          <IconButton
            title="Log out"
            className="hov-color-danger"
            onClick={() => {
              localStorage.removeItem('jwt');
              navigateToRoot();
            }}
            style={{ fontSize: '1rem' }}
          >
            ⏻
          </IconButton>
        </div>
      )}

      {showSettings && guild && (
        <GuildSettingsModal
          guild={guild}
          perms={perms}
          guildUpdatedEvent={guildUpdatedEvent}
          currentUser={currentUser}
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
            // The NewChannel signal may have added it already
            setChannels(p => p.some(c => c.id === ch.id) ? p : [...p, ch]);
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
            // Settings auto-save, so the modal stays open; keep its copy current
            setChannels(p => p.map(c => c.id === updated.id ? { ...c, ...updated } : c));
            setChannelSettings(cs => cs && cs.id === updated.id ? { ...cs, ...updated } : cs);
          }}
          onDeleted={() => {
            setChannels(p => p.filter(c => c.id !== channelSettings.id));
            if (String(currentChannelId) === String(channelSettings.id)) nav(`/app/guild/${guildId}`, { replace: true });
            setChannelSettings(null);
          }}
          channelUpdatedEvent={channelUpdatedEvent}
        />
      )}

      {guildContextMenu && guild && (
        <GuildContextMenu
          guild={guild}
          isOwner={isOwner}
          currentUser={currentUser}
          x={guildContextMenu.x}
          y={guildContextMenu.y}
          onClose={() => setGuildContextMenu(null)}
          onLeave={() => {
            // LeftGuild signal will handle the cleanup
            setGuildContextMenu(null);
          }}
          onOpenSettings={canOpenSettings ? () => setShowSettings(true) : null}
        />
      )}
    </div>
  );
}
