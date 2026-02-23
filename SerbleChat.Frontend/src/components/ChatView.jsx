import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage, leaveOrDeleteGroupChat } from '../api.js';
import UserPopout from './UserPopout.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import InviteCard from './InviteCard.jsx';

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
  p:          ({ children }) => <span style={{ display: 'block', margin: 0 }}>{children}</span>,
  a:          ({ href, children }) => {
    // Render invite links as plain text — the InviteCard below the message handles them
    if (href && INVITE_RE().test(href)) {
      return <span style={{ color: '#7c9ef8' }}>{children}</span>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#7c9ef8', textDecoration: 'underline' }}>{children}</a>;
  },
  strong:     ({ children }) => <strong style={{ fontWeight: 700, color: '#f2f3f5' }}>{children}</strong>,
  em:         ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  del:        ({ children }) => <del style={{ textDecoration: 'line-through', opacity: 0.7 }}>{children}</del>,
  code:       ({ inline, children }) => inline
    ? <code style={{ background: '#2b2d31', borderRadius: 3, padding: '0.1em 0.35em', fontFamily: 'monospace', fontSize: '0.85em', color: '#e3e5e8' }}>{children}</code>
    : <code>{children}</code>,
  pre:        ({ children }) => <pre style={{ background: '#2b2d31', borderRadius: 6, padding: '0.6rem 0.8rem', overflowX: 'auto', margin: '0.3rem 0', fontSize: '0.85em', fontFamily: 'monospace', color: '#e3e5e8' }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #4f5660', paddingLeft: '0.6rem', margin: '0.2rem 0', color: '#b5bac1' }}>{children}</blockquote>,
  ul:         ({ children }) => <ul style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ul>,
  ol:         ({ children }) => <ol style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ol>,
  li:         ({ children }) => <li style={{ margin: '0.1rem 0' }}>{children}</li>,
  h1:         ({ children }) => <strong style={{ fontSize: '1.1em', display: 'block' }}>{children}</strong>,
  h2:         ({ children }) => <strong style={{ fontSize: '1.05em', display: 'block' }}>{children}</strong>,
  h3:         ({ children }) => <strong style={{ fontSize: '1em', display: 'block' }}>{children}</strong>,
};

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

function MessageBubble({ msg, prevMsg, resolveUser, currentUserId, onContextMenu, onUserClick, getColor }) {
  const [author, setAuthor] = useState(null);

  // Group consecutive messages from the same author
  const compact = prevMsg && prevMsg.authorId === msg.authorId &&
    new Date(msg.createdAt) - new Date(prevMsg.createdAt) < 5 * 60 * 1000;

  useEffect(() => {
    resolveUser(msg.authorId).then(setAuthor);
  }, [msg.authorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve color: use role color if in guild, otherwise seed from username
  const nameColor = getColor(msg.authorId, author?.username);

  const ts = msg._pending
    ? 'Sending…'
    : new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (compact) {
    return (
      <div
        onContextMenu={e => onContextMenu(e, msg)}
        style={{ padding: '0.1rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
        onMouseEnter={e => e.currentTarget.style.background = '#2e3035'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ fontSize: '0.65rem', color: msg._pending ? '#f0b232' : '#4f5660', width: 40, flexShrink: 0, alignSelf: 'center', textAlign: 'right' }}>
          {ts}
        </span>
        <span style={{ color: '#dbdee1', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', flex: 1 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
          {extractInviteIds(msg.content).map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div
      onContextMenu={e => onContextMenu(e, msg)}
      style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
      onMouseEnter={e => e.currentTarget.style.background = '#2e3035'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div
        onClick={e => !msg._pending && onUserClick(e, msg.authorId, author?.username)}
        style={{ cursor: msg._pending ? 'default' : 'pointer', flexShrink: 0 }}
      >
        <Avatar name={author?.username} size={40} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span
            onClick={e => !msg._pending && onUserClick(e, msg.authorId, author?.username)}
            style={{ fontWeight: 600, color: nameColor, fontSize: '0.9rem', cursor: msg._pending ? 'default' : 'pointer' }}
          >
            {author?.username ?? msg.authorId.slice(0, 10)}
          </span>
          <span style={{ fontSize: '0.68rem', color: msg._pending ? '#f0b232' : '#4f5660' }}>{ts}</span>
        </div>
        <div style={{ color: '#dbdee1', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
          {extractInviteIds(msg.content).map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ChatView() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const { currentUser, dmChannels, groupChats, messages, setMessages, resolveUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent } = useApp();
  const [input, setInput]           = useState('');
  const [channel, setChannel]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [otherUser, setOtherUser]   = useState(null);
  const [ctxMenu, setCtxMenu]       = useState(null);
  const [popout,  setPopout]        = useState(null);
  const [showMembers, setShowMembers] = useState(
    () => sessionStorage.getItem('memberPanelOpen') !== 'false'
  );
  const [memberRefreshTick, setMemberRefreshTick] = useState(0);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [leaveBusy, setLeaveBusy]   = useState(false);

  function toggleMembers() {
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const ctxRef    = useRef(null);

  const channelMessages = messages[String(channelId)] ?? [];

  // Derive group chat info
  const isGroupChannel = channel?.type === 2;
  const isGuildChannel = channel?.type === 0;
  const groupChat = isGroupChannel
    ? groupChats.find(g => String(g.channelId) === String(channelId))
    : null;
  const isOwner = groupChat?.ownerId === currentUser?.id;
  const existingMemberIds = new Set(); // populated lazily by MemberList, used by AddMembersModal

  // Permission checks for guild channels
  // PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
  const myGuildPerms  = isGuildChannel ? getMyPerms(channel?.guildId) : null;
  const isAdmin       = myGuildPerms?.administrator === 0;
  const canSend       = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.sendMessages === 0;
  const canManageMsgs = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.manageMessages === 0;

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
    // Clamp to viewport
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 80);
    setCtxMenu({ x, y, msg });
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

    Promise.all([
      getChannel(channelId),
      getMessages(channelId, 50, 0),
    ]).then(([ch, msgs]) => {
      // Keep the correct sidebar active based on the channel type
      setActiveGuildId(ch.type === 0 ? String(ch.guildId) : null);
      // Load permissions and member colors for guild channels
      if (ch.type === 0 && ch.guildId) {
        loadGuildPermissions(ch.guildId);
        loadGuildMemberColors(ch.guildId, channelId);
      }
      setChannel(ch);
      setMessages(p => ({ ...p, [String(channelId)]: [...msgs].reverse() }));
      setLoading(false);
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

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

  // Focus input when channel changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [channelId]);

  // Auto-resize textarea as content grows/shrinks
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 192) + 'px'; // 192px ≈ 12rem
  }, [input]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !currentUser) return;
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

    try {
      await sendMessage(channelId, text);
    } catch (err) {
      console.error('Send failed:', err);
      // Remove the pending message on failure
      setMessages(p => ({
        ...p,
        [String(channelId)]: (p[String(channelId)] ?? []).filter(m => m.id !== tempId),
      }));
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  const channelDisplayName = channel?.type === 1
    ? (otherUser?.username ?? '…')
    : (channel?.name ?? `Channel ${channelId}`);

  const channelIcon = channel?.type === 1 ? '👤' : channel?.type === 2 ? '👥' : '#';

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#72767d' }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#313338' }}>
        {/* Channel header */}
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0 0.75rem 0 1.25rem', borderBottom: '1px solid #1e1f22',
          flexShrink: 0, background: '#313338',
        }}>
          <span style={{ fontSize: '1rem' }}>{channelIcon}</span>
          <span style={{ fontWeight: 700, color: '#f2f3f5', fontSize: '0.95rem', flex: 1 }}>
            {channelDisplayName}
          </span>
          {channel?.type === 1 && otherUser && (
            <span style={{ fontSize: '0.78rem', color: '#72767d' }}>Direct Message</span>
          )}

          {/* Group chat actions */}
          {isGroupChannel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
              {isOwner && (
                <HeaderBtn title="Add Members" onClick={() => setShowAddMembers(true)}>
                  ➕
                </HeaderBtn>
              )}
              <HeaderBtn title="Leave Group" danger onClick={handleLeave} disabled={leaveBusy}>
                🚪
              </HeaderBtn>
            </div>
          )}

          {/* Members toggle — not shown for guild channels */}
          {!isGuildChannel && (
            <HeaderBtn title="Member List" active={showMembers} onClick={toggleMembers}>
              👥
            </HeaderBtn>
          )}
        </div>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: '0.5rem' }}>
          {channelMessages.length === 0 && !loading && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#72767d' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>
                {channel?.type === 1 ? '👋' : '🎉'}
              </div>
              <div style={{ fontWeight: 700, color: '#b5bac1', marginBottom: '0.3rem', fontSize: '1rem' }}>
                {channel?.type === 1
                  ? `This is the beginning of your conversation with ${channelDisplayName}`
                  : `Welcome to ${channelDisplayName}!`}
              </div>
              <div style={{ fontSize: '0.85rem' }}>Send the first message!</div>
            </div>
          )}

          {channelMessages.map((msg, i) => (
            <MessageBubble
              key={msg.id ?? `tmp-${i}`}
              msg={msg}
              prevMsg={channelMessages[i - 1] ?? null}
              resolveUser={resolveUser}
              currentUserId={currentUser?.id}
              onContextMenu={handleContextMenu}
              onUserClick={handleUserClick}
              getColor={(userId, username) => getMemberColor(isGuildChannel ? channel?.guildId : null, userId, username)}
            />
          ))}
          <div ref={bottomRef} style={{ height: 8 }} />
        </div>

        <div style={{ padding: '0 1rem 1.5rem', flexShrink: 0 }}>
          {canSend ? (
          <form onSubmit={handleSend}>
            <div style={{ display: 'flex', alignItems: 'flex-end', background: '#383a40', borderRadius: '8px', padding: '0 0.75rem' }}>
              <textarea
                ref={inputRef}
                rows={1}
                style={{
                  flex: 1, background: 'transparent', border: 'none', color: '#dbdee1',
                  fontSize: '0.9375rem', padding: '0.875rem 0.25rem', outline: 'none',
                  resize: 'none', overflow: 'hidden', lineHeight: 1.5,
                  maxHeight: '12rem', overflowY: 'auto', fontFamily: 'inherit',
                }}
                placeholder={`Message ${channelDisplayName}`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={2000}
              />
              {input.trim() && (
                <button type="submit"
                  style={{ background: '#7c3aed', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#fff', padding: '0.3rem 0.55rem', fontSize: '0.9rem', marginLeft: '0.5rem', marginBottom: '0.875rem', lineHeight: 1, transition: 'background 0.15s', flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
                  onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
                >↵</button>
              )}
            </div>
          </form>
          ) : (
            <div style={{ background: '#2b2d31', borderRadius: '8px', padding: '0.75rem 1rem', color: '#72767d', fontSize: '0.875rem', textAlign: 'center' }}>
              🔒 You don't have permission to send messages here.
            </div>
          )}
        </div>

        {/* Context menu */}
        {ctxMenu && (
          <div ref={ctxRef} style={{ position: 'fixed', zIndex: 500, top: ctxMenu.y, left: ctxMenu.x, background: '#111214', border: '1px solid #3b3d43', borderRadius: '6px', padding: '0.3rem', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 150 }}>
            {ctxMenu.msg.authorId === currentUser?.id || canManageMsgs ? (
              <button onClick={handleDelete}
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', padding: '0.5rem 0.75rem', background: 'transparent', border: 'none', color: '#f23f43', fontSize: '0.875rem', fontWeight: 500, borderRadius: '4px', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(242,63,67,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >🗑 Delete Message</button>
            ) : (
              <div style={{ padding: '0.5rem 0.75rem', color: '#4f5660', fontSize: '0.8rem' }}>No actions available</div>
            )}
          </div>
        )}

        {/* User popout */}
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

      {/* Member list panel */}
      {showMembers && channel && (
        <MemberList
          channelId={channelId}
          guildId={isGuildChannel ? channel.guildId : null}
          ownerId={groupChat?.ownerId ?? null}
          refreshTick={memberRefreshTick}
        />
      )}

      {/* Add members modal */}
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