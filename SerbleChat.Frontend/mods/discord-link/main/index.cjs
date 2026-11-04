// Discord Link, main half: the Discord account, the voice connection and any streams being watched.
// The page half (renderer/) decides when to join and leave, sends the mic as Opus, and plays and
// shows what comes back.

const fs = require('fs');
const path = require('path');
const { DiscordGateway } = require('./gateway.cjs');
const { VoiceConnection } = require('./voice.cjs');

module.exports = {
  start(ctx) {
    const { safeStorage } = ctx.electron;
    const log = { log: ctx.log, warn: ctx.warn, error: ctx.error };
    const accountFile = path.join(ctx.dataDir, 'account.json');

    let gateway = null;
    // What the page wants: { guildId, channelId, selfMute, selfDeaf } or null
    let want = null;
    // Our own voice state from Discord, and the server it's on
    let voiceSessionId = null;
    let voiceServer = null;
    let voice = null;
    let voiceStatus = 'idle';
    let voiceError = null;
    /** streamKey -> { status, error, rtcServerId, server, conn } */
    const streams = new Map();
    // The people whose cameras the page is showing (the voice server sends everyone's)
    let cameras = new Set();

    // ── State for the page ──

    let stateTimer = null;
    function pushState() {
      if (stateTimer) return;
      stateTimer = setTimeout(() => {
        stateTimer = null;
        ctx.ipc.send('state', describe());
      }, 50);
    }

    function describeUser(guildId, userId) {
      return {
        id: userId,
        name: gateway.displayName(guildId, userId) ?? `User ${userId.slice(-4)}`,
        username: gateway.users.get(userId)?.username ?? null,
        avatar: gateway.avatarUrl(guildId, userId),
      };
    }

    function describe() {
      const account = gateway
        ? {
          status: gateway.status,
          error: gateway.error,
          bot: gateway.bot,
          user: gateway.user ? describeUser(null, gateway.user.id) : null,
        }
        : { status: 'logged-out', error: null, bot: false, user: null };
      let voiceState = null;
      if (want && gateway) {
        const guild = gateway.guilds.get(want.guildId);
        const channel = guild?.channels.get(want.channelId);
        const states = guild ? [...guild.voiceStates.values()].filter(v => v.channel_id === want.channelId) : [];
        const unknown = states.map(s => s.user_id).filter(id => !gateway.displayName(want.guildId, id));
        if (unknown.length) gateway.requestMembers(want.guildId, unknown);
        voiceState = {
          guildId: want.guildId,
          channelId: want.channelId,
          guildName: guild?.name ?? null,
          channelName: channel?.name ?? null,
          status: voiceStatus,
          error: voiceError,
          privacyCode: voice?.privacyCode ?? null,
          members: states.map(s => ({
            ...describeUser(want.guildId, s.user_id),
            isMe: s.user_id === gateway.user?.id,
            selfMute: !!s.self_mute, selfDeaf: !!s.self_deaf, mute: !!s.mute, deaf: !!s.deaf,
            streaming: !!s.self_stream, video: !!s.self_video,
            streamKey: s.self_stream ? `guild:${want.guildId}:${want.channelId}:${s.user_id}` : null,
          })),
        };
      }
      const streamStates = {};
      for (const [key, s] of streams) streamStates[key] = { status: s.status, error: s.error };
      return { account, voice: voiceState, streams: streamStates };
    }

    // ── Account ──

    function saveAccount(token, bot) {
      const secure = safeStorage.isEncryptionAvailable();
      const stored = secure ? safeStorage.encryptString(token).toString('base64') : token;
      fs.writeFileSync(accountFile, JSON.stringify({ token: stored, encrypted: secure, bot }), { mode: 0o600 });
    }

    function loadAccount() {
      try {
        const saved = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
        const token = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.token, 'base64')) : saved.token;
        return { token, bot: !!saved.bot };
      } catch {
        return null;
      }
    }

    function login(token, bot) {
      logout(false);
      gateway = new DiscordGateway({ token, bot, log });
      gateway.on('status', pushState);
      gateway.on('guilds', pushState);
      gateway.on('members', pushState);
      gateway.on('ready', () => {
        ctx.log(`Logged in to Discord as ${gateway.user.username}`);
        // Back after a reconnect that couldn't resume: our voice state is gone, so join again
        if (want) joinVoice(want);
      });
      // A join asked for while reconnecting
      gateway.on('resumed', () => { if (want && voiceStatus === 'waiting') joinVoice(want); });
      gateway.on('voiceState', onVoiceState);
      gateway.on('dispatch', onDispatch);
      gateway.connect();
      pushState();
      return gateway;
    }

    function logout(forget = true) {
      leaveVoice();
      if (gateway) {
        gateway.removeAllListeners();
        gateway.close();
        gateway = null;
      }
      if (forget) {
        try { fs.unlinkSync(accountFile); } catch { /* not saved */ }
      }
      pushState();
    }

    // ── Voice ──

    function joinVoice(target) {
      if (!gateway || gateway.status !== 'ready') {
        want = target;
        voiceStatus = 'waiting';
        pushState();
        return;
      }
      const moving = !want || want.guildId !== target.guildId || want.channelId !== target.channelId;
      want = target;
      if (moving || !voice) {
        destroyVoice();
        voiceStatus = 'joining';
        voiceError = null;
      }
      gateway.joinVoice(target.guildId, target.channelId, { selfMute: !!target.selfMute, selfDeaf: !!target.selfDeaf });
      pushState();
    }

    function leaveVoice() {
      const wasIn = want;
      want = null;
      destroyVoice();
      for (const key of [...streams.keys()]) stopWatching(key);
      voiceStatus = 'idle';
      voiceError = null;
      if (wasIn && gateway?.status === 'ready') gateway.joinVoice(wasIn.guildId, null);
      pushState();
    }

    function destroyVoice() {
      if (voice) {
        voice.removeAllListeners();
        voice.destroy();
        voice = null;
      }
      voiceSessionId = null;
      voiceServer = null;
    }

    function onVoiceState(vs) {
      if (want && vs.guild_id === want.guildId) pushState();
      if (vs.user_id !== gateway.user?.id || !want || vs.guild_id !== want.guildId) return;
      if (!vs.channel_id) {
        // Disconnected (or kicked) on Discord's side
        if (voiceStatus === 'connected' || voiceStatus === 'connecting') {
          destroyVoice();
          voiceStatus = 'error';
          voiceError = 'Disconnected from the Discord channel';
          pushState();
        }
        return;
      }
      if (vs.channel_id !== want.channelId) {
        // Moved by someone: follow
        want = { ...want, channelId: vs.channel_id };
      }
      if (vs.session_id && vs.session_id !== voiceSessionId) {
        voiceSessionId = vs.session_id;
        maybeConnectVoice(true);
      }
    }

    function onDispatch(t, d) {
      if (t === 'VOICE_SERVER_UPDATE') {
        if (!want || d.guild_id !== want.guildId) return;
        if (!d.endpoint) {
          // The server's going away; another update follows
          destroyVoice();
          voiceStatus = 'connecting';
          pushState();
          return;
        }
        // The same server again (it's re-sent sometimes): keep the connection
        if (voice && voiceServer?.endpoint === d.endpoint && voiceServer?.token === d.token) return;
        voiceServer = { endpoint: d.endpoint, token: d.token };
        maybeConnectVoice(true);
      } else if (t === 'STREAM_CREATE') {
        const s = streams.get(d.stream_key);
        if (!s) return;
        s.rtcServerId = d.rtc_server_id;
        maybeConnectStream(d.stream_key);
      } else if (t === 'STREAM_SERVER_UPDATE') {
        const s = streams.get(d.stream_key);
        if (!s) return;
        s.server = { endpoint: d.endpoint, token: d.token };
        maybeConnectStream(d.stream_key);
      } else if (t === 'STREAM_DELETE') {
        const s = streams.get(d.stream_key);
        if (!s) return;
        s.conn?.destroy();
        s.conn = null;
        s.status = 'ended';
        s.error = d.reason === 'unauthorized' ? 'Not allowed to watch' : null;
        ctx.ipc.send('streamEnded', d.stream_key);
        pushState();
      }
    }

    function maybeConnectVoice(replace) {
      if (!want || !voiceSessionId || !voiceServer || !gateway?.user) return;
      if (voice && !replace) return;
      if (voice) { voice.removeAllListeners(); voice.destroy(); }
      voiceStatus = 'connecting';
      const conn = new VoiceConnection({
        kind: 'voice',
        endpoint: voiceServer.endpoint,
        token: voiceServer.token,
        serverId: want.guildId,
        sessionId: voiceSessionId,
        userId: gateway.user.id,
        daveChannelId: want.channelId,
        log,
      });
      voice = conn;
      conn.on('ready', () => { voiceStatus = 'connected'; voiceError = null; pushState(); });
      conn.on('privacy', pushState);
      conn.on('audio', (userId, ts, opus) => ctx.ipc.send('a', userId, ts, opus));
      conn.on('video', (userId, frame) => {
        if (cameras.has(userId)) ctx.ipc.send('v', `camera:${userId}`, frame.codec, frame.keyframe, frame.discontinuity, frame.timestamp, frame.data);
      });
      conn.on('close', (code, reason) => {
        if (voice !== conn) return;
        voice = null;
        voiceStatus = 'error';
        voiceError = `Discord voice disconnected (${code}${reason ? `: ${reason}` : ''})`;
        pushState();
        // Ask for a new voice server after a drop we didn't ask for
        if (want && code !== 4014 && code !== 4022) setTimeout(() => { if (want && !voice) joinVoice(want); }, 2000);
      });
      pushState();
    }

    // ── Streams ──

    function watchStream(streamKey) {
      if (!gateway || !want) throw new Error('Not in a Discord voice channel');
      if (streams.has(streamKey) && streams.get(streamKey).status !== 'ended') return;
      streams.set(streamKey, { status: 'connecting', error: null, rtcServerId: null, server: null, conn: null });
      gateway.watchStream(streamKey);
      pushState();
    }

    function stopWatching(streamKey) {
      const s = streams.get(streamKey);
      if (!s) return;
      s.conn?.removeAllListeners();
      s.conn?.destroy();
      streams.delete(streamKey);
      if (gateway?.status === 'ready') gateway.stopStream(streamKey);
      pushState();
    }

    function maybeConnectStream(streamKey) {
      const s = streams.get(streamKey);
      if (!s || !s.rtcServerId || !s.server || !voiceSessionId || !gateway?.user) return;
      s.conn?.removeAllListeners();
      s.conn?.destroy();
      const streamerId = streamKey.split(':').pop();
      const conn = new VoiceConnection({
        kind: 'stream',
        endpoint: s.server.endpoint,
        token: s.server.token,
        serverId: s.rtcServerId,
        sessionId: voiceSessionId,
        userId: gateway.user.id,
        daveChannelId: (BigInt(s.rtcServerId) - 1n).toString(),
        log,
      });
      s.conn = conn;
      conn.on('ready', () => { s.status = 'live'; pushState(); });
      conn.on('audio', (userId, ts, opus) => { if (userId === streamerId) ctx.ipc.send('a', `stream:${streamKey}`, ts, opus); });
      conn.on('video', (userId, frame) => {
        if (userId === streamerId) ctx.ipc.send('v', `stream:${streamKey}`, frame.codec, frame.keyframe, frame.discontinuity, frame.timestamp, frame.data);
      });
      conn.on('close', (code, reason) => {
        if (s.conn !== conn) return;
        s.conn = null;
        s.status = 'ended';
        s.error = `Stream connection closed (${code}${reason ? `: ${reason}` : ''})`;
        ctx.ipc.send('streamEnded', streamKey);
        pushState();
      });
      pushState();
    }

    // ── IPC from the page ──

    ctx.ipc.handle('state', () => describe());

    ctx.ipc.handle('login', async ({ token, bot }) => {
      token = String(token ?? '').trim().replace(/^Bot\s+/i, '');
      if (!token) throw new Error('Enter a token');
      const g = login(token, !!bot);
      // Wait for READY, so a bad token is reported here
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to Discord')), 20000);
        g.once('ready', () => { clearTimeout(timer); resolve(); });
        g.once('fatal', (message) => { clearTimeout(timer); reject(new Error(message)); });
      }).catch(err => { logout(false); throw err; });
      saveAccount(token, !!bot);
      return describe();
    });

    ctx.ipc.handle('logout', () => { logout(true); return describe(); });

    ctx.ipc.handle('guilds', () => gateway?.describeGuilds() ?? []);

    // Discord people we know of (friends, and anyone in a voice channel we can see), for linking accounts
    ctx.ipc.handle('knownUsers', () => {
      if (!gateway) return [];
      const ids = new Set(gateway.friends);
      for (const g of gateway.guilds.values()) for (const id of g.voiceStates.keys()) ids.add(id);
      ids.delete(gateway.user?.id);
      return [...ids].map(id => describeUser(want?.guildId ?? null, id)).sort((a, b) => a.name.localeCompare(b.name));
    });

    ctx.ipc.handle('user', async (id) => {
      if (!gateway) return null;
      if (!gateway.users.get(id)?.username) {
        try { gateway.noteUser(await gateway.request('GET', `/users/${id}`)); } catch { return null; }
      }
      return describeUser(want?.guildId ?? null, id);
    });

    ctx.ipc.handle('join', (target) => { joinVoice(target); return describe(); });
    ctx.ipc.handle('leave', () => { leaveVoice(); return describe(); });
    ctx.ipc.handle('selfState', ({ selfMute, selfDeaf }) => {
      if (!want) return;
      if (!!want.selfMute === !!selfMute && !!want.selfDeaf === !!selfDeaf) return;
      want = { ...want, selfMute: !!selfMute, selfDeaf: !!selfDeaf };
      if (gateway?.status === 'ready') gateway.joinVoice(want.guildId, want.channelId, want);
      if (selfMute) voice?.stopSpeaking();
    });

    ctx.ipc.handle('watch', (streamKey) => { watchStream(streamKey); return describe(); });
    ctx.ipc.handle('unwatch', (streamKey) => { stopWatching(streamKey); return describe(); });
    ctx.ipc.on('cameras', (userIds) => { cameras = new Set(userIds); });
    ctx.ipc.handle('keyframe', (key) => {
      if (key.startsWith('stream:')) {
        const streamKey = key.slice('stream:'.length);
        streams.get(streamKey)?.conn?.requestKeyframeFor(streamKey.split(':').pop());
      } else if (key.startsWith('camera:')) {
        voice?.requestKeyframeFor(key.slice('camera:'.length));
      }
    });

    // The mic, as Opus packets with their RTP timestamps
    ctx.ipc.on('opus', (data, timestamp) => voice?.sendOpus(Buffer.from(data), timestamp));
    ctx.ipc.on('silence', () => voice?.stopSpeaking());

    // Log back in with the saved account
    const saved = loadAccount();
    if (saved) login(saved.token, saved.bot);

    ctx.onStop(() => {
      // Leave the channel properly, so we don't hang around in it on Discord
      leaveVoice();
      logout(false);
    });
  },
};
