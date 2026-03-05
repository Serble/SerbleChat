import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { navigateToRoot } from '../electron-utils.js';
import CreateGroupModal from './CreateGroupModal.jsx';
import ChannelNotifContextMenu from './ChannelNotifContextMenu.jsx';
import GroupChatSettingsModal from './GroupChatSettingsModal.jsx';
import VoicePanel from './VoicePanel.jsx';
import Avatar from './Avatar.jsx';
import UserPopout from './UserPopout.jsx';
import UserInteraction from './UserInteraction.jsx';
import { getGroupChatIconUrl } from '../api.js';

function SidebarItem({ icon, label, active, badge, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.45rem 0.6rem', borderRadius: '6px', width: '100%',
        background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontSize: '0.9rem', fontWeight: active ? 600 : 400,
        transition: 'background 0.1s, color 0.1s', flexShrink: 0,
      }}
    >
      {icon && <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>{icon}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {label}
      </span>
      {badge > 0 && (
        <span style={{
          background: 'var(--danger)', color: '#fff', borderRadius: '9999px',
          padding: '0.1rem 0.4rem', fontSize: '0.68rem', fontWeight: 700,
          minWidth: 18, textAlign: 'center', flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

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
      paddingLeft: '2.5rem',
      paddingRight: '0.6rem',
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
  const [hovered, setHovered] = useState(false);
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.35rem 0.6rem', borderRadius: '6px', width: '100%',
          background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
          fontSize: '0.875rem', fontWeight: active || unread > 0 ? 600 : 400,
          transition: 'background 0.1s, color 0.1s',
        }}
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
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
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
      {ctxMenu && (
        <ChannelNotifContextMenu
          channelId={dm.channelId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <VoiceParticipantsBelow channelId={dm.channelId} />
    </>
  );
}

function GroupItem({ chat, currentChannelId }) {
  const { unreads, currentUser, channelUpdatedEvent } = useApp();
  const nav = useNavigate();
  const active = String(currentChannelId) === String(chat.channelId);
  const name = chat.channel?.name ?? `Group ${chat.channelId}`;
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [hasIcon, setHasIcon] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const unread = unreads[String(chat.channelId)] ?? 0;
  const isOwner = chat.ownerId === currentUser?.id;

  // Check if group chat icon exists
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getGroupChatIconUrl(chat.channelId);
  }, [chat.channelId]);

  // Refresh icon when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent) return;
    if (String(channelUpdatedEvent.channelId) === String(chat.channelId)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getGroupChatIconUrl(chat.channelId) + '?t=' + channelUpdatedEvent.ts;
    }
  }, [channelUpdatedEvent, chat.channelId]);

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
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.35rem 0.6rem', borderRadius: '6px', flex: 1,
            background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontSize: '0.875rem', fontWeight: active || unread > 0 ? 600 : 400,
            transition: 'background 0.1s, color 0.1s',
            minWidth: 0,
          }}
        >
          {/* Group chat icon or avatar */}
          {hasIcon ? (
            <img
              key={`group-icon-${chat.channelId}-${channelUpdatedEvent?.ts || 0}`}
              src={getGroupChatIconUrl(chat.channelId) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
              alt="Group icon"
              onError={() => setHasIcon(false)}
              style={{
                width: 28, height: 28, borderRadius: '4px', flexShrink: 0,
                objectFit: 'cover',
              }}
            />
          ) : (
            <Avatar name={name} size={28} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
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

        {/* Settings icon — only visible to owners on hover */}
        {isOwner && hovered && (
          <span
            title="Group Settings"
            onClick={e => { e.stopPropagation(); setShowSettings(true); }}
            style={{ 
              cursor: 'pointer', color: '#72767d', fontSize: '0.9rem', 
              padding: '0.15rem 0.25rem', borderRadius: '3px', lineHeight: 1, 
              flexShrink: 0, transition: 'color 0.1s' 
            }}
            className="hov-text-primary"
          >⚙</span>
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
      <VoiceParticipantsBelow channelId={chat.channelId} />
    </>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{
      padding: '1rem 0.5rem 0.3rem',
      fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      userSelect: 'none',
    }}>
      {label}
    </div>
  );
}

export default function DmSidebar() {
  const { currentUser, dmChannels, groupChats, isConnected, friends, channelLastActive } = useApp();
  const { voiceSession, voiceMuted, voiceDeafened, toggleMute, toggleDeafen, leaveVoice, joinVoice, voiceChannelId, voiceParticipants, remoteScreenShares, localScreenShare, voiceStatus, voiceError } = useVoice();
  const nav = useNavigate();
  const loc = useLocation();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [userPopout, setUserPopout] = useState(null); // { userId, username, anchorRect }

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
          icon="👥"
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
        <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 0.5rem 0.3rem' }}>
          <span style={{
            flex: 1, fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em', userSelect: 'none',
          }}>
            Group Chats
          </span>
          <button
            title="Create Group Chat"
            onClick={() => setShowCreateGroup(true)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
              padding: '0 0.1rem', borderRadius: '4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            ＋
          </button>
        </div>
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
          <button
            title="Log out"
            onClick={() => { 
              localStorage.removeItem('jwt'); 
              navigateToRoot();
            }}
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

      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  );
}