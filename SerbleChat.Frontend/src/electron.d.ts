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
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
