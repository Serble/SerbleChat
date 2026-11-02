import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as signalR from '@microsoft/signalr';
import {
  getMyAccount, getFriends, getDmChannels,
  getGroupChats, getGroupChat, getAccountById, getMyGuilds,
  getMyGuildPermissions, getMyChannelPermissions, verifyAuth, getGuildChannelMembersDetails,
  getBlockedUsers, blockUser as blockUserApi, unblockUser as unblockUserApi,
  getUnreads, getChannelNotifPrefs, setChannelNotifPrefs,
  patchAccount, getGuildNotifPrefs, setGuildNotifPrefs as setGuildNotifPrefsApi,
  getGuildChannels, getUsersInVoice, getActivePolls,
  setMyStatus, clearMyStatus, expireMyStatus, getUsersBatch,
} from '../api.js';
import { noteUser } from '../imageVersions.js';
import { resolveOwnStatus, resolvePublicStatus, expiresAtMs } from '../components/status/status.js';
import { resubscribeIfEnabled } from '../push.js';
import { playSound, preloadSounds } from '../sound.js';
import { navigateToRoot } from '../electron-utils.js';

const Ctx = createContext(null);

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5210';

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser]   = useState(null);
  const [friends,     setFriends]       = useState([]);
  const [dmChannels,  setDmChannels]    = useState([]);
  const [groupChats,  setGroupChats]    = useState([]);
  const [guilds,      setGuilds]        = useState([]);
  const guildsRef = useRef(guilds);
  guildsRef.current = guilds;
  const [blockedUsers, setBlockedUsers] = useState([]); // PublicUserResponse[]
  const [blockedUserIds, setBlockedUserIds] = useState(new Set()); // Set<string>
  const [isConnected, setIsConnected]   = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false); // Track when guilds/channels are loaded
  const [messages,    setMessages]      = useState({});   // channelId (string) -> msg[]
  // pollId (string) -> poll: the latest copy of every poll we've seen. Poll cards and the
  // voice-panel strip read from here, so a PollUpdated event refreshes them all at once.
  const [polls, setPolls] = useState({});
  const [channelLastActive, setChannelLastActive] = useState({}); // channelId (string) -> ms timestamp
  const [toasts,        setToasts]        = useState([]);
  const [channelEvent,  setChannelEvent]  = useState(null); // { type, channelId, data }
  const [guildChannelEvent, setGuildChannelEvent] = useState(null); // { type, channelId, guildId }
  // Initialise from URL so the correct sidebar is shown immediately on page reload
  // Support both BrowserRouter (pathname) and HashRouter (hash)
  const [activeGuildId, setActiveGuildId] = useState(() => {
    // Check pathname first (BrowserRouter)
    let path = window.location.pathname;
    // If using HashRouter, get path from hash
    if (window.location.hash && window.location.hash.startsWith('#/')) {
      path = window.location.hash.slice(1); // Remove the # prefix
    }
    const m = path.match(/\/app\/guild\/(\d+)/);
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
  // last ChannelUpdated event payload { channelId } — DmSidebar/ChatView watches this
  const [channelUpdatedEvent, setChannelUpdatedEvent] = useState(null);
  // channelId (string) -> string[] (userIds) for voice presence
  const [voiceUsersByChannel, setVoiceUsersByChannel] = useState({});
  const voiceUsersByChannelRef = useRef({});
  const voicePresencePrimedRef = useRef(new Set());
  const voicePresenceInflightRef = useRef(new Set());
  // channelId (string) -> userId (string) -> { muted, deafened } for people in voice
  const [voiceStatesByChannel, setVoiceStatesByChannel] = useState({});
  // userId (string) -> { status, statusMessage, statusExpiresAt }: the latest status we know
  // for each user, from UserStatusUpdated events and from user records fetched from the API.
  // Read it through getUserStatus, which applies expiry and handles yourself.
  const [userStatuses, setUserStatuses] = useState({});
  // Bumped when a status expires, so everything re-renders with it gone
  const [statusClock, setStatusClock] = useState(0);
  // Bumped after the hub reconnects: status events may have been missed, so lists refetch
  const [presenceResync, setPresenceResync] = useState(0);
  // Bumped when cached user records change (a profile update, or the refetch after a reconnect). resolveUser
  // changes with it, so everything that resolved a user resolves again and shows the new name.
  const [userRevision, setUserRevision] = useState(0);
  // Bumped after the hub comes back from being down: the open channel refetches its messages (see ChatView)
  const [syncGeneration, setSyncGeneration] = useState(0);
  // channelId (string) -> Set<userId> of users currently typing
  const [typingUsers, setTypingUsers] = useState({});

  const hubRef          = useRef(null);
  // Failed attempts at the initial connection (connectHub), and the timer for the next one
  const connectAttemptsRef = useRef(0);
  const connectRetryRef    = useRef(null);
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
  // Typing indicator timeout IDs: channelId -> Set<timeoutId>
  const clearTypingRef = useRef({});

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

  /** Whether you're in Do Not Disturb right now (reads refs, so safe in SignalR handlers). */
  function isDndNow() {
    return resolveOwnStatus(currentUserRef.current, true).type === 'dnd';
  }

  /**
   * `notify: true` marks a toast as a notification (something happened, rather than
   * feedback on what you just did); those are dropped while you're in Do Not Disturb.
   */
  function addToast({ title, body, type = 'info', duration = 5000, notify = false }) {
    if (notify && isDndNow()) return;
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
      navigateToRoot();
      return;
    }

    // Preload sounds in the background
    preloadSounds(['notification', 'mute', 'unmute', 'deafen', 'undeafen', 'join', 'leave', 'stream_start', 'stream_end']).catch(console.warn);

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
      // Mark initial data as loaded after guilds and channel mappings are populated
      setInitialDataLoaded(true);
      // Load initial unread counts (already filtered by per-channel prefs server-side)
      await reloadUnreads();
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
    setVoiceStatesByChannel(prev => {
      if (!prev[key]?.[String(userId)]) return prev;
      const { [String(userId)]: _removed, ...rest } = prev[key];
      return { ...prev, [key]: rest };
    });
  }

  function setVoiceState(channelId, userId, muted, deafened) {
    const key = String(channelId);
    setVoiceStatesByChannel(prev => ({
      ...prev,
      [key]: { ...prev[key], [String(userId)]: { muted: !!muted, deafened: !!deafened } },
    }));
  }

  /** Tell everyone who can see the channel our mute/deafen state (we must be in its call). */
  const reportVoiceState = useCallback((channelId, muted, deafened) => {
    const me = currentUserRef.current?.id;
    if (me) setVoiceState(channelId, me, muted, deafened);
    hubRef.current?.invoke('UpdateVoiceState', Number(channelId), !!muted, !!deafened)
      .catch(e => console.warn('UpdateVoiceState failed:', e));
  }, []);

  async function primeVoiceUsers(channelId) {
    const key = String(channelId);
    if (voicePresencePrimedRef.current.has(key) || voicePresenceInflightRef.current.has(key)) return;
    voicePresenceInflightRef.current.add(key);
    try {
      const response = await getUsersInVoice(key);
      setVoiceUsersForChannel(key, response?.users ?? []);
      // older backends don't send states
      const states = {};
      for (const st of response?.states ?? []) {
        states[String(st.userId)] = { muted: !!st.muted, deafened: !!st.deafened };
      }
      setVoiceStatesByChannel(prev => ({ ...prev, [key]: states }));
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

  /** Unread counts from the server, except for the channel on screen (it's being read). */
  async function reloadUnreads() {
    try {
      const counts = await getUnreads();
      const stringKeyed = {};
      for (const [k, v] of Object.entries(counts ?? {})) {
        if (String(k) !== activeChannelIdRef.current) stringKeyed[String(k)] = v;
      }
      setUnreads(stringKeyed);
    } catch (e) { console.warn('getUnreads failed:', e); }
  }

  /**
   * After the hub was down, anything could have changed: messages, unreads, lists, other people's profiles
   * and statuses. Refetch it all, and have the open channel refetch its messages.
   */
  async function resyncAfterOutage() {
    setUserStatuses({});
    setPresenceResync(n => n + 1);
    setSyncGeneration(n => n + 1);
    const ids = Object.keys(userCacheRef.current);
    await Promise.allSettled([
      reloadUnreads(),
      getMyAccount().then(u => setCurrentUser(p => ({ ...(p ?? {}), ...u }))),
      getFriends().then(setFriends),
      getDmChannels().then(setDmChannels),
      reloadGroups(),
      reloadGuilds(),
      refreshBlockedUsers(),
      (async () => {
        for (let i = 0; i < ids.length; i += 500) applyUsers(await getUsersBatch(ids.slice(i, i + 500)));
      })(),
    ]);
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
    if (!id) return null;  // webhook messages have no user author
    if (userCacheRef.current[id]) return userCacheRef.current[id];
    try {
      const u = await getAccountById(id);
      userCacheRef.current[id] = u;
      seedUserStatuses([u]);
      return u;
    } catch {
      const fb = { id, username: id.slice(0, 8) + '…' };
      userCacheRef.current[id] = fb;
      return fb;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRevision]); // reads a ref; a new revision means cached users changed, so callers should resolve again

  /**
   * Record statuses from user records just fetched from the API (PublicUserResponse,
   * or guild member details { user }). Fresh server data, so it replaces what we had.
   */
  const seedUserStatuses = useCallback((records) => {
    const patch = {};
    for (const rec of records ?? []) {
      const u = rec?.user ?? rec;
      if (!u?.id || u.status === undefined) continue;
      patch[String(u.id)] = { status: u.status, statusMessage: u.statusMessage ?? '', statusExpiresAt: u.statusExpiresAt ?? null };
    }
    if (Object.keys(patch).length > 0) setUserStatuses(p => ({ ...p, ...patch }));
  }, []);

  /**
   * Fresh user records from the server: updates the cache, the image versions and statuses, then bumps
   * userRevision so whatever showed the old records shows the new ones.
   */
  const applyUsers = useCallback((list) => {
    const users = (list ?? []).filter(u => u?.id);
    if (users.length === 0) return;
    for (const u of users) {
      userCacheRef.current[u.id] = { ...(userCacheRef.current[u.id] ?? {}), ...u };
      noteUser(u);
    }
    seedUserStatuses(users);
    const mine = users.find(u => u.id === currentUserRef.current?.id);
    if (mine) {
      setCurrentUser(p => p && { ...p, username: mine.username, blurb: mine.blurb, color: mine.color, avatarVersion: mine.avatarVersion });
    }
    setUserRevision(n => n + 1);
  }, [seedUserStatuses]);

  /**
   * How a user's status looks right now: { presence, message, expiresAt }.
   * presence is online | away | dnd | offline, or invisible for yourself while invisible.
   * `fallback` is a user record to use when we have nothing live for them.
   */
  function getUserStatus(userId, fallback) {
    if (userId == null) return resolvePublicStatus(null);
    if (currentUser && String(userId) === String(currentUser.id)) {
      const own = resolveOwnStatus(currentUser, isConnected);
      return { presence: own.presence, message: own.message, expiresAt: own.expiresAt };
    }
    return resolvePublicStatus(userStatuses[String(userId)] ?? fallback);
  }

  /** Your own status: { type, presence, message, expiresAt }. */
  const ownStatus = resolveOwnStatus(currentUser, isConnected);

  function applyOwnStatus(update) {
    if (!update) return;
    setCurrentUser(p => p ? {
      ...p,
      statusType: update.statusType,
      statusMessage: update.statusMessage ?? '',
      statusExpiresAt: update.statusExpiresAt ?? null,
    } : p);
  }

  /** Set your status. expiresAt: Date or null for never. Throws on failure. */
  async function setOwnStatus({ type, message = '', expiresAt = null }) {
    const update = await setMyStatus({
      type, message,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    applyOwnStatus(update);
  }

  async function clearOwnStatus() {
    applyOwnStatus(await clearMyStatus());
  }

  // Expire statuses on time. One timer, set for whichever known status ends first.
  // Your own expiry also tells the server, so everyone else hears (they can't time out
  // an invisible status themselves). The server only clears it if it really has expired.
  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const rec of Object.values(userStatuses)) {
      const t = expiresAtMs(rec.statusExpiresAt);
      if (t != null && t > now && t < next) next = t;
    }
    const ownExpiry = expiresAtMs(currentUser?.statusExpiresAt);
    if (ownExpiry != null && ownExpiry > now && ownExpiry < next) next = ownExpiry;
    if (ownExpiry != null && ownExpiry <= now) {
      // Passed (or the laptop was asleep through it): have the server clear it. If our clock
      // runs ahead of the server's it won't have expired there yet, so check again shortly.
      expireMyStatus().then(applyOwnStatus).catch(e => console.warn('expireMyStatus failed:', e));
      next = Math.min(next, now + 30_000);
    }
    if (next === Infinity) return;
    // setTimeout caps at ~24.8 days; a longer wait just re-checks then
    const delay = Math.min(next - now + 50, 2 ** 31 - 1);
    const timer = setTimeout(() => setStatusClock(c => c + 1), delay);
    return () => clearTimeout(timer);
  }, [userStatuses, currentUser?.statusExpiresAt, statusClock]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Synchronous cache lookup — lets components render a known user on first paint. */
  const peekUser = useCallback((id) => userCacheRef.current[id] ?? null, []);

  /** Store server copies of polls (from messages, events or API responses). */
  const upsertPolls = useCallback((list) => {
    const valid = (list ?? []).filter(Boolean);
    if (valid.length === 0) return;
    setPolls(p => {
      const next = { ...p };
      for (const poll of valid) next[String(poll.id)] = poll;
      return next;
    });
  }, []);

  /** Remember the polls attached to a batch of messages. */
  const rememberMessagePolls = useCallback((msgs) => {
    upsertPolls((msgs ?? []).map(m => m.poll));
  }, [upsertPolls]);

  /** Fetch a channel's running polls (they may be far up its history). */
  const loadActivePolls = useCallback((channelId) => {
    return getActivePolls(channelId).then(upsertPolls).catch(e => console.warn('[AppContext] Failed to load active polls:', e));
  }, [upsertPolls]);

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
      // Never give up: SignalR's default stops after four tries (about 40 s), which a laptop lid or a flaky
      // network easily outlasts, and then the page sat there disconnected and silently stale until reloaded
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: ({ previousRetryCount }) => Math.min(30_000, 1000 * 2 ** Math.min(previousRetryCount, 5)) })
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // Set synchronously BEFORE the first await so any concurrent connectHub()
    // call hits the guard and returns early (fixes React StrictMode double-invoke).
    hubRef.current = conn;

    conn.on('NewMessage', msg => {
      const key = String(msg.channelId);
      if (msg.poll) upsertPolls([msg.poll]);
      setMessages(p => {
        const existing = p[key] ?? [];
        const pendingIdx = existing.findIndex(
          m => m._pending && m.authorId === msg.authorId && m.content === msg.content
        );
        if (pendingIdx !== -1) {
          const updated = [...existing];
          // Keep the pending message's render key so the bubble isn't remounted when confirmed
          updated[pendingIdx] = { ...msg, _key: existing[pendingIdx]._key ?? existing[pendingIdx].id };
          return { ...p, [key]: updated };
        }
        return { ...p, [key]: [...existing, msg] };
      });
      // Clear typing indicator for this user in this channel
      setTypingUsers(p => {
        const updated = p[key] ? new Set(p[key]) : new Set();
        updated.delete(String(msg.authorId));
        if (updated.size === 0) {
          const next = { ...p };
          delete next[key];
          return next;
        }
        return { ...p, [key]: updated };
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

    conn.on('ReceiveNotification', async (content) => {
      // Acknowledge straight away: without it the server decides this connection is dead and sends a push instead
      if (content?.ackId) conn.send('AckNotification', content.ackId).catch(() => {});
      // The server doesn't send these in Do Not Disturb; this covers the moment after switching
      if (isDndNow()) return;
      playSound('notification').catch(e => console.warn('[AppContext] Failed to play notification sound:', e));
    });

    conn.on('PollUpdated', poll => {
      if (poll?.id != null) upsertPolls([poll]);
    });

    conn.on('DeleteMessage', ({ id }) => {
      // A deleted message takes its poll with it
      setPolls(p => {
        const gone = Object.keys(p).filter(k => String(p[k].messageId) === String(id));
        if (gone.length === 0) return p;
        const next = { ...p };
        for (const k of gone) delete next[k];
        return next;
      });
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

    conn.on('MessageEdited', ({ id, channelId, message }) => {
      const key = String(channelId);
      setMessages(p => {
        const existing = p[key];
        if (!existing) return p;
        const idx = existing.findIndex(m => String(m.id) === String(id));
        if (idx === -1) return p;
        const updated = [...existing];
        updated[idx] = existing[idx]._key ? { ...message, _key: existing[idx]._key } : message;
        return { ...p, [key]: updated };
      });
    });

    conn.on('FriendRequestReceived', async ({ fromUserId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(fromUserId);
      addToast({ title: 'New Friend Request', body: `${u.username} sent you a friend request.`, type: 'info', notify: true });
    });

    conn.on('FriendRequestAccepted', async ({ userId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(userId);
      addToast({ title: 'Friend Request Accepted', body: `${u.username} accepted your friend request!`, type: 'success', notify: true });
    });

    conn.on('FriendRemoved', async ({ userId }) => {
      await getFriends().then(setFriends).catch(console.error);
      const u = await resolveUser(userId);
      addToast({ title: 'Friend Removed', body: `${u.username} removed you as a friend.`, type: 'danger', notify: true });
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

    conn.on('ChannelUpdated', ({ channelId }) => {
      if (!channelId) return;
      // Signal components to refresh channel data (icons, etc.)
      setChannelUpdatedEvent({ channelId, ts: Date.now() });
    });

    conn.on('UserUpdated', ({ id, user }) => {
      // A profile change carries the new profile (name, blurb, colour, avatar version)
      if (user) applyUsers([user]);
      // Either way (a guild role change sends only the ID) member lists and colours refetch
      setUserUpdatedEvent({ userId: id, ts: Date.now() });
    });

    conn.on('JoinedGuild', async ({ guildId }) => {
      // Joined on another device (this one already has it when it did the joining)
      if (guildsRef.current.some(g => String(g.id) === String(guildId))) return;
      await reloadGuilds();
      // The server only adds a connection to a guild's group when it connects
      await reconnectHub();
    });

    conn.on('LeftGuild', async ({ guildId }) => {
      // Remove guild from the list
      setGuilds(p => p.filter(g => String(g.id) !== String(guildId)));
      
      // Clear active guild if we're viewing this guild
      setActiveGuildId(prev => String(prev) === String(guildId) ? null : prev);
      
      // Clean up guild-related state
      setGuildPermissions(p => {
        const next = { ...p };
        delete next[guildId];
        return next;
      });
      setGuildMemberColors(p => {
        const next = { ...p };
        delete next[guildId];
        return next;
      });
      setGuildNotifPrefs(p => {
        const next = { ...p };
        delete next[guildId];
        return next;
      });
      delete guildPermissionsRef.current[guildId];
      delete guildNotifPrefsRef.current[guildId];
      
      // Show toast notification
      addToast({
        title: 'Left Guild',
        body: 'You have been removed from the guild.',
        type: 'info',
        duration: 5000,
        notify: true,
      });
    });

    conn.on('ClientJoinVoice', ({ userId, channelId }) => {
      if (userId == null || channelId == null) return;
      addVoiceUser(channelId, userId);
    });

    conn.on('ClientLeaveVoice', ({ userId, channelId }) => {
      if (userId == null || channelId == null) return;
      removeVoiceUser(channelId, userId);
    });

    conn.on('ClientVoiceStateUpdated', ({ userId, channelId, muted, deafened }) => {
      if (userId == null || channelId == null) return;
      setVoiceState(channelId, userId, muted, deafened);
    });

    conn.on('UserStatusUpdated', ({ userId, status, statusMessage, statusExpiresAt }) => {
      if (userId == null) return;
      // Your own status comes from OwnStatusUpdated (this one says "offline" while you're invisible)
      if (String(userId) === String(currentUserRef.current?.id)) return;
      setUserStatuses(p => ({ ...p, [String(userId)]: { status, statusMessage: statusMessage ?? '', statusExpiresAt: statusExpiresAt ?? null } }));
    });

    conn.on('OwnStatusUpdated', update => applyOwnStatus(update));

    conn.on('UserTyping', ({ userId, channelId }) => {
      if (!userId || !channelId) return;
      const key = String(channelId);
      const userIdStr = String(userId);
      
      // Clear any existing timeout for this user in this channel
      if (clearTypingRef.current[key]?.[userIdStr]) {
        clearTimeout(clearTypingRef.current[key][userIdStr]);
      }
      
      // Add user to typing set
      setTypingUsers(p => {
        const current = p[key] ? new Set(p[key]) : new Set();
        current.add(userIdStr);
        return { ...p, [key]: current };
      });
      
      // Set 4-second auto-clear timeout
      const timeoutId = setTimeout(() => {
        setTypingUsers(p => {
          const updated = p[key] ? new Set(p[key]) : new Set();
          updated.delete(userIdStr);
          if (updated.size === 0) {
            const next = { ...p };
            delete next[key];
            return next;
          }
          return { ...p, [key]: updated };
        });
        // Clean up ref
        if (clearTypingRef.current[key]) {
          delete clearTypingRef.current[key][userIdStr];
        }
      }, 4000);
      
      // Store timeout ID for potential cleanup
      if (!clearTypingRef.current[key]) clearTypingRef.current[key] = {};
      clearTypingRef.current[key][userIdStr] = timeoutId;
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
      // Everything that happened while we were away was missed
      resyncAfterOutage();
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
      // Only the first connection follows a fresh load; one that took retries may have missed things
      if (connectAttemptsRef.current > 0) resyncAfterOutage();
      connectAttemptsRef.current = 0;
      // Send status immediately then every 30 seconds
      const sendStatus = () => conn.invoke('UpdateStatus').catch(() => {});
      sendStatus();
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(sendStatus, 30_000);
    } catch (e) {
      hubRef.current = null;
      console.error('SignalR connect failed:', e);
      // The server may be restarting or the network down: keep trying, like a dropped connection does
      const attempt = ++connectAttemptsRef.current;
      clearTimeout(connectRetryRef.current);
      connectRetryRef.current = setTimeout(() => connectHub(), Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
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
      initialDataLoaded,
      messages,  setMessages,
      polls, upsertPolls, rememberMessagePolls, loadActivePolls,
      channelLastActive,
      toasts, addToast, removeToast,
      channelEvent,
      guildChannelEvent,
      resolveUser,
      peekUser,
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
      channelUpdatedEvent,
      userStatuses, seedUserStatuses, getUserStatus, presenceResync, statusClock, syncGeneration,
      ownStatus, setOwnStatus, clearOwnStatus,
      typingUsers,
      hubRef,
      channelToGuild,
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
      voiceStatesByChannel,
      primeVoiceUsers,
      reportVoiceState,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
