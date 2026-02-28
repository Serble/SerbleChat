// TypeScript definitions for Electron API exposed via preload script

export interface Keybinds {
  toggleMute: string;
  toggleDeafen: string;
}

export interface ElectronAPI {
  isElectron: () => Promise<boolean>;
  platform: () => Promise<string>;
  getKeybinds: () => Promise<Keybinds>;
  setKeybinds: (keybinds: Keybinds) => Promise<{ success: boolean }>;
  validateKeybind: (accelerator: string) => Promise<{ valid: boolean; error?: string }>;
  onKeybindTriggered: (callback: (action: string) => void) => () => void;
  
  // OAuth flow for Electron
  oauthStartServer: () => Promise<{ success: boolean; error?: string }>;
  oauthOpenBrowser: (url: string) => Promise<{ success: boolean; error?: string }>;
  oauthWaitCallback: () => Promise<{ code: string | null; state: string | null; authorized: string | null }>;
  oauthStopServer: () => Promise<{ success: boolean; error?: string }>;
  
  // Screen sharing for Electron
  getDisplaySources: () => Promise<{ success: boolean; sources?: Array<{ id: string; name: string; thumbnail: string; isScreen: boolean }>; error?: string }>;
  getDisplaySource: (sourceId: string) => Promise<{ success: boolean; source?: any; error?: string }>;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
