import { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import {
  getMyAccount, getFriends, getDmChannels,
  getGroupChats, getGroupChat, getAccountById, getMyGuilds,
} from '../api.js';

const Ctx = createContext(null);

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://100.115.82.61:5210';

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser]   = useState(null);
  const [friends,     setFriends]       = useState([]);
  const [dmChannels,  setDmChannels]    = useState([]);
  const [groupChats,  setGroupChats]    = useState([]);
  const [guilds,      setGuilds]        = useState([]);
  const [userCache,   setUserCache]     = useState({});
  const [isConnected, setIsConnected]   = useState(false);
  const [messages,    setMessages]      = useState({});   // channelId (string) -> msg[]
  const [toasts,        setToasts]        = useState([]);
  const [channelEvent,  setChannelEvent]  = useState(null); // { type, channelId, data }
  const [guildChannelEvent, setGuildChannelEvent] = useState(null); // { type, channelId, guildId }
  // Initialise from URL so the correct sidebar is shown immediately on page reload
  const [activeGuildId, setActiveGuildId] = useState(() => {
    const m = window.location.pathname.match(/\/app\/guild\/(\d+)/);
    return m ? m[1] : null;
  });

  const hubRef       = useRef(null);
  const userCacheRef = useRef({});
  const heartbeatRef = useRef(null);

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
    try {
      const [user, fr, dms] = await Promise.all([
        getMyAccount(), getFriends(), getDmChannels(),
      ]);
      setCurrentUser(user);
      setFriends(fr);
      setDmChannels(dms);
      await reloadGroups();
      await reloadGuilds();
      connectHub();
    } catch (e) {
      console.error('AppContext init failed:', e);
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
    } catch (e) { console.error('reloadGuilds failed:', e); }
  }

  async function resolveUser(id) {
    if (userCacheRef.current[id]) return userCacheRef.current[id];
    try {
      const u = await getAccountById(id);
      userCacheRef.current[id] = u;
      setUserCache(p => ({ ...p, [id]: u }));
      return u;
    } catch {
      const fb = { id, username: id.slice(0, 8) + '…' };
      userCacheRef.current[id] = fb;
      return fb;
    }
  }

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

    conn.on('NewChannel', async (channel) => {
      // channel.type: 0=Guild, 1=DM, 2=Group
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

  return (
    <Ctx.Provider value={{
      currentUser,
      friends,  setFriends,
      dmChannels, setDmChannels,
      groupChats, setGroupChats,
      guilds,     setGuilds,
      userCache, isConnected,
      messages,  setMessages,
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
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
