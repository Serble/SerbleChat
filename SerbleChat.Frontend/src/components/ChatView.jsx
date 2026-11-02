import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import { getMessages, getMessagesAt, sendMessage, getChannel, deleteMessage, editMessage, leaveOrDeleteGroupChat,
         getGuildMembers, getGuildRoles, getGuildChannels, getChannelMembers,
         getChannelIconUrl, getGroupChatIconUrl, getGuild } from '../api.js';
import UserPopout from './UserPopout.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import VoiceParticipantPreview from './VoiceParticipantPreview.jsx';
import PollCreateModal from './poll/PollCreateModal.jsx';
import ChatHeader from './chat/ChatHeader.jsx';
import Composer, { BlockedInputBanner, NoPermissionNotice } from './chat/Composer.jsx';
import MessageList, { MessageListSkeleton, captureScrollAnchor } from './chat/MessageList.jsx';
import { PAGE_SIZE, MAX_WINDOW, realMessages, prependOlder, appendNewer, reinsert, aroundFlags } from './chat/messageWindow.js';
import { MessageContextMenu, ImageContextMenu } from './chat/MessageMenus.jsx';
import TypingIndicator from './chat/TypingIndicator.jsx';
import SearchPanel from './chat/SearchPanel.jsx';
import { useFileUploads } from './chat/FileUploadPanel.jsx';
import { isUnlimited } from './chat/utils.js';
import { AttachmentIcon } from '../icons.jsx';
import { withQuery } from '../imageVersions.js';

// After a failed page fetch, wait this long before scrolling can trigger another attempt
const PAGE_RETRY_MS = 3000;

const EMPTY_MENTION_DATA = { members: [], channels: [], roles: [] };

/**
 * Check whether an image URL loads; calls `onResult(bool)` unless cancelled.
 * Returns a cancel function so a slow probe can't report for a channel we've left.
 */
function probeImage(url, onResult) {
  let cancelled = false;
  const img = new Image();
  img.onload = () => { if (!cancelled) onResult(true); };
  img.onerror = () => { if (!cancelled) onResult(false); };
  img.src = url;
  return () => { cancelled = true; };
}

/** Does this drag carry files (as opposed to e.g. selected text)? */
function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export default function ChatView() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, dmChannels, groupChats, messages, setMessages, holdLiveMessages, releaseLiveMessages, resolveUser, peekUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent, userUpdatedEvent, loadChannelPermissions, getMyChannelPerms, isBlocked, unblockUser, setActiveChannelId, markChannelRead, registerChannelMeta, channelUpdatedEvent, typingUsers, rememberMessagePolls, syncGeneration } = useApp();
  const { blockedMessageMode } = useClientOptions() ?? { blockedMessageMode: 'masked' };
  const { isMobile } = useMobile() ?? { isMobile: false };
  const [input, setInput]           = useState('');
  const [sendError, setSendError]   = useState(null); // string | null
  const [channel, setChannel]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [otherUser, setOtherUser]   = useState(null);
  const [guildOwnerId, setGuildOwnerId] = useState(null);
  const [hasChannelIcon, setHasChannelIcon] = useState(false);
  const [ctxMenu, setCtxMenu]       = useState(null); // { x, y, msg, key }
  const [popout,  setPopout]        = useState(null);
  const [showMembers, setShowMembers] = useState(
    () => sessionStorage.getItem('memberPanelOpen') !== 'false'
  );
  const [memberRefreshTick, setMemberRefreshTick] = useState(0);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [leaveBusy, setLeaveBusy]   = useState(false);
  // Mention autocomplete data for the composer and mention chips
  const [mentionData, setMentionData] = useState(EMPTY_MENTION_DATA);

  // File uploads
  const fileUploads = useFileUploads();
  const [dragOver, setDragOver] = useState(false);

  // Message editing
  const [editingMsgId, setEditingMsgId] = useState(null);

  // Image context menu
  const [imageCtxMenu, setImageCtxMenu] = useState(null); // { x, y, imageUrl, filename, msg, key }

  // The loaded window of history (see chat/messageWindow.js). hasOlder/hasNewer mirror windowRef for rendering:
  // hasNewer means the window doesn't reach the present, and live messages are held instead of appended.
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  // 'older' | 'newer' while a failed page fetch at that end is cooling down; clearing it lets the list retry
  const [pageError, setPageError] = useState(null);
  // Channel load state: { channelId }. Replaced on every channel change, so channel-level requests detect staleness.
  const historyRef = useRef(null);
  // Window state: { hasOlder, hasNewer, loadingOlder, loadingNewer, retryAt }. Replaced whenever the whole
  // window is (a jump), so page requests started against the old one are dropped when they land.
  const windowRef = useRef(null);
  // Bumped per window replacement, so only the latest of overlapping jumps applies
  const replaceSeqRef = useRef(0);
  // True while a window replacement is in flight
  const replacingRef = useRef(false);
  // How MessageList should scroll once the next messages change lands: a captured anchor to hold in place, or
  // { type: 'bottom' }. Set right before the change, so the list can apply it before the browser paints.
  const scrollIntentRef = useRef(null);

  // Message search panel. On desktop it takes the member list's place while open.
  const [searchOpen, setSearchOpen] = useState(false);
  // Bumped to (re)focus the search box, e.g. Ctrl+F while the panel is already open
  const [searchFocusToken, setSearchFocusToken] = useState(0);

  function toggleMembers() {
    if (searchOpen && !isMobile) {
      // The member button while searching swaps the panel back to the member list
      setSearchOpen(false);
      if (showMembers) return;
    }
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }

  function openSearch() {
    setSearchOpen(true);
    setSearchFocusToken(t => t + 1);
  }

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (!isMobile) inputRef.current?.focus();
  }, [isMobile]);

  // Ctrl+F (Cmd+F) searches this channel instead of the page. Left alone while a modal is open.
  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key?.toLowerCase() !== 'f') return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openSearch();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  const channelMessages = messages[String(channelId)] ?? [];
  // The list as last rendered, for page requests deciding what to fetch and whether to trim
  const channelMessagesRef = useRef(channelMessages);
  channelMessagesRef.current = channelMessages;

  /** Which end's page fetch failed: show it, and let scrolling retry once the cool-down is over. */
  function notePageError(w, end) {
    w.retryAt = Date.now() + PAGE_RETRY_MS;
    if (windowRef.current !== w) return;
    setPageError(end);
    // The user may already be at that end, where no scroll event will come to retry
    setTimeout(() => { if (windowRef.current === w) setPageError(null); }, PAGE_RETRY_MS);
  }

  /**
   * Fetch the page before the oldest loaded message. Returns false (without fetching) when there's nothing
   * older, a fetch is already running, the window is being replaced, or a failed fetch is cooling down.
   */
  function loadOlderMessages() {
    const w = windowRef.current;
    // The channelId check covers the render between a channel switch and its reset effect
    if (!w || historyRef.current?.channelId !== String(channelId)) return false;
    if (!w.hasOlder || w.loadingOlder || Date.now() < w.retryAt) return false;
    fetchOlderPage(w);
    return true;
  }

  async function fetchOlderPage(w) {
    const key = String(channelId);
    const oldest = realMessages(channelMessagesRef.current)[0];
    if (!oldest) return;
    w.loadingOlder = true;
    setLoadingOlder(true);
    try {
      const page = await getMessagesAt(key, { before: oldest.id }, PAGE_SIZE);
      if (windowRef.current !== w) return;
      rememberMessagePolls(page);
      w.hasOlder = page.length === PAGE_SIZE;
      // Past the cap, drop the newest end. Pending sends belong at the very end, so never trim while there are any.
      const current = channelMessagesRef.current;
      const trim = !current.some(m => m._pending) && realMessages(current).length + page.length > MAX_WINDOW;
      if (trim && !w.hasNewer) {
        // The window no longer reaches the present: hold live messages from here on
        w.hasNewer = true;
        holdLiveMessages(key);
      }
      scrollIntentRef.current = captureScrollAnchor(scrollRef.current);
      setMessages(prev => ({ ...prev, [key]: prependOlder(prev[key] ?? [], page, trim) }));
      setHasOlder(w.hasOlder);
      setHasNewer(w.hasNewer);
    } catch (err) {
      console.error('Failed to load older messages:', err);
      notePageError(w, 'older');
    } finally {
      w.loadingOlder = false;
      if (windowRef.current === w) setLoadingOlder(false);
    }
  }

  /** The page after the newest loaded message, while the window doesn't reach the present. Same contract as above. */
  function loadNewerMessages() {
    const w = windowRef.current;
    if (!w || historyRef.current?.channelId !== String(channelId)) return false;
    if (!w.hasNewer || w.loadingNewer || Date.now() < w.retryAt) return false;
    fetchNewerPage(w);
    return true;
  }

  async function fetchNewerPage(w) {
    const key = String(channelId);
    const real = realMessages(channelMessagesRef.current);
    const newest = real[real.length - 1];
    if (!newest) return;
    w.loadingNewer = true;
    setLoadingNewer(true);
    try {
      const page = await getMessagesAt(key, { after: newest.id }, PAGE_SIZE);
      if (windowRef.current !== w) return;
      rememberMessagePolls(page);
      const trim = real.length + page.length > MAX_WINDOW;
      if (trim) w.hasOlder = true;
      // A short page means we've caught up. Anything sent since that query ran was held: merge it in,
      // in the same update, and go back to appending live messages.
      let held = [];
      if (page.length < PAGE_SIZE) {
        w.hasNewer = false;
        held = releaseLiveMessages(key);
      }
      scrollIntentRef.current = captureScrollAnchor(scrollRef.current);
      setMessages(prev => ({ ...prev, [key]: appendNewer(prev[key] ?? [], [...page, ...held], trim) }));
      setHasOlder(w.hasOlder);
      setHasNewer(w.hasNewer);
      if (!w.hasNewer) markChannelRead(channelId);
    } catch (err) {
      console.error('Failed to load newer messages:', err);
      notePageError(w, 'newer');
    } finally {
      w.loadingNewer = false;
      if (windowRef.current === w) setLoadingNewer(false);
    }
  }

  /** Fetch a fresh window: the latest page (around = null) or the one centred on a message. */
  async function fetchWindow(around) {
    if (around == null) {
      const page = await getMessages(channelId, PAGE_SIZE, 0);
      return { page, hasOlder: page.length === PAGE_SIZE, hasNewer: false };
    }
    const page = await getMessagesAt(channelId, { around }, PAGE_SIZE);
    return { page, ...aroundFlags(page, around) };
  }

  /**
   * Show a freshly fetched window in place of the current one. Live messages must have been held since
   * before the fetch: they're merged in if the window reaches the present, and held on otherwise.
   */
  function applyWindow({ page, hasOlder: older, hasNewer: newer }, intent) {
    const key = String(channelId);
    const w = { hasOlder: older, hasNewer: newer, loadingOlder: false, loadingNewer: false, retryAt: 0 };
    windowRef.current = w;
    let held = releaseLiveMessages(key);
    if (newer) {
      // Those belong past the end of this window; paging forward fetches them
      held = [];
      holdLiveMessages(key);
    }
    rememberMessagePolls(page);
    scrollIntentRef.current = intent;
    setMessages(prev => {
      // Pending sends only make sense at the present
      const pending = newer ? [] : (prev[key] ?? []).filter(m => m._pending);
      return { ...prev, [key]: appendNewer(pending, [...page, ...held], false) };
    });
    setHasOlder(older);
    setHasNewer(newer);
    setLoadingOlder(false);
    setLoadingNewer(false);
    setPageError(null);
    if (!newer) markChannelRead(channelId);
  }

  /**
   * Replace the window with the present (around = null, scrolled to the bottom) or with the history around a
   * message. Resolves true once it's in place, false if it failed or a later replacement superseded it.
   */
  async function replaceWindow(around) {
    const key = String(channelId);
    const history = historyRef.current;
    const prev = windowRef.current;
    if (!prev || history?.channelId !== key) return false;
    const seq = ++replaceSeqRef.current;
    replacingRef.current = true;
    // A stand-in with both ends busy: no new page fetches start, and ones in flight are dropped when they land
    windowRef.current = { ...prev, loadingOlder: true, loadingNewer: true };
    setLoadingOlder(false);
    setLoadingNewer(false);
    holdLiveMessages(key);
    try {
      const result = await fetchWindow(around);
      if (replaceSeqRef.current !== seq || historyRef.current !== history) return false;
      applyWindow(result, around == null ? { type: 'bottom' } : null);
      return true;
    } catch (err) {
      console.error('Failed to load messages:', err);
      if (replaceSeqRef.current === seq && historyRef.current === history) {
        windowRef.current = { ...prev, loadingOlder: false, loadingNewer: false, retryAt: 0 };
        if (!prev.hasNewer) {
          // We were at the present: put back what arrived during the failed fetch
          const held = releaseLiveMessages(key);
          if (held.length > 0) setMessages(p => ({ ...p, [key]: appendNewer(p[key] ?? [], held, false) }));
        }
      }
      return false;
    } finally {
      if (replaceSeqRef.current === seq) replacingRef.current = false;
    }
  }

  const loadAround = useCallback(id => replaceWindow(id), [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Go back to the newest messages. Only fetches when the window doesn't already reach them. */
  async function goToPresent() {
    // During a jump the window is about to move, so fetch the present even if the current one reaches it
    if (!windowRef.current?.hasNewer && !replacingRef.current) return true;
    return replaceWindow(null);
  }

  // Derive group chat info
  const isGroupChannel = channel?.type === 2;
  const isGuildChannel = channel?.type === 0;
  const isDmChannel = channel?.type === 1;
  const groupChat = isGroupChannel
    ? groupChats.find(g => String(g.channelId) === String(channelId))
    : null;
  const isOwner = groupChat?.ownerId === currentUser?.id;

  // Permission checks for guild channels
  // PermissionState: 0 = Allow, 1 = Deny, 2 = Inherit
  // Prefer channel-level resolved perms (includes overrides); fall back to guild-level perms
  const myGuildPerms  = isGuildChannel ? (getMyChannelPerms(channelId) ?? getMyPerms(channel?.guildId)) : null;
  const isAdmin       = myGuildPerms?.administrator === 0;
  const canSend       = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.sendMessages === 0;
  const canManageMsgs = !isGuildChannel || !myGuildPerms || isAdmin || myGuildPerms.manageMessages === 0;
  // Polls need Send Messages too. Perms from before polls existed lack the key; the server decides then.
  const canCreatePolls = canSend && (!isGuildChannel || !myGuildPerms || isAdmin || (myGuildPerms.createPolls ?? 0) === 0);

  // Memoized so MessageBubble (which is React.memo'd) doesn't re-render just because
  // the parent re-renders with an otherwise unchanged getColor inline lambda.
  const guildIdForColor = isGuildChannel ? channel?.guildId : null;
  const getColor = useCallback(
    (userId, username, userColor) => getMemberColor(guildIdForColor, userId, username, userColor),
    [getMemberColor, guildIdForColor]
  );

  // Typing users for this channel, minus blocked users. Memoized so TypingIndicator
  // (React.memo) only re-resolves names when the set actually changes.
  const channelTypingUsers = typingUsers[String(channelId)];
  const visibleTypingUsers = useMemo(() => {
    if (!channelTypingUsers?.size) return null;
    const filtered = new Set(Array.from(channelTypingUsers).filter(uid => !isBlocked(uid)));
    return filtered.size > 0 ? filtered : null;
  }, [channelTypingUsers, isBlocked]);

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

  // ── Menus / popouts ─────────────────────────────────────────────────────────
  // Each open gets a fresh `key` so the menu remounts (resetting its "Copied!" state)
  // when the user right-clicks something else while one is already open.

  const handleContextMenu = useCallback((e, msg) => {
    if (msg._pending) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, msg, key: Date.now() });
  }, []);

  // `msg` is set when opened from an image in a message, null when opened from the fullscreen viewer
  const handleImageContextMenu = useCallback((e, imageUrl, filename, isModal = false, msg = null) => {
    e.preventDefault();
    setImageCtxMenu({ x: e.clientX, y: e.clientY, imageUrl, filename, msg: isModal ? null : msg, key: Date.now() });
  }, []);

  const handleUserClick = useCallback((e, userId, username) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout({ userId, username: username ?? userId, anchorRect: rect });
  }, []);

  // "More" button in a message's hover toolbar: open the same menu, anchored under the button
  const handleMoreClick = useCallback((e, msg) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCtxMenu({ x: rect.left, y: rect.bottom + 4, msg, key: Date.now() });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const closeImageCtxMenu = useCallback(() => setImageCtxMenu(null), []);

  // ── Delete / edit ───────────────────────────────────────────────────────────

  // Stable so the memoized MessageBubbles (hover toolbar) don't re-render
  const handleDelete = useCallback(async (msg) => {
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
      // Put it back where it was (the window may have moved on meanwhile, in which case it's left out)
      setMessages(p => ({ ...p, [String(msg.channelId)]: reinsert(p[String(msg.channelId)] ?? [], msg) }));
    }
  }, [setMessages]);

  const handleStartEdit = useCallback((msg) => {
    setEditingMsgId(msg.id);
    setCtxMenu(null);
  }, []);

  // Stable so the memoized MessageBubbles don't all re-render on every keystroke
  const handleEditSave = useCallback(async (msg, content) => {
    const newContent = content.trim();
    setEditingMsgId(null);
    if (!newContent) return;

    // Optimistically update the message
    setMessages(p => ({
      ...p,
      [String(msg.channelId)]: (p[String(msg.channelId)] ?? []).map(m =>
        m.id === msg.id ? { ...m, content: newContent, editedAt: new Date().toISOString() } : m
      ),
    }));

    try {
      await editMessage(msg.channelId, msg.id, newContent);
    } catch (err) {
      console.error('Edit failed:', err);
      // The server will send a MessageEdited event with the authoritative state,
      // or the optimistic update will stand if the server later reconnects.
    }
  }, [setMessages]);

  const handleEditCancel = useCallback(() => setEditingMsgId(null), []);

  /** Up-arrow in an empty composer: edit your most recent message. Returns true if handled. */
  function editLastOwnMessage() {
    const ownMessages = channelMessages.filter(m => !m._pending && !m.poll && m.authorId === currentUser?.id);
    if (ownMessages.length === 0) return false;
    setEditingMsgId(ownMessages[ownMessages.length - 1].id);
    return true;
  }

  // ── Channel load ────────────────────────────────────────────────────────────

  useEffect(() => {
    // Mark this channel as actively viewed (clears its unread count)
    setActiveChannelId(channelId);
    return () => {
      // When leaving the channel, clear active so new messages are counted
      setActiveChannelId(null);
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setChannel(null);
    setOtherUser(null);
    setGuildOwnerId(null);
    setInput('');
    setSendError(null);
    setMentionData(EMPTY_MENTION_DATA);
    setEditingMsgId(null);
    setCtxMenu(null);
    setImageCtxMenu(null);
    setPopout(null);
    setDragOver(false);
    setShowCreatePoll(false);
    // Attachments belong to the draft, which is discarded on channel switch too
    fileUploads.clearFiles();

    // Fresh channel and window state; no paging until the first window tells us what's there
    const history = { channelId: String(channelId) };
    historyRef.current = history;
    windowRef.current = null;
    replaceSeqRef.current++;
    replacingRef.current = false;
    scrollIntentRef.current = null;
    setLoadingOlder(false);
    setLoadingNewer(false);
    setHasOlder(false);
    setHasNewer(false);
    setPageError(null);

    // Opening a message link: load the history around it straight away rather than the present first
    const linked = jumpToIdRef.current;
    // Hold live messages until the window is in place, so one arriving mid-request is neither lost nor doubled
    holdLiveMessages(channelId);
    Promise.all([
      getChannel(channelId),
      fetchWindow(linked && /^\d+$/.test(linked) ? linked : null),
    ]).then(([ch, win]) => {
      // Ignore responses for a channel we've already navigated away from
      if (historyRef.current !== history) return;
      // Keep the correct sidebar active based on the channel type
      setActiveGuildId(ch.type === 0 ? String(ch.guildId) : null);
      // Register channel metadata for tiered unread resolution
      registerChannelMeta(channelId, { type: ch.type, guildId: ch.guildId ?? null });
      // Mark channel as read now that we've loaded messages
      markChannelRead(channelId);
      const isCurrent = () => historyRef.current === history;
      // Load permissions and member colors for guild channels
      if (ch.type === 0 && ch.guildId) {
        loadGuildPermissions(ch.guildId);
        loadChannelPermissions(ch.guildId, channelId);
        loadGuildMemberColors(ch.guildId, channelId);
        // Fetch guild info to get owner ID
        getGuild(ch.guildId).then(guild => {
          if (isCurrent()) setGuildOwnerId(guild.ownerId);
        }).catch(console.error);
        // Load mention autocomplete data
        Promise.all([
          getGuildMembers(ch.guildId),
          getGuildRoles(ch.guildId),
          getGuildChannels(ch.guildId),
        ]).then(([members, roles, channels]) => {
          if (!isCurrent()) return;
          setMentionData({
            members:  (members  ?? []).map(m => ({ id: m.user?.id ?? m.id, username: m.user?.username ?? m.username, color: m.color ?? null })),
            channels: (channels ?? []).map(c => ({ id: String(c.id), name: c.name })),
            roles:    (roles    ?? []).map(r => ({ id: String(r.id), name: r.name, color: r.color || null })),
          });
        }).catch(console.error);
      } else {
        // DM / group: load channel members for user-mention autocomplete
        getChannelMembers(channelId).then(members => {
          if (!isCurrent()) return;
          setMentionData({
            members:  (members ?? []).map(m => ({ id: m.id, username: m.username, color: null })),
            channels: [],
            roles:    [],
          });
        }).catch(console.error);
      }
      setChannel(ch);
      applyWindow(win, null);
      setLoading(false);
    }).catch(e => {
      if (historyRef.current !== history) return;
      console.error(e);
      setLoading(false);
    });
    return () => {
      // Leaving the channel: stop holding its live messages (the next visit loads a fresh window anyway)
      releaseLiveMessages(channelId);
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the hub was down, messages sent, edited or deleted meanwhile were missed: refetch the newest page and
  // put it in place of what we had from that point on. Older pages are kept when they still join up with it.
  // Away from the present there's nothing to put in place: paging forward fetches what was missed.
  useEffect(() => {
    if (!syncGeneration || !channelId) return;
    const key = String(channelId);
    const history = historyRef.current;
    const w = windowRef.current;
    if (!w || w.hasNewer || replacingRef.current) return;
    let cancelled = false;
    // Hold live messages meanwhile, so ones arriving during the request aren't overwritten by the older page
    holdLiveMessages(key);
    const isCurrent = () => !cancelled && historyRef.current === history && windowRef.current === w;
    getMessages(channelId, PAGE_SIZE, 0).then(msgs => {
      if (!isCurrent()) return;
      const held = releaseLiveMessages(key);
      const latest = [...msgs].reverse();
      const oldestLatest = latest[0]?.id;
      // No overlap means more than a page arrived: what we had no longer joins up, so start from the newest page
      const joins = oldestLatest != null && channelMessagesRef.current.some(m => !m._pending && m.id >= oldestLatest);
      rememberMessagePolls(msgs);
      setMessages(p => {
        const have = p[key] ?? [];
        const kept = joins ? have.filter(m => !m._pending && m.id < oldestLatest) : [];
        return { ...p, [key]: appendNewer([...kept, ...latest, ...have.filter(m => m._pending)], held, false) };
      });
      if (!joins) {
        w.hasOlder = msgs.length === PAGE_SIZE;
        setHasOlder(w.hasOlder);
      }
      markChannelRead(channelId);
    }).catch(e => {
      console.warn('Resync of channel messages failed:', e);
      if (!isCurrent()) return;
      const held = releaseLiveMessages(key);
      if (held.length > 0) setMessages(p => ({ ...p, [key]: appendNewer(p[key] ?? [], held, false) }));
    });
    return () => { cancelled = true; };
  }, [syncGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve other user for DM channel header
  useEffect(() => {
    if (!channel || channel.type !== 1 || !currentUser) return;
    const dm = dmChannels.find(d => String(d.channelId) === String(channelId));
    if (!dm) return;
    const otherId = dm.user1Id === currentUser.id ? dm.user2Id : dm.user1Id;
    let cancelled = false;
    resolveUser(otherId).then(u => { if (!cancelled) setOtherUser(u); });
    return () => { cancelled = true; };
  }, [channel, dmChannels, currentUser, channelId, resolveUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if channel has an icon (guild or group chat)
  useEffect(() => {
    if (!channel) return;
    if (channel.type === 0) return probeImage(getChannelIconUrl(channel.guildId, channel.id), setHasChannelIcon);
    if (channel.type === 2) return probeImage(getGroupChatIconUrl(channel.id), setHasChannelIcon);
    setHasChannelIcon(false);
  }, [channel]);

  // Re-check the icon when this channel is updated via signal (cache-busted)
  useEffect(() => {
    if (!channelUpdatedEvent || !channel) return;
    if (String(channelUpdatedEvent.channelId) !== String(channel.id)) return;
    const bust = 't=' + channelUpdatedEvent.ts;
    if (channel.type === 0) return probeImage(withQuery(getChannelIconUrl(channel.guildId, channel.id), bust), setHasChannelIcon);
    if (channel.type === 2) return probeImage(withQuery(getGroupChatIconUrl(channel.id), bust), setHasChannelIcon);
  }, [channelUpdatedEvent, channel]);

  // ?message=<id> (from a message link) asks the list to scroll to and highlight that message
  const jumpToId = searchParams.get('message');
  const jumpToIdRef = useRef(jumpToId);
  jumpToIdRef.current = jumpToId;
  // A search result: jump the list to it (the same way a message link does)
  const handleSearchJump = useCallback((msg) => {
    setSearchParams(p => { p.set('message', String(msg.id)); return p; }, { replace: true });
    // On phones the results cover the chat
    if (isMobile) setSearchOpen(false);
  }, [setSearchParams, isMobile]);

  const handleJumpHandled = useCallback(() => {
    // Remove the param without navigating, so the same link can be followed again
    setSearchParams(p => { p.delete('message'); return p; }, { replace: true });
  }, [setSearchParams]);

  // Focus input when channel changes or once loading finishes
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [channelId, loading]);

  // ── Message send ─────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if ((!text && fileUploads.files.length === 0) || !currentUser) return;
    // Enter while a previous send is still uploading would upload the same files again
    if (fileUploads.uploading) return;

    setSendError(null);

    // Reading older history: go back to the present first, so the sent message shows up where it belongs
    if (windowRef.current?.hasNewer || replacingRef.current) await goToPresent();

    // Check for invalid expiration times before attempting upload
    const { limits } = fileUploads;
    if (fileUploads.files.length > 0 && limits && !isUnlimited(limits.maxExpiryHours)) {
      const badIdx = fileUploads.fileExpirations.findIndex(h => h !== null && h > limits.maxExpiryHours);
      if (badIdx !== -1) {
        setSendError(`File ${badIdx + 1}: expiration time exceeds maximum (${limits.maxExpiryHours} hours)`);
        return;
      }
    }

    // Upload files if present
    let uploadedFileIds;
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
    if (uploadedFileIds?.length > 0) {
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
    // Snap to the bottom (scrollTop 0 in the column-reverse list) once the DOM has updated
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
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
      setSendError(err?.status === 403
        ? 'You cannot send messages here.'
        : 'Failed to send message. Please try again.');
    }
  }

  const channelDisplayName = channel?.type === 1
    ? (otherUser?.username ?? '…')
    : (channel?.name ?? `Channel ${channelId}`);

  // ── Drag and drop ───────────────────────────────────────────────────────────

  function handleDragOver(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // dragleave also fires when moving between children; only clear once the
    // pointer has left the column entirely (relatedTarget outside or null).
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) fileUploads.addFiles(files);
  }

  if (loading) {
    return (
      <div className="chat-column">
        <div style={{ height: 48, flexShrink: 0, borderBottom: '1px solid var(--border)' }} />
        <MessageListSkeleton />
        <div className="chat-composer-area">
          <div className="chat-composer-placeholder" />
          <div className="chat-typing-slot" />
        </div>
      </div>
    );
  }

  const memberListProps = {
    channelId,
    guildId: isGuildChannel ? channel.guildId : null,
    ownerId: isGuildChannel ? guildOwnerId : groupChat?.ownerId ?? null,
    refreshTick: memberRefreshTick,
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main chat column */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="chat-column"
      >
        <ChatHeader
          channel={channel}
          channelId={channelId}
          displayName={channelDisplayName}
          otherUser={otherUser}
          hasChannelIcon={hasChannelIcon}
          onIconError={() => setHasChannelIcon(false)}
          iconVersion={channelUpdatedEvent?.ts}
          isOwner={isOwner}
          onAddMembers={() => setShowAddMembers(true)}
          onLeave={handleLeave}
          leaveBusy={leaveBusy}
          showMembers={showMembers}
          onToggleMembers={toggleMembers}
          showSearch={searchOpen}
          onToggleSearch={() => (searchOpen ? closeSearch() : openSearch())}
        />

        {/* Drag and drop overlay */}
        {dragOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'var(--accent-soft)', border: '2px dashed var(--accent)', borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', backdropFilter: 'blur(1px)',
          }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
              fontSize: '1.2rem', color: 'var(--accent)', fontWeight: 600, textAlign: 'center',
            }}>
              <AttachmentIcon size={40} />
              <div>Drop files to upload</div>
            </div>
          </div>
        )}

        {/* Voice participants preview (below header buttons, above messages) */}
        {(isDmChannel || isGroupChannel || (isGuildChannel && channel?.voiceCapable)) && (
          <VoiceParticipantPreview channelId={channelId} compact={false} canManageMsgs={isGuildChannel && canManageMsgs} />
        )}

        <MessageList
          scrollRef={scrollRef}
          channel={channel}
          channelId={channelId}
          displayName={channelDisplayName}
          otherUser={otherUser}
          messages={channelMessages}
          hasOlder={hasOlder}
          hasNewer={hasNewer}
          loadingOlder={loadingOlder}
          loadingNewer={loadingNewer}
          pageError={pageError}
          onLoadOlder={loadOlderMessages}
          onLoadNewer={loadNewerMessages}
          onLoadAround={loadAround}
          onJumpToPresent={goToPresent}
          scrollIntentRef={scrollIntentRef}
          jumpToId={jumpToId}
          onJumpHandled={handleJumpHandled}
          isBlocked={isBlocked}
          blockedMessageMode={blockedMessageMode}
          currentUserId={currentUser?.id}
          editingMsgId={editingMsgId}
          activeMsgId={ctxMenu?.msg.id ?? imageCtxMenu?.msg?.id ?? null}
          bubbleProps={{
            peekUser,
            resolveUser,
            onContextMenu: handleContextMenu,
            onImageContextMenu: handleImageContextMenu,
            onUserClick: handleUserClick,
            getColor,
            mentionData,
            guildId: guildIdForColor,
            canManageMsgs,
            onEditSave: handleEditSave,
            onEditCancel: handleEditCancel,
            onStartEdit: handleStartEdit,
            onDelete: handleDelete,
            onMore: handleMoreClick,
          }}
        />

        <div className="chat-composer-area">
          {/* Blocked-by-me banner — replaces the input entirely */}
          {isDmChannel && otherUser && isBlocked(otherUser.id) ? (
            <BlockedInputBanner username={otherUser.username} userId={otherUser.id} unblockUser={unblockUser} />
          ) : canSend ? (
            <Composer
              channelId={channelId}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              placeholder={`Message ${isGuildChannel ? '#' : ''}${channelDisplayName}`}
              mentionData={mentionData}
              fileUploads={fileUploads}
              sendError={sendError}
              onDismissError={() => setSendError(null)}
              onSend={handleSend}
              onEditLast={editLastOwnMessage}
              onCreatePoll={canCreatePolls ? () => setShowCreatePoll(true) : undefined}
            />
          ) : (
            <NoPermissionNotice />
          )}
          {/* Fixed-height slot under the input, so the typing indicator never shifts the layout */}
          <div className="chat-typing-slot">
            {visibleTypingUsers && <TypingIndicator users={visibleTypingUsers} resolveUser={resolveUser} />}
          </div>
        </div>

        {ctxMenu && (
          <MessageContextMenu
            key={ctxMenu.key}
            x={ctxMenu.x}
            y={ctxMenu.y}
            msg={ctxMenu.msg}
            canEdit={ctxMenu.msg.authorId === currentUser?.id && !ctxMenu.msg.poll}
            canDelete={ctxMenu.msg.authorId === currentUser?.id || canManageMsgs}
            onEdit={() => handleStartEdit(ctxMenu.msg)}
            onDelete={() => handleDelete(ctxMenu.msg)}
            onClose={closeCtxMenu}
          />
        )}

        {imageCtxMenu && (
          <ImageContextMenu
            key={imageCtxMenu.key}
            x={imageCtxMenu.x}
            y={imageCtxMenu.y}
            imageUrl={imageCtxMenu.imageUrl}
            filename={imageCtxMenu.filename}
            msg={imageCtxMenu.msg}
            onClose={closeImageCtxMenu}
          />
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
              <MemberList {...memberListProps} style={{ width: 'min(85vw, 320px)', height: '100%' }} />
            </div>
          </>
        ) : (
          /* Desktop: plain flex sibling — only render when open (search takes its place) */
          !searchOpen && showMembers && <MemberList {...memberListProps} />
        )
      )}

      {channel && searchOpen && (
        <SearchPanel
          channelId={channelId}
          channelLabel={isGuildChannel ? `#${channelDisplayName}` : channelDisplayName}
          focusToken={searchFocusToken}
          onJump={handleSearchJump}
          onClose={closeSearch}
          isMobile={isMobile}
          peekUser={peekUser}
          resolveUser={resolveUser}
          getColor={getColor}
          mentionData={mentionData}
          isBlocked={isBlocked}
          blockedMessageMode={blockedMessageMode}
        />
      )}

      {showCreatePoll && (
        <PollCreateModal
          channelId={channelId}
          onClose={() => setShowCreatePoll(false)}
          onCreated={() => {
            if (windowRef.current?.hasNewer) goToPresent();
            else requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
          }}
        />
      )}

      {showAddMembers && (
        <AddMembersModal
          groupId={Number(channelId)}
          onClose={() => { setShowAddMembers(false); setMemberRefreshTick(t => t + 1); }}
        />
      )}
    </div>
  );
}
