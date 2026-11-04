# Client mods

Mods only work in the desktop app. A mod can do anything: its code runs with the same access as the app
itself, both in Electron's main process (full Node.js) and in the page (all of the app's internals).
Mods are off until you turn them on in **Settings → Mods**.

A working example that uses every part of the API is in [`mods-example/hello-mod`](mods-example/hello-mod).

## Installing a mod

1. Open **Settings → Mods → Open folder**. This opens the `mods` folder in the app's data folder (Electron's
   `userData`), which the tab also shows when no mods are installed.
2. Put the mod's folder in it. The folder must contain a `mod.json`.
3. Press **Reload mods**, then turn the mod on and press **Reload to apply**.

When you're working on a mod, set `SERBLE_MODS_DIR` to the folder that holds it, so you can skip copying it. The value
can be a list separated like `PATH`, and each entry can be a mod or a folder of mods:

```sh
SERBLE_MODS_DIR=$PWD/mods-example npm run electron:dev
```

**Reload mods** restarts every mod's main half with its code loaded fresh, then reloads the page. Reloading the page
leaves any call you're in.

## `mod.json`

```json
{
  "id": "discord-bridge",
  "name": "Discord Bridge",
  "version": "0.1.0",
  "author": "you",
  "description": "Shown in Settings → Mods.",
  "main": "main.cjs",
  "renderer": "renderer.js"
}
```

- `id` can use lowercase letters, digits, `.`, `-` and `_`. If it's missing, the folder name is used.
- A mod needs `main`, `renderer`, or both. Both are paths inside the mod's folder.

## The main half (`main`)

The main half runs in Electron's main process with full Node.js. `require` works for Node's built-in modules
(`dgram`, `net`, `child_process`, ...), for Electron, and for anything in the mod's own `node_modules`
(run `npm install` in the mod's folder). This is where code goes that the page can't run, such as a UDP voice
connection, a TCP server or native code.

```js
// main.cjs
module.exports = {
  async start(ctx) {
    ctx.ipc.handle('login', async (token) => { /* ... */ return { ok: true }; });
    const timer = setInterval(() => ctx.ipc.send('status', { at: Date.now() }), 1000);
    ctx.onStop(() => clearInterval(timer));
  },
  async stop() { /* optional */ },
};
```

`module.exports = function start(ctx) {}` also works. A function returned from `start` runs when the mod stops.
An `.mjs` entry is loaded as ESM, but reloading only refreshes that one file.

The window waits up to 5 seconds for main halves to start. Don't wait in `start` for slow work, like logging in
somewhere: start it and let it finish in the background.

| `ctx.` | |
|---|---|
| `id`, `manifest`, `dir` | The mod's id, its parsed `mod.json` and its folder |
| `dataDir` | A folder for the mod's own files (`<userData>/mod-data/<id>`), created when first read |
| `ipc.handle(channel, fn)` | Answers `api.ipc.invoke(channel, ...args)`. `fn(...args)` can be async |
| `ipc.on(channel, fn)` | Receives `api.ipc.send(channel, ...args)` |
| `ipc.send(channel, ...args)` | Sends to `api.ipc.on(channel, fn)` in the page |
| `onStop(fn)` | Runs `fn` when the mod is turned off, reloaded, or the app quits |
| `log`, `warn`, `error` | Log to the terminal and to the page's devtools console |
| `electron`, `getMainWindow()` | Electron itself, and the app's window |

IPC arguments use structured clone, so typed arrays and `Buffer`s pass through as binary data. Messages sent while
the page is reloading are dropped.

## The renderer half (`renderer`)

The renderer half is an ES module that the page imports before the app renders. It can't use bare imports like
`import React from 'react'`. Get React and the rest of the app's modules from `api` instead, so the mod shares the
app's instances. Without a bundler, use `React.createElement`. For JSX, bundle the mod with esbuild or a similar tool
and replace the `react` imports with `api.React`. Relative imports inside the mod's folder work.

```js
// renderer.js
export default function start(api) {
  const { React } = api;
  api.ui.settings(() => React.createElement('div', null, 'Settings for my mod'));
  api.voice.onSession((session) => {
    api.log('joined', session.room.name);
    return () => api.log('left');
  });
}
```

A function returned from `start` (or an exported `stop`) runs when the page goes away.

| `api.` | |
|---|---|
| `id`, `mod` | The mod's id and its listing (name, version, ...) |
| `React`, `modules` | The app's modules, listed below |
| `ipc.invoke(channel, ...args)` | Calls the main half's `ctx.ipc.handle`. Returns a promise |
| `ipc.send(channel, ...args)` / `ipc.on(channel, fn)` | Fire-and-forget messages each way |
| `ui.register(slot, Component, { order })` | Adds a component to a slot (see below). Returns a function that removes it |
| `ui.settings(Component)` | Adds a panel under the mod in Settings → Mods |
| `app.get()` / `app.subscribe(fn)` | The app's state: the `useApp()` value from `src/context/AppContext.jsx` (current user, guilds, messages, the SignalR hub `hubRef`, `addToast`, ...). `null` outside the app |
| `voice.get()` / `voice.subscribe(fn)` | The `useVoice()` value (`voiceSession`, `voiceParticipants`, `joinVoice`, `toggleMute`, ...) |
| `voice.session()` / `voice.room()` | The current call's `VoiceSession` (`src/voice.js`) and LiveKit `Room`, or `null` |
| `voice.onSession(fn)` | Calls `fn(session)` each time you join a call. A function it returns runs when you leave |
| `voice.audioContext` | The `AudioContext` that calls play through. Audio nodes that connect to a call must come from it |
| `clientOptions`, `theme` | The same `get`/`subscribe` pair for client settings and the theme |
| `navigate(path)` | Moves the app to a path, such as `/app/channel/123` |
| `toast({ title, body, type })` | Shows a toast |
| `storage.get(key, fallback)` / `set` / `remove` | JSON values in `localStorage`, under the mod's namespace |
| `onStop(fn)`, `log`, `warn`, `error` | |

The subscribe and register functions are undone when the page unloads.

`api.modules` holds `react`, `react-dom`, `react-dom/client`, `react-router-dom`, `livekit-client`,
`@microsoft/signalr`, `api` (the HTTP API, `src/api.js`), `voice` (`src/voice.js`), `sound`, `electron`
(`src/electron-utils.js`), `ui` (the components in `src/components/ui`, plus `Avatar` and `ModSlot`), `icons`, and
`hooks` (`useApp`, `useVoice`, `useClientOptions`, `useTheme`, `useMobile`). Components a mod puts in a slot can use
these hooks. The same object is available as `window.SerbleChat.modules` in devtools.

Everything else is open to change through the DOM or through these objects, because the mod runs in the page. These
objects are the app's real internals, not a stable API, so they can change between app versions.

### UI slots

| Slot | Where it renders | Props |
|---|---|---|
| `app-overlay` | Once, over the whole app (for floating UI and modals) | none |
| `voice-panel` | The voice panel in the sidebar, under the participants, while in a call | `channelId`, `voiceSession`, `participants` |
| `chat-header` | A channel's header, before the search button | `channel`, `channelId` |
| `user-popout` | Profile cards, above the user ID | `userId`, `user`, `guildId` |
| `settings:<mod id>` | Under the mod in Settings → Mods (use `api.ui.settings`) | none |

When a slot component throws, only that component is removed. The rest of the app keeps working, and the error is
logged.

## Call audio

These are the parts a voice bridge needs:

- **Hearing the call.** Remote audio is in `session.room`, and `livekit-client`'s `RoomEvent.TrackSubscribed` fires
  for each track. Feed `track.mediaStreamTrack` into `voice.audioContext` with `createMediaStreamSource`, mix the
  sources, and pull out PCM with an `AudioWorklet`. Then `api.ipc.send` it to the main half. Skip
  `Track.Source.ScreenShareAudio` publications unless you want stream sound too. Your own mic is
  `session.rawMicTrack` before processing, or `session.micTrack` as sent.
- **Talking into the call.** Anything connected to `session.micDestination` is mixed into the mic track you publish,
  so everyone in the call hears it. Other Serble clients play one voice track per person, so a bridge should feed
  audio in this way rather than publishing a second audio track. Muting yourself mutes the whole track, bridged
  audio included.
- **Playing audio to yourself only.** Connect to `voice.audioContext.destination`.

`hello-mod` does all three: it streams the call's audio to its main half and plays a test tone into the call.

## Native modules

The main half runs in Electron's Node.js, so native addons must be built for Electron's ABI. Run
`npx @electron/rebuild` in the mod's folder, against the Electron version in this repo's `package.json`. When a
library has a pure-JS fallback, use it instead. For a Discord voice client, for example, use `opusscript` instead of
`@discordjs/opus`, and `libsodium-wrappers` or `tweetnacl` for encryption.

Note that Discord's terms forbid automating a user account (self-bots). A bridge that uses a bot account doesn't have
that problem.
