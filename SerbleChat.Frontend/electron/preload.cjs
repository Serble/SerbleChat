const { contextBridge, ipcRenderer } = require('electron');

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
});
