// Discord Link, page half. Joins the linked Discord voice channel whenever you're in a linked Serble
// call, sends your Serble mic there, plays the Discord side, shows who's in it, and lets you watch
// their streams. People whose Serble and Discord accounts you've linked are muted on the Discord side
// while they're in the Serble call (you already hear them there).

import htm from '../node_modules/htm/dist/htm.module.js';
import { AudioEngine } from './audio.js';
import { VideoSink } from './video.js';

const DEFAULT_THRESHOLD = -50; // dBFS
const SPEAKING_LEVEL = 0.008;

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach(fn => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const volumeToGain = (v) => Math.max(0, Math.min(2, Number(v) || 0)) ** 2;

export default function start(api) {
  const { React } = api;
  const html = htm.bind(React.createElement);
  const { useState, useEffect, useRef, useSyncExternalStore } = React;
  const UI = api.modules.ui;
  const I = api.modules.icons;

  // ── State ──

  const saved = (key, fallback) => api.storage.get(key, fallback);
  const store = createStore({
    main: null, // the main half's state (account, voice, streams)
    channelLinks: saved('channelLinks', {}), // serbleChannelId -> { guildId, channelId, guildName, channelName, serbleName }
    accountLinks: saved('accountLinks', {}), // serbleUserId -> { discordId, discordName, serbleName }
    prefs: saved('prefs', {}), // discordUserId -> { muted, volume }
    streamVolumes: saved('streamVolumes', {}), // streamKey -> volume
    threshold: saved('threshold', DEFAULT_THRESHOLD),
    watching: [], // [{ key: 'stream:<streamKey>' | 'camera:<userId>', title }]
  });
  // Changes many times a second, so kept apart (only the components showing it re-render)
  const live = createStore({ levels: {}, videoInfo: {}, speakingSelf: false });

  const persist = (key, value) => {
    store.set({ [key]: value });
    api.storage.set(key, value);
  };

  const useStore = (s, select) => useSyncExternalStore(s.subscribe, () => select(s.get()));

  api.ipc.on('state', (main) => store.set({ main }));
  api.ipc.invoke('state').then(main => store.set({ main })).catch(() => {});

  // ── Audio ──

  /** The Serble user a Discord account is linked to, if any. */
  function serbleIdFor(discordId) {
    for (const [serbleId, link] of Object.entries(store.get().accountLinks)) if (link.discordId === discordId) return serbleId;
    return null;
  }

  function serbleParticipantIds() {
    const participants = api.voice.get()?.voiceParticipants ?? [];
    return new Set(participants.filter(p => !p.isLocal).map(p => String(p.identity)));
  }

  /** Whether you're hearing this Discord user through Serble already (their linked account is in the call). */
  function heardInSerble(discordId) {
    const serbleId = serbleIdFor(discordId);
    return !!serbleId && serbleParticipantIds().has(serbleId);
  }

  function gainFor(key) {
    const s = store.get();
    if (key.startsWith('stream:')) return volumeToGain(s.streamVolumes[key.slice('stream:'.length)] ?? 1);
    const p = s.prefs[key] ?? {};
    if (p.muted || heardInSerble(key)) return 0;
    return volumeToGain(p.volume ?? 1);
  }

  let levelsQueued = null;
  const engine = new AudioEngine({
    gainFor,
    log: api,
    onLevels(levels) {
      // At most ten updates a second reach React
      if (levelsQueued) { levelsQueued = levels; return; }
      levelsQueued = levels;
      setTimeout(() => { live.set({ levels: levelsQueued }); levelsQueued = null; }, 100);
    },
  });

  function applyGains() {
    for (const key of engine.decoders.keys()) engine.setGain(key, gainFor(key));
    engine.setMaster(api.voice.get()?.voiceDeafened ? 0 : 1);
  }

  api.ipc.on('a', (key, ts, opus) => engine.push(key, ts, opus));

  // ── Video ──

  /** key -> VideoSink */
  const sinks = new Map();
  api.ipc.on('v', (key, codec, keyframe, discontinuity, ts, data) => sinks.get(key)?.push(codec, keyframe, discontinuity, ts, data));
  api.ipc.on('streamEnded', (streamKey) => {
    live.set(s => ({ videoInfo: { ...s.videoInfo, [`stream:${streamKey}`]: { ...s.videoInfo[`stream:${streamKey}`], ended: true } } }));
  });

  const sendCameras = () => api.ipc.send('cameras', store.get().watching.filter(w => w.key.startsWith('camera:')).map(w => w.key.slice('camera:'.length)));

  function openViewer(key, title) {
    if (store.get().watching.some(w => w.key === key)) return;
    const sink = new VideoSink({
      log: api,
      requestKeyframe: () => api.ipc.invoke('keyframe', key).catch(() => {}),
      onInfo: (info) => live.set(s => ({ videoInfo: { ...s.videoInfo, [key]: { ...s.videoInfo[key], ...info } } })),
    });
    sinks.set(key, sink);
    store.set(s => ({ watching: [...s.watching, { key, title }] }));
    sendCameras();
    if (key.startsWith('stream:')) {
      api.ipc.invoke('watch', key.slice('stream:'.length)).catch(err => api.toast({ title: 'Couldn\'t watch the stream', body: err.message, type: 'error' }));
    } else {
      api.ipc.invoke('keyframe', key).catch(() => {});
    }
  }

  function closeViewer(key) {
    sinks.get(key)?.close();
    sinks.delete(key);
    store.set(s => ({ watching: s.watching.filter(w => w.key !== key) }));
    sendCameras();
    live.set(s => { const videoInfo = { ...s.videoInfo }; delete videoInfo[key]; return { videoInfo }; });
    if (key.startsWith('stream:')) {
      engine.remove(key);
      api.ipc.invoke('unwatch', key.slice('stream:'.length)).catch(() => {});
    }
  }

  // ── Keeping Discord in step with the Serble call ──

  let joinedFor = null;
  let joining = false;
  let sentSelf = null;
  let knownMembers = new Set();

  function desired() {
    const s = store.get();
    const v = api.voice.get();
    const channelId = v?.voiceSession && v.voiceChannelId != null ? String(v.voiceChannelId) : null;
    const link = channelId ? s.channelLinks[channelId] : null;
    const account = s.main?.account;
    const loggedIn = !!account?.user && (account.status === 'ready' || account.status === 'reconnecting');
    return link && loggedIn ? { key: `${channelId}|${link.guildId}|${link.channelId}`, link, voice: v } : null;
  }

  // sync() changes state that makes it run again: run those passes after this one, not inside it
  let syncing = false;
  let syncAgain = false;
  function sync() {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      do {
        syncAgain = false;
        syncOnce();
      } while (syncAgain);
    } finally {
      syncing = false;
    }
  }

  let outputDevice = null;
  function syncOnce() {
    const s = store.get();
    const want = desired();
    const v = api.voice.get();
    const selfMute = !!(v?.voiceMuted || v?.voiceDeafened);
    const selfDeaf = !!v?.voiceDeafened;

    if (want && (want.key !== joinedFor || !s.main?.voice)) {
      if (!joining) {
        joining = true;
        joinedFor = want.key;
        sentSelf = `${selfMute}|${selfDeaf}`;
        api.ipc.invoke('join', { guildId: want.link.guildId, channelId: want.link.channelId, selfMute, selfDeaf })
          .then(main => store.set({ main }))
          .catch(err => api.error('Joining Discord failed:', err))
          .finally(() => { joining = false; });
      }
    } else if (!want && joinedFor) {
      joinedFor = null;
      api.ipc.invoke('leave').then(main => store.set({ main })).catch(() => {});
    } else if (want && sentSelf !== `${selfMute}|${selfDeaf}`) {
      sentSelf = `${selfMute}|${selfDeaf}`;
      api.ipc.invoke('selfState', { selfMute, selfDeaf }).catch(() => {});
    }

    // Media runs while the Discord side is connected
    const connected = !!want && s.main?.voice?.status === 'connected';
    const micTrack = v?.voiceSession?.micTrack?.mediaStreamTrack ?? null;
    if (connected) {
      engine.init().then(() => applyGains()).catch(err => api.error('Audio setup failed:', err));
      const device = api.clientOptions.get()?.localDeviceSettings?.outputDeviceId ?? 'default';
      if (device !== outputDevice) {
        outputDevice = device;
        engine.setOutputDevice(device);
      }
      if (micTrack && engine.capture?.track !== micTrack) {
        engine.startCapture(micTrack, {
          isMuted: () => { const vv = api.voice.get(); return !!(vv?.voiceMuted || vv?.voiceDeafened); },
          threshold: () => store.get().threshold,
          onPacket: (opus, ts) => api.ipc.send('opus', opus, ts),
          onSilence: () => api.ipc.send('silence'),
          onSpeaking: (speaking) => live.set({ speakingSelf: speaking }),
        }).catch(err => api.error('Mic capture failed:', err));
      }
    } else if (engine.capturing || engine.decoders.size) {
      engine.stopCapture();
      for (const key of [...engine.decoders.keys()]) engine.remove(key);
      live.set({ speakingSelf: false });
    }
    if (!s.main?.voice) for (const w of s.watching) closeViewer(w.key);

    // Forget the voices of people who left
    const members = new Set((s.main?.voice?.members ?? []).map(m => m.id));
    for (const id of knownMembers) if (!members.has(id)) engine.remove(id);
    knownMembers = members;
    applyGains();
  }

  api.voice.subscribe(sync);
  store.subscribe(sync);
  const syncTimer = setInterval(sync, 1000);
  api.onStop(() => {
    clearInterval(syncTimer);
    engine.close();
  });

  // ── Components ──

  function DiscordAvatar({ src, size = 20, speaking = false }) {
    return html`<img src=${src} width=${size} height=${size} alt="" style=${{
      borderRadius: '50%', flexShrink: 0, objectFit: 'cover',
      boxShadow: speaking ? '0 0 0 2px var(--success)' : 'none', transition: 'box-shadow 0.1s',
    }} />`;
  }

  function Chip({ children, tone = 'muted', title }) {
    const colors = { muted: 'var(--text-muted)', accent: 'var(--accent)', danger: 'var(--danger)', success: 'var(--success)' };
    return html`<span title=${title} style=${{
      fontSize: '0.65rem', fontWeight: 700, padding: '0.05rem 0.3rem', borderRadius: 4, flexShrink: 0,
      color: colors[tone], border: `1px solid color-mix(in srgb, ${colors[tone]} 45%, transparent)`,
    }}>${children}</span>`;
  }

  function IconBtn({ title, onClick, active, children, danger }) {
    return html`<button type="button" title=${title} aria-label=${title} onClick=${onClick} className="ui-icon-btn hov-text-primary" style=${{
      width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 4,
      color: danger ? 'var(--danger)' : active ? 'var(--accent)' : 'var(--text-muted)',
    }}>${children}</button>`;
  }

  /** Picks a Discord voice channel for a Serble one. */
  function LinkPicker({ serbleChannelId, onDone }) {
    const [guilds, setGuilds] = useState(null);
    const [guildId, setGuildId] = useState('');
    const [channelId, setChannelId] = useState('');
    useEffect(() => { api.ipc.invoke('guilds').then(setGuilds).catch(() => setGuilds([])); }, []);
    const guild = guilds?.find(g => g.id === guildId);

    async function link() {
      const channel = guild.channels.find(c => c.id === channelId);
      let serbleName = null;
      try { serbleName = (await api.modules.api.getChannel(serbleChannelId))?.name ?? null; } catch { /* keep the id */ }
      persist('channelLinks', {
        ...store.get().channelLinks,
        [serbleChannelId]: { guildId, channelId, guildName: guild.name, channelName: channel.name, serbleName },
      });
      onDone?.();
    }

    if (!guilds) return html`<div className="ui-hint">Loading your Discord servers…</div>`;
    if (!guilds.length) return html`<div className="ui-hint">No Discord voice channels found.</div>`;
    return html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }} data-testid="dl-link-picker">
      <${UI.Select} value=${guildId} onChange=${e => { setGuildId(e.target.value); setChannelId(''); }} aria-label="Discord server">
        <option value="">Choose a Discord server…</option>
        ${guilds.map(g => html`<option key=${g.id} value=${g.id}>${g.name}</option>`)}
      </${UI.Select}>
      ${guild && html`<${UI.Select} value=${channelId} onChange=${e => setChannelId(e.target.value)} aria-label="Discord voice channel">
        <option value="">Choose a voice channel…</option>
        ${guild.channels.map(c => html`<option key=${c.id} value=${c.id}>🔊 ${c.name}${c.members ? ` (${c.members})` : ''}</option>`)}
      </${UI.Select}>`}
      <div style=${{ display: 'flex', gap: '0.35rem' }}>
        <${UI.Button} size="sm" variant="primary" disabled=${!channelId} onClick=${link}>Link</${UI.Button}>
        ${onDone && html`<${UI.Button} size="sm" variant="ghost" onClick=${onDone}>Cancel</${UI.Button}>`}
      </div>
    </div>`;
  }

  /** One person in the Discord channel. */
  function MemberRow({ member, serbleParticipants }) {
    const level = useStore(live, l => l.levels[member.id] ?? 0);
    const prefs = useStore(store, s => s.prefs[member.id]);
    const linkedSerbleId = useStore(store, s => Object.entries(s.accountLinks).find(([, l]) => l.discordId === member.id)?.[0] ?? null);
    const watching = useStore(store, s => s.watching.some(w => w.key === `stream:${member.streamKey}`));
    const [open, setOpen] = useState(false);
    const inSerble = !!linkedSerbleId && serbleParticipants.some(p => String(p.identity) === linkedSerbleId);
    const muted = !!prefs?.muted;
    const speaking = !inSerble && !muted && level > SPEAKING_LEVEL;

    const setPrefs = (patch) => persist('prefs', { ...store.get().prefs, [member.id]: { ...prefs, ...patch } });

    return html`<div data-testid="dl-member" data-discord-id=${member.id}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.15rem 0.35rem', borderRadius: 4 }}>
        <${DiscordAvatar} src=${member.avatar} speaking=${speaking} />
        <button type="button" onClick=${() => setOpen(o => !o)} title="Volume and linking" style=${{
          font: 'inherit', flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          fontSize: '0.8rem', color: inSerble ? 'var(--text-muted)' : 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>${member.name}</button>
        ${inSerble && html`<${Chip} title="Their linked Serble account is in this call, so their Discord audio is muted">in Serble</${Chip}>`}
        ${member.streaming && html`<button type="button" data-testid="dl-watch" onClick=${() => watching ? closeViewer(`stream:${member.streamKey}`) : openViewer(`stream:${member.streamKey}`, `${member.name}'s stream`)}
          title=${watching ? 'Stop watching' : 'Watch their stream'} style=${{
            fontSize: '0.62rem', fontWeight: 800, padding: '0.1rem 0.35rem', borderRadius: 4, border: 'none', cursor: 'pointer',
            background: watching ? 'var(--bg-active)' : 'var(--danger)', color: watching ? 'var(--text-secondary)' : '#fff',
          }}>${watching ? 'WATCHING' : 'LIVE'}</button>`}
        ${member.video && !member.streaming && html`<${IconBtn} title="Watch their camera" onClick=${() => openViewer(`camera:${member.id}`, `${member.name}'s camera`)}><${I.VideoIcon} size=${13} /></${IconBtn}>`}
        ${(member.selfDeaf || member.deaf) ? html`<${I.HeadphonesOffIcon} size=${13} style=${{ color: 'var(--danger)' }} />`
          : (member.selfMute || member.mute) ? html`<${I.MicOffIcon} size=${13} style=${{ color: 'var(--danger)' }} />` : null}
        <${IconBtn} title=${muted ? 'Unmute' : 'Mute for me'} active=${false} danger=${muted} onClick=${() => setPrefs({ muted: !muted })}>
          ${muted ? html`<${I.SpeakerMutedIcon} size=${13} />` : html`<${I.SpeakerIcon} size=${13} />`}
        </${IconBtn}>
      </div>
      ${open && html`<div style=${{ padding: '0.25rem 0.35rem 0.4rem 1.9rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Volume
          <${UI.Slider} min=${0} max=${2} step=${0.05} value=${prefs?.volume ?? 1} onChange=${v => setPrefs({ volume: Number(v?.target?.value ?? v) })} style=${{ flex: 1 }} />
          <span style=${{ width: 32, textAlign: 'right' }}>${Math.round((prefs?.volume ?? 1) * 100)}%</span>
        </label>
        <${AccountLinkSelect} discordMember=${member} serbleParticipants=${serbleParticipants} />
      </div>`}
    </div>`;
  }

  /** Links a Discord person to someone in the Serble call (or unlinks them). */
  function AccountLinkSelect({ discordMember, serbleParticipants }) {
    const app = api.modules.hooks.useApp();
    const links = useStore(store, s => s.accountLinks);
    const linked = Object.entries(links).find(([, l]) => l.discordId === discordMember.id)?.[0] ?? '';
    const [names, setNames] = useState({});
    const others = serbleParticipants.filter(p => !p.isLocal).map(p => String(p.identity));
    useEffect(() => {
      for (const id of others) app?.resolveUser(id).then(u => setNames(n => ({ ...n, [id]: u?.username ?? id })));
    }, [others.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    function choose(serbleId) {
      const next = { ...store.get().accountLinks };
      for (const [k, l] of Object.entries(next)) if (l.discordId === discordMember.id) delete next[k];
      if (serbleId) next[serbleId] = { discordId: discordMember.id, discordName: discordMember.name, serbleName: names[serbleId] ?? null };
      persist('accountLinks', next);
    }

    const options = [...new Set([...others, ...(linked ? [linked] : [])])];
    return html`<label style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
      Serble
      <${UI.Select} value=${linked} onChange=${e => choose(e.target.value)} style=${{ flex: 1, fontSize: '0.75rem', padding: '0.15rem 0.3rem' }} aria-label="Linked Serble account">
        <option value="">Not linked</option>
        ${options.map(id => html`<option key=${id} value=${id}>${names[id] ?? links[id]?.serbleName ?? id}</option>`)}
      </${UI.Select}>
    </label>`;
  }

  const STATUS_TEXT = {
    idle: 'Not connected', waiting: 'Waiting for Discord…', joining: 'Joining…', connecting: 'Connecting…',
    connected: 'Connected', error: 'Error',
  };

  // The Discord half of the voice panel
  api.ui.register('voice-panel', function DiscordVoicePanel({ channelId, participants }) {
    const main = useStore(store, s => s.main);
    const link = useStore(store, s => s.channelLinks[String(channelId)]);
    const speakingSelf = useStore(live, l => l.speakingSelf);
    const [picking, setPicking] = useState(false);
    const account = main?.account;
    const loggedIn = !!account?.user;

    if (!loggedIn) {
      if (!link) return null;
      return html`<div className="ui-hint" style=${{ fontSize: '0.72rem' }}>
        This call is linked to Discord #${link.channelName}. Log in to Discord in Settings → Mods → Discord Link to join it too.
      </div>`;
    }
    if (!link) {
      return picking
        ? html`<${LinkPicker} serbleChannelId=${String(channelId)} onDone=${() => setPicking(false)} />`
        : html`<button type="button" data-testid="dl-link-call" onClick=${() => setPicking(true)} className="hov-text-primary" style=${{
            background: 'none', border: '1px dashed var(--border)', borderRadius: 6, padding: '0.3rem', cursor: 'pointer',
            fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
          }}><${I.LinkIcon} size=${13} /> Also join a Discord voice channel</button>`;
    }

    const voice = main?.voice;
    const status = voice?.status ?? 'idle';
    const members = (voice?.members ?? []).filter(m => !m.isMe);
    const unlink = () => {
      const next = { ...store.get().channelLinks };
      delete next[String(channelId)];
      persist('channelLinks', next);
    };

    return html`<div data-testid="dl-voice" style=${{ borderTop: '1px solid var(--border)', paddingTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style=${{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: status === 'connected' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : 'var(--warning)' }} />
        <span title=${voice?.privacyCode ? `End-to-end encrypted. Privacy code: ${voice.privacyCode}` : undefined} style=${{ flex: 1, minWidth: 0, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Discord · ${voice?.channelName ?? link.channelName}
          <span style=${{ fontWeight: 400, color: 'var(--text-muted)' }}> ${status === 'connected' ? (voice?.guildName ?? link.guildName) : STATUS_TEXT[status] ?? status}</span>
        </span>
        ${speakingSelf && html`<${Chip} tone="success" title="Your mic is going to Discord">on air</${Chip}>`}
        <${IconBtn} title="Unlink from this Discord channel" onClick=${unlink}><${I.CloseIcon} size=${12} /></${IconBtn}>
      </div>
      ${voice?.error && html`<div style=${{ fontSize: '0.72rem', color: 'var(--danger)' }}>${voice.error}</div>`}
      ${status === 'connected' && !members.length && html`<div className="ui-hint" style=${{ fontSize: '0.72rem', paddingLeft: '0.75rem' }}>Nobody else is in the Discord channel.</div>`}
      <div style=${{ display: 'flex', flexDirection: 'column', maxHeight: 160, overflowY: 'auto' }}>
        ${members.map(m => html`<${MemberRow} key=${m.id} member=${m} serbleParticipants=${participants} />`)}
      </div>
    </div>`;
  });

  // Streams and cameras being watched, in floating windows
  function Viewer({ entry, index }) {
    const { key, title } = entry;
    const info = useStore(live, l => l.videoInfo[key]);
    const mainStream = useStore(store, s => key.startsWith('stream:') ? s.main?.streams?.[key.slice('stream:'.length)] : null);
    const volume = useStore(store, s => s.streamVolumes[key.slice('stream:'.length)] ?? 1);
    const holder = useRef(null);
    const box = useRef(null);
    const [pos, setPos] = useState(() => ({ x: Math.max(16, window.innerWidth - 560 - index * 24), y: 80 + index * 24 }));

    useEffect(() => {
      const canvas = sinks.get(key)?.canvas;
      if (canvas && holder.current) {
        Object.assign(canvas.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' });
        holder.current.appendChild(canvas);
      }
    }, [key]);

    function drag(e) {
      if (e.button !== 0 || e.target.closest('button,input')) return;
      const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      const move = (ev) => setPos({ x: Math.max(0, ev.clientX - start.x), y: Math.max(0, ev.clientY - start.y) });
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    let status = null;
    if (info?.error) status = info.error;
    else if (mainStream?.error) status = mainStream.error;
    else if (info?.ended || mainStream?.status === 'ended') status = 'The stream ended';
    else if (mainStream?.status === 'connecting') status = 'Connecting to the stream…';
    else if (!info || info.waiting) status = 'Waiting for video…';

    const isStream = key.startsWith('stream:');
    return html`<div ref=${box} data-testid="dl-viewer" style=${{
      position: 'fixed', left: pos.x, top: pos.y, width: 540, height: 340, zIndex: 900,
      background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
      resize: 'both', minWidth: 240, minHeight: 160, display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    }}>
      <div onMouseDown=${drag} style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', cursor: 'move', userSelect: 'none', flexShrink: 0 }}>
        <span style=${{ flex: 1, minWidth: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ${title}
          ${info && !status && html`<span style=${{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem', fontSize: '0.72rem' }}>${info.width}×${info.height} · ${info.fps} fps</span>`}
        </span>
        ${isStream && html`<${UI.Slider} min=${0} max=${2} step=${0.05} value=${volume} title="Stream volume" style=${{ width: 80 }}
          onChange=${v => { persist('streamVolumes', { ...store.get().streamVolumes, [key.slice('stream:'.length)]: Number(v) }); applyGains(); }} />`}
        <${IconBtn} title="Full screen" onClick=${() => holder.current?.requestFullscreen?.()}><${I.PopOutIcon} size=${13} /></${IconBtn}>
        <${IconBtn} title="Close" onClick=${() => closeViewer(key)}><${I.CloseIcon} size=${13} /></${IconBtn}>
      </div>
      <div style=${{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        <div ref=${holder} style=${{ position: 'absolute', inset: 0 }} />
        ${status && html`<div data-testid="dl-viewer-status" style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: '0.85rem', pointerEvents: 'none' }}>${status}</div>`}
      </div>
    </div>`;
  }

  api.ui.register('app-overlay', function DiscordViewers() {
    const watching = useStore(store, s => s.watching);
    return watching.map((entry, i) => html`<${Viewer} key=${entry.key} entry=${entry} index=${i} />`);
  });

  // The linked Discord account on Serble profile cards
  api.ui.register('user-popout', function DiscordProfile({ userId, user }) {
    const app = api.modules.hooks.useApp();
    const link = useStore(store, s => s.accountLinks[userId]);
    const loggedIn = useStore(store, s => !!s.main?.account?.user);
    const [picking, setPicking] = useState(false);
    const [known, setKnown] = useState(null);
    const [manual, setManual] = useState('');
    if (userId === app?.currentUser?.id || (!link && !loggedIn)) return null;

    const label = { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.3rem' };
    async function save(discordId, discordName) {
      let name = discordName;
      if (!name) name = (await api.ipc.invoke('user', discordId).catch(() => null))?.name ?? discordId;
      const next = { ...store.get().accountLinks };
      for (const [k, l] of Object.entries(next)) if (l.discordId === discordId) delete next[k];
      next[userId] = { discordId, discordName: name, serbleName: user?.username ?? null };
      persist('accountLinks', next);
      setPicking(false);
    }
    function unlink() {
      const next = { ...store.get().accountLinks };
      delete next[userId];
      persist('accountLinks', next);
    }
    function openPicker() {
      setPicking(true);
      api.ipc.invoke('knownUsers').then(setKnown).catch(() => setKnown([]));
    }

    return html`<div data-testid="dl-profile" style=${{ marginBottom: '0.75rem' }}>
      <div style=${label}>Discord</div>
      ${link && !picking && html`<div style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
        <span style=${{ flex: 1 }}>${link.discordName ?? link.discordId}</span>
        <${UI.Button} size="sm" variant="ghost" onClick=${unlink}>Unlink</${UI.Button}>
      </div>`}
      ${!link && !picking && html`<${UI.Button} size="sm" onClick=${openPicker}><${I.LinkIcon} size=${13} /> Link Discord account</${UI.Button}>`}
      ${picking && html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <${UI.Select} value="" onChange=${e => { const u = known?.find(k => k.id === e.target.value); if (u) save(u.id, u.name); }} aria-label="Discord account">
          <option value="">${known ? 'Choose someone…' : 'Loading…'}</option>
          ${(known ?? []).map(u => html`<option key=${u.id} value=${u.id}>${u.name}${u.username && u.username !== u.name ? ` (@${u.username})` : ''}</option>`)}
        </${UI.Select}>
        <div style=${{ display: 'flex', gap: '0.35rem' }}>
          <${UI.TextInput} placeholder="…or their Discord user ID" value=${manual} onChange=${e => setManual(e.target.value.trim())} style=${{ flex: 1, fontSize: '0.8rem' }} />
          <${UI.Button} size="sm" disabled=${!/^\d{15,22}$/.test(manual)} onClick=${() => save(manual)}>Link</${UI.Button}>
        </div>
        <${UI.Button} size="sm" variant="ghost" onClick=${() => setPicking(false)}>Cancel</${UI.Button}>
      </div>`}
    </div>`;
  });

  // ── Settings ──

  api.ui.settings(function DiscordLinkSettings() {
    const main = useStore(store, s => s.main);
    const channelLinks = useStore(store, s => s.channelLinks);
    const accountLinks = useStore(store, s => s.accountLinks);
    const threshold = useStore(store, s => s.threshold);
    const [token, setToken] = useState('');
    const [bot, setBot] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const account = main?.account;

    async function login() {
      setBusy(true);
      setError(null);
      try {
        store.set({ main: await api.ipc.invoke('login', { token, bot }) });
        setToken('');
      } catch (err) {
        setError(String(err.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      } finally {
        setBusy(false);
      }
    }

    const row = { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.83rem', color: 'var(--text-secondary)' };
    return html`<div data-testid="dl-settings">
      <${UI.SectionTitle}>Discord account</${UI.SectionTitle}>
      ${account?.user ? html`<div style=${{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <${DiscordAvatar} src=${account.user.avatar} size=${32} />
          <div style=${{ flex: 1 }}>
            <div style=${{ fontWeight: 600, color: 'var(--text-primary)' }}>${account.user.name}</div>
            <div className="ui-hint">${account.status === 'ready' ? 'Connected' : account.status === 'reconnecting' ? 'Reconnecting…' : account.status}${account.bot ? ' · bot' : ''}</div>
          </div>
          <${UI.Button} size="sm" variant="danger" onClick=${() => api.ipc.invoke('logout').then(m => store.set({ main: m }))}>Log out</${UI.Button}>
        </div>`
      : html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
          <div className="ntfy-warning" style=${{ fontSize: '0.8rem' }}>
            <${I.WarningIcon} size=${15} />
            <div>Logging in with your own account's token is against Discord's terms (it counts as a self-bot), and Discord can suspend accounts for it. A bot token is allowed, but then a bot joins the channel instead of you. The token is stored on this computer, encrypted where the system supports it.</div>
          </div>
          <${UI.TextInput} type="password" placeholder="Discord token" value=${token} onChange=${e => setToken(e.target.value)} autoComplete="off" data-testid="dl-token" />
          <label style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
            <${UI.Toggle} checked=${bot} onChange=${() => setBot(b => !b)} /> It's a bot token
          </label>
          ${(error || account?.error) && html`<${UI.ErrorBox}>${error ?? account.error}</${UI.ErrorBox}>`}
          <div><${UI.Button} variant="primary" size="sm" disabled=${!token || busy} onClick=${login}>${busy ? 'Logging in…' : 'Log in'}</${UI.Button}></div>
        </div>`}

      <${UI.SectionTitle}>Linked voice channels</${UI.SectionTitle}>
      <div className="ui-hint" style=${{ marginBottom: '0.4rem' }}>Joining a linked Serble voice channel joins its Discord channel too. Link one from the voice panel while you're in a call.</div>
      ${Object.entries(channelLinks).map(([serbleId, l]) => html`<div key=${serbleId} style=${row}>
        <span style=${{ flex: 1 }}>${l.serbleName ?? `Serble channel ${serbleId}`} ↔ #${l.channelName} <span style=${{ color: 'var(--text-muted)' }}>(${l.guildName})</span></span>
        <${UI.Button} size="sm" variant="ghost" onClick=${() => { const n = { ...channelLinks }; delete n[serbleId]; persist('channelLinks', n); }}>Remove</${UI.Button}>
      </div>`)}
      ${!Object.keys(channelLinks).length && html`<div className="ui-hint" style=${{ marginBottom: '0.5rem' }}>None yet.</div>`}

      <div style=${{ height: '1rem' }} />
      <${UI.SectionTitle}>Linked accounts</${UI.SectionTitle}>
      <div className="ui-hint" style=${{ marginBottom: '0.4rem' }}>While someone's linked Serble account is in your Serble call, their Discord audio is muted, so you don't hear them twice. Link people from their profile card, or from the Discord list in the voice panel.</div>
      ${Object.entries(accountLinks).map(([serbleId, l]) => html`<div key=${serbleId} style=${row}>
        <span style=${{ flex: 1 }}>${l.serbleName ?? serbleId} ↔ ${l.discordName ?? l.discordId}</span>
        <${UI.Button} size="sm" variant="ghost" onClick=${() => { const n = { ...accountLinks }; delete n[serbleId]; persist('accountLinks', n); }}>Remove</${UI.Button}>
      </div>`)}
      ${!Object.keys(accountLinks).length && html`<div className="ui-hint" style=${{ marginBottom: '0.5rem' }}>None yet.</div>`}

      <div style=${{ height: '1rem' }} />
      <${UI.SectionTitle}>Mic</${UI.SectionTitle}>
      <label style=${{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
        Send to Discord above
        <${UI.Slider} min=${-80} max=${-20} step=${1} value=${threshold} onChange=${v => persist('threshold', Number(v?.target?.value ?? v))} style=${{ flex: 1 }} />
        <span style=${{ width: 56, textAlign: 'right' }}>${threshold} dB</span>
      </label>
      <div className="ui-hint" style=${{ marginTop: '0.3rem' }}>Your mic is only sent to Discord while it's louder than this (so you don't show as always talking there). Muting or deafening in Serble mutes or deafens you on Discord too.</div>
    </div>`;
  });
}
