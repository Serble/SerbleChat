const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  isElectron: () => ipcRenderer.invoke('is-electron'),
  platform: () => ipcRenderer.invoke('get-platform'),
  
  // Keybind management
  getKeybinds: () => ipcRenderer.invoke('get-keybinds'),
  setKeybinds: (keybinds) => ipcRenderer.invoke('set-keybinds', keybinds),
  validateKeybind: (accelerator) => ipcRenderer.invoke('validate-keybind', accelerator),
  onKeybindTriggered: (callback) => {
    const handler = (event, action) => callback(action);
    ipcRenderer.on('keybind-triggered', handler);
    return () => ipcRenderer.removeListener('keybind-triggered', handler);
  },
});
