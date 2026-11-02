import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import { getMessages, sendMessage, getChannel, deleteMessage, editMessage, leaveOrDeleteGroupChat,
         getGuildMembers, getGuildRoles, getGuildChannels, getChannelMembers,
         getChannelIconUrl, getGroupChatIconUrl, getGuild } from '../api.js';
import UserPopout from './UserPopout.jsx';
import MemberList from './MemberList.jsx';
import AddMembersModal from './AddMembersModal.jsx';
import VoiceParticipantPreview from './VoiceParticipantPreview.jsx';
import PollCreateModal from './poll/PollCreateModal.jsx';
import ChatHeader from './chat/ChatHeader.jsx';
import Composer, { BlockedInputBanner, NoPermissionNotice } from './chat/Composer.jsx';
import MessageList, { MessageListSkeleton } from './chat/MessageList.jsx';
import { MessageContextMenu, ImageContextMenu } from './chat/MessageMenus.jsx';
import TypingIndicator from './chat/TypingIndicator.jsx';
import { useFileUploads } from './chat/FileUploadPanel.jsx';
import { isUnlimited } from './chat/utils.js';
import { AttachmentIcon } from '../icons.jsx';
import { withQuery } from '../imageVersions.js';

const MESSAGE_PAGE_SIZE = 50;
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
  const { currentUser, dmChannels, groupChats, messages, setMessages, resolveUser, peekUser, channelEvent, refreshDms, setActiveGuildId, loadGuildPermissions, getMyPerms, loadGuildMemberColors, getMemberColor, rolesUpdatedEvent, userUpdatedEvent, loadChannelPermissions, getMyChannelPerms, isBlocked, unblockUser, setActiveChannelId, markChannelRead, registerChannelMeta, channelUpdatedEvent, typingUsers, rememberMessagePolls, syncGeneration } = useApp();
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

  // Older messages loading state; hasMore mirrors historyRef.current.hasMore for rendering
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // True while a failed history fetch is cooling down; clearing it lets the list retry
  const [olderError, setOlderError] = useState(false);
  // Pagination state for the current channel's history: { channelId, hasMore, loading, retryAt }.
  // The object is replaced on every channel change, so in-flight requests detect staleness by identity.
  const historyRef = useRef(null);

  function toggleMembers() {
    setShowMembers(v => {
      sessionStorage.setItem('memberPanelOpen', String(!v));
      return !v;
    });
  }
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  const channelMessages = messages[String(channelId)] ?? [];

  /**
   * Fetch the next page of older history. Returns false (without fetching) when there's
   * nothing more to load, a fetch is already running, or a failed fetch is cooling down.
   */
  function loadOlderMessages() {
    const history = historyRef.current;
    // The channelId check covers the render between a channel switch and its reset effect
    if (history?.channelId !== String(channelId)) return false;
    if (!history.hasMore || history.loading || Date.now() < history.retryAt) return false;
    fetchOlderPage(history);
    return true;
  }

  async function fetchOlderPage(history) {
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
      setHasMore(history.hasMore);
      if (older.length > 0) {
        rememberMessagePolls(older);
        setMessages(prev => ({ ...prev, [key]: [...older, ...(prev[key] ?? [])] }));
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
      history.retryAt = Date.now() + LOAD_OLDER_RETRY_MS;
      if (historyRef.current === history) {
        setOlderError(true);
        // The user may already be at the very top, where no scroll event will come to retry
        setTimeout(() => { if (historyRef.current === history) setOlderError(false); }, LOAD_OLDER_RETRY_MS);
      }
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
      // Re-fetch to restore if delete failed — simplest recovery
      getMessages(msg.channelId, MESSAGE_PAGE_SIZE, 0)
        .then(msgs => setMessages(p => ({ ...p, [String(msg.channelId)]: [...msgs].reverse() })))
        .catch(console.error);
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

    // Fresh pagination state; hasMore stays false until the first page tells us otherwise
    const history = { channelId: String(channelId), hasMore: false, loading: false, retryAt: 0 };
    historyRef.current = history;
    setLoadingOlder(false);
    setHasMore(false);
    setOlderError(false);

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
      setHasMore(history.hasMore);
      rememberMessagePolls(msgs);
      setMessages(p => ({ ...p, [String(channelId)]: [...msgs].reverse() }));
      setLoading(false);
    }).catch(e => {
      if (historyRef.current !== history) return;
      console.error(e);
      setLoading(false);
    });
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the hub was down, messages sent, edited or deleted meanwhile were missed: refetch the newest page and
  // put it in place of what we had from that point on. Older pages are kept when they still join up with it.
  const channelMessagesRef = useRef(channelMessages);
  channelMessagesRef.current = channelMessages;
  useEffect(() => {
    if (!syncGeneration || !channelId) return;
    const key = String(channelId);
    const history = historyRef.current;
    let cancelled = false;
    getMessages(channelId, MESSAGE_PAGE_SIZE, 0).then(msgs => {
      if (cancelled || historyRef.current !== history) return;
      const latest = [...msgs].reverse();
      const oldestLatest = latest[0]?.id;
      // No overlap means more than a page arrived: what we had no longer joins up, so start from the newest page
      const joins = oldestLatest != null && channelMessagesRef.current.some(m => !m._pending && m.id >= oldestLatest);
      rememberMessagePolls(msgs);
      setMessages(p => {
        const have = p[key] ?? [];
        const kept = joins ? have.filter(m => !m._pending && m.id < oldestLatest) : [];
        return { ...p, [key]: [...kept, ...latest, ...have.filter(m => m._pending)] };
      });
      if (!joins) {
        history.hasMore = msgs.length === MESSAGE_PAGE_SIZE;
        setHasMore(history.hasMore);
      }
      markChannelRead(channelId);
    }).catch(e => console.warn('Resync of channel messages failed:', e));
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
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          olderError={olderError}
          onLoadOlder={loadOlderMessages}
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
          /* Desktop: plain flex sibling — only render when open */
          showMembers && <MemberList {...memberListProps} />
        )
      )}

      {showCreatePoll && (
        <PollCreateModal
          channelId={channelId}
          onClose={() => setShowCreatePoll(false)}
          onCreated={() => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; })}
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
