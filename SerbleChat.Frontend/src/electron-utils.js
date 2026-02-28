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

// Get electron API safely
export const getElectronAPI = () => {
  return typeof window !== 'undefined' && window.electron ? window.electron : null;
};

// Export electron API safely (deprecated, use getElectronAPI instead)
export const electronAPI = typeof window !== 'undefined' && window.electron ? window.electron : null;

/**
 * Perform OAuth flow for Electron using external browser
 * @param {string} oauthUrl - The OAuth URL to open in the browser
 * @returns {Promise<{code: string, state: string, authorized: string}>} - The callback parameters
 */
export async function electronOAuthFlow(oauthUrl) {
  const api = getElectronAPI();
  
  if (!isElectron() || !api) {
    throw new Error('Not running in Electron');
  }

  try {
    // Start the local callback server
    const serverResult = await api.oauthStartServer();
    if (!serverResult.success) {
      throw new Error('Failed to start OAuth callback server: ' + (serverResult.error || 'Unknown error'));
    }

    // Open the OAuth URL in the user's default browser
    const browserResult = await api.oauthOpenBrowser(oauthUrl);
    if (!browserResult.success) {
      throw new Error('Failed to open browser: ' + (browserResult.error || 'Unknown error'));
    }

    // Wait for the callback from the browser
    const callbackData = await api.oauthWaitCallback();
    
    // Stop the callback server
    await api.oauthStopServer();

    return callbackData;
  } catch (error) {
    // Make sure to stop the server on error
    try {
      await api.oauthStopServer();
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
}
