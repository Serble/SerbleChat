import { useState, useEffect, useMemo, useRef } from 'react';
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
import { GearIcon, PeopleIcon, PlusIcon, SearchIcon, CloseIcon } from '../icons.jsx';
import { getAccountById, getOrCreateDmChannel } from '../api.js';
import './chat/chat.css';
import { AvatarStatusDot } from './status/StatusDot.jsx';

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

// Hovered rows, and the keyboard-selected row while filtering
const SELECTED_STYLE = { background: 'var(--bg-hover)', color: 'var(--text-secondary)' };

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

function DmItem({ dm, currentChannelId, selected, onOpen }) {
  const { currentUser, resolveUser, unreads, getUserStatus, seedUserStatuses, presenceResync } = useApp();
  const nav = useNavigate();
  const [otherUser, setOtherUser] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }

  useEffect(() => {
    if (!currentUser) return;
    const otherId = dm.user1Id === currentUser.id ? dm.user2Id : dm.user1Id;
    resolveUser(otherId).then(setOtherUser);
  }, [dm, currentUser, resolveUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a reconnect, refetch their status (resolveUser would answer from its cache)
  useEffect(() => {
    if (!presenceResync || !currentUser) return;
    const otherId = dm.user1Id === currentUser.id ? dm.user2Id : dm.user1Id;
    getAccountById(otherId).then(u => seedUserStatuses([u])).catch(() => {});
  }, [presenceResync]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = String(currentChannelId) === String(dm.channelId);
  const name = otherUser?.username ?? '…';
  const otherId = dm.user1Id === currentUser?.id ? dm.user2Id : dm.user1Id;
  const unread = unreads[String(dm.channelId)] ?? 0;
  const { presence, message: statusMessage } = getUserStatus(otherId, otherUser);

  function handleContextMenu(e) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        onClick={() => { nav(`/app/channel/${dm.channelId}`); onOpen?.(); }}
        onContextMenu={handleContextMenu}
        className={active ? undefined : HOVER_CLASS}
        style={{ ...rowStyle(active, unread > 0), ...(selected && !active && SELECTED_STYLE) }}
        data-selected={selected || undefined}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar userId={otherId} name={name} size={28} color={otherUser?.color} />
          <AvatarStatusDot presence={presence} size={8} />
        </div>
        <span style={{ ...labelStyle, minWidth: 0 }}>
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {statusMessage && (
            <span
              title={statusMessage}
              style={{
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', lineHeight: 1.3,
              }}
            >
              {statusMessage}
            </span>
          )}
        </span>
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

function GroupItem({ chat, currentChannelId, selected, onOpen }) {
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
          onClick={() => { nav(`/app/channel/${chat.channelId}`); onOpen?.(); }}
          onContextMenu={handleContextMenu}
          data-selected={selected || undefined}
          style={{
            ...rowStyle(active, unread > 0),
            width: undefined, flex: 1, minWidth: 0,
            ...(!active && (hovered || selected) && SELECTED_STYLE),
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

/** A friend you have no DM with yet, offered while filtering: opening it starts the conversation. */
function FriendResult({ userId, name, selected, onOpen }) {
  const { getUserStatus, peekUser } = useApp();
  const user = peekUser(userId);
  const { presence } = getUserStatus(userId, user);
  return (
    <button
      onClick={onOpen}
      className={HOVER_CLASS}
      data-selected={selected || undefined}
      style={{ ...rowStyle(false), ...(selected && SELECTED_STYLE) }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar userId={userId} name={name} size={28} color={user?.color} />
        <AvatarStatusDot presence={presence} size={8} />
      </div>
      <span style={labelStyle}>{name}</span>
    </button>
  );
}

/** Usernames for a set of user ids, filled in as they resolve (from the user cache when possible). */
function useUsernames(ids) {
  const { resolveUser, peekUser } = useApp();
  const key = ids.join(',');
  const [names, setNames] = useState({});
  useEffect(() => {
    let cancelled = false;
    for (const id of ids) {
      const cached = peekUser(id);
      if (cached?.username) {
        setNames(p => (p[id] === cached.username ? p : { ...p, [id]: cached.username }));
        continue;
      }
      resolveUser(id).then(u => {
        if (!cancelled && u?.username) setNames(p => ({ ...p, [id]: u.username }));
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return names;
}

/**
 * How well a name matches the filter: 0 starts with it, 1 a word in it does, 2 contains it, -1 no match.
 * `q` is already lower-cased.
 */
function matchRank(name, q) {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\-_.]+/).some(w => w.startsWith(q))) return 1;
  return n.includes(q) ? 2 : -1;
}

/** Keep only matches, best first; ties keep their order (most recently active first). */
function filterByName(items, q) {
  return items
    .map((item, i) => ({ item, i, rank: item.name ? matchRank(item.name, q) : -1 }))
    .filter(x => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.item);
}

const NO_IDS = [];

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
  const { currentUser, dmChannels, groupChats, friends, channelLastActive, refreshDms } = useApp();
  const { voiceSession, voiceMuted, toggleMute, leaveVoice, joinVoice, voiceChannelId, voiceParticipants, remoteScreenShares, localScreenShare, voiceStatus, voiceError } = useVoice();
  const nav = useNavigate();
  const loc = useLocation();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  // Conversation filter
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const filterRef = useRef(null);
  const listRef = useRef(null);

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

  // ── Conversation filter ──
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const me = currentUser?.id;
  const otherIdOf = dm => (dm.user1Id === me ? dm.user2Id : dm.user1Id);
  // Accepted friends you have no DM with yet: offered so you can start one from here
  const dmUserIds = new Set(dmChannels.map(otherIdOf));
  const friendIds = friends
    .filter(f => !f.pending)
    .map(f => (f.user1Id === me ? f.user2Id : f.user1Id))
    .filter(id => id && !dmUserIds.has(id));
  const names = useUsernames(filtering ? [...dmUserIds, ...friendIds] : NO_IDS);

  const results = useMemo(() => {
    if (!filtering) return [];
    const dms = filterByName(sortedDms.map(dm => ({ kind: 'dm', key: `dm-${dm.channelId}`, dm, name: names[otherIdOf(dm)] })), q);
    const groups = filterByName(sortedGroups.map(chat => ({ kind: 'group', key: `group-${chat.channelId}`, chat, name: chat.channel?.name ?? '' })), q);
    const people = filterByName(friendIds.map(id => ({ kind: 'friend', key: `friend-${id}`, userId: id, name: names[id] })), q)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...dms, ...groups, ...people];
  }, [filtering, q, names, dmChannels, groupChats, friends, channelLastActive, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new filter starts the keyboard selection at the best match
  useEffect(() => { setSelectedIdx(0); }, [q]);

  // Ctrl+K (Cmd+K) jumps to the filter from anywhere on the home screens
  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key?.toLowerCase() !== 'k') return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep the keyboard-selected row in view
  useEffect(() => {
    if (filtering) listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, filtering]);

  function finishFilter() {
    setQuery('');
    filterRef.current?.blur();
  }

  async function openResult(r) {
    if (!r) return;
    if (r.kind === 'dm') nav(`/app/channel/${r.dm.channelId}`);
    else if (r.kind === 'group') nav(`/app/channel/${r.chat.channelId}`);
    else {
      try {
        const ch = await getOrCreateDmChannel(r.userId);
        refreshDms();
        nav(`/app/channel/${ch.id}`);
      } catch (e) {
        console.error('Could not open a DM:', e);
        return;
      }
    }
    finishFilter();
  }

  function handleFilterKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openResult(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else filterRef.current?.blur();
    }
  }

  function renderResults() {
    if (results.length === 0) {
      return (
        <div style={{ padding: '1.25rem 0.5rem', color: 'var(--text-subtle)', fontSize: '0.82rem', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
          No conversations match “{query.trim()}”.
        </div>
      );
    }
    const out = [];
    let lastKind = null;
    results.forEach((r, i) => {
      if (r.kind !== lastKind) {
        out.push(<SectionHeader key={`h-${r.kind}`} label={r.kind === 'dm' ? 'Direct Messages' : r.kind === 'group' ? 'Group Chats' : 'Start a Conversation'} />);
        lastKind = r.kind;
      }
      const selected = i === selectedIdx;
      if (r.kind === 'dm') out.push(<DmItem key={r.key} dm={r.dm} currentChannelId={currentChannelId} selected={selected} onOpen={finishFilter} />);
      else if (r.kind === 'group') out.push(<GroupItem key={r.key} chat={r.chat} currentChannelId={currentChannelId} selected={selected} onOpen={finishFilter} />);
      else out.push(<FriendResult key={r.key} userId={r.userId} name={r.name} selected={selected} onOpen={() => openResult(r)} />);
    });
    return out;
  }

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
        <div className="search-box search-box--sidebar" onClick={() => filterRef.current?.focus()}>
          <SearchIcon size={13} />
          <input
            ref={filterRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            placeholder="Find a conversation…"
            aria-label="Find a conversation"
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="search-box-clear"
              title="Clear"
              aria-label="Clear filter"
              onClick={e => { e.stopPropagation(); setQuery(''); filterRef.current?.focus(); }}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable list */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.5rem 0' }}>
        {filtering ? renderResults() : <>
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
        </>}
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