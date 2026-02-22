import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage } from '../api.js';
import UserPopout from './UserPopout.jsx';

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

function MessageBubble({ msg, prevMsg, resolveUser, currentUserId, onContextMenu, onUserClick }) {
  const [author, setAuthor] = useState(null);
  const hue = msg.authorId ? (msg.authorId.charCodeAt(0) * 37 + msg.authorId.charCodeAt(msg.authorId.length - 1) * 17) % 360 : 200;

  // Group consecutive messages from the same author
  const compact = prevMsg && prevMsg.authorId === msg.authorId &&
    new Date(msg.createdAt) - new Date(prevMsg.createdAt) < 5 * 60 * 1000;

  useEffect(() => {
    resolveUser(msg.authorId).then(setAuthor);
  }, [msg.authorId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {msg.content}
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
            style={{ fontWeight: 600, color: `hsl(${hue},60%,72%)`, fontSize: '0.9rem', cursor: msg._pending ? 'default' : 'pointer' }}
          >
            {author?.username ?? msg.authorId.slice(0, 10)}
          </span>
          <span style={{ fontSize: '0.68rem', color: msg._pending ? '#f0b232' : '#4f5660' }}>{ts}</span>
        </div>
        <div style={{ color: '#dbdee1', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

export default function ChatView() {
  const { channelId } = useParams();
  const { currentUser, dmChannels, messages, setMessages, resolveUser } = useApp();
  const [input, setInput]         = useState('');
  const [channel, setChannel]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [otherUser, setOtherUser] = useState(null);
  const [ctxMenu, setCtxMenu]     = useState(null); // { x, y, msg }
  const [popout,  setPopout]      = useState(null); // { userId, username, anchorRect }
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const ctxRef    = useRef(null);

  const channelMessages = messages[String(channelId)] ?? [];

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
        .then(msgs => setMessages(p => ({ ...p, [String(msg.channelId)]: msgs })))
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
      setChannel(ch);
      setMessages(p => ({ ...p, [String(channelId)]: msgs }));
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#313338' }}>
      {/* Channel header */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0 1.25rem', borderBottom: '1px solid #1e1f22',
        flexShrink: 0, background: '#313338',
      }}>
        <span style={{ fontSize: '1rem' }}>{channelIcon}</span>
        <span style={{ fontWeight: 700, color: '#f2f3f5', fontSize: '0.95rem' }}>
          {channelDisplayName}
        </span>
        {channel?.type === 1 && otherUser && (
          <span style={{ fontSize: '0.78rem', color: '#72767d', marginLeft: '0.25rem' }}>
            Direct Message
          </span>
        )}
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: '0.5rem' }}>
        {channelMessages.length === 0 && !loading && (
          <div style={{
            padding: '3rem 1.5rem', textAlign: 'center',
            color: '#72767d',
          }}>
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
          />
        ))}
        <div ref={bottomRef} style={{ height: 8 }} />
      </div>

      {/* Message input */}
      <div style={{ padding: '0 1rem 1.5rem', flexShrink: 0 }}>
        <form onSubmit={handleSend}>
          <div style={{
            display: 'flex', alignItems: 'center',
            background: '#383a40', borderRadius: '8px',
            padding: '0 0.75rem',
          }}>
            <input
              ref={inputRef}
              style={{
                flex: 1, background: 'transparent', border: 'none',
                color: '#dbdee1', fontSize: '0.9375rem', padding: '0.875rem 0.25rem',
                outline: 'none',
              }}
              placeholder={`Message ${channelDisplayName}`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
            />
            {input.trim() && (
              <button
                type="submit"
                style={{
                  background: '#7c3aed', border: 'none', borderRadius: '4px',
                  cursor: 'pointer', color: '#fff', padding: '0.3rem 0.55rem',
                  fontSize: '0.9rem', marginLeft: '0.5rem', lineHeight: 1,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
                onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
              >
                ↵
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{
            position: 'fixed', zIndex: 500,
            top: ctxMenu.y, left: ctxMenu.x,
            background: '#111214', border: '1px solid #3b3d43',
            borderRadius: '6px', padding: '0.3rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: 150,
          }}
        >
          {ctxMenu.msg.authorId === currentUser?.id ? (
            <button
              onClick={handleDelete}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                width: '100%', padding: '0.5rem 0.75rem',
                background: 'transparent', border: 'none',
                color: '#f23f43', fontSize: '0.875rem', fontWeight: 500,
                borderRadius: '4px', cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(242,63,67,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              🗑 Delete Message
            </button>
          ) : (
            <div style={{ padding: '0.5rem 0.75rem', color: '#4f5660', fontSize: '0.8rem' }}>
              No actions available
            </div>
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
        />
      )}
    </div>
  );
}