// The renderer half: an ES module the app imports, run in the page. No bundler needed: React
// and the rest of the app's modules come from `api`. (Using JSX? Bundle it, keeping react external.)

export default function start(api) {
  const { React } = api;
  const h = React.createElement;
  const { useState, useEffect } = React;
  const { Button, Hint, SectionTitle } = api.modules.ui;

  api.log('Hello from the renderer');

  // Latest numbers from the main half
  let lastTick = null;
  const tickListeners = new Set();
  api.ipc.on('tick', (tick) => { lastTick = tick; tickListeners.forEach(fn => fn(tick)); });
  const useTick = () => {
    const [tick, setTick] = useState(lastTick);
    useEffect(() => { tickListeners.add(setTick); return () => tickListeners.delete(setTick); }, []);
    return tick;
  };

  // ── Settings → Mods → Hello Mod ──
  api.ui.settings(function HelloSettings() {
    const [info, setInfo] = useState(null);
    const [echo, setEcho] = useState(null);
    const [greeting, setGreeting] = useState(() => api.storage.get('greeting', 'Hello'));
    const tick = useTick();
    return h('div', { 'data-testid': 'hello-settings' },
      h(SectionTitle, null, 'Hello Mod'),
      h('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
        h(Button, { size: 'sm', onClick: async () => setInfo(await api.ipc.invoke('info')) }, 'Ask main process'),
        h(Button, { size: 'sm', onClick: async () => setEcho(await api.ipc.invoke('udp-echo', 'ping over UDP')) }, 'UDP echo'),
        h(Button, { size: 'sm', onClick: () => api.toast({ title: greeting, body: 'A toast from a mod', type: 'success' }) }, 'Toast'),
      ),
      info && h('div', { 'data-testid': 'hello-info', className: 'ui-hint' }, `Host ${info.hostname} (${info.platform}), up ${info.uptime}s, data in ${info.dataDir}`),
      echo && h('div', { 'data-testid': 'hello-echo', className: 'ui-hint' }, `UDP said: ${echo}`),
      h('div', { 'data-testid': 'hello-tick', className: 'ui-hint' }, tick ? `Main process tick at ${new Date(tick.at).toLocaleTimeString()}, ${tick.samples} audio samples received` : 'Waiting for main process…'),
      h('label', { style: { display: 'block', marginTop: '0.5rem', fontSize: '0.85rem' } }, 'Greeting (saved): ',
        h('input', { value: greeting, onChange: e => { setGreeting(e.target.value); api.storage.set('greeting', e.target.value); } })),
    );
  });

  // ── A button in every channel header ──
  api.ui.register('chat-header', function HelloHeaderButton({ channelId }) {
    return h(Button, {
      size: 'sm', variant: 'ghost', title: 'Hello Mod',
      onClick: () => api.toast({ title: 'Hello Mod', body: `You're in channel ${channelId}` }),
    }, '👋');
  });

  // ── A section on everyone's profile card ──
  api.ui.register('user-popout', function HelloPopout({ userId, user }) {
    return h(Hint, { style: { marginBottom: '0.75rem' } }, `Hello Mod sees ${user?.username ?? userId}`);
  });

  // ── Call audio, both ways ──
  // Out of the call: every remote voice is mixed and streamed to the main half (where a bridge
  // would encode it for the other platform). Into the call: a test tone mixed into your mic.
  const ctx = api.voice.audioContext;
  let tone = null;

  api.voice.onSession((session) => {
    api.log('Joined a call', session.room.name);
    const { RoomEvent, Track } = api.modules['livekit-client'];
    const mix = ctx.createGain();
    const sources = new Map();
    const add = (track, pub, participant) => {
      if (track.kind !== 'audio' || pub.source === Track.Source.ScreenShareAudio) return;
      const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      source.connect(mix);
      sources.set(track.sid, source);
    };
    const remove = (track) => { sources.get(track.sid)?.disconnect(); sources.delete(track.sid); };
    for (const p of session.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) if (pub.track) add(pub.track, pub, p);
    }
    session.room.on(RoomEvent.TrackSubscribed, add);
    session.room.on(RoomEvent.TrackUnsubscribed, remove);

    // ScriptProcessor keeps the example short; use an AudioWorklet for real work
    const tap = ctx.createScriptProcessor(4096, 1, 1);
    tap.onaudioprocess = (e) => api.ipc.send('audio', e.inputBuffer.getChannelData(0).slice());
    mix.connect(tap);
    tap.connect(ctx.destination); // (outputs silence; it only runs while connected)

    return () => {
      api.log('Left the call');
      session.room.off(RoomEvent.TrackSubscribed, add);
      session.room.off(RoomEvent.TrackUnsubscribed, remove);
      sources.forEach(s => s.disconnect());
      tap.disconnect();
      mix.disconnect();
      tone?.stop();
      tone = null;
    };
  });

  function toggleTone(session) {
    if (tone) { tone.stop(); tone = null; return false; }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.05;
    osc.connect(gain);
    // micDestination is what your published mic track carries: anything connected to it is heard
    gain.connect(session.micDestination);
    osc.start();
    tone = { stop: () => { osc.stop(); gain.disconnect(); } };
    return true;
  }

  // ── In the voice panel while in a call ──
  api.ui.register('voice-panel', function HelloVoice({ voiceSession, participants }) {
    const [on, setOn] = useState(!!tone);
    const tick = useTick();
    return h('div', { 'data-testid': 'hello-voice', style: { fontSize: '0.75rem', color: 'var(--text-muted)' } },
      `Hello Mod: ${participants.length} in call, ${tick?.samples ?? 0} samples sent to main `,
      h(Button, { size: 'sm', onClick: () => setOn(toggleTone(voiceSession)) }, on ? 'Stop tone' : 'Play tone'),
    );
  });

  return () => api.log('Stopped');
}
