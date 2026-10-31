import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage, editMessage, leaveOrDeleteGroupChat,
         getGuildMembers, getGuildRoles, getGuildChannels, getChannelMembers,
         getChannelIconUrl, getGroupChatIconUrl, markMessagesAsRead, getGuild } from '../api.js';
import UserPopout from './UserPopout.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import VoiceParticipantPreview from './VoiceParticipantPreview.jsx';
import ChatHeader from './chat/ChatHeader.jsx';
import Composer, { BlockedInputBanner, NoPermissionNotice } from './chat/Composer.jsx';
import { MessageBubble, BlockedGroupBubble } from './chat/MessageBubble.jsx';
import { MessageContextMenu, ImageContextMenu } from './chat/MessageMenus.jsx';
import TypingIndicator from './chat/TypingIndicator.jsx';
import { useFileUploads } from './chat/FileUploadPanel.jsx';
import { isUnlimited } from './chat/utils.js';
import { ChatIcon, AttachmentIcon, WaveIcon, CheckCircleIcon } from '../icons.jsx';

const MESSAGE_PAGE_SIZE = 50;
// Start fetching older messages when the user is within this distance of the top of the history
const LOAD_OLDER_THRESHOLD_PX = 600;
// After a failed fetch, wait this long before scrolling can trigger another attempt
const LOAD_OLDER_RETRY_MS = 3000;

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
  const { currentUser, dmChannels, groupChats, messages, setMessages, resolveUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent, userUpdatedEvent, loadChannelPermissions, getMyChannelPerms, isBlocked, unblockUser, setActiveChannelId, markChannelRead, registerChannelMeta, channelUpdatedEvent, typingUsers } = useApp();
  const { blockedMessageMode } = useClientOptions() ?? { blockedMessageMode: 'masked' };
  const { isMobile } = useMobile() ?? { isMobile: false };
  const [input, setInput]           = useState('');
  const [sendError, setSendError]   = useState(null); // string | null
  const [highlightMsgId, setHighlightMsgId] = useState(null);
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

  // Older messages loading state
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Pagination state for the current channel's history: { channelId, hasMore, loading, retryAt }.
  // The object is replaced on every channel change, so in-flight requests detect staleness by identity.
  const historyRef = useRef(null);

  const lastMarkedReadIdRef = useRef(null);
  const markReadTimeoutRef = useRef(null);

  function toggleMembers() {
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  const channelMessages = messages[String(channelId)] ?? [];

  // The message list is a column-reverse scroller: the browser keeps the view anchored to the
  // bottom when the list or viewport resizes, and prepending history doesn't move what's on screen.
  // In that layout scrollTop is 0 at the bottom and goes negative as the user scrolls up.
  function loadOlderIfNearTop() {
    const el = scrollRef.current;
    const history = historyRef.current;
    // The channelId check covers the render between a channel switch and its reset effect
    if (!el || history?.channelId !== String(channelId)) return;
    if (!history.hasMore || history.loading || Date.now() < history.retryAt) return;
    const distanceFromTop = el.scrollHeight - el.clientHeight + el.scrollTop;
    if (distanceFromTop < LOAD_OLDER_THRESHOLD_PX) loadOlderMessages(history);
  }

  async function loadOlderMessages(history) {
    const key = history.channelId;
    // Live new/deleted messages are mirrored in the local list, so its length tracks the server offset
    const offset = channelMessages.filter(m => !m._pending).length;
    history.loading = true;
    setLoadingOlder(true);
    try {
      const page = await getMessages(key, MESSAGE_PAGE_SIZE, offset);
      if (historyRef.current !== history) return;
      // Pages come newest-first; drop any overlap caused by messages arriving mid-request
      const known = new Set(channelMessages.map(m => String(m.id)));
      const older = page.filter(m => !known.has(String(m.id))).reverse();
      // A full page with nothing new means the offset no longer lines up; stop instead of refetching it forever
      history.hasMore = page.length === MESSAGE_PAGE_SIZE && older.length > 0;
      if (older.length > 0) {
        setMessages(prev => ({ ...prev, [key]: [...older, ...(prev[key] ?? [])] }));
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
      history.retryAt = Date.now() + LOAD_OLDER_RETRY_MS;
    } finally {
      history.loading = false;
      if (historyRef.current === history) setLoadingOlder(false);
    }
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

  // Memoized so MessageBubble (which is React.memo'd) doesn't re-render just because
  // the parent re-renders with an otherwise unchanged getColor inline lambda.
  const guildIdForColor = isGuildChannel ? channel?.guildId : null;
  const getColor = useCallback(
    (userId, username, userColor) => getMemberColor(guildIdForColor, userId, username, userColor),
    [getMemberColor, guildIdForColor]
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
  }, [channelMessages, isBlocked, blockedMessageMode]);

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

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const closeImageCtxMenu = useCallback(() => setImageCtxMenu(null), []);

  // ── Delete / edit ───────────────────────────────────────────────────────────

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
      getMessages(msg.channelId, MESSAGE_PAGE_SIZE, 0)
        .then(msgs => setMessages(p => ({ ...p, [String(msg.channelId)]: [...msgs].reverse() })))
        .catch(console.error);
    }
  }

  function handleEditFromContext() {
    if (!ctxMenu) return;
    setEditingMsgId(ctxMenu.msg.id);
    setCtxMenu(null);
  }

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
    const ownMessages = channelMessages.filter(m => !m._pending && m.authorId === currentUser?.id);
    if (ownMessages.length === 0) return false;
    setEditingMsgId(ownMessages[ownMessages.length - 1].id);
    return true;
  }

  // ── Channel load ────────────────────────────────────────────────────────────

  useEffect(() => {
    // Mark this channel as actively viewed (clears its unread count)
    setActiveChannelId(channelId);
    // Reset message read tracking for the new channel
    lastMarkedReadIdRef.current = null;
    clearTimeout(markReadTimeoutRef.current);
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
    // Attachments belong to the draft, which is discarded on channel switch too
    fileUploads.clearFiles();

    // Fresh pagination state; hasMore stays false until the first page tells us otherwise
    const history = { channelId: String(channelId), hasMore: false, loading: false, retryAt: 0 };
    historyRef.current = history;
    setLoadingOlder(false);

    Promise.all([
      getChannel(channelId),
      getMessages(channelId, MESSAGE_PAGE_SIZE, 0),
    ]).then(([ch, msgs]) => {
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
      history.hasMore = msgs.length === MESSAGE_PAGE_SIZE;
      setMessages(p => ({ ...p, [String(channelId)]: [...msgs].reverse() }));
      setLoading(false);
    }).catch(e => {
      if (historyRef.current !== history) return;
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
    let cancelled = false;
    resolveUser(otherId).then(u => { if (!cancelled) setOtherUser(u); });
    return () => { cancelled = true; };
  }, [channel, dmChannels, currentUser, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const bust = '?t=' + channelUpdatedEvent.ts;
    if (channel.type === 0) return probeImage(getChannelIconUrl(channel.guildId, channel.id) + bust, setHasChannelIcon);
    if (channel.type === 2) return probeImage(getGroupChatIconUrl(channel.id) + bust, setHasChannelIcon);
  }, [channelUpdatedEvent, channel]);

  // Scrolling isn't the only way the top of the history can end up on screen: the first page, a
  // short page, or hidden blocked messages may not fill the viewport. Re-check whenever the list changes.
  useEffect(() => {
    loadOlderIfNearTop();
  }, [renderUnits, loadingOlder]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const msgElements = scrollEl.querySelectorAll('[data-msgid]');
      if (msgElements.length === 0) return;

      const scrollRect = scrollEl.getBoundingClientRect();
      let highestVisibleId = null;

      // Find the highest message ID that's at least partially visible
      for (const el of msgElements) {
        const rect = el.getBoundingClientRect();
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
          }, 500);
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

  // ── Message send ─────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if ((!text && fileUploads.files.length === 0) || !currentUser) return;
    // Enter while a previous send is still uploading would upload the same files again
    if (fileUploads.uploading) return;

    setSendError(null);

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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}><ChatIcon size={32} /></div>
          <div>Loading…</div>
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
        style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}
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
          <VoiceParticipantPreview channelId={channelId} compact={false} />
        )}

        {/* Messages area */}
        <div ref={scrollRef} onScroll={loadOlderIfNearTop} style={{
          flex: 1,
          overflowY: 'auto',
          paddingTop: '0.5rem',
          display: 'flex',
          flexDirection: 'column-reverse',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Loading indicator above the oldest loaded message, where the older ones will appear */}
            {loadingOlder && (
              <div style={{ padding: '1rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: '2px solid color-mix(in srgb, var(--text-secondary) 25%, transparent)',
                  borderTop: '2px solid var(--text-secondary)',
                  animation: 'spin 0.6s linear infinite',
                }} />
                <span style={{ fontSize: '0.85rem' }}>Loading older messages...</span>
              </div>
            )}
            {channelMessages.length === 0 && (
              <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>
                  {isDmChannel ? <WaveIcon size={20} /> : <CheckCircleIcon size={20} />}
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem', fontSize: '1rem' }}>
                  {isDmChannel
                    ? `This is the beginning of your conversation with ${channelDisplayName}`
                    : `Welcome to ${channelDisplayName}!`}
                </div>
                <div style={{ fontSize: '0.85rem' }}>Send the first message!</div>
              </div>
            )}
            {renderUnits.map(unit => unit.type === 'blocked' ? (
              <BlockedGroupBubble
                key={unit.key}
                messages={unit.messages}
                authorId={unit.authorId}
                resolveUser={resolveUser}
                onContextMenu={handleContextMenu}
                onImageContextMenu={handleImageContextMenu}
                onUserClick={handleUserClick}
                getColor={getColor}
                mentionData={mentionData}
                guildId={guildIdForColor}
              />
            ) : (
              <MessageBubble
                key={unit.key}
                msg={unit.msg}
                prevMsg={unit.prevMsg}
                resolveUser={resolveUser}
                onContextMenu={handleContextMenu}
                onImageContextMenu={handleImageContextMenu}
                onUserClick={handleUserClick}
                getColor={getColor}
                mentionData={mentionData}
                highlighted={highlightMsgId !== null && String(unit.msg.id) === highlightMsgId}
                guildId={guildIdForColor}
                isEditing={editingMsgId !== null && String(unit.msg.id) === String(editingMsgId)}
                onEditSave={handleEditSave}
                onEditCancel={handleEditCancel}
              />
            ))}
          </div>
        </div>

        {/* Typing indicator - between messages and input */}
        {visibleTypingUsers && (
          <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            <TypingIndicator users={visibleTypingUsers} resolveUser={resolveUser} />
          </div>
        )}

        <div style={{ padding: '0 1rem 1.5rem', flexShrink: 0 }}>
          {/* Blocked-by-me banner — replaces the input entirely */}
          {isDmChannel && otherUser && isBlocked(otherUser.id) ? (
            <BlockedInputBanner username={otherUser.username} userId={otherUser.id} unblockUser={unblockUser} />
          ) : canSend ? (
            <Composer
              channelId={channelId}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              placeholder={`Message ${channelDisplayName}`}
              mentionData={mentionData}
              fileUploads={fileUploads}
              sendError={sendError}
              onDismissError={() => setSendError(null)}
              onSend={handleSend}
              onEditLast={editLastOwnMessage}
            />
          ) : (
            <NoPermissionNotice />
          )}
        </div>

        {ctxMenu && (
          <MessageContextMenu
            key={ctxMenu.key}
            x={ctxMenu.x}
            y={ctxMenu.y}
            msg={ctxMenu.msg}
            canEdit={ctxMenu.msg.authorId === currentUser?.id}
            canDelete={ctxMenu.msg.authorId === currentUser?.id || canManageMsgs}
            onEdit={handleEditFromContext}
            onDelete={handleDelete}
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
          /* Desktop: plain flex sibling — only render when open */
          showMembers && <MemberList {...memberListProps} />
        )
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
