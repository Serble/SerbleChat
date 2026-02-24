import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage, leaveOrDeleteGroupChat,
         getGuildMembers, getGuildRoles, getGuildChannels, getChannelMembers, FRONTEND_URL } from '../api.js';
import { joinChannel, leaveChannel, setMuted as applyVoiceMuted } from '../voice.js';
import UserPopout from './UserPopout.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import InviteCard from './InviteCard.jsx';
import { MentionText, MentionPicker } from './MentionRenderer.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';

// Regex that matches invite links anywhere in a message.
// Intentionally origin-agnostic so that links shared from a different
// hostname/port (or after a Vite port reassignment on reload) still work.
const INVITE_RE = () => /https?:\/\/[^\s/]+\/invite\/(\d+)/g;

/** Extract unique invite IDs from a message string */
function extractInviteIds(content) {
  const ids = [];
  const seen = new Set();
  let m;
  const re = INVITE_RE();
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

// Markdown component overrides styled for the dark chat theme
const mdComponents = {
  p:          ({ children }) => <span style={{ display: 'block', margin: '0 0 0.45em' }}>{children}</span>,
  a:          ({ href, children }) => {
    if (href && INVITE_RE().test(href)) {
      return <span style={{ color: 'var(--text-link)' }}>{children}</span>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-link)', textDecoration: 'underline' }}>{children}</a>;
  },
  strong:     ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
  em:         ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  del:        ({ children }) => <del style={{ textDecoration: 'line-through', opacity: 0.7 }}>{children}</del>,
  code:       ({ inline, children }) => inline
    ? <code style={{ background: 'var(--bg-secondary)', borderRadius: 3, padding: '0.1em 0.35em', fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--text-secondary)' }}>{children}</code>
    : <code>{children}</code>,
  pre:        ({ children }) => <pre style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.6rem 0.8rem', overflowX: 'auto', margin: '0.3rem 0', fontSize: '0.85em', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--text-subtle)', paddingLeft: '0.6rem', margin: '0.2rem 0', color: 'var(--text-secondary)' }}>{children}</blockquote>,
  ul:         ({ children }) => <ul style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ul>,
  ol:         ({ children }) => <ol style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ol>,
  li:         ({ children }) => <li style={{ margin: '0.1rem 0' }}>{children}</li>,
  h1:         ({ children }) => <strong style={{ fontSize: '1.1em', display: 'block' }}>{children}</strong>,
  h2:         ({ children }) => <strong style={{ fontSize: '1.05em', display: 'block' }}>{children}</strong>,
  h3:         ({ children }) => <strong style={{ fontSize: '1em', display: 'block' }}>{children}</strong>,
};

// Inject the highlight-flash keyframe once (ThemeContext updates it when accent changes)
if (typeof document !== 'undefined' && !document.getElementById('msg-highlight-style')) {
  const s = document.createElement('style');
  s.id = 'msg-highlight-style';
  s.textContent = `@keyframes msgHighlight {
    0%   { background: rgba(124,58,237,0.35); }
    60%  { background: rgba(124,58,237,0.2); }
    100% { background: transparent; }
  }
  .msg-highlighted { animation: msgHighlight 2s ease-out forwards; }`;
  document.head.appendChild(s);
}

/**
 * Parse a timestamp string from the server as UTC.
 * The backend sends ISO-8601 strings without a timezone designator (e.g.
 * "2026-02-24T14:30:00"), which JS Date parses as *local* time — wrong.
 * Appending 'Z' forces UTC interpretation.
 */
function parseUtcDate(str) {
  if (!str) return new Date(NaN);
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(str) ? str : str + 'Z');
}

function CtxBtn({ icon, label, onClick, danger, copied }) {
  const [hov, setHov] = useState(false);
  const color  = copied ? 'var(--success)' : danger ? 'var(--danger)' : 'var(--text-secondary)';
  const hovBg  = copied ? 'rgba(35,165,90,0.12)' : danger ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.07)';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        width: '100%', padding: '0.45rem 0.75rem',
        background: hov ? hovBg : 'transparent',
        border: 'none', color, fontSize: '0.875rem', fontWeight: 500,
        borderRadius: '4px', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      <span style={{ width: '1.1em', textAlign: 'center', flexShrink: 0 }}>{copied ? '✓' : icon}</span>
      {copied ? 'Copied!' : label}
    </button>
  );
}

function Avatar({ name, size = 40 }) {
  const initial = name ? name[0].toUpperCase() : '?';
  const hue = name ? (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},45%,38%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none', marginTop: 2,
    }}>
      {initial}
    </div>
  );
}

function HeaderBtn({ children, title, onClick, active, danger, disabled }) {
  const [hov, setHov] = useState(false);
  const bg = danger && hov ? 'rgba(242,63,67,0.15)'
    : active ? 'rgba(255,255,255,0.1)'
    : hov ? 'rgba(255,255,255,0.07)'
    : 'transparent';
  const color = danger ? (hov ? '#f23f43' : '#72767d') : active ? '#f2f3f5' : '#949ba4';
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: bg, border: 'none', color, borderRadius: '6px',
        padding: '0.25rem 0.5rem', cursor: disabled ? 'default' : 'pointer',
        fontSize: '1rem', lineHeight: 1, transition: 'all 0.15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  );
}

const MessageBubble = React.memo(function MessageBubble({ msg, prevMsg, resolveUser, currentUserId, onContextMenu, onUserClick, getColor, mentionData, highlighted }) {
  const [author, setAuthor] = useState(null);

  // Group consecutive messages from the same author
  const compact = prevMsg && prevMsg.authorId === msg.authorId &&
    parseUtcDate(msg.createdAt) - parseUtcDate(prevMsg.createdAt) < 5 * 60 * 1000;

  useEffect(() => {
    resolveUser(msg.authorId).then(setAuthor);
  }, [msg.authorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize invite ID extraction — only re-runs when message content changes
  const inviteIds = useMemo(() => extractInviteIds(msg.content), [msg.content]);

  // Resolve color: use role color if in guild, otherwise seed from username
  const nameColor = getColor(msg.authorId, author?.username);

  const ts = msg._pending
    ? 'Sending…'
    : parseUtcDate(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  // Full timestamp shown next to the username in non-compact rows (may include date if old)
  const tsHeader = msg._pending
    ? 'Sending…'
    : (() => {
        const d = parseUtcDate(msg.createdAt);
        const now = new Date();
        const isToday = d.toLocaleDateString() === now.toLocaleDateString();
        return isToday
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      })();

  if (compact) {
    return (
      <div
        data-msgid={msg.id}
        className={highlighted ? 'msg-highlighted' : undefined}
        onContextMenu={e => onContextMenu(e, msg)}
        style={{ padding: '0.1rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ fontSize: '0.65rem', color: msg._pending ? '#f0b232' : 'var(--text-subtle)', width: 40, flexShrink: 0, alignSelf: 'center', textAlign: 'right' }}>
          {ts}
        </span>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', flex: 1, minWidth: 0, overflowX: 'hidden' }}>
          <MentionText content={msg.content} mdComponents={mdComponents} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} />
          {inviteIds.map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      data-msgid={msg.id}
      className={highlighted ? 'msg-highlighted' : undefined}
      onContextMenu={e => onContextMenu(e, msg)}
      style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div
        onClick={e => !msg._pending && onUserClick(e, msg.authorId, author?.username)}
        style={{ cursor: msg._pending ? 'default' : 'pointer', flexShrink: 0 }}
      >
        <Avatar name={author?.username} size={40} />
      </div>
      <div style={{ flex: 1, overflowX: 'hidden', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span
            onClick={e => !msg._pending && onUserClick(e, msg.authorId, author?.username)}
            style={{ fontWeight: 600, color: nameColor, fontSize: '0.9rem', cursor: msg._pending ? 'default' : 'pointer' }}
          >
            {author?.username ?? msg.authorId.slice(0, 10)}
          </span>
          <span style={{ fontSize: '0.68rem', color: msg._pending ? '#f0b232' : 'var(--text-subtle)' }}>{tsHeader}</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
          <MentionText content={msg.content} mdComponents={mdComponents} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} />
          {inviteIds.map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
        </div>
      </div>
    </div>
  );
});

function BlockedInputBanner({ username, userId, unblockUser }) {
  const [busy, setBusy] = useState(false);

  async function handleUnblock() {
    setBusy(true);
    try { await unblockUser(userId); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.75rem 1rem',
      background: 'rgba(242,63,67,0.08)', border: '1px solid rgba(242,63,67,0.25)',
      borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.875rem',
    }}>
      <span style={{ flexShrink: 0, fontSize: '1rem' }}>🚫</span>
      <span style={{ flex: 1 }}>
        You have blocked <strong style={{ color: 'var(--text-secondary)' }}>{username}</strong>. You cannot send messages until you unblock them.
      </span>
      <button
        onClick={handleUnblock}
        disabled={busy}
        style={{
          flexShrink: 0, padding: '0.35rem 0.85rem', borderRadius: '6px',
          background: busy ? 'rgba(255,255,255,0.05)' : 'rgba(242,63,67,0.15)',
          border: '1px solid rgba(242,63,67,0.35)',
          color: busy ? 'var(--text-muted)' : '#f23f43',
          fontSize: '0.8rem', fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'rgba(242,63,67,0.28)'; }}
        onMouseLeave={e => { if (!busy) e.currentTarget.style.background = 'rgba(242,63,67,0.15)'; }}
      >
        {busy ? 'Unblocking…' : 'Unblock'}
      </button>
    </div>
  );
}

function BlockedGroupBubble({ messages, authorId, resolveUser, currentUserId, onContextMenu, onUserClick, getColor, mentionData }) {
  const [expanded, setExpanded] = useState(false);
  const [author, setAuthor] = useState(null);

  useEffect(() => {
    resolveUser(authorId).then(setAuthor);
  }, [authorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = messages.length;
  const name = author?.username ?? '…';

  if (expanded) {
    return (
      <div>
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            prevMsg={i === 0 ? null : messages[i - 1]}
            resolveUser={resolveUser}
            currentUserId={currentUserId}
            onContextMenu={onContextMenu}
            onUserClick={onUserClick}
            getColor={getColor}
            mentionData={mentionData}
            highlighted={false}
          />
        ))}
        <div
          onClick={() => setExpanded(false)}
          style={{
            padding: '0.25rem 1rem 0.35rem',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            userSelect: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <span>▲</span>
          <span>Hide messages from blocked user</span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(true)}
      style={{
        margin: '0.25rem 1rem',
        padding: '0.45rem 0.8rem',
        borderRadius: '6px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
    >
      <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>🚫</span>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>
        {count === 1
          ? `1 message from blocked user ${name}`
          : `${count} messages from blocked user ${name}`}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', flexShrink: 0 }}>click to show ▼</span>
    </div>
  );
}

export default function ChatView() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, dmChannels, groupChats, messages, setMessages, resolveUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent, userUpdatedEvent, loadChannelPermissions, getMyChannelPerms, isBlocked, unblockUser } = useApp();
  const { blockedMessageMode } = useClientOptions() ?? { blockedMessageMode: 'masked' };
  const [input, setInput]           = useState('');
  const [sendError, setSendError]   = useState(null); // string | null
  const [highlightMsgId, setHighlightMsgId] = useState(null);
  const [channel, setChannel]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [otherUser, setOtherUser]   = useState(null);
  const [ctxMenu, setCtxMenu]       = useState(null);
  const [copiedCtx, setCopiedCtx]   = useState(null); // 'text' | 'link' | 'id' | null
  const [popout,  setPopout]        = useState(null);
  const [showMembers, setShowMembers] = useState(
    () => sessionStorage.getItem('memberPanelOpen') !== 'false'
  );
  const [memberRefreshTick, setMemberRefreshTick] = useState(0);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [leaveBusy, setLeaveBusy]   = useState(false);
  // Mention autocomplete
  const [mentionData, setMentionData]   = useState({ members: [], channels: [], roles: [] });
  const [mentionPicker, setMentionPicker] = useState(null); // { query, atIndex } | null
  const [pickerIndex, setPickerIndex]   = useState(0);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | connecting | connected | error
  const [voiceSession, setVoiceSession] = useState(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);

  function toggleMembers() {
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const ctxRef    = useRef(null);

  // Scroll the messages container to the very bottom instantly
  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const channelMessages = messages[String(channelId)] ?? [];

  // Derive group chat info
  const isGroupChannel = channel?.type === 2;
  const isGuildChannel = channel?.type === 0;
  const isDmChannel = channel?.type === 1;
  const groupChat = isGroupChannel
    ? groupChats.find(g => String(g.channelId) === String(channelId))
    : null;
  const isOwner = groupChat?.ownerId === currentUser?.id;
  const existingMemberIds = new Set(); // populated lazily by MemberList, used by AddMembersModal

  // Permission checks for guild channels
  // PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
  // Prefer channel-level resolved perms (includes overrides); fall back to guild-level perms
  const myGuildPerms  = isGuildChannel ? (getMyChannelPerms(channelId) ?? getMyPerms(channel?.guildId)) : null;
  const isAdmin       = myGuildPerms?.administrator === 0;
  const canSend       = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.sendMessages === 0;
  const canManageMsgs = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.manageMessages === 0;

  // Memoized so MessageBubble (which is React.memo'd) doesn't re-render just because
  // the parent re-renders with an otherwise unchanged getColor inline lambda.
  const guildIdForColor = isGuildChannel ? channel?.guildId : null;
  const getColor = useCallback(
    (userId, username) => getMemberColor(guildIdForColor, userId, username),
    [getMemberColor, guildIdForColor] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Pre-process messages into render units, grouping consecutive blocked-user messages
  const renderUnits = useMemo(() => {
    const units = [];
    let i = 0;
    while (i < channelMessages.length) {
      const msg = channelMessages[i];
      if (!msg._pending && isBlocked(msg.authorId)) {
        if (blockedMessageMode === 'hidden') {
          // Skip entirely
          i++;
          continue;
        }
        if (blockedMessageMode === 'visible') {
          // Show normally — no grouping
          units.push({ type: 'normal', key: msg.id ?? `tmp-${i}`, msg, prevMsg: channelMessages[i - 1] ?? null });
          i++;
          continue;
        }
        // 'masked' (default): collect consecutive blocked messages from the same author
        const group = [msg];
        let j = i + 1;
        while (j < channelMessages.length) {
          const next = channelMessages[j];
          if (!next._pending && isBlocked(next.authorId) && next.authorId === msg.authorId) {
            group.push(next);
            j++;
          } else break;
        }
        units.push({ type: 'blocked', key: `blocked-${msg.id ?? i}`, authorId: msg.authorId, messages: group });
        i = j;
      } else {
        units.push({ type: 'normal', key: msg.id ?? `tmp-${i}`, msg, prevMsg: channelMessages[i - 1] ?? null });
        i++;
      }
    }
    return units;
  }, [channelMessages, isBlocked, blockedMessageMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to channel-level SignalR events
  useEffect(() => {
    if (!channelEvent) return;
    if (channelEvent.channelId === Number(channelId)) {
      if (channelEvent.type === 'ChannelDeleted') {
        nav('/app/friends', { replace: true });
      } else if (channelEvent.type === 'UserLeft') {
        setMemberRefreshTick(t => t + 1);
      }
    }
  }, [channelEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh member colors when roles are updated in this guild
  useEffect(() => {
    if (!rolesUpdatedEvent || !isGuildChannel || !channel?.guildId) return;
    if (String(rolesUpdatedEvent.guildId) === String(channel.guildId)) {
      loadGuildMemberColors(channel.guildId, channelId);
    }
  }, [rolesUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh member colors when a specific user's roles change (UserUpdated)
  useEffect(() => {
    if (!userUpdatedEvent || !isGuildChannel || !channel?.guildId) return;
    loadGuildMemberColors(channel.guildId, channelId);
  }, [userUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLeave() {
    if (leaveBusy) return;
    const confirmed = isOwner
      ? window.confirm('You are the owner. Leaving will DELETE this group chat for everyone. Continue?')
      : window.confirm('Are you sure you want to leave this group chat?');
    if (!confirmed) return;
    setLeaveBusy(true);
    try {
      await leaveOrDeleteGroupChat(Number(channelId));
      refreshDms();
      nav('/app/friends', { replace: true });
    } catch (err) {
      console.error('Leave failed:', err);
      setLeaveBusy(false);
    }
  }

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e) {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null);
    }
    function onKey(e) { if (e.key === 'Escape') setCtxMenu(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback((e, msg) => {
    if (msg._pending) return;
    e.preventDefault();
    // Clamp to viewport — menu is ~200px wide, ~160px tall
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 160);
    setCtxMenu({ x, y, msg });
    setCopiedCtx(null);
  }, []);

  const handleUserClick = useCallback((e, userId, username) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout({ userId, username: username ?? userId, anchorRect: rect });
  }, []);

  async function handleDelete() {
    if (!ctxMenu) return;
    const { msg } = ctxMenu;
    setCtxMenu(null);
    // Optimistically remove
    setMessages(p => ({
      ...p,
      [String(msg.channelId)]: (p[String(msg.channelId)] ?? []).filter(m => m.id !== msg.id),
    }));
    try {
      await deleteMessage(msg.channelId, msg.id);
    } catch (err) {
      console.error('Delete failed:', err);
      // Re-fetch to restore if delete failed — simplest recovery
      getMessages(msg.channelId, 50, 0)
        .then(msgs => setMessages(p => ({ ...p, [String(msg.channelId)]: [...msgs].reverse() })))
        .catch(console.error);
    }
  }

  useEffect(() => {
    setLoading(true);
    setChannel(null);
    setOtherUser(null);
    setInput('');
    setSendError(null);
    setMentionPicker(null);
    setMentionData({ members: [], channels: [], roles: [] });

    Promise.all([
      getChannel(channelId),
      getMessages(channelId, 50, 0),
    ]).then(([ch, msgs]) => {
      // Keep the correct sidebar active based on the channel type
      setActiveGuildId(ch.type === 0 ? String(ch.guildId) : null);
      // Load permissions and member colors for guild channels
      if (ch.type === 0 && ch.guildId) {
        loadGuildPermissions(ch.guildId);
        loadChannelPermissions(ch.guildId, channelId);
        loadGuildMemberColors(ch.guildId, channelId);
        // Load mention autocomplete data
        Promise.all([
          getGuildMembers(ch.guildId),
          getGuildRoles(ch.guildId),
          getGuildChannels(ch.guildId),
        ]).then(([members, roles, channels]) => {
          setMentionData({
            members:  (members  ?? []).map(m => ({ id: m.user?.id ?? m.id, username: m.user?.username ?? m.username, color: m.color ?? null })),
            channels: (channels ?? []).map(c => ({ id: String(c.id), name: c.name })),
            roles:    (roles    ?? []).map(r => ({ id: String(r.id), name: r.name, color: r.color || null })),
          });
        }).catch(console.error);
      } else {
        // DM / group: load channel members for user-mention autocomplete
        getChannelMembers(channelId).then(members => {
          setMentionData({
            members:  (members ?? []).map(m => ({ id: m.id, username: m.username, color: null })),
            channels: [],
            roles:    [],
          });
        }).catch(console.error);
      }
      setChannel(ch);
      setMessages(p => ({ ...p, [String(channelId)]: [...msgs].reverse() }));
      setLoading(false);
      // Scroll to bottom after React has painted the new messages.
      // requestAnimationFrame fires after the browser has done layout/paint.
      requestAnimationFrame(() => scrollToBottom());
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve other user for DM channel header
  useEffect(() => {
    if (!channel || channel.type !== 1 || !currentUser) return;
    const dm = dmChannels.find(d => String(d.channelId) === String(channelId));
    if (!dm) return;
    const otherId = dm.user1Id === currentUser.id ? dm.user2Id : dm.user1Id;
    resolveUser(otherId).then(setOtherUser);
  }, [channel, dmChannels, currentUser, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new message arrives and the user is already near the bottom, keep them there.
  // We intentionally do NOT run this on the initial load — that's handled by the
  // requestAnimationFrame call inside the fetch .then() above.
  useEffect(() => {
    if (searchParams.get('message')) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) scrollToBottom();
  }, [channelMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to and highlight a linked message once messages have loaded
  useEffect(() => {
    const targetId = searchParams.get('message');
    if (!targetId || loading) return;
    const el = document.querySelector(`[data-msgid="${targetId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightMsgId(String(targetId));
    // Remove the ?message= param from the URL without navigating
    setSearchParams(p => { p.delete('message'); return p; }, { replace: true });
    // Clear the highlight after the animation finishes
    const t = setTimeout(() => setHighlightMsgId(null), 2200);
    return () => clearTimeout(t);
  }, [loading, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input when channel changes or once loading finishes
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [channelId, loading]);

  // Auto-resize textarea as content grows/shrinks
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px'; // 320px ≈ 20rem
  }, [input]);

  // ── Mention autocomplete ────────────────────────────────────────────────────

  function detectMention(text, cursorPos) {
    const before = text.slice(0, cursorPos);
    const atIdx  = before.lastIndexOf('@');
    if (atIdx === -1) { setMentionPicker(null); return; }
    const query = before.slice(atIdx + 1);
    // Cancel if there's a space/newline between @ and cursor
    if (/[\s\n]/.test(query)) { setMentionPicker(null); return; }
    setMentionPicker({ query, atIndex: atIdx });
    setPickerIndex(0);
  }

  const pickerSuggestions = useMemo(() => {
    if (!mentionPicker) return [];
    const q = mentionPicker.query.toLowerCase();
    const score = (label) => label.toLowerCase().startsWith(q) ? 0 : 1;
    const users = mentionData.members
      .filter(m => !q || m.username.toLowerCase().includes(q))
      .sort((a, b) => score(a.username) - score(b.username))
      .slice(0, 5)
      .map(m => ({ type: 'user', id: m.id, label: m.username, color: m.color }));
    const channels = mentionData.channels
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => score(a.name) - score(b.name))
      .slice(0, 3)
      .map(c => ({ type: 'channel', id: c.id, label: c.name, color: null }));
    const roles = mentionData.roles
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => score(a.name) - score(b.name))
      .slice(0, 3)
      .map(r => ({ type: 'role', id: r.id, label: r.name, color: r.color }));
    return [...users, ...channels, ...roles];
  }, [mentionPicker, mentionData]); // eslint-disable-line react-hooks/exhaustive-deps

  function insertMention(suggestion) {
    if (!mentionPicker) return;
    const { atIndex, query } = mentionPicker;
    const before  = input.slice(0, atIndex);
    const after   = input.slice(atIndex + 1 + query.length);
    const token   = `<@${suggestion.type}:${suggestion.id}> `;
    const next    = before + token + after;
    setInput(next);
    setMentionPicker(null);
    // Restore focus and place cursor after the inserted token
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      const pos = before.length + token.length;
      inputRef.current.setSelectionRange(pos, pos);
    });
  }

  // ── Message send ─────────────────────────────────────────────────────────────

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !currentUser) return;

    setSendError(null);
    setInput('');

    // Optimistic pending message — will be replaced by the NewMessage signal
    const tempId = `_pending_${Date.now()}_${Math.random()}`;
    const tempMsg = {
      id: tempId,
      channelId: Number(channelId),
      authorId: currentUser.id,
      content: text,
      createdAt: new Date().toISOString(),
      _pending: true,
    };
    setMessages(p => ({
      ...p,
      [String(channelId)]: [...(p[String(channelId)] ?? []), tempMsg],
    }));
    // Always snap to bottom when the user sends a message
    requestAnimationFrame(() => scrollToBottom());

    try {
      await sendMessage(channelId, text);
    } catch (err) {
      console.error('Send failed:', err);
      // Remove the pending message on failure
      setMessages(p => ({
        ...p,
        [String(channelId)]: (p[String(channelId)] ?? []).filter(m => m.id !== tempId),
      }));
      if (err?.status === 403) {
        setSendError('You cannot send messages here.');
      } else {
        setSendError('Failed to send message. Please try again.');
      }
    }
  }

  function handleKeyDown(e) {
    // Mention picker keyboard navigation takes priority
    if (mentionPicker && pickerSuggestions.length > 0) {
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => Math.min(pickerSuggestions.length - 1, i + 1)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && pickerSuggestions.length > 0)) {
        e.preventDefault(); insertMention(pickerSuggestions[pickerIndex]); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionPicker(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }
  
  async function handleJoinVoice() {
    if (voiceBusy || voiceStatus === 'connecting') return;
    setVoiceBusy(true);
    setVoiceStatus('connecting');
    try {
      const session = await joinChannel({ channelId });
      setVoiceSession(session ?? {});
      setVoiceStatus('connected');
    } catch (err) {
      console.error('joinChannel failed:', err);
      setVoiceStatus('error');
    } finally {
      setVoiceBusy(false);
    }
  }

  async function handleLeaveVoice() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      await leaveChannel(voiceSession);
    } catch (err) {
      console.error('leaveChannel failed:', err);
    } finally {
      setVoiceSession(null);
      setVoiceMuted(false);
      setVoiceStatus('idle');
      setVoiceBusy(false);
    }
  }

  async function handleToggleMute() {
    if (!voiceSession) return;
    
    const nextMuted = !voiceMuted;
    try {
      await applyVoiceMuted(voiceSession, nextMuted);
      setVoiceMuted(nextMuted);
    } catch (err) {
      console.error('setMuted failed:', err);
    }
  }

  const channelDisplayName = channel?.type === 1
    ? (otherUser?.username ?? '…')
    : (channel?.name ?? `Channel ${channelId}`);

  const channelIcon = channel?.type === 1 ? '👤' : channel?.type === 2 ? '👥' : '#';

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💬</div>
          <div>Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main chat column */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg-base)' }}>
        {/* Channel header */}
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0 0.75rem 0 1.25rem', borderBottom: '1px solid var(--border)',
          flexShrink: 0, background: 'var(--bg-base)',
        }}>
          <span style={{ fontSize: '1rem' }}>{channelIcon}</span>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', flex: 1 }}>
            {channelDisplayName}
          </span>
          {isDmChannel && otherUser && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Direct Message</span>
          )}

          {(isDmChannel || isGroupChannel) && (
            <HeaderBtn
              title={voiceStatus === 'connected' ? 'Leave Voice' : 'Join Voice'}
              onClick={voiceStatus === 'connected' ? handleLeaveVoice : handleJoinVoice}
              active={voiceStatus === 'connected'}
              disabled={voiceBusy || voiceStatus === 'connecting'}
            >
              {voiceStatus === 'connected' ? '🔊' : '🎙️'}
            </HeaderBtn>
          )}

          {isGroupChannel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
              {isOwner && (
                <HeaderBtn title="Add Members" onClick={() => setShowAddMembers(true)}>➕</HeaderBtn>
              )}
              <HeaderBtn title="Leave Group" danger onClick={handleLeave} disabled={leaveBusy}>🚪</HeaderBtn>
            </div>
          )}

          {!isGuildChannel && (
            <HeaderBtn title="Member List" active={showMembers} onClick={toggleMembers}>👥</HeaderBtn>
          )}
        </div>

        {(isDmChannel || isGroupChannel) && voiceStatus !== 'idle' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '0.75rem', padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.85rem',
          }}>
            <div>
              {voiceStatus === 'connecting' && 'Connecting to voice…'}
              {voiceStatus === 'connected' && 'Voice connected'}
              {voiceStatus === 'error' && 'Voice error'}
            </div>
            {voiceStatus === 'connected' && (
              <button
                onClick={handleToggleMute}
                style={{
                  background: voiceMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)',
                  border: 'none', color: voiceMuted ? 'var(--danger)' : 'var(--text-primary)',
                  borderRadius: '6px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.85rem',
                }}
                title={voiceMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {voiceMuted ? '🔇' : '🎙️'}
              </button>
            )}
          </div>
        )}

        {/* Messages area */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingTop: '0.5rem' }}>
          {channelMessages.length === 0 && !loading && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>
                {channel?.type === 1 ? '👋' : '🎉'}
              </div>
              <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem', fontSize: '1rem' }}>
                {channel?.type === 1
                  ? `This is the beginning of your conversation with ${channelDisplayName}`
                  : `Welcome to ${channelDisplayName}!`}
              </div>
              <div style={{ fontSize: '0.85rem' }}>Send the first message!</div>
            </div>
          )}

          {renderUnits.map(unit => {
            if (unit.type === 'blocked') {
              return (
                <BlockedGroupBubble
                  key={unit.key}
                  messages={unit.messages}
                  authorId={unit.authorId}
                  resolveUser={resolveUser}
                  currentUserId={currentUser?.id}
                  onContextMenu={handleContextMenu}
                  onUserClick={handleUserClick}
                  getColor={getColor}
                  mentionData={mentionData}
                />
              );
            }
            return (
              <MessageBubble
                key={unit.key}
                msg={unit.msg}
                prevMsg={unit.prevMsg}
                resolveUser={resolveUser}
                currentUserId={currentUser?.id}
                onContextMenu={handleContextMenu}
                onUserClick={handleUserClick}
                getColor={getColor}
                mentionData={mentionData}
                highlighted={highlightMsgId !== null && String(unit.msg.id) === highlightMsgId}
              />
            );
          })}
          <div ref={bottomRef} style={{ height: 8 }} />
        </div>

        <div style={{ padding: '0 1rem 1.5rem', flexShrink: 0 }}>
          {/* Blocked-by-me banner — replaces the input entirely */}
          {isDmChannel && otherUser && isBlocked(otherUser.id) ? (
            <BlockedInputBanner username={otherUser.username} userId={otherUser.id} unblockUser={unblockUser} />
          ) : canSend ? (
          <>
            {sendError && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                marginBottom: '0.5rem', padding: '0.55rem 0.85rem',
                background: 'rgba(242,63,67,0.12)', border: '1px solid rgba(242,63,67,0.35)',
                borderRadius: '6px', color: '#f23f43', fontSize: '0.83rem',
              }}>
                <span style={{ flexShrink: 0 }}>🚫</span>
                <span style={{ flex: 1 }}>{sendError}</span>
                <button
                  onClick={() => setSendError(null)}
                  style={{ background: 'none', border: 'none', color: '#f23f43', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.1rem', opacity: 0.7, flexShrink: 0 }}
                  title="Dismiss"
                >✕</button>
              </div>
            )}
            <form onSubmit={handleSend} style={{ position: 'relative' }}>
              {mentionPicker && (
                <MentionPicker
                  suggestions={pickerSuggestions}
                  selectedIndex={pickerIndex}
                  onSelect={insertMention}
                  onHoverIndex={setPickerIndex}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'flex-end', background: 'var(--bg-input)', borderRadius: '8px', padding: '0 0.75rem' }}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                    fontSize: '0.9375rem', padding: '0.875rem 0.25rem', outline: 'none',
                    resize: 'none', overflow: 'hidden', lineHeight: 1.5,
                    maxHeight: '20rem', overflowY: 'auto', fontFamily: 'inherit',
                  }}
                  placeholder={`Message ${channelDisplayName}`}
                  value={input}
                  onChange={e => { setInput(e.target.value); setSendError(null); detectMention(e.target.value, e.target.selectionStart); }}
                  onKeyDown={handleKeyDown}
                  onKeyUp={e => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                      detectMention(input, e.target.selectionStart);
                    }
                  }}
                  onClick={e => detectMention(input, e.target.selectionStart)}
                  maxLength={16384}
                />
                {input.trim() && (
                  <button type="submit"
                    style={{ background: 'var(--accent)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#fff', padding: '0.3rem 0.55rem', fontSize: '0.9rem', marginLeft: '0.5rem', marginBottom: '0.875rem', lineHeight: 1, transition: 'background 0.15s', flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
                  >↵</button>
                )}
              </div>
            </form>
          </>
          ) : (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
              🔒 You don't have permission to send messages here.
            </div>
          )}
        </div>

        {/* Context menu */}
        {ctxMenu && (
          <div ref={ctxRef} style={{ position: 'fixed', zIndex: 500, top: ctxMenu.y, left: ctxMenu.x, background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.3rem', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 200 }}>
            <CtxBtn icon="📋" label="Copy Text"
              copied={copiedCtx === 'text'}
              onClick={() => {
                navigator.clipboard.writeText(ctxMenu.msg.content);
                setCopiedCtx('text');
                setTimeout(() => { setCopiedCtx(null); setCtxMenu(null); }, 1000);
              }} />
            <CtxBtn icon="🔗" label="Copy Message Link"
              copied={copiedCtx === 'link'}
              onClick={() => {
                const url = `${FRONTEND_URL}/app/channel/${ctxMenu.msg.channelId}?message=${ctxMenu.msg.id}`;
                navigator.clipboard.writeText(url);
                setCopiedCtx('link');
                setTimeout(() => { setCopiedCtx(null); setCtxMenu(null); }, 1000);
              }} />
            <CtxBtn icon="🪪" label="Copy Message ID"
              copied={copiedCtx === 'id'}
              onClick={() => {
                navigator.clipboard.writeText(String(ctxMenu.msg.id));
                setCopiedCtx('id');
                setTimeout(() => { setCopiedCtx(null); setCtxMenu(null); }, 1000);
              }} />
            {(ctxMenu.msg.authorId === currentUser?.id || canManageMsgs) && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '0.25rem 0' }} />
                <CtxBtn icon="🗑" label="Delete Message" danger onClick={handleDelete} />
              </>
            )}
          </div>
        )}

        {popout && (
          <UserPopout
            userId={popout.userId}
            username={popout.username}
            anchorRect={popout.anchorRect}
            onClose={() => setPopout(null)}
            guildId={isGuildChannel ? channel?.guildId : null}
          />
        )}
      </div>

      {showMembers && channel && (
        <MemberList
          channelId={channelId}
          guildId={isGuildChannel ? channel.guildId : null}
          ownerId={groupChat?.ownerId ?? null}
          refreshTick={memberRefreshTick}
        />
      )}

      {showAddMembers && (
        <AddMembersModal
          groupId={Number(channelId)}
          existingMemberIds={existingMemberIds}
          onClose={() => { setShowAddMembers(false); setMemberRefreshTick(t => t + 1); }}
        />
      )}
    </div>
  );
}
