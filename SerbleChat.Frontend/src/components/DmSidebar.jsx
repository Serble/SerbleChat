import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';
import ChannelNotifContextMenu from './ChannelNotifContextMenu.jsx';

function Avatar({ name, size = 32 }) {
  const initial = name ? name[0].toUpperCase() : '?';
  const hue = name ? (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},45%,40%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

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

function DmItem({ dm, currentChannelId }) {
  const { currentUser, resolveUser, unreads } = useApp();
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
  const [hovered, setHovered] = useState(false);
  const unread = unreads[String(dm.channelId)] ?? 0;

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
        <Avatar name={name} size={28} />
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
    </>
  );
}

function GroupItem({ chat, currentChannelId }) {
  const { unreads } = useApp();
  const nav = useNavigate();
  const active = String(currentChannelId) === String(chat.channelId);
  const name = chat.channel?.name ?? `Group ${chat.channelId}`;
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const unread = unreads[String(chat.channelId)] ?? 0;

  function handleContextMenu(e) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        onClick={() => nav(`/app/channel/${chat.channelId}`)}
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
        <Avatar name={name} size={28} />
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
          channelId={chat.channelId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
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

      {/* User panel */}
      {currentUser && (
        <div style={{
          padding: '0.6rem 0.75rem', background: 'var(--bg-user-panel)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          flexShrink: 0,
        }}>
          <div style={{ position: 'relative' }}>
            <Avatar name={currentUser.username} size={32} />
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

      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  );
}