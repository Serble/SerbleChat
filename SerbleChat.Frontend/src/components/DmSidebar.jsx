import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';
import ChannelNotifContextMenu from './ChannelNotifContextMenu.jsx';
import GroupChatSettingsModal from './GroupChatSettingsModal.jsx';
import VoicePanel from './VoicePanel.jsx';
import VoiceUserChips from './voice/VoiceUserChips.jsx';
import Avatar from './Avatar.jsx';
import UserPanel from './UserPanel.jsx';
import useGroupChatIcon from './useGroupChatIcon.js';
import { IconButton } from './ui/index.js';
import { GearIcon, PeopleIcon, PlusIcon } from '../icons.jsx';

const HOVER_CLASS = 'hov-bg hov-text-secondary';
const DM_CHIPS_STYLE = { padding: '0.2rem 0.6rem 0.2rem 2.5rem' };

/** Shared look for sidebar rows (Friends, DMs, group chats). */
function rowStyle(active, bold) {
  return {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.35rem 0.6rem', borderRadius: '6px', width: '100%',
    background: active ? 'var(--bg-active)' : 'transparent',
    border: 'none', cursor: 'pointer', textAlign: 'left',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    fontSize: '0.875rem', fontWeight: active || bold ? 600 : 400,
    transition: 'background 0.1s, color 0.1s',
  };
}

const labelStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 };

function UnreadBadge({ count }) {
  if (!(count > 0)) return null;
  return (
    <span style={{
      background: 'var(--danger)', color: '#fff', borderRadius: '9999px',
      padding: '0.1rem 0.38rem', fontSize: '0.68rem', fontWeight: 700,
      minWidth: 18, textAlign: 'center', flexShrink: 0,
    }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarItem({ icon, label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className={active ? undefined : HOVER_CLASS}
      style={{ ...rowStyle(active), padding: '0.45rem 0.6rem', fontSize: '0.9rem', flexShrink: 0 }}
    >
      {icon && <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>{icon}</span>}
      <span style={labelStyle}>{label}</span>
      <UnreadBadge count={badge} />
    </button>
  );
}

function DmItem({ dm, currentChannelId }) {
  const { currentUser, resolveUser, unreads, userStatuses } = useApp();
  const nav = useNavigate();
  const [otherUser, setOtherUser] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }

  useEffect(() => {
    if (!currentUser) return;
    const otherId = dm.user1Id === currentUser.id ? dm.user2Id : dm.user1Id;
    resolveUser(otherId).then(setOtherUser);
  }, [dm, currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = String(currentChannelId) === String(dm.channelId);
  const name = otherUser?.username ?? '…';
  const otherId = dm.user1Id === currentUser?.id ? dm.user2Id : dm.user1Id;
  const unread = unreads[String(dm.channelId)] ?? 0;
  const isOnline = userStatuses[String(otherId)] === 'online';

  function handleContextMenu(e) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        onClick={() => nav(`/app/channel/${dm.channelId}`)}
        onContextMenu={handleContextMenu}
        className={active ? undefined : HOVER_CLASS}
        style={rowStyle(active, unread > 0)}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar userId={otherId} name={name} size={28} color={otherUser?.color} />
          <div style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 9, height: 9, borderRadius: '50%',
            background: isOnline ? 'var(--success)' : 'var(--text-subtle)',
            border: '2px solid var(--bg-secondary)',
          }} />
        </div>
        <span style={labelStyle}>{name}</span>
        {!active && <UnreadBadge count={unread} />}
      </button>
      {ctxMenu && (
        <ChannelNotifContextMenu
          channelId={dm.channelId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <VoiceUserChips channelId={dm.channelId} style={DM_CHIPS_STYLE} />
    </>
  );
}

function GroupItem({ chat, currentChannelId }) {
  const { unreads, currentUser, channelUpdatedEvent } = useApp();
  const nav = useNavigate();
  const active = String(currentChannelId) === String(chat.channelId);
  const name = chat.channel?.name ?? `Group ${chat.channelId}`;
  // Row hover is tracked in state (not CSS) because it also reveals the owner's gear button
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const icon = useGroupChatIcon(chat.channelId, channelUpdatedEvent);
  const unread = unreads[String(chat.channelId)] ?? 0;
  const isOwner = chat.ownerId === currentUser?.id;

  function handleContextMenu(e) {
    e.preventDefault();
    // Always show notification settings on right-click
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0 0.1rem',
        }}
      >
        <button
          onClick={() => nav(`/app/channel/${chat.channelId}`)}
          onContextMenu={handleContextMenu}
          style={{
            ...rowStyle(active, unread > 0),
            width: undefined, flex: 1, minWidth: 0,
            ...(!active && hovered && { background: 'var(--bg-hover)', color: 'var(--text-secondary)' }),
          }}
        >
          {/* Group chat icon or avatar */}
          {icon.hasIcon ? (
            <img
              src={icon.src}
              alt="Group icon"
              onError={icon.onError}
              style={{
                width: 28, height: 28, borderRadius: '4px', flexShrink: 0,
                objectFit: 'cover',
              }}
            />
          ) : (
            <Avatar name={name} size={28} />
          )}
          <span style={labelStyle}>{name}</span>
          {!active && <UnreadBadge count={unread} />}
        </button>

        {/* Settings icon — only visible to owners on hover */}
        {isOwner && hovered && (
          <IconButton
            title="Group Settings"
            aria-label="Group Settings"
            onClick={e => { e.stopPropagation(); setShowSettings(true); }}
            style={{ padding: '0.15rem 0.25rem', flexShrink: 0 }}
          ><GearIcon size={14} /></IconButton>
        )}
      </div>
      {ctxMenu && (
        <ChannelNotifContextMenu
          channelId={chat.channelId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {showSettings && isOwner && (
        <GroupChatSettingsModal
          chat={chat}
          onClose={() => setShowSettings(false)}
          channelUpdatedEvent={channelUpdatedEvent}
        />
      )}
      <VoiceUserChips channelId={chat.channelId} style={DM_CHIPS_STYLE} />
    </>
  );
}

function SectionHeader({ label, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '1rem 0.5rem 0.3rem',
      fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      userSelect: 'none',
    }}>
      <span style={{ flex: 1 }}>{label}</span>
      {action}
    </div>
  );
}

export default function DmSidebar() {
  const { currentUser, dmChannels, groupChats, friends, channelLastActive } = useApp();
  const { voiceSession, voiceMuted, toggleMute, leaveVoice, joinVoice, voiceChannelId, voiceParticipants, remoteScreenShares, localScreenShare, voiceStatus, voiceError } = useVoice();
  const nav = useNavigate();
  const loc = useLocation();
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const currentChannelId = loc.pathname.match(/\/channel\/(\d+)/)?.[1];
  const onFriends = loc.pathname === '/app/friends';

  const pendingIncoming = friends.filter(
    f => f.pending && currentUser && f.user2Id === currentUser.id
  ).length;

  // Sort by most recent activity (new message) first; fallback to original order (index)
  const sortedDms = [...dmChannels].sort((a, b) =>
    (channelLastActive[String(b.channelId)] ?? 0) - (channelLastActive[String(a.channelId)] ?? 0)
  );
  const sortedGroups = [...groupChats].sort((a, b) =>
    (channelLastActive[String(b.channelId)] ?? 0) - (channelLastActive[String(a.channelId)] ?? 0)
  );

  return (
    <div style={{
      width: 240, background: 'var(--bg-secondary)', flexShrink: 0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      borderRight: '1px solid var(--border)',
    }}>
      {/* Search / header area */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 0.75rem', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{
          flex: 1, background: 'var(--bg-tertiary)', borderRadius: '4px',
          padding: '0.35rem 0.6rem', color: 'var(--text-muted)',
          fontSize: '0.82rem', cursor: 'text', userSelect: 'none',
        }}>
          Find a conversation…
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.5rem 0' }}>
        {/* Friends */}
        <SidebarItem
          icon={<PeopleIcon size={16} />}
          label="Friends"
          active={onFriends}
          badge={pendingIncoming}
          onClick={() => nav('/app/friends')}
        />

        {/* DMs */}
        {sortedDms.length > 0 && (
          <>
            <SectionHeader label="Direct Messages" />
            {sortedDms.map(dm => (
              <DmItem key={dm.channelId} dm={dm} currentChannelId={currentChannelId} />
            ))}
          </>
        )}

        {/* Group Chats */}
        <SectionHeader
          label="Group Chats"
          action={
            <button
              title="Create Group Chat"
              aria-label="Create Group Chat"
              onClick={() => setShowCreateGroup(true)}
              className="hov-text-secondary"
              style={{
                display: 'flex', background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '0 0.1rem', borderRadius: '4px',
                transition: 'color 0.15s',
              }}
            >
              <PlusIcon size={14} />
            </button>
          }
        />
        {sortedGroups.map(gc => (
          <GroupItem key={gc.channelId} chat={gc} currentChannelId={currentChannelId} />
        ))}

        {sortedDms.length === 0 && sortedGroups.length === 0 && (
          <div style={{ padding: '1.25rem 0.5rem', color: 'var(--text-subtle)', fontSize: '0.82rem', lineHeight: 1.6 }}>
            No conversations yet.<br />Add friends to start chatting!
          </div>
        )}
      </div>

      {/* Voice Panel - shown when connected to voice */}
      {(voiceSession || voiceStatus !== 'idle' || voiceError) && (
        <VoicePanel
          channelId={voiceChannelId}
          voiceSession={voiceSession}
          participants={voiceParticipants}
          voiceMuted={voiceMuted}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          onToggleMute={toggleMute}
          onLeave={leaveVoice}
          onRetry={() => voiceChannelId && joinVoice(voiceChannelId)}
          remoteScreenShares={remoteScreenShares}
          localScreenShare={localScreenShare}
        />
      )}

      <UserPanel />

      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  );
}