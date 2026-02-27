import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as signalR from '@microsoft/signalr';
import {
  getMyAccount, getFriends, getDmChannels,
  getGroupChats, getGroupChat, getAccountById, getMyGuilds,
  getMyGuildPermissions, getMyChannelPermissions, verifyAuth, getGuildChannelMembersDetails,
  getBlockedUsers, blockUser as blockUserApi, unblockUser as unblockUserApi,
  getUnreads, getChannelNotifPrefs, setChannelNotifPrefs,
  patchAccount, getGuildNotifPrefs, setGuildNotifPrefs as setGuildNotifPrefsApi,
  getGuildChannels, getUsersInVoice,
} from '../api.js';
import { resubscribeIfEnabled } from '../push.js';

const Ctx = createContext(null);

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5210';

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser]   = useState(null);
  const [friends,     setFriends]       = useState([]);
  const [dmChannels,  setDmChannels]    = useState([]);
  const [groupChats,  setGroupChats]    = useState([]);
  const [guilds,      setGuilds]        = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]); // PublicUserResponse[]
  const [blockedUserIds, setBlockedUserIds] = useState(new Set()); // Set<string>
  const [isConnected, setIsConnected]   = useState(false);
  const [messages,    setMessages]      = useState({});   // channelId (string) -> msg[]
  const [channelLastActive, setChannelLastActive] = useState({}); // channelId (string) -> ms timestamp
  const [toasts,        setToasts]        = useState([]);
  const [channelEvent,  setChannelEvent]  = useState(null); // { type, channelId, data }
  const [guildChannelEvent, setGuildChannelEvent] = useState(null); // { type, channelId, guildId }
  // Initialise from URL so the correct sidebar is shown immediately on page reload
  const [activeGuildId, setActiveGuildId] = useState(() => {
    const m = window.location.pathname.match(/\/app\/guild\/(\d+)/);
    return m ? m[1] : null;
  });
  // guildId (string) -> GuildPermissions object from server
  const [guildPermissions, setGuildPermissions] = useState({});
  const guildPermissionsRef = useRef({});
  // channelId (string) -> GuildPermissions (resolved including channel overrides)
  const [channelPermissions, setChannelPermissions] = useState({});
  // guildId (string) -> { userId -> hex color string }
  const [guildMemberColors, setGuildMemberColors] = useState({});
  // last RolesUpdated event payload { guildId } — MemberList watches this
  const [rolesUpdatedEvent, setRolesUpdatedEvent] = useState(null);
  // last UserUpdated event payload { userId } — MemberList / ChatView watches this
  const [userUpdatedEvent, setUserUpdatedEvent] = useState(null);
  // last GuildUpdated event payload { guildId } — GuildSidebar watches this
  const [guildUpdatedEvent, setGuildUpdatedEvent] = useState(null);
  // channelId (string) -> string[] (userIds) for voice presence
  const [voiceUsersByChannel, setVoiceUsersByChannel] = useState({});
  const voiceUsersByChannelRef = useRef({});
  const voicePresencePrimedRef = useRef(new Set());
  const voicePresenceInflightRef = useRef(new Set());
  // userId (string) -> 'online' | 'offline'
  const [userStatuses, setUserStatuses] = useState({});

  const hubRef          = useRef(null);
  const userCacheRef    = useRef({});
  const heartbeatRef    = useRef(null);
  const initDoneRef     = useRef(false); // guard against double-invoke
  // Always-current ref to currentUser so SignalR closures never see stale state
  const currentUserRef  = useRef(null);
  // channelId (string) → { type: 0|1|2, guildId: number|null }
  // type: 0=Guild, 1=DM, 2=Group — mirrors the ChannelType enum
  const channelMetaRef  = useRef({});
  // Unread counts: channelId (string) -> number
  const [unreads, setUnreads] = useState({});
  // Channel-to-guild mapping: channelId (string) -> guildId (string)
  const [channelToGuild, setChannelToGuild] = useState({});
  // Notification prefs cache: channelId (string) -> { notifications: 0|1|2|3, unreads: 0|1|2|3 }
  const [notifPrefs, setNotifPrefs] = useState({});
  // Guild notification prefs cache: guildId (string) -> { preferences: { notifications, unreads } }
  const [guildNotifPrefs, setGuildNotifPrefs] = useState({});
  // Refs so SignalR handlers (closures) always see latest values without stale state
  const activeChannelIdRef = useRef(null);
  const notifPrefsRef = useRef({});
  const guildNotifPrefsRef = useRef({});

  // Keep refs in sync with state so SignalR handlers always read the latest values
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { voiceUsersByChannelRef.current = voiceUsersByChannel; }, [voiceUsersByChannel]);

  useEffect(() => {
    dmChannels.forEach(dm => {
      channelMetaRef.current[String(dm.channelId)] = { type: 1, guildId: null };
    });
  }, [dmChannels]);

  useEffect(() => {
    groupChats.forEach(gc => {
      channelMetaRef.current[String(gc.channelId)] = { type: 2, guildId: null };
    });
  }, [groupChats]);

  function addToast({ title, body, type = 'info', duration = 5000 }) {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts(p => [...p, { id, title, body, type, duration }]);
  }

  function removeToast(id) {
    setToasts(p => p.filter(t => t.id !== id));
  }

  useEffect(() => {
    init();
    return () => {
      hubRef.current?.stop();
      hubRef.current = null;
      clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    // Verify the stored JWT is still valid before loading anything.
    try {
      await verifyAuth();
    } catch {
      localStorage.removeItem('jwt');
      window.location.replace('/');
      return;
    }

    try {
      const [user, fr, dms] = await Promise.all([
        getMyAccount(), getFriends(), getDmChannels(),
      ]);
      setCurrentUser(user);
      setFriends(fr);
      setDmChannels(dms);
      await reloadGroups();
      await reloadGuilds();
      await refreshBlockedUsers();
      // Load initial unread counts (already filtered by per-channel prefs server-side)
      try {
        const counts = await getUnreads();
        const stringKeyed = {};
        for (const [k, v] of Object.entries(counts ?? {})) stringKeyed[String(k)] = v;
        setUnreads(stringKeyed);
      } catch (e) { console.warn('getUnreads failed:', e); }
      // Re-register push subscription in the background (no-op if not opted in)
      resubscribeIfEnabled().catch(e => console.warn('resubscribeIfEnabled failed:', e));
      connectHub();
    } catch (e) {
      console.error('AppContext init failed:', e);
    }
  }

  async function refreshBlockedUsers() {
    try {
      const list = await getBlockedUsers();
      const arr = Array.isArray(list) ? list : [];
      setBlockedUsers(arr);
      setBlockedUserIds(new Set(arr.map(u => String(u.id))));
    } catch (e) { console.error('refreshBlockedUsers failed:', e); }
  }

  async function blockUserFn(id) {
    await blockUserApi(id);
    await refreshBlockedUsers();
  }

  async function unblockUserFn(id) {
    await unblockUserApi(id);
    await refreshBlockedUsers();
  }

  const isBlocked = useCallback((id) => blockedUserIds.has(String(id)), [blockedUserIds]);

  function setVoiceUsersForChannel(channelId, userIds) {
    const key = String(channelId);
    const nextList = Array.from(new Set((userIds ?? []).map(String)));
    voiceUsersByChannelRef.current = { ...voiceUsersByChannelRef.current, [key]: nextList };
    setVoiceUsersByChannel(prev => ({ ...prev, [key]: nextList }));
  }

  function addVoiceUser(channelId, userId) {
    const key = String(channelId);
    const existing = voiceUsersByChannelRef.current[key] ?? [];
    if (existing.includes(String(userId))) return;
    const nextList = [...existing, String(userId)];
    voiceUsersByChannelRef.current = { ...voiceUsersByChannelRef.current, [key]: nextList };
    setVoiceUsersByChannel(prev => ({ ...prev, [key]: nextList }));
  }

  function removeVoiceUser(channelId, userId) {
    const key = String(channelId);
    const existing = voiceUsersByChannelRef.current[key] ?? [];
    const nextList = existing.filter(id => String(id) !== String(userId));
    voiceUsersByChannelRef.current = { ...voiceUsersByChannelRef.current, [key]: nextList };
    setVoiceUsersByChannel(prev => ({ ...prev, [key]: nextList }));
  }

  async function primeVoiceUsers(channelId) {
    const key = String(channelId);
    if (voicePresencePrimedRef.current.has(key) || voicePresenceInflightRef.current.has(key)) return;
    voicePresenceInflightRef.current.add(key);
    try {
      const response = await getUsersInVoice(key);
      setVoiceUsersForChannel(key, response?.users ?? []);
      voicePresencePrimedRef.current.add(key);
    } catch (e) {
      console.warn('primeVoiceUsers failed:', e);
    } finally {
      voicePresenceInflightRef.current.delete(key);
    }
  }

  /** Call when the user navigates to a channel. Clears unread count for that channel. */
  function setActiveChannelId(id) {
    const key = id ? String(id) : null;
    activeChannelIdRef.current = key;
    if (key) markChannelRead(key);
  }

  /** Register channel type/guildId so the unread resolver knows the hierarchy. */
  function registerChannelMeta(channelId, meta) {
    channelMetaRef.current[String(channelId)] = meta;
    if (meta?.type === 0 && meta?.guildId != null) {
      setChannelToGuild(p => ({ ...p, [String(channelId)]: String(meta.guildId) }));
    }
  }

  /**
   * Resolve the effective "unreads" preference for a channel by walking the
   * hierarchy: channel → guild (if guild channel) → user defaults.
   * Returns: 1=AllMessages, 2=MentionsOnly, 3=Nothing
   * Enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
   */
  function resolveEffectiveUnreadsMode(channelKey) {
    // 1. Channel-level override
    const channelUnreads = notifPrefsRef.current[channelKey]?.unreads ?? 0;
    if (channelUnreads !== 0) return channelUnreads;

    const meta = channelMetaRef.current[channelKey];

    // 2. Guild-level override (only for guild channels, type=0)
    if (meta?.type === 0 && meta?.guildId) {
      const guildUnreads = guildNotifPrefsRef.current[String(meta.guildId)]?.preferences?.unreads ?? 0;
      if (guildUnreads !== 0) return guildUnreads;
    }

    // 3. User defaults — based on channel type
    const user = currentUserRef.current;
    if (meta?.type === 0) { // Guild
      const d = user?.defaultGuildNotificationPreferences?.unreads;
      if (d !== undefined && d !== 0) return d;
      return 1; // server default: AllMessages
    } else if (meta?.type === 1) { // DM
      const d = user?.defaultDmNotificationPreferences?.unreads;
      if (d !== undefined && d !== 0) return d;
      return 1; // server default: AllMessages
    } else if (meta?.type === 2) { // Group
      const d = user?.defaultGroupNotificationPreferences?.unreads;
      if (d !== undefined && d !== 0) return d;
      return 1; // server default: AllMessages
    }

    // 4. Channel type unknown yet — assume AllMessages
    return 1;
  }
  function markChannelRead(channelId) {
    const key = String(channelId);
    setUnreads(p => {
      if (!p[key]) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  /** Fetch & cache per-channel notification preferences. */
  async function loadChannelNotifPrefs(channelId) {
    const key = String(channelId);
    try {
      const prefs = await getChannelNotifPrefs(key);
      notifPrefsRef.current[key] = prefs;
      setNotifPrefs(p => ({ ...p, [key]: prefs }));
      return prefs;
    } catch (e) {
      console.error('loadChannelNotifPrefs failed:', e);
      return null;
    }
  }

  /** Persist updated notification preferences and update local cache. */
  async function updateChannelNotifPrefs(channelId, patch) {
    const key = String(channelId);
    try {
      await setChannelNotifPrefs(key, patch);
      const updated = { ...(notifPrefsRef.current[key] ?? { notifications: 0, unreads: 0 }), ...patch };
      notifPrefsRef.current[key] = updated;
      setNotifPrefs(p => ({ ...p, [key]: updated }));
      return updated;
    } catch (e) {
      console.error('updateChannelNotifPrefs failed:', e);
      return null;
    }
  }

  /** Fetch & cache per-guild notification preferences. */
  async function loadGuildNotifPrefs(guildId) {
    const key = String(guildId);
    try {
      const data = await getGuildNotifPrefs(key);
      guildNotifPrefsRef.current[key] = data;
      setGuildNotifPrefs(p => ({ ...p, [key]: data }));
      return data;
    } catch (e) {
      console.error('loadGuildNotifPrefs failed:', e);
      return null;
    }
  }

  /** Persist updated guild-level notification preferences. */
  async function updateGuildNotifPrefs(guildId, preferences) {
    const key = String(guildId);
    try {
      await setGuildNotifPrefsApi(key, preferences);
      // GET returns { ..., preferences: { notifications, unreads } } — mirror that shape in cache
      const updated = { ...(guildNotifPrefsRef.current[key] ?? {}), preferences };
      guildNotifPrefsRef.current[key] = updated;
      setGuildNotifPrefs(p => ({ ...p, [key]: updated }));
      return updated;
    } catch (e) {
      console.error('updateGuildNotifPrefs failed:', e);
      return null;
    }
  }

  /** PATCH /account – update user-level default notification preferences and/or notificationsWhileOnline. */
  async function updateUserDefaultPrefs(patch) {
    try {
      await patchAccount(patch);
      setCurrentUser(p => {
        if (!p) return p;
        const updated = { ...p, ...patch };
        // Keep the resolveUser cache in sync so other components that
        // already resolved the current user see the new colour/blurb.
        if (userCacheRef.current[p.id]) {
          userCacheRef.current[p.id] = { ...userCacheRef.current[p.id], ...patch };
        }
        return updated;
      });
    } catch (e) {
      console.error('updateUserDefaultPrefs failed:', e);
      throw e;
    }
  }

  async function reloadGroups() {
    try {
      const members = await getGroupChats();
      const ids = [...new Set(members.map(m => m.groupChatId))];
      if (ids.length === 0) { setGroupChats([]); return; }
      const chats = await Promise.all(ids.map(id => getGroupChat(id)));
      setGroupChats(chats);
    } catch (e) { console.error('reloadGroups failed:', e); }
  }

  async function reloadGuilds() {
    try {
      const gs = await getMyGuilds();
      setGuilds(gs);
      // Build channel→guild map for unread aggregation
      const entries = await Promise.all(
        gs.map(g =>
          getGuildChannels(g.id)
            .then(chs => (chs ?? []).map(ch => [String(ch.id), String(g.id)]))
            .catch(() => [])
        )
      );
      const map = Object.fromEntries(entries.flat());
      setChannelToGuild(p => ({ ...p, ...map }));
      // Also register in channelMetaRef so resolveEffectiveUnreadsMode works
      for (const [channelId, guildId] of Object.entries(map)) {
        channelMetaRef.current[channelId] = { type: 0, guildId: Number(guildId) };
      }
    } catch (e) { console.error('reloadGuilds failed:', e); }
  }

  async function loadGuildPermissions(guildId) {
    const key = String(guildId);
    try {
      const perms = await getMyGuildPermissions(key);
      guildPermissionsRef.current[key] = perms;
      setGuildPermissions(p => ({ ...p, [key]: perms }));
      return perms;
    } catch (e) {
      console.error('loadGuildPermissions failed:', e);
      return null;
    }
  }

  function getMyPerms(guildId) {
    return guildPermissions[String(guildId)] ?? null;
  }

  async function loadChannelPermissions(guildId, channelId) {
    const key = String(channelId);
    try {
      const perms = await getMyChannelPermissions(guildId, channelId);
      setChannelPermissions(p => ({ ...p, [key]: perms }));
      return perms;
    } catch (e) {
      console.error('loadChannelPermissions failed:', e);
      return null;
    }
  }

  function getMyChannelPerms(channelId) {
    return channelPermissions[String(channelId)] ?? null;
  }

  /** Fetch member-color data for a guild channel and store it. */
  async function loadGuildMemberColors(guildId, channelId) {
    try {
      const members = await getGuildChannelMembersDetails(guildId, channelId);
      const colorMap = {};
      for (const m of members) {
        colorMap[m.user.id] = m.color || null;
      }
      setGuildMemberColors(p => ({ ...p, [String(guildId)]: colorMap }));
    } catch (e) {
      console.error('loadGuildMemberColors failed:', e);
    }
  }

  /**
   * Resolve a display colour for a user.
   * Priority: guild role colour > user's own profile colour > hue from username.
   *
   * @param {string|null} guildId
   * @param {string}      userId
   * @param {string}      username
   * @param {string}      [userColor]  hex colour from the user's profile (may be "")
   */
  const getMemberColor = useCallback((guildId, userId, username, userColor) => {
    if (guildId) {
      const map = guildMemberColors[String(guildId)];
      const roleColor = map?.[userId];
      if (roleColor && roleColor !== '#ffffff') return roleColor;
    }
    // User's own chosen profile colour
    if (userColor && userColor !== '') return userColor;
    // Deterministic hue seeded from username (or userId as fallback)
    const seed = username || userId || 'x';
    const hue  = (seed.charCodeAt(0) * 37 + seed.charCodeAt(seed.length - 1) * 17) % 360;
    return `hsl(${hue},60%,72%)`;
  }, [guildMemberColors]);

  // Stable reference — uses ref for cache so no state update is needed
  const resolveUser = useCallback(async (id) => {
    if (userCacheRef.current[id]) return userCacheRef.current[id];
    try {
      const u = await getAccountById(id);
      userCacheRef.current[id] = u;
      return u;
    } catch {
      const fb = { id, username: id.slice(0, 8) + '…' };
      userCacheRef.current[id] = fb;
      return fb;
    }
  }, []); // deps: empty — only uses a ref and a module-level import

  async function reconnectHub() {
    try { await hubRef.current?.stop(); } catch { /* ignore */ }
    hubRef.current = null;
    setIsConnected(false);
    await connectHub();
  }

  async function connectHub() {
    if (hubRef.current) return;
    const jwt = localStorage.getItem('jwt');
    if (!jwt) return;

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE}/updates`, { accessTokenFactory: () => jwt })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // Set synchronously BEFORE the first await so any concurrent connectHub()
    // call hits the guard and returns early (fixes React StrictMode double-invoke).
    hubRef.current = conn;

    conn.on('NewMessage', msg => {
      const key = String(msg.channelId);
      setMessages(p => {
        const existing = p[key] ?? [];
        const pendingIdx = existing.findIndex(
          m => m._pending && m.authorId === msg.authorId && m.content === msg.content
        );
        if (pendingIdx !== -1) {
          const updated = [...existing];
          updated[pendingIdx] = msg;
          return { ...p, [key]: updated };
        }
        return { ...p, [key]: [...existing, msg] };
      });
      // Bubble the channel to the top of the DM/group sidebar
      setChannelLastActive(p => ({ ...p, [key]: Date.now() }));
      // Unread tracking: only when not currently viewing this channel
      if (key !== activeChannelIdRef.current) {
        const mode = resolveEffectiveUnreadsMode(key);
        if (mode === 1) { // AllMessages
          setUnreads(p => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
        }
        // MentionsOnly (2) — incremented by MentionedInMessage event
        // Nothing (3) — never increment
      }
    });

    conn.on('MentionedInMessage', ({ ChannelId }) => {
      const key = String(ChannelId);
      if (key !== activeChannelIdRef.current) {
        const mode = resolveEffectiveUnreadsMode(key);
        if (mode === 2) { // MentionsOnly
          setUnreads(p => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
        }
      }
    });

    conn.on('DeleteMessage', ({ id }) => {
      setMessages(p => {
        const next = { ...p };
        for (const key of Object.keys(next)) {
          if (next[key].some(m => m.id === id)) {
            next[key] = next[key].filter(m => m.id !== id);
            break;
          }
        }
        return next;
      });
    });

    conn.on('FriendRequestReceived', async ({ fromUserId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(fromUserId);
      addToast({ title: 'New Friend Request', body: `${u.username} sent you a friend request.`, type: 'info' });
    });

    conn.on('FriendRequestAccepted', async ({ userId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(userId);
      addToast({ title: 'Friend Request Accepted', body: `${u.username} accepted your friend request!`, type: 'success' });
    });

    conn.on('FriendRemoved', async ({ userId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(userId);
      addToast({ title: 'Friend Removed', body: `${u.username} removed you as a friend.`, type: 'danger' });
    });

    conn.on('ChannelDeleted', ({ channelId }) => {
      setGroupChats(p => p.filter(g => g.channelId !== channelId));
      setChannelEvent({ type: 'ChannelDeleted', channelId });
      // Also notify the guild sidebar so it can remove the channel
      setGuildChannelEvent({ type: 'ChannelDeleted', channelId });
    });

    conn.on('UserLeft', ({ userId, channelId }) => {
      setChannelEvent({ type: 'UserLeft', channelId, data: { userId } });
    });

    conn.on('RolesUpdated', ({ guildId }) => {
      if (!guildId) return;
      // Refresh our own permissions
      loadGuildPermissions(guildId).catch(console.error);
      // Signal components to refresh colors and channels
      setRolesUpdatedEvent({ guildId, ts: Date.now() });
    });

    conn.on('GuildUpdated', ({ guildId }) => {
      if (!guildId) return;
      // Reload guild list to get updated guild info
      reloadGuilds().catch(console.error);
      // Signal components (like GuildSidebar) to refresh their data
      setGuildUpdatedEvent({ guildId, ts: Date.now() });
    });

    conn.on('UserUpdated', ({ id }) => {
      // A guild member's roles changed — refresh member colors/list
      setUserUpdatedEvent({ userId: id, ts: Date.now() });
    });

    conn.on('ClientJoinVoice', ({ userId, channelId }) => {
      if (userId == null || channelId == null) return;
      addVoiceUser(channelId, userId);
    });

    conn.on('ClientLeaveVoice', ({ userId, channelId }) => {
      if (userId == null || channelId == null) return;
      removeVoiceUser(channelId, userId);
    });

    conn.on('UserStatusUpdated', ({ userId, status }) => {
      setUserStatuses(p => ({ ...p, [String(userId)]: status }));
    });

    conn.on('NewChannel', async (channel) => {      // channel.type: 0=Guild, 1=DM, 2=Group
      if (channel?.type === 0) {
        // Guild channel created — notify guild sidebar to reload its channel list
        setGuildChannelEvent({ type: 'NewChannel', channelId: channel.id, guildId: channel.guildId });
      } else {
        await getDmChannels().then(setDmChannels).catch(console.error);
        await reloadGroups();
      }
      // Always reconnect so OnConnectedAsync adds us to the new channel's SignalR group
      try { await hubRef.current?.stop(); } catch { /* ignore */ }
      hubRef.current = null;
      setIsConnected(false);
      await connectHub();
    });

    conn.onclose(() => {
      if (hubRef.current === conn) hubRef.current = null;
      clearInterval(heartbeatRef.current);
      setIsConnected(false);
    });
    conn.onreconnecting(() => setIsConnected(false));
    conn.onreconnected(() => {
      setIsConnected(true);
      const sendStatus = () => conn.invoke('UpdateStatus').catch(() => {});
      sendStatus();
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(sendStatus, 30_000);
      // Allow voice presence to re-prime after reconnect
      voicePresencePrimedRef.current = new Set();
    });

    try {
      await conn.start();
      setIsConnected(true);
      // Send status immediately then every 30 seconds
      const sendStatus = () => conn.invoke('UpdateStatus').catch(() => {});
      sendStatus();
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(sendStatus, 30_000);
    } catch (e) {
      hubRef.current = null;
      console.error('SignalR connect failed:', e);
    }
  }

  /** guildId (string) -> total unread count across all its channels */
  const guildUnreads = useMemo(() => {
    const result = {};
    for (const [channelId, count] of Object.entries(unreads)) {
      const guildId = channelToGuild[channelId];
      if (guildId) result[guildId] = (result[guildId] ?? 0) + count;
    }
    return result;
  }, [unreads, channelToGuild]);

  /** Total unread count for DM and group chat channels (non-guild channels) */
  const homeUnreads = useMemo(() => {
    let total = 0;
    for (const [channelId, count] of Object.entries(unreads)) {
      // If channel is not in a guild, it's a DM or group chat
      if (!channelToGuild[channelId]) {
        total += count;
      }
    }
    return total;
  }, [unreads, channelToGuild]);

  return (
    <Ctx.Provider value={{
      currentUser,
      friends,  setFriends,
      dmChannels, setDmChannels,
      groupChats, setGroupChats,
      guilds,     setGuilds,
      blockedUsers, isBlocked, blockUser: blockUserFn, unblockUser: unblockUserFn, refreshBlockedUsers,
      isConnected,
      messages,  setMessages,
      channelLastActive,
      toasts, addToast, removeToast,
      channelEvent,
      guildChannelEvent,
      resolveUser,
      refreshFriends: () => getFriends().then(setFriends).catch(console.error),
      refreshDms: () => {
        getDmChannels().then(setDmChannels).catch(console.error);
        reloadGroups();
      },
      refreshGuilds: reloadGuilds,
      reconnectHub,
      activeGuildId, setActiveGuildId,
      guildPermissions, loadGuildPermissions, getMyPerms,
      channelPermissions, loadChannelPermissions, getMyChannelPerms,
      guildMemberColors, loadGuildMemberColors, getMemberColor,
      rolesUpdatedEvent,
      userUpdatedEvent,
      guildUpdatedEvent,
      userStatuses,
      // Unread counts & notification preferences
      unreads,
      guildUnreads,
      homeUnreads,
      markChannelRead,
      setActiveChannelId,
      registerChannelMeta,
      notifPrefs,
      loadChannelNotifPrefs,
      updateChannelNotifPrefs,
      guildNotifPrefs,
      loadGuildNotifPrefs,
      updateGuildNotifPrefs,
      updateUserDefaultPrefs,
      voiceUsersByChannel,
      primeVoiceUsers,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
