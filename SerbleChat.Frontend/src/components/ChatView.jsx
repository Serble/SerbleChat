import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage, leaveOrDeleteGroupChat,
         getGuildMembers, getGuildRoles, getGuildChannels, getChannelMembers, FRONTEND_URL,
         getChannelIconUrl, getGroupChatIconUrl, markMessagesAsRead, getGuild } from '../api.js';
import { copyToClipboard } from '../electron-utils.js';
import UserPopout from './UserPopout.jsx';
import UserInteraction from './UserInteraction.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import VoiceParticipantPreview from './VoiceParticipantPreview.jsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import InviteCard from './InviteCard.jsx';
import MessageCard from './MessageCard.jsx';
import FileEmbed from './FileEmbed.jsx';
import { MentionText, MentionPicker } from './MentionRenderer.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import Avatar from './Avatar.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import { FileUploadPanel, useFileUploads } from './FileUploadPanel.jsx';

/**
 * Helper: treat -1 as unlimited
 */
function isUnlimited(value) {
  return value === -1;
}

// Regex that matches invite links anywhere in a message.
// Intentionally origin-agnostic so that links shared from a different
// hostname/port (or after a Vite port reassignment on reload) still work.
const INVITE_RE = () => /https?:\/\/[^\s/]+\/invite\/([a-zA-Z0-9_-]+)/g;

// Regex that matches message links: /app/channel/:channelId?message=:messageId
// Also origin-agnostic for the same reasons as invite links.
const MESSAGE_RE = () => /https?:\/\/[^\s/]+\/app\/channel\/(\d+)\?message=(\d+)/g;

// Regex that matches files API URLs: /files/something
// Matches the VITE_SERBLE_FILES_API_URL base with /files/ path
const FILE_RE = () => /https?:\/\/[^\s/]+\/files\/[^\s]+/g;

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

/** Extract unique message links (channelId, messageId pairs) from a message string */
function extractMessageLinks(content) {
  const links = [];
  const seen = new Set();
  let m;
  const re = MESSAGE_RE();
  while ((m = re.exec(content)) !== null) {
    const key = `${m[1]}-${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ channelId: m[1], messageId: m[2] });
    }
  }
  return links;
}

/** Extract unique file URLs from a message string */
function extractFileUrls(content) {
  const urls = [];
  const seen = new Set();
  let m;
  const re = FILE_RE();
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[0])) { seen.add(m[0]); urls.push(m[0]); }
  }
  return urls;
}


// Markdown component overrides styled for the dark chat theme
const mdComponents = {
  p:          ({ children }) => <span style={{ display: 'block', margin: '0 0 0.45em' }}>{children}</span>,
  a:          ({ href, children }) => {
    if (href && (INVITE_RE().test(href) || MESSAGE_RE().test(href) || FILE_RE().test(href))) {
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
  @keyframes spin {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
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

const MessageBubble = React.memo(function MessageBubble({ msg, prevMsg, resolveUser, currentUserId, onContextMenu, onImageContextMenu, onUserClick, getColor, mentionData, highlighted, guildId }) {
  const [author, setAuthor] = useState(null);

  // Group consecutive messages from the same author
  const compact = prevMsg && prevMsg.authorId === msg.authorId &&
    parseUtcDate(msg.createdAt) - parseUtcDate(prevMsg.createdAt) < 5 * 60 * 1000;

  useEffect(() => {
    resolveUser(msg.authorId).then(setAuthor);
  }, [msg.authorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize invite ID extraction — only re-runs when message content changes
  const inviteIds = useMemo(() => extractInviteIds(msg.content), [msg.content]);
  const messageLinks = useMemo(() => extractMessageLinks(msg.content), [msg.content]);
  const fileUrls = useMemo(() => extractFileUrls(msg.content), [msg.content]);

  // Resolve color: role color > user profile color > generated hue
  const nameColor = getColor(msg.authorId, author?.username, author?.color);

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
        className={`${highlighted ? 'msg-highlighted' : ''} hov-bg`.trim()}
        onContextMenu={e => onContextMenu(e, msg)}
        style={{ padding: '0.1rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
      >
        <span style={{ fontSize: '0.65rem', color: msg._pending ? '#f0b232' : 'var(--text-subtle)', width: 40, flexShrink: 0, alignSelf: 'center', textAlign: 'right' }}>
          {ts}
        </span>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', flex: 1, minWidth: 0, overflowX: 'hidden' }}>
          <MentionText content={msg.content} mdComponents={mdComponents} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} />
          {inviteIds.map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
          {messageLinks.map(link => (
            <MessageCard key={`${link.channelId}-${link.messageId}`} channelId={link.channelId} messageId={link.messageId} />
          ))}
          {fileUrls.map(url => (
            <FileEmbed 
              key={url} 
              fileUrl={url}
              onImageContextMenu={(e) => onImageContextMenu(e, url, url.split('/').pop(), false, msg.id)}
              onModalImageContextMenu={(e) => onImageContextMenu(e, url, url.split('/').pop(), true)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      data-msgid={msg.id}
      className={`${highlighted ? 'msg-highlighted' : ''} hov-bg`.trim()}
      onContextMenu={e => onContextMenu(e, msg)}
      style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.75rem', opacity: msg._pending ? 0.55 : 1, cursor: 'default' }}
    >
      <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={msg._pending}>
        <div style={{ flexShrink: 0 }}>
          <Avatar userId={msg.authorId} name={author?.username} size={40} color={author?.color} style={{ marginTop: 2 }} />
        </div>
      </UserInteraction>
      <div style={{ flex: 1, overflowX: 'hidden', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={msg._pending}>
            <span style={{ fontWeight: 600, color: nameColor, fontSize: '0.9rem' }}>
              {author?.username ?? msg.authorId.slice(0, 10)}
            </span>
          </UserInteraction>
          <span style={{ fontSize: '0.68rem', color: msg._pending ? '#f0b232' : 'var(--text-subtle)' }}>{tsHeader}</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
          <MentionText content={msg.content} mdComponents={mdComponents} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} />
          {inviteIds.map(id => (
            <InviteCard key={id} inviteId={id} />
          ))}
          {messageLinks.map(link => (
            <MessageCard key={`${link.channelId}-${link.messageId}`} channelId={link.channelId} messageId={link.messageId} />
          ))}
          {fileUrls.map(url => (
            <FileEmbed 
              key={url} 
              fileUrl={url}
              onImageContextMenu={(e) => onImageContextMenu(e, url, url.split('/').pop(), false, msg.id)}
              onModalImageContextMenu={(e) => onImageContextMenu(e, url, url.split('/').pop(), true)}
            />
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
        className={!busy ? 'hov-danger-light' : undefined}
      >
        {busy ? 'Unblocking…' : 'Unblock'}
      </button>
    </div>
  );
}

function BlockedGroupBubble({ messages, authorId, resolveUser, currentUserId, onContextMenu, onUserClick, getColor, mentionData, guildId }) {
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
            onImageContextMenu={onImageContextMenu}
            onUserClick={onUserClick}
            getColor={getColor}
            mentionData={mentionData}
            highlighted={false}
            guildId={guildId}
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
          className="hov-text-secondary"
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
      className="hov-bg"
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
  const { currentUser, dmChannels, groupChats, messages, setMessages, resolveUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent, userUpdatedEvent, loadChannelPermissions, getMyChannelPerms, isBlocked, unblockUser, setActiveChannelId, markChannelRead, registerChannelMeta, channelUpdatedEvent, typingUsers, hubRef } = useApp();
  const { voiceChannelId, voiceStatus, voiceBusy, joinVoice, leaveVoice, toggleMute, voiceMuted, remoteScreenShares } = useVoice();
  const { blockedMessageMode, sendTypingIndicators } = useClientOptions() ?? { blockedMessageMode: 'masked', sendTypingIndicators: true };
  const { isMobile, openSidebar } = useMobile() ?? { isMobile: false, openSidebar: () => {} };
  const [input, setInput]           = useState('');
  const [sendError, setSendError]   = useState(null); // string | null
  const [highlightMsgId, setHighlightMsgId] = useState(null);
  const [channel, setChannel]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [otherUser, setOtherUser]   = useState(null);
  const [guildOwnerId, setGuildOwnerId] = useState(null);
  const [hasChannelIcon, setHasChannelIcon] = useState(false);
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
  
  // File uploads
  const fileUploads = useFileUploads();
  const [dragOver, setDragOver] = useState(false);
  
  // Image context menu
  const [imageCtxMenu, setImageCtxMenu] = useState(null); // { x, y, imageUrl, filename, isModal, messageId? }
  const [copiedImageCtx, setCopiedImageCtx] = useState(null); // 'link' | 'image' | null
  
  // Older messages loading state
  const [loadingOlder, setLoadingOlder] = useState(false);
  
  const lastMarkedReadIdRef = useRef(null);
  const markReadTimeoutRef = useRef(null);
  // Debounce timer for typing indicator notifications (max send every 2 seconds)
  const typingIndicatorTimerRef = useRef(null);
  const lastTypingNotifyRef = useRef(0);
  
  // Pagination state for loading older messages
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const scrollLoadDebounceRef = useRef(null);
  const scrollRestoreRef = useRef(null); // { scrollTopBefore, scrollHeightBefore } to restore after loading
  const isAdjustingScrollRef = useRef(false); // Flag to prevent scroll event during adjustment
  const lastLoadedHeightRef = useRef(0); // Track total message height when we last loaded

  function toggleMembers() {
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const ctxRef    = useRef(null);
  const imageCtxRef = useRef(null);

  // Track whether the user has scrolled away from the bottom.
  // When false, we allow reverse flex layout to naturally keep them at bottom.
  // When true, we lock scrollTop so they stay where they manually scrolled to.
  const userScrolledAway = useRef(false);

  // Detect when user manually scrolls (not from us setting scrollTop)
  function handleMessagesScroll() {
    const el = scrollRef.current;
    if (!el) return;
    
    // Skip loading check if we're currently adjusting scroll position or already loading
    if (isAdjustingScrollRef.current || loadingOlderRef.current || !hasMoreRef.current) return;
    
    // Consider "at bottom" if less than 150px of space below current view
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    userScrolledAway.current = !isNearBottom;
    
    // Load older messages when user scrolls NEAR THE TOP
    // With column-reverse and negative scrollTop:
    // scrollTop = 0 means at the bottom (newest messages)
    // scrollTop < 0 means scrolled up toward older messages
    // scrollTop ≈ -(scrollHeight - clientHeight) means at the very top
    // We want to load when scrollTop is close to its minimum (most negative)
    
    const minScrollTop = -(el.scrollHeight - el.clientHeight);
    const isNearTop = el.scrollTop < minScrollTop + 100; // Within 100px of the top
    
    if (isNearTop) {
      // Debounce to avoid multiple requests on rapid scrolling
      clearTimeout(scrollLoadDebounceRef.current);
      scrollLoadDebounceRef.current = setTimeout(() => {
        loadOlderMessages();
      }, 300);
    }
  }

  // Load older messages by fetching with increased offset
  async function loadOlderMessages() {
    if (loadingOlderRef.current || !hasMoreRef.current) return;
    
    const el = scrollRef.current;
    if (!el) return;
    
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    
    try {
      const olderMessages = await getMessages(channelId, 50, offsetRef.current);
      
      if (!olderMessages || olderMessages.length === 0) {
        hasMoreRef.current = false;
        return;
      }
      
      // If we got fewer messages than requested, we've reached the end
      if (olderMessages.length < 50) {
        hasMoreRef.current = false;
      }
      
      // Update offset for next load
      offsetRef.current += 50;
      
      // Mark that we need to update loading state (useLayoutEffect will handle it)
      scrollRestoreRef.current = true;
      
      // Prepend new messages to the state (reverse them since they come in newest-first order)
      setMessages(prev => ({
        ...prev,
        [String(channelId)]: [...[...olderMessages].reverse(), ...(prev[String(channelId)] ?? [])],
      }));
    } catch (err) {
      console.error('Failed to load older messages:', err);
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  // When the scroll container is resized (e.g. on-screen keyboard opens),
  // keep the scroll position locked if user has scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      // If user scrolled away, maintain their scroll position
      if (userScrolledAway.current) {
        // Get current scroll position as a fraction of total scrollable height
        const scrollFraction = el.scrollTop / (el.scrollHeight - el.clientHeight);
        // After resize, reapply the same fraction
        requestAnimationFrame(() => {
          el.scrollTop = scrollFraction * (el.scrollHeight - el.clientHeight);
        });
      }
      // If at bottom, flexbox handles it naturally with column-reverse
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Handle visual viewport resize (keyboard show/hide on mobile)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onVVResize() {
      if (userScrolledAway.current) {
        const el = scrollRef.current;
        if (el) {
          const scrollFraction = el.scrollTop / (el.scrollHeight - el.clientHeight);
          requestAnimationFrame(() => {
            el.scrollTop = scrollFraction * (el.scrollHeight - el.clientHeight);
          });
        }
      }
    }
    vv.addEventListener('resize', onVVResize);
    return () => vv.removeEventListener('resize', onVVResize);
  }, []);

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
    (userId, username, userColor) => getMemberColor(guildIdForColor, userId, username, userColor),
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
      // Also reload channel permissions since roles affect permissions
      loadChannelPermissions(channel.guildId, channelId);
    }
  }, [rolesUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh member colors when a specific user's roles change (UserUpdated)
  useEffect(() => {
    if (!userUpdatedEvent || !isGuildChannel || !channel?.guildId) return;
    loadGuildMemberColors(channel.guildId, channelId);
  }, [userUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh icon when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent || !channel) return;
    if (String(channelUpdatedEvent.channelId) === String(channel.id)) {
      if (channel.type === 0) {
        const img = new Image();
        img.onload = () => setHasChannelIcon(true);
        img.onerror = () => setHasChannelIcon(false);
        img.src = getChannelIconUrl(channel.guildId, channel.id) + '?t=' + channelUpdatedEvent.ts;
      } else if (channel.type === 2) {
        const img = new Image();
        img.onload = () => setHasChannelIcon(true);
        img.onerror = () => setHasChannelIcon(false);
        img.src = getGroupChatIconUrl(channel.id) + '?t=' + channelUpdatedEvent.ts;
      }
    }
  }, [channelUpdatedEvent, channel]);

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

  // Close image context menu on outside click or Escape
  useEffect(() => {
    if (!imageCtxMenu) return;
    function onDown(e) {
      if (imageCtxRef.current && !imageCtxRef.current.contains(e.target)) setImageCtxMenu(null);
    }
    function onKey(e) { if (e.key === 'Escape') setImageCtxMenu(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [imageCtxMenu]);

  const handleContextMenu = useCallback((e, msg) => {
    if (msg._pending) return;
    e.preventDefault();
    // Clamp to viewport — menu is ~200px wide, ~160px tall
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 160);
    setCtxMenu({ x, y, msg });
    setCopiedCtx(null);
  }, []);

  const handleImageContextMenu = useCallback((e, imageUrl, filename, isModal = false, messageId = null) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 160);
    setImageCtxMenu({ x, y, imageUrl, filename, isModal, messageId });
    setCopiedImageCtx(null);
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
    // Mark this channel as actively viewed (clears its unread count)
    setActiveChannelId(channelId);
    // Reset message read tracking for the new channel
    lastMarkedReadIdRef.current = null;
    clearTimeout(markReadTimeoutRef.current);
    return () => {
      // When leaving the channel, clear active so new messages are counted
      setActiveChannelId(null);
      // Clear any pending scroll debounce
      clearTimeout(scrollLoadDebounceRef.current);
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setChannel(null);
    setOtherUser(null);
    setGuildOwnerId(null);
    setInput('');
    setSendError(null);
    setMentionPicker(null);
    setMentionData({ members: [], channels: [], roles: [] });
    userScrolledAway.current = false;
    
    // Reset pagination state for older messages
    // Start at offset 50 since initial load gets offset 0-49
    offsetRef.current = 50;
    hasMoreRef.current = true;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    lastLoadedHeightRef.current = 0;

    Promise.all([
      getChannel(channelId),
      getMessages(channelId, 50, 0),
    ]).then(([ch, msgs]) => {
      // Keep the correct sidebar active based on the channel type
      setActiveGuildId(ch.type === 0 ? String(ch.guildId) : null);
      // Register channel metadata for tiered unread resolution
      registerChannelMeta(channelId, { type: ch.type, guildId: ch.guildId ?? null });
      // Mark channel as read now that we've loaded messages
      markChannelRead(channelId);
      // Load permissions and member colors for guild channels
      if (ch.type === 0 && ch.guildId) {
        loadGuildPermissions(ch.guildId);
        loadChannelPermissions(ch.guildId, channelId);
        loadGuildMemberColors(ch.guildId, channelId);
        // Fetch guild info to get owner ID
        getGuild(ch.guildId).then(guild => {
          setGuildOwnerId(guild.ownerId);
        }).catch(console.error);
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
      // With flex-direction: column-reverse, the view naturally stays at the bottom.
      // No explicit scrolling needed.
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

  // Check if channel has an icon (guild or group chat)
  useEffect(() => {
    if (!channel) return;
    if (channel.type === 0) {
      // Guild channel icon
      const img = new Image();
      img.onload = () => setHasChannelIcon(true);
      img.onerror = () => setHasChannelIcon(false);
      img.src = getChannelIconUrl(channel.guildId, channel.id);
    } else if (channel.type === 2) {
      // Group chat icon
      const img = new Image();
      img.onload = () => setHasChannelIcon(true);
      img.onerror = () => setHasChannelIcon(false);
      img.src = getGroupChatIconUrl(channel.id);
    } else {
      setHasChannelIcon(false);
    }
  }, [channel]);

  // Refresh icon when channel is updated via signal
  useEffect(() => {
    if (!channelUpdatedEvent || !channel) return;
    if (String(channelUpdatedEvent.channelId) === String(channel.id)) {
      if (channel.type === 0) {
        const img = new Image();
        img.onload = () => setHasChannelIcon(true);
        img.onerror = () => setHasChannelIcon(false);
        img.src = getChannelIconUrl(channel.guildId, channel.id) + '?t=' + channelUpdatedEvent.ts;
      } else if (channel.type === 2) {
        const img = new Image();
        img.onload = () => setHasChannelIcon(true);
        img.onerror = () => setHasChannelIcon(false);
        img.src = getGroupChatIconUrl(channel.id) + '?t=' + channelUpdatedEvent.ts;
      }
    }
  }, [channelUpdatedEvent, channel]);

  // When typing indicator appears/disappears, no scroll handling needed
  // with flex-direction: column-reverse layout
  useEffect(() => {
    // Just mark that we're not scrolled away when typing indicator appears/disappears
    // This helps detect user activity at the bottom
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      userScrolledAway.current = false;
    }
  }, [typingUsers[String(channelId)]?.size]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Mark visible messages as read when user views them
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || channelMessages.length === 0) return;

    const markVisibleMessagesAsRead = () => {
      // Get all message elements
      const msgElements = scrollEl.querySelectorAll('[data-msgid]');
      if (msgElements.length === 0) return;

      let highestVisibleId = null;

      // Find the highest message ID that's at least partially visible
      for (const el of msgElements) {
        const rect = el.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        
        // Check if element is within the visible viewport (with some margin)
        if (rect.bottom > scrollRect.top && rect.top < scrollRect.bottom) {
          const msgId = el.getAttribute('data-msgid');
          if (msgId && !isNaN(msgId)) {
            const id = BigInt(msgId);
            if (highestVisibleId === null || id > highestVisibleId) {
              highestVisibleId = id;
            }
          }
        }
      }

      // If we found a visible message and it's higher than what we've already marked
      if (highestVisibleId !== null) {
        const lastMarked = lastMarkedReadIdRef.current ? BigInt(lastMarkedReadIdRef.current) : null;
        if (lastMarked === null || highestVisibleId > lastMarked) {
          // Debounce the API call to avoid too many requests
          clearTimeout(markReadTimeoutRef.current);
          markReadTimeoutRef.current = setTimeout(async () => {
            try {
              await markMessagesAsRead(String(channelId), String(highestVisibleId));
              lastMarkedReadIdRef.current = String(highestVisibleId);
            } catch (err) {
              console.warn('Failed to mark messages as read:', err);
            }
          }, 500); // 500ms debounce
        }
      }
    };

    // Track scroll and message changes to detect when new messages become visible
    scrollEl.addEventListener('scroll', markVisibleMessagesAsRead);
    markVisibleMessagesAsRead(); // Initial check

    return () => {
      scrollEl.removeEventListener('scroll', markVisibleMessagesAsRead);
      clearTimeout(markReadTimeoutRef.current);
    };
  }, [channelMessages, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea as content grows/shrinks
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px'; // 320px ≈ 20rem
  }, [input]);

  // Restore scroll position after loading older messages
  useLayoutEffect(() => {
    if (!scrollRestoreRef.current) return;
    
    const el = scrollRef.current;
    if (!el) return;
    
    // When messages are prepended to the top, the browser naturally keeps the user
    // viewing the same messages they were before - no scroll adjustment needed!
    // Just reset the loading state flags.
    
    scrollRestoreRef.current = null;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    isAdjustingScrollRef.current = false;
  }, [channelMessages]); // Runs after messages update

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

  // ── Typing indicator ────────────────────────────────────────────────────────

  function notifyTyping() {
    // Only send if the setting is enabled
    if (!sendTypingIndicators || !hubRef || !hubRef.current) return;
    
    const now = Date.now();
    // Throttle to max once every 2 seconds to reduce server load
    if (now - lastTypingNotifyRef.current < 2000) return;
    
    lastTypingNotifyRef.current = now;
    try {
      hubRef.current?.invoke('NotifyTyping', Number(channelId)).catch(e => {
        console.warn('Failed to notify typing:', e);
      });
    } catch (e) {
      console.warn('Failed to notify typing:', e);
    }
  }

  // ── Message send ─────────────────────────────────────────────────────────────

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && fileUploads.files.length === 0) || !currentUser) return;

    setSendError(null);

    // Check for invalid expiration times before attempting upload
    if (fileUploads.files.length > 0 && fileUploads.limits) {
      for (let i = 0; i < fileUploads.files.length; i++) {
        const expirationHours = fileUploads.fileExpirations?.[i];
        if (expirationHours !== null && !isUnlimited(fileUploads.limits.maxExpiryHours) && expirationHours > fileUploads.limits.maxExpiryHours) {
          setSendError(`File ${i + 1}: expiration time exceeds maximum (${fileUploads.limits.maxExpiryHours} hours)`);
          return;
        }
      }
    }

    // Upload files if present
    let uploadedFileIds = undefined;
    if (fileUploads.files.length > 0) {
      try {
        uploadedFileIds = await fileUploads.uploadAllFiles();
        if (uploadedFileIds === null) {
          // Upload failed, errors are displayed in the panel
          console.warn('[ChatView] File upload failed');
          return;
        }
      } catch (err) {
        console.error('[ChatView] Error uploading files:', err);
        setSendError(`Failed to upload files: ${err.message}`);
        return;
      }
    }

    // Build message content with file links if any
    let messageContent = text;
    if (uploadedFileIds && Array.isArray(uploadedFileIds) && uploadedFileIds.length > 0) {
      const filesBaseUrl = import.meta.env.VITE_SERBLE_FILES_API_URL ?? 'https://api.files.serble.net';
      const fileLinks = uploadedFileIds.map(id => `${filesBaseUrl}/files/${id}`).join('\n');
      messageContent = messageContent ? `${messageContent}\n\n${fileLinks}` : fileLinks;
    }

    setInput('');

    // Optimistic pending message — will be replaced by the NewMessage signal
    const tempId = `_pending_${Date.now()}_${Math.random()}`;
    const tempMsg = {
      id: tempId,
      channelId: Number(channelId),
      authorId: currentUser.id,
      content: messageContent,
      createdAt: new Date().toISOString(),
      _pending: true,
    };
    setMessages(p => ({
      ...p,
      [String(channelId)]: [...(p[String(channelId)] ?? []), tempMsg],
    }));
    // Reset the scroll-away flag and snap to bottom when user sends a message
    userScrolledAway.current = false;
    // Use requestAnimationFrame to ensure the DOM has updated before scrolling
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });

    try {
      await sendMessage(channelId, messageContent);
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

  const channelDisplayName = channel?.type === 1
    ? (otherUser?.username ?? '…')
    : (channel?.name ?? `Channel ${channelId}`);

  const channelIcon = channel?.type === 1 ? '👤' : channel?.type === 2 ? '👥' : '#';

  // ── Drag and drop ───────────────────────────────────────────────────────────

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragOver to false if we're leaving the entire input area
    if (e.target === e.currentTarget) {
      setDragOver(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    
    // Only accept files
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      fileUploads.addFiles(files);
    }
  }

  function handleFileInputChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      fileUploads.addFiles(e.target.files);
      // Reset input so the same file can be selected again
      e.target.value = '';
    }
  }

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
      <div 
        onDragOver={handleDragOver} 
        onDragLeave={handleDragLeave} 
        onDrop={handleDrop}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}
      >
        {/* Channel header */}
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0 0.75rem 0 1.25rem', borderBottom: '1px solid var(--border)',
          flexShrink: 0, background: 'var(--bg-base)',
        }}>
          {/* Hamburger – only shown on mobile */}
          {isMobile && (
            <button
              title="Open sidebar"
              onClick={openSidebar}
              style={{
                background: 'none', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
                padding: '0.25rem', marginRight: '0.15rem', flexShrink: 0,
              }}
            >☰</button>
          )}
          {/* Channel icon display */}
          {isGroupChannel && hasChannelIcon ? (
            // Group chat: show icon as avatar
            <img
              key={`header-group-icon-${channelId}-${channelUpdatedEvent?.ts || 0}`}
              src={getGroupChatIconUrl(channelId) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
              alt="Group icon"
              onError={() => setHasChannelIcon(false)}
              style={{
                width: 32, height: 32, borderRadius: '6px', flexShrink: 0,
                objectFit: 'cover',
              }}
            />
          ) : (
            <span style={{ fontSize: '1rem' }}>{channelIcon}</span>
          )}
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {/* Guild channel icon (if exists) */}
            {isGuildChannel && hasChannelIcon && (
              <img
                key={`header-channel-icon-${channelId}-${channelUpdatedEvent?.ts || 0}`}
                src={getChannelIconUrl(channel.guildId, channelId) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
                alt="Channel icon"
                onError={() => setHasChannelIcon(false)}
                style={{
                  width: 20, height: 20, borderRadius: '4px', flexShrink: 0,
                  objectFit: 'cover',
                }}
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {channelDisplayName}
            </span>
          </span>
          {isDmChannel && otherUser && !isMobile && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Direct Message</span>
          )}

          {/* Voice button - shown for DM, group, and voice-capable guild channels */}
          {(isDmChannel || isGroupChannel || (isGuildChannel && channel?.voiceCapable)) && (
            <HeaderBtn
              title={voiceChannelId === Number(channelId) ? 'Leave Voice' : 'Join Voice'}
              onClick={voiceChannelId === Number(channelId) ? leaveVoice : () => joinVoice(Number(channelId))}
              active={voiceChannelId === Number(channelId)}
              disabled={voiceBusy || voiceStatus === 'connecting'}
            >
              {voiceChannelId === Number(channelId) ? '🔊' : '🎙️'}
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

          <HeaderBtn title="Member List" active={showMembers} onClick={toggleMembers}>👥</HeaderBtn>
        </div>

        {/* Drag and drop overlay */}
        {dragOver && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(124, 58, 237, 0.15)',
              border: '2px dashed var(--accent)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              pointerEvents: 'none',
              backdropFilter: 'blur(1px)',
            }}
          >
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '1.2rem',
              color: 'var(--accent)',
              fontWeight: 600,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '2.5rem' }}>📎</div>
              <div>Drop files to upload</div>
            </div>
          </div>
        )}

        {/* Voice participants preview (below header buttons, above messages) */}
        {(isDmChannel || isGroupChannel || (isGuildChannel && channel?.voiceCapable)) && (
          <VoiceParticipantPreview channelId={channelId} compact={false} />
        )}

        {/* Messages area */}
        <div ref={scrollRef} onScroll={handleMessagesScroll} style={{ 
          flex: 1, 
          overflowY: 'auto', 
          paddingTop: '0.5rem',
          display: 'flex',
          flexDirection: 'column-reverse',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
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
                    guildId={guildIdForColor}
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
                  onImageContextMenu={handleImageContextMenu}
                  onUserClick={handleUserClick}
                  getColor={getColor}
                  mentionData={mentionData}
                  highlighted={highlightMsgId !== null && String(unit.msg.id) === highlightMsgId}
                  guildId={guildIdForColor}
                />
              );
            })}
            {/* Loading indicator when fetching older messages */}
            {loadingOlder && (
              <div style={{ 
                padding: '1rem', 
                textAlign: 'center', 
                color: 'var(--text-muted)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <div style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderTop: '2px solid var(--text-secondary)',
                  borderRadius: '50%',
                  animation: 'spin 0.6s linear infinite',
                }}></div>
                <span style={{ fontSize: '0.85rem' }}>Loading older messages...</span>
              </div>
            )}
            {/* Empty state message at the top (since we're reversed) */}
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
          </div>
        </div>

        {/* Typing indicator - between messages and input */}
        {typingUsers[String(channelId)]?.size > 0 && (() => {
          const filtered = new Set(
            Array.from(typingUsers[String(channelId)]).filter(uid => !isBlocked(uid))
          );
          return filtered.size > 0 ? (
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
              <TypingIndicator 
                users={filtered} 
                resolveUser={resolveUser}
              />
            </div>
          ) : null;
        })()}

        <div style={{ padding: '0 1rem 1.5rem', flexShrink: 0 }}>
          {/* Blocked-by-me banner — replaces the input entirely */}
          {isDmChannel && otherUser && isBlocked(otherUser.id) ? (
            <BlockedInputBanner username={otherUser.username} userId={otherUser.id} unblockUser={unblockUser} />
          ) : canSend ? (
          <>
            {/* File upload panel */}
            <FileUploadPanel 
              files={fileUploads.files}
              fileExpirations={fileUploads.fileExpirations}
              onFileExpirationChange={fileUploads.setFileExpiration}
              onRemoveFile={fileUploads.removeFile}
              uploading={fileUploads.uploading}
              errors={fileUploads.uploadErrors}
              maxExpiryHours={fileUploads.limits?.maxExpiryHours}
              noExpirySingleFileSize={fileUploads.limits?.noExpirySingleFileSize}
            />
            
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
              
              {/* Drag overlay */}
              {dragOver && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(124, 58, 237, 0.1)',
                  border: '2px dashed var(--accent)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}>
                  <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
                    Drop files to upload
                  </div>
                </div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-input)', borderRadius: '8px', padding: '0 0.75rem' }}>
                {/* File upload button */}
                <button
                  type="button"
                  onClick={() => fileUploads.fileInputRef.current?.click()}
                  disabled={fileUploads.uploading}
                  title="Attach files"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: fileUploads.uploading ? 'var(--text-muted)' : 'var(--text-secondary)',
                    cursor: fileUploads.uploading ? 'not-allowed' : 'pointer',
                    fontSize: '1.1rem',
                    padding: '0.5rem 0.25rem',
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '1.5rem',
                    opacity: fileUploads.uploading ? 0.5 : 1,
                  }}
                  className={!fileUploads.uploading ? 'hov-color-accent' : undefined}
                >
                  📎
                </button>
                
                {/* Hidden file input */}
                <input
                  ref={fileUploads.fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />
                
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
                  onChange={e => { 
                    setInput(e.target.value); 
                    setSendError(null); 
                    detectMention(e.target.value, e.target.selectionStart);
                    notifyTyping();
                  }}
                  onKeyDown={handleKeyDown}
                  onKeyUp={e => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                      detectMention(input, e.target.selectionStart);
                    }
                  }}
                  onClick={e => detectMention(input, e.target.selectionStart)}
                  maxLength={16384}
                />
                {(input.trim() || fileUploads.files.length > 0) && (
                  <button type="submit"
                    disabled={fileUploads.uploading}
                    style={{ background: fileUploads.uploading ? 'var(--bg-secondary)' : 'var(--accent)', border: 'none', borderRadius: '4px', cursor: fileUploads.uploading ? 'not-allowed' : 'pointer', color: '#fff', padding: '0.3rem 0.55rem', fontSize: '0.9rem', marginLeft: '0.5rem', marginBottom: '0.875rem', lineHeight: 1, transition: 'background 0.15s', flexShrink: 0, opacity: fileUploads.uploading ? 0.6 : 1 }}
                    className={!fileUploads.uploading ? 'hov-accent' : undefined}
                  >{fileUploads.uploading ? '⏳' : '↵'}</button>
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
                copyToClipboard(ctxMenu.msg.content).catch(err => console.error('Failed to copy text:', err));
                setCopiedCtx('text');
                setTimeout(() => { setCopiedCtx(null); setCtxMenu(null); }, 1000);
              }} />
            <CtxBtn icon="🔗" label="Copy Message Link"
              copied={copiedCtx === 'link'}
              onClick={() => {
                const url = `${FRONTEND_URL}/app/channel/${ctxMenu.msg.channelId}?message=${ctxMenu.msg.id}`;
                copyToClipboard(url).catch(err => console.error('Failed to copy message link:', err));
                setCopiedCtx('link');
                setTimeout(() => { setCopiedCtx(null); setCtxMenu(null); }, 1000);
              }} />
            <CtxBtn icon="🪪" label="Copy Message ID"
              copied={copiedCtx === 'id'}
              onClick={() => {
                copyToClipboard(String(ctxMenu.msg.id)).catch(err => console.error('Failed to copy message ID:', err));
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

        {/* Image context menu */}
        {imageCtxMenu && createPortal(
          <div ref={imageCtxRef} style={{ position: 'fixed', zIndex: 99999, top: imageCtxMenu.y, left: imageCtxMenu.x, background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.3rem', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 200 }}>
            {/* If message context (not modal), show message options first */}
            {!imageCtxMenu.isModal && imageCtxMenu.messageId && (
              <>
                <CtxBtn icon="📋" label="Copy Text"
                  copied={copiedImageCtx === 'text'}
                  onClick={() => {
                    const msg = messages[String(imageCtxMenu.messageId)]?.find(m => m.id === imageCtxMenu.messageId);
                    if (msg) {
                      navigator.clipboard.writeText(msg.content);
                      setCopiedImageCtx('text');
                      setTimeout(() => { setCopiedImageCtx(null); setImageCtxMenu(null); }, 1000);
                    }
                  }} />
                <CtxBtn icon="🔗" label="Copy Message Link"
                  copied={copiedImageCtx === 'link'}
                  onClick={() => {
                    const msg = messages[String(imageCtxMenu.messageId)]?.find(m => m.id === imageCtxMenu.messageId);
                    if (msg) {
                      const url = `${FRONTEND_URL}/app/channel/${msg.channelId}?message=${msg.id}`;
                      navigator.clipboard.writeText(url);
                      setCopiedImageCtx('link');
                      setTimeout(() => { setCopiedImageCtx(null); setImageCtxMenu(null); }, 1000);
                    }
                  }} />
                <div style={{ height: 1, background: 'var(--border)', margin: '0.25rem 0' }} />
              </>
            )}
            
            {/* Image-specific options */}
            <CtxBtn icon="🔗" label="Copy Image Link"
              copied={copiedImageCtx === 'image-link'}
              onClick={() => {
                copyToClipboard(imageCtxMenu.imageUrl).catch(err => console.error('Failed to copy image link:', err));
                setCopiedImageCtx('image-link');
                setTimeout(() => { setCopiedImageCtx(null); setImageCtxMenu(null); }, 1000);
              }} />
            <CtxBtn icon="🌐" label="Open Image"
              onClick={() => {
                window.open(imageCtxMenu.imageUrl, '_blank');
                setImageCtxMenu(null);
              }} />
            <CtxBtn icon="📋" label="Copy Image"
              copied={copiedImageCtx === 'image'}
              onClick={() => {
                fetch(imageCtxMenu.imageUrl)
                  .then(res => res.blob())
                  .then(blob => {
                    // Try Electron clipboard first, then fall back to web API
                    if (window.electron?.copyToClipboard) {
                      // For Electron, we need to use a workaround since Electron's clipboard doesn't handle binary data directly
                      // Convert blob to data URL and use the web API
                      const reader = new FileReader();
                      reader.onload = () => {
                        // Try web clipboard API with blob
                        if (navigator.clipboard?.write) {
                          navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                          setCopiedImageCtx('image');
                          setTimeout(() => { setCopiedImageCtx(null); setImageCtxMenu(null); }, 1000);
                        } else {
                          console.error('Clipboard API not available');
                          setImageCtxMenu(null);
                        }
                      };
                      reader.readAsDataURL(blob);
                    } else {
                      // Web environment - use standard clipboard API
                      navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                      setCopiedImageCtx('image');
                      setTimeout(() => { setCopiedImageCtx(null); setImageCtxMenu(null); }, 1000);
                    }
                  })
                  .catch(err => {
                    console.error('Failed to copy image:', err);
                    setImageCtxMenu(null);
                  });
              }} />
            <CtxBtn icon="💾" label="Save Image"
              onClick={() => {
                const a = document.createElement('a');
                a.href = imageCtxMenu.imageUrl;
                a.download = imageCtxMenu.filename || 'image';
                a.click();
                setImageCtxMenu(null);
              }} />
          </div>,
          document.body
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

      {channel && (
        isMobile ? (
          <>
            {/* Mobile: backdrop — only visible when panel is open */}
            {showMembers && (
              <div
                onClick={toggleMembers}
                style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,0.6)' }}
              />
            )}
            {/* Mobile: slide-in drawer from the right — always mounted so transition works */}
            <div style={{
              position: 'fixed', top: 0, right: 0,
              height: 'var(--app-height, 100dvh)',
              zIndex: 200,
              transform: showMembers ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.25s ease',
              willChange: 'transform',
            }}>
              <MemberList
                channelId={channelId}
                guildId={isGuildChannel ? channel.guildId : null}
                ownerId={isGuildChannel ? guildOwnerId : groupChat?.ownerId ?? null}
                refreshTick={memberRefreshTick}
                style={{ width: 'min(85vw, 320px)', height: '100%' }}
              />
            </div>
          </>
        ) : (
          /* Desktop: plain flex sibling — only render when open */
          showMembers && (
            <MemberList
              channelId={channelId}
              guildId={isGuildChannel ? channel.guildId : null}
              ownerId={isGuildChannel ? guildOwnerId : groupChat?.ownerId ?? null}
              refreshTick={memberRefreshTick}
            />
          )
        )
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
