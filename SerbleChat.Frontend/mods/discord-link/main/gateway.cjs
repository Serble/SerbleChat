// A minimal Discord gateway + REST client: just enough to log in, know the guilds, voice channels and
// who's in them, join voice, and watch streams. Works with a user token (acting as your account) or a
// bot token.

const { EventEmitter } = require('events');
const crypto = require('crypto');
const WebSocket = require('ws');

// Overridable for testing against a stand-in server
const API = process.env.DISCORD_LINK_API ?? 'https://discord.com/api/v9';
const GATEWAY = process.env.DISCORD_LINK_GATEWAY ?? 'wss://gateway.discord.gg';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9210 Chrome/134.0.6998.205 Electron/35.3.0 Safari/537.36';

// What the desktop client says about itself. Sent on identify and (base64) with REST requests.
const PROPERTIES = {
  os: 'Windows',
  browser: 'Discord Client',
  release_channel: 'stable',
  client_version: '1.0.9210',
  os_version: '10.0.19044',
  os_arch: 'x64',
  app_arch: 'x64',
  system_locale: 'en-US',
  has_client_mods: false,
  browser_user_agent: USER_AGENT,
  browser_version: '35.3.0',
  os_sdk_version: '19044',
  client_build_number: 455964,
  native_build_number: 69976,
  client_event_source: null,
};

const Op = {
  DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, VOICE_STATE_UPDATE: 4, RESUME: 6, RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11,
  STREAM_DELETE: 19, STREAM_WATCH: 20,
};

// Channel types that have voice
const VOICE_CHANNEL_TYPES = new Set([2, 13]);

class DiscordGateway extends EventEmitter {
  constructor({ token, bot = false, log }) {
    super();
    this.token = token;
    this.bot = bot;
    this.log = log;
    this.ws = null;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.heartbeatTimer = null;
    this.acked = true;
    this.closed = false;
    this.status = 'connecting'; // connecting | ready | reconnecting | error | closed
    this.error = null;
    this.user = null;
    /** guildId -> { id, name, icon, channels: Map<id, channel>, voiceStates: Map<userId, state> } */
    this.guilds = new Map();
    /** userId -> user */
    this.users = new Map();
    /** `${guildId}:${userId}` -> member (for nicknames) */
    this.members = new Map();
    this.friends = new Set();
    this.pendingMemberRequests = new Set();
    this.launchId = crypto.randomUUID();
  }

  // ── REST ──

  async request(method, path, body) {
    const headers = {
      Authorization: this.bot ? `Bot ${this.token}` : this.token,
      'User-Agent': this.bot ? 'DiscordBot (https://serble.net, 0.1)' : USER_AGENT,
    };
    if (!this.bot) headers['X-Super-Properties'] = Buffer.from(JSON.stringify({ ...PROPERTIES, client_launch_id: this.launchId })).toString('base64');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.message ?? `Discord said ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Gateway connection ──

  connect(resume = false) {
    const url = `${resume && this.resumeUrl ? this.resumeUrl : GATEWAY}/?encoding=json&v=9`;
    const ws = new WebSocket(url, { headers: this.bot ? {} : { 'User-Agent': USER_AGENT } });
    this.ws = ws;
    ws.on('message', (data) => {
      let packet;
      try { packet = JSON.parse(data.toString()); } catch { return; }
      try { this.onPacket(packet, resume); } catch (err) { this.log.error('Gateway packet handling failed:', err); }
    });
    ws.on('close', (code, reason) => this.onClose(ws, code, String(reason)));
    ws.on('error', (err) => this.log.warn('Gateway socket error:', err.message));
  }

  send(op, d) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  close() {
    this.closed = true;
    this.status = 'closed';
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimer);
    try { this.ws?.close(1000); } catch { /* already closed */ }
    this.emit('status');
  }

  onClose(ws, code, reason) {
    if (ws !== this.ws) return;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimer);
    if (this.closed) return;
    this.log.warn(`Gateway closed (${code}${reason ? `: ${reason}` : ''})`);
    // Codes that mean trying again won't help
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
      this.status = 'error';
      this.error = code === 4004 ? 'Discord rejected the token' : `Discord closed the connection (${code}${reason ? `: ${reason}` : ''})`;
      this.closed = true;
      this.emit('status');
      this.emit('fatal', this.error);
      return;
    }
    this.status = 'reconnecting';
    this.emit('status');
    const canResume = this.sessionId && ![4007, 4009].includes(code);
    if (!canResume) { this.sessionId = null; this.seq = null; }
    setTimeout(() => { if (!this.closed) this.connect(canResume); }, 1000 + Math.random() * 2000);
  }

  startHeartbeat(interval) {
    clearInterval(this.heartbeatTimer);
    this.acked = true;
    const beat = () => {
      if (!this.acked) {
        this.log.warn('Gateway heartbeat not acknowledged; reconnecting');
        try { this.ws?.terminate(); } catch { /* gone */ }
        return;
      }
      this.acked = false;
      this.send(Op.HEARTBEAT, this.seq);
    };
    // The first one after a random part of the interval, as Discord asks
    this.heartbeatTimer = setTimeout(() => {
      beat();
      this.heartbeatTimer = setInterval(beat, interval);
    }, interval * Math.random());
  }

  identify() {
    if (this.bot) {
      this.send(Op.IDENTIFY, {
        token: this.token,
        // GUILDS | GUILD_VOICE_STATES
        intents: (1 << 0) | (1 << 7),
        properties: { os: process.platform, browser: 'Serble Chat', device: 'Serble Chat' },
      });
    } else {
      this.send(Op.IDENTIFY, {
        token: this.token,
        capabilities: 0,
        properties: { ...PROPERTIES, client_launch_id: this.launchId },
        presence: { status: 'unknown', since: 0, activities: [], afk: false },
        compress: false,
        client_state: { guild_versions: {} },
      });
    }
  }

  onPacket({ op, d, s, t }, resuming) {
    if (s != null) this.seq = s;
    switch (op) {
      case Op.HELLO:
        this.startHeartbeat(d.heartbeat_interval);
        if (resuming && this.sessionId) this.send(Op.RESUME, { token: this.token, session_id: this.sessionId, seq: this.seq });
        else this.identify();
        break;
      case Op.HEARTBEAT_ACK:
        this.acked = true;
        break;
      case Op.HEARTBEAT:
        this.send(Op.HEARTBEAT, this.seq);
        break;
      case Op.RECONNECT:
        try { this.ws.close(4900); } catch { /* gone */ }
        break;
      case Op.INVALID_SESSION:
        if (!d) { this.sessionId = null; this.seq = null; }
        setTimeout(() => {
          if (this.closed) return;
          if (d && this.sessionId) this.send(Op.RESUME, { token: this.token, session_id: this.sessionId, seq: this.seq });
          else this.identify();
        }, 1000 + Math.random() * 4000);
        break;
      case Op.DISPATCH:
        this.onDispatch(t, d);
        this.emit('dispatch', t, d);
        break;
    }
  }

  // ── State ──

  noteUser(user) {
    if (!user?.id) return;
    this.users.set(user.id, { ...this.users.get(user.id), ...user });
  }

  noteMember(guildId, member) {
    if (!member) return;
    const userId = member.user?.id ?? member.user_id;
    if (!userId) return;
    if (member.user) this.noteUser(member.user);
    this.members.set(`${guildId}:${userId}`, member);
  }

  noteGuild(g) {
    if (!g?.id || g.unavailable) return;
    const existing = this.guilds.get(g.id);
    const guild = existing ?? { id: g.id, channels: new Map(), voiceStates: new Map() };
    guild.name = g.name ?? g.properties?.name ?? guild.name ?? 'Unknown server';
    guild.icon = g.icon ?? g.properties?.icon ?? guild.icon ?? null;
    this.guilds.set(g.id, guild);
    for (const c of g.channels ?? []) guild.channels.set(c.id, c);
    for (const vs of g.voice_states ?? []) this.noteVoiceState({ ...vs, guild_id: g.id }, false);
    for (const m of g.members ?? []) this.noteMember(g.id, m);
  }

  noteVoiceState(vs, announce = true) {
    const guild = this.guilds.get(vs.guild_id);
    if (vs.member) this.noteMember(vs.guild_id, vs.member);
    if (guild) {
      if (vs.channel_id) guild.voiceStates.set(vs.user_id, vs);
      else guild.voiceStates.delete(vs.user_id);
    }
    if (announce) this.emit('voiceState', vs);
  }

  onDispatch(t, d) {
    switch (t) {
      case 'READY':
        this.status = 'ready';
        this.error = null;
        this.user = d.user;
        this.sessionId = d.session_id;
        this.resumeUrl = d.resume_gateway_url ?? null;
        this.noteUser(d.user);
        for (const u of d.users ?? []) this.noteUser(u);
        for (const r of d.relationships ?? []) {
          if (r.user) this.noteUser(r.user);
          if (r.type === 1) this.friends.add(r.user?.id ?? r.id);
        }
        for (const g of d.guilds ?? []) this.noteGuild(g);
        (d.merged_members ?? []).forEach((list, i) => {
          const guildId = d.guilds?.[i]?.id;
          for (const m of list ?? []) this.noteMember(guildId, m);
        });
        this.emit('ready');
        this.emit('status');
        break;
      case 'READY_SUPPLEMENTAL':
        for (const g of d.guilds ?? []) {
          for (const vs of g.voice_states ?? []) this.noteVoiceState({ ...vs, guild_id: g.id }, false);
        }
        (d.merged_members ?? []).forEach((list, i) => {
          const guildId = d.guilds?.[i]?.id;
          for (const m of list ?? []) this.noteMember(guildId, m);
        });
        this.emit('guilds');
        break;
      case 'RESUMED':
        this.status = 'ready';
        this.emit('resumed');
        this.emit('status');
        break;
      case 'GUILD_CREATE':
      case 'GUILD_UPDATE':
        this.noteGuild(d);
        this.emit('guilds');
        break;
      case 'GUILD_DELETE':
        if (!d.unavailable) this.guilds.delete(d.id);
        this.emit('guilds');
        break;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        if (d.guild_id) this.guilds.get(d.guild_id)?.channels.set(d.id, d);
        this.emit('guilds');
        break;
      case 'CHANNEL_DELETE':
        if (d.guild_id) this.guilds.get(d.guild_id)?.channels.delete(d.id);
        this.emit('guilds');
        break;
      case 'VOICE_STATE_UPDATE':
        this.noteVoiceState(d);
        break;
      case 'GUILD_MEMBERS_CHUNK':
        for (const m of d.members ?? []) this.noteMember(d.guild_id, m);
        this.emit('members');
        break;
      case 'GUILD_MEMBER_UPDATE':
        this.noteMember(d.guild_id, d);
        this.emit('members');
        break;
    }
  }

  // ── Helpers ──

  /** Asks for the member records of people we don't know yet (names, nicknames, avatars). */
  requestMembers(guildId, userIds) {
    const missing = userIds.filter(id => !this.members.has(`${guildId}:${id}`) && !this.pendingMemberRequests.has(`${guildId}:${id}`));
    if (!missing.length) return;
    for (const id of missing) this.pendingMemberRequests.add(`${guildId}:${id}`);
    this.send(Op.REQUEST_GUILD_MEMBERS, { guild_id: guildId, user_ids: missing.slice(0, 100), presences: false });
    // Fall back to REST for anyone the gateway doesn't answer for
    setTimeout(() => {
      for (const id of missing) {
        if (this.members.has(`${guildId}:${id}`) || this.users.get(id)?.username) continue;
        this.request('GET', `/users/${id}`).then(u => { this.noteUser(u); this.emit('members'); }).catch(() => {});
      }
    }, 3000);
  }

  displayName(guildId, userId) {
    const member = guildId ? this.members.get(`${guildId}:${userId}`) : null;
    const user = this.users.get(userId);
    return member?.nick ?? user?.global_name ?? user?.username ?? null;
  }

  avatarUrl(guildId, userId) {
    const member = guildId ? this.members.get(`${guildId}:${userId}`) : null;
    if (member?.avatar) return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${member.avatar}.png?size=64`;
    const user = this.users.get(userId);
    if (user?.avatar) return `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=64`;
    const index = user?.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }

  /** The guilds and their voice channels, for pickers. */
  describeGuilds() {
    return [...this.guilds.values()]
      .map(g => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        channels: [...g.channels.values()]
          .filter(c => VOICE_CHANNEL_TYPES.has(c.type))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map(c => ({ id: c.id, name: c.name, type: c.type, members: [...g.voiceStates.values()].filter(v => v.channel_id === c.id).length })),
      }))
      .filter(g => g.channels.length)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  joinVoice(guildId, channelId, { selfMute = false, selfDeaf = false } = {}) {
    this.send(Op.VOICE_STATE_UPDATE, { guild_id: guildId, channel_id: channelId, self_mute: selfMute, self_deaf: selfDeaf, self_video: false });
  }

  watchStream(streamKey) {
    this.send(Op.STREAM_WATCH, { stream_key: streamKey });
  }

  stopStream(streamKey) {
    this.send(Op.STREAM_DELETE, { stream_key: streamKey });
  }
}

module.exports = { DiscordGateway, VOICE_CHANNEL_TYPES };
