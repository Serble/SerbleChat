// Utility to check if the app is running in Electron
export const isElectron = () => {
  // Check if window.electron exists (exposed via preload script)
  if (typeof window !== 'undefined' && window.electron) {
    return true;
  }
  
  // Fallback check for user agent
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.indexOf(' electron/') > -1;
};

// Get platform information
export const getPlatform = async () => {
  if (isElectron() && window.electron) {
    try {
      return await window.electron.platform();
    } catch (e) {
      console.error('Failed to get platform from Electron:', e);
    }
  }
  return navigator.platform;
};

// Export electron API safely
export const electronAPI = typeof window !== 'undefined' && window.electron ? window.electron : null;
