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

/**
 * Copy text to clipboard in both Electron and web environments
 * @param {string} text - The text to copy
 * @returns {Promise<void>}
 */
export const copyToClipboard = async (text) => {
  if (isElectron() && window.electron?.copyToClipboard) {
    // Use Electron's clipboard API
    try {
      const result = await window.electron.copyToClipboard(text);
      if (!result.success) {
        throw new Error(result.error || 'Failed to copy to clipboard');
      }
    } catch (error) {
      console.error('Error copying to clipboard via Electron:', error);
      // Fallback to web API if Electron method fails
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw error;
      }
    }
  } else {
    // Use standard web Clipboard API
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }
};

/**
 * Navigate to the root/landing page correctly in both Electron and web environments
 * In Electron with file:// protocol, we use hash navigation (HashRouter)
 * In web, we can use normal navigation
 */
export const navigateToRoot = () => {
  if (isElectron() && window.location.protocol === 'file:') {
    // In Electron with HashRouter, just change the hash to navigate to root
    window.location.hash = '/';
  } else {
    // In web/dev mode, use normal navigation
    window.location.href = '/';
  }
};

/**
 * Open an external URL in the system default browser.
 * In Electron, uses shell.openExternal via IPC so the link opens outside the app.
 * In a normal browser, opens a new tab.
 *
 * @param {string} url - The URL to open
 */
export const openExternalLink = async (url) => {
  if (!url) return;
  if (isElectron() && window.electron?.openExternal) {
    try {
      await window.electron.openExternal(url);
      return;
    } catch (err) {
      console.error('Failed to open external link via Electron:', err);
      // Fall through to web fallback
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * Trigger a file download without navigating the page.
 * In Electron, uses the native download manager via IPC so that WebRTC/voice
 * connections are NOT disrupted (avoids the will-navigate event).
 * In a normal browser, opens the URL in a new tab (cross-origin a.download is
 * ignored by browsers anyway, so this is the most reliable approach).
 *
 * @param {string} url - The file URL to download
 * @param {string} [filename] - Suggested filename (used as fallback in browser only)
 */
export const triggerDownload = async (url, filename) => {
  if (!url) return;
  if (isElectron() && window.electron?.downloadFile) {
    try {
      await window.electron.downloadFile(url);
      return;
    } catch (err) {
      console.error('Failed to trigger download via Electron:', err);
      // Fall through to web fallback
    }
  }
  // Browser fallback: open in new tab (Content-Disposition on the server
  // controls whether it's shown inline or downloaded).
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * Get the correct path for public assets (images, sounds, etc.)
 * In Electron production (file:// protocol), we need to use absolute file:// paths
 * In web/dev mode, we can use absolute paths starting with /
 * 
 * @param {string} assetPath - The asset path starting with / (e.g., '/favicon.webp', '/sounds/notification.ogg')
 * @returns {string} - The correct path for the current environment
 */
export const getAssetPath = (assetPath) => {
  // Remove leading slash if present
  const cleanPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
  
  // In Electron production with file:// protocol, construct absolute path
  if (isElectron() && window.location.protocol === 'file:') {
    // Get base URL (everything up to the last slash)
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    return `${baseUrl}/${cleanPath}`;
  }
  
  // For web/dev mode, return the path with leading slash
  return `/${cleanPath}`;
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
export const electronOAuthFlow = async (oauthUrl) => {
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
};

/**
 * Initialize media permissions in Electron
 * Call this on app startup to ensure media permissions are properly set up
 * @returns {Promise<void>}
 */
export const initializeMediaPermissions = async () => {
  if (!isElectron()) {
    return; // Only needed in Electron
  }
  
  try {
    // Test microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    console.log('Microphone access initialized successfully');
  } catch (err) {
    console.warn('Microphone access initialization warning:', err.message);
    // Don't throw - this might fail if user denies permission, and that's okay
  }
};

/**
 * Check if screen sharing is available in the current environment
 * @returns {boolean}
 */
export const isScreenSharingAvailable = () => {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    return typeof navigator.mediaDevices.getDisplayMedia === 'function';
  }
  return false;
};

/**
 * Get microphone error message for display
 * @param {Error} error
 * @returns {string}
 */
export const getMicrophoneErrorMessage = (error) => {
  if (!error) return 'Unknown microphone error';
  
  if (error.name === 'NotAllowedError') {
    return 'Microphone access was denied. Check Electron permissions.';
  } else if (error.name === 'NotFoundError') {
    return 'No microphone device found.';
  } else if (error.name === 'NotSupportedError') {
    return 'Microphone is not supported in this environment.';
  } else if (error.name === 'SecurityError') {
    return 'Microphone access blocked by security policy.';
  }
  
  return error.message || 'Failed to access microphone';
};

/**
 * Show display source picker for Electron screen sharing
 * @returns {Promise<string>} - Returns the selected source ID, or null if cancelled
 */
export const pickDisplaySourceElectron = async () => {
  if (!isElectron() || !window.electron?.getDisplaySources) {
    throw new Error('Display source picker only available in Electron');
  }

  try {
    // Get available sources
    const result = await window.electron.getDisplaySources();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to get display sources');
    }

    const sources = result.sources || [];
    if (sources.length === 0) {
      throw new Error('No display sources found');
    }

    // If only one source, return it without showing a dialog
    if (sources.length === 1) {
      console.log('Only one source available, auto-selecting:', sources[0].name);
      await window.electron.getDisplaySource(sources[0].id);
      return sources[0].id;
    }

    // Show a simple picker - you can customize this UI
    return new Promise((resolve) => {
      // Create a modal dialog for source selection
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: system-ui, -apple-system, sans-serif;
        backdrop-filter: blur(4px);
      `;

      const container = document.createElement('div');
      container.style.cssText = `
        background: var(--bg-overlay, #111214);
        border: 1px solid var(--border, #1e1f22);
        border-radius: 12px;
        padding: 2rem;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        color: var(--text-primary, #f2f3f5);
      `;

      const title = document.createElement('h2');
      title.textContent = 'Select what to share';
      title.style.cssText = 'margin: 0 0 1.5rem 0; font-size: 1.3rem; color: var(--text-primary, #f2f3f5);';
      container.appendChild(title);

      const sourcesContainer = document.createElement('div');
      sourcesContainer.style.cssText = 'display: flex; flex-direction: column; gap: 1rem;';

      // Group sources by type
      const screens = sources.filter(s => s.isScreen);
      const windows = sources.filter(s => !s.isScreen);

      const addSourceGroup = (groupSources, groupLabel) => {
        if (groupSources.length === 0) return;

        const groupTitle = document.createElement('div');
        groupTitle.textContent = groupLabel;
        groupTitle.style.cssText = 'font-weight: 600; color: var(--accent, #7c3aed); margin-top: 1rem; margin-bottom: 0.5rem; font-size: 0.9rem;';
        sourcesContainer.appendChild(groupTitle);

        groupSources.forEach(source => {
          const sourceBtn = document.createElement('button');
          sourceBtn.style.cssText = `
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 0.75rem;
            background: var(--bg-hover, #2e3035);
            border: 1px solid var(--border, #1e1f22);
            border-radius: 8px;
            color: var(--text-primary, #f2f3f5);
            cursor: pointer;
            transition: all 0.2s;
          `;

          sourceBtn.onmouseover = () => {
            sourceBtn.style.background = 'var(--bg-active, #404249)';
            sourceBtn.style.borderColor = 'var(--border, #1e1f22)';
          };
          sourceBtn.onmouseout = () => {
            sourceBtn.style.background = 'var(--bg-hover, #2e3035)';
            sourceBtn.style.borderColor = 'var(--border, #1e1f22)';
          };

          // Thumbnail
          const thumbnail = document.createElement('img');
          thumbnail.src = source.thumbnail;
          thumbnail.style.cssText = 'width: 80px; height: 45px; border-radius: 4px; object-fit: cover;';

          // Label
          const label = document.createElement('div');
          label.style.cssText = 'flex: 1; text-align: left; overflow: hidden;';
          label.textContent = source.name;

          sourceBtn.appendChild(thumbnail);
          sourceBtn.appendChild(label);

          sourceBtn.onclick = async () => {
            try {
              await window.electron.getDisplaySource(source.id);
              modal.remove();
              resolve(source.id);
            } catch (err) {
              console.error('Error selecting source:', err);
              modal.remove();
              resolve(null);
            }
          };

          sourcesContainer.appendChild(sourceBtn);
        });
      };

      addSourceGroup(screens, 'Displays');
      addSourceGroup(windows, 'Windows');

      container.appendChild(sourcesContainer);

      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        width: 100%;
        padding: 0.75rem;
        margin-top: 1.5rem;
        background: var(--bg-hover, #2e3035);
        border: 1px solid var(--border, #1e1f22);
        border-radius: 6px;
        color: var(--text-primary, #f2f3f5);
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
      `;
      
      cancelBtn.onmouseover = () => {
        cancelBtn.style.background = 'var(--bg-active, #404249)';
      };
      cancelBtn.onmouseout = () => {
        cancelBtn.style.background = 'var(--bg-hover, #2e3035)';
      };

      cancelBtn.onclick = () => {
        modal.remove();
        resolve(null);
      };

      container.appendChild(cancelBtn);
      modal.appendChild(container);
      document.body.appendChild(modal);
    });
  } catch (err) {
    console.error('Error in display source picker:', err);
    throw err;
  }
}

/**
 * Request fullscreen with proper browser API support
 * @param {HTMLElement} element - The element to fullscreen
 * @returns {Promise<void>}
 */
export const requestFullscreenWithElectronSupport = async (element) => {
  if (!element) return;

  try {
    // Try to request fullscreen using the appropriate API for this browser
    const requestFn = element.requestFullscreen || 
                      element.webkitRequestFullscreen || 
                      element.mozRequestFullScreen || 
                      element.msRequestFullscreen;
    
    if (!requestFn) {
      console.warn('Fullscreen API not supported in this browser');
      return;
    }

    // Try with options first (preferred)
    try {
      const promise = requestFn.call(element, { navigationUI: 'hide' });
      if (promise && typeof promise.then === 'function') {
        await promise;
      }
    } catch (error) {
      // If options aren't supported, try without them
      const promise = requestFn.call(element);
      if (promise && typeof promise.then === 'function') {
        await promise;
      }
    }
  } catch (error) {
    console.error('Browser fullscreen request failed:', error);
    throw error;
  }
};

/**
 * Exit fullscreen with proper browser API support
 * @returns {Promise<void>}
 */
export const exitFullscreenWithElectronSupport = async () => {
  try {
    if (document.exitFullscreen) {
      const promise = document.exitFullscreen();
      if (promise && typeof promise.then === 'function') {
        await promise;
      }
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    } else {
      console.warn('No fullscreen API available to exit fullscreen');
    }
  } catch (error) {
    console.error('Browser fullscreen exit failed:', error);
    throw error;
  }
};