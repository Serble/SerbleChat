const { contextBridge, ipcRenderer } = require('electron');

// Messages from mods' main halves, by `${modId}\0${channel}` (one IPC listener for all of them)
const modEventListeners = new Map();
ipcRenderer.on('mod-event', (_event, id, channel, ...args) => {
  for (const callback of modEventListeners.get(`${id}\0${channel}`) ?? []) {
    try { callback(...args); } catch (err) { console.error(`[mod:${id}] listener for "${channel}" threw:`, err); }
  }
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  isElectron: () => ipcRenderer.invoke('is-electron'),
  platform: () => ipcRenderer.invoke('get-platform'),

  // Open external URLs in the system browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Download a file via the native download manager (does not navigate the page)
  downloadFile: (url) => ipcRenderer.invoke('download-file', url),
  
  // Keybind management
  getKeybinds: () => ipcRenderer.invoke('get-keybinds'),
  setKeybinds: (keybinds) => ipcRenderer.invoke('set-keybinds', keybinds),
  validateKeybind: (accelerator) => ipcRenderer.invoke('validate-keybind', accelerator),
  onKeybindTriggered: (callback) => {
    const handler = (event, action) => callback(action);
    ipcRenderer.on('keybind-triggered', handler);
    return () => ipcRenderer.removeListener('keybind-triggered', handler);
  },
  
  // Clipboard management
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  
  // OAuth flow for Electron
  oauthStartServer: () => ipcRenderer.invoke('oauth-start-server'),
  oauthOpenBrowser: (url) => ipcRenderer.invoke('oauth-open-browser', url),
  oauthWaitCallback: () => ipcRenderer.invoke('oauth-wait-callback'),
  oauthStopServer: () => ipcRenderer.invoke('oauth-stop-server'),
  
  // Screen sharing for Electron
  getDisplaySources: () => ipcRenderer.invoke('get-display-sources'),
  getDisplaySource: (sourceId) => ipcRenderer.invoke('get-display-source', sourceId),

  // Keep a popped-out stream window (see src/streamPopout.js) above other windows
  setStreamPopoutOnTop: (name, onTop) => ipcRenderer.invoke('stream-popout-on-top', name, onTop),

  // Stream audio (sound shared along with a screen share)
  streamAudio: {
    support: () => ipcRenderer.invoke('stream-audio-support'),
    listApps: () => ipcRenderer.invoke('stream-audio-list-apps'),
    // Linux only: start/stop the virtual mic that carries the shared sound
    start: (options) => ipcRenderer.invoke('stream-audio-start', options),
    setApps: (apps) => ipcRenderer.invoke('stream-audio-set-apps', apps),
    stop: () => ipcRenderer.invoke('stream-audio-stop'),
  },

  // Client mods (see electron/mods.cjs and src/mods/)
  mods: {
    list: () => ipcRenderer.invoke('mods-list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('mods-set-enabled', id, enabled),
    // Restarts the main halves of mods; the page reloads itself for the rest
    reload: () => ipcRenderer.invoke('mods-reload'),
    folder: () => ipcRenderer.invoke('mods-folder'),
    openFolder: () => ipcRenderer.invoke('mods-open-folder'),
    // Talking to a mod's main half
    invoke: (id, channel, ...args) => ipcRenderer.invoke('mod-invoke', id, channel, ...args),
    send: (id, channel, ...args) => ipcRenderer.send('mod-send', id, channel, ...args),
    on: (id, channel, callback) => {
      const key = `${id}\0${channel}`;
      if (!modEventListeners.has(key)) modEventListeners.set(key, new Set());
      modEventListeners.get(key).add(callback);
      return () => modEventListeners.get(key)?.delete(callback);
    },
    // Log lines from mods' main halves, so they show in the page's devtools too
    onLog: (callback) => {
      const handler = (_event, id, level, message) => callback(id, level, message);
      ipcRenderer.on('mod-log', handler);
      return () => ipcRenderer.removeListener('mod-log', handler);
    },
  },
});
