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
  getDisplaySource: (sourceId: string) => Promise<{ success: boolean; source?: { id: string; name: string }; error?: string }>;

  // Keep a popped-out stream window (by its window name) above other windows
  setStreamPopoutOnTop?: (name: string, onTop: boolean) => Promise<boolean>;

  // Client mods (electron/mods.cjs, src/mods/, MODDING.md)
  mods?: {
    list: () => Promise<ModListing[]>;
    setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
    reload: () => Promise<ModListing[]>;
    folder: () => Promise<string | null>;
    openFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;
    invoke: (id: string, channel: string, ...args: unknown[]) => Promise<unknown>;
    send: (id: string, channel: string, ...args: unknown[]) => void;
    on: (id: string, channel: string, callback: (...args: unknown[]) => void) => () => void;
    onLog: (callback: (id: string, level: 'log' | 'warn' | 'error', message: string) => void) => () => void;
  };
}

export interface ModListing {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
  dir: string;
  hasMain: boolean;
  rendererUrl: string | null;
  enabled: boolean;
  status: 'running' | 'stopped' | 'disabled' | 'error';
  error: string | null;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
