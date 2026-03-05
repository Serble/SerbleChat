const { app, BrowserWindow, ipcMain, globalShortcut, shell, clipboard, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const isDev = process.env.NODE_ENV === 'development';

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=:#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnv();

let mainWindow;
let currentKeybinds = {
  toggleMute: 'CommandOrControl+Shift+M',
  toggleDeafen: 'CommandOrControl+Shift+D'
};

// OAuth callback server state
let oauthCallbackServer = null;
let oauthCallbackResolve = null;

// Store user-selected display source
let selectedDisplaySource = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      enableRemoteModule: false,
      // Enable fullscreen API for elements (not just window)
      v8CodeCacheOptions: 'code',
    },
    backgroundColor: '#313338',
    show: false,
    autoHideMenuBar: true,
  });

  // Show window and register keybinds when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Register keybinds after window is shown (non-blocking)
    try {
      registerKeybinds();
    } catch (err) {
      console.error('Failed to register keybinds:', err);
      // Don't crash the app if keybinds fail to register
    }
  });

  if (isDev) {
    // In development, load from configured frontend URL or fallback to localhost
    const frontendUrl = process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
    mainWindow.loadURL(frontendUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Intercept all new-window requests (target="_blank" links) and open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(err => console.error('Failed to open external URL:', err));
    return { action: 'deny' };
  });

  // Also intercept will-navigate to prevent external URLs from navigating the main window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isFile = url.startsWith('file://');
    const isLocalhost = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (!isFile && !isLocalhost) {
      event.preventDefault();
      shell.openExternal(url).catch(err => console.error('Failed to open external URL:', err));
    }
  });
}

// Normalize keybind accelerator strings
function normalizeAccelerator(accelerator) {
  if (!accelerator) return '';
  
  const keyMap = {
    'ScrLk': 'ScrollLock',
    'Pause': 'Pause',
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
    'F7': 'F7', 'F8': 'F8', 'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    'Return': 'Enter',
    'Up': 'ArrowUp',
    'Down': 'ArrowDown',
    'Left': 'ArrowLeft',
    'Right': 'ArrowRight',
  };
  
  let normalized = accelerator;
  
  // Replace key names
  for (const [from, to] of Object.entries(keyMap)) {
    normalized = normalized.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  
  return normalized;
}

// Format accelerator for platform-specific registration
function formatAcceleratorForPlatform(accelerator) {
  if (!accelerator) return '';
  
  const isMac = process.platform === 'darwin';
  
  // Replace CommandOrControl with the right modifier for this platform
  let formatted = accelerator.replace('CommandOrControl', isMac ? 'Command' : 'Control');
  
  return formatted;
}

// Check if a keybind can be registered at OS level
function canRegisterKeybind(accelerator) {
  // Keys that Electron can't register globally
  const unregisterableKeys = ['pause', 'scrolllock', 'numlock', 'capslock'];
  return !unregisterableKeys.some(k => accelerator.toLowerCase().includes(k));
}

// Register global shortcuts
function registerKeybinds() {
  try {
    // Unregister all previous shortcuts
    globalShortcut.unregisterAll();
  } catch (err) {
    console.warn('Warning: Could not unregister previous shortcuts:', err.message);
  }
  
  const isLinux = process.platform === 'linux';
  let successCount = 0;
  
  // Register toggle mute
  if (currentKeybinds.toggleMute) {
    try {
      const normalized = normalizeAccelerator(currentKeybinds.toggleMute);
      const formatted = formatAcceleratorForPlatform(normalized);
      
      // Skip if this key can't be registered
      if (!canRegisterKeybind(formatted)) {
        console.warn('Keybind cannot be registered at OS level:', currentKeybinds.toggleMute);
      } else {
        const success = globalShortcut.register(formatted, () => {
          if (mainWindow) {
            mainWindow.webContents.send('keybind-triggered', 'toggleMute');
          }
        });
        if (success) {
          console.log('Registered toggleMute keybind:', currentKeybinds.toggleMute);
          successCount++;
        } else {
          // On Linux, many keybinds are reserved by the system - this is expected
          if (isLinux) {
            console.info('Info: toggleMute keybind already in use (common on Linux):', currentKeybinds.toggleMute);
          } else {
            console.warn('Failed to register toggleMute keybind:', currentKeybinds.toggleMute, '(formatted:', formatted + ')');
          }
        }
      }
    } catch (e) {
      if (isLinux) {
        console.info('Info: Could not register toggleMute keybind (common on Linux):', e.message);
      } else {
        console.error('Error registering toggleMute keybind:', e);
      }
    }
  }
  
  // Register toggle deafen
  if (currentKeybinds.toggleDeafen) {
    try {
      const normalized = normalizeAccelerator(currentKeybinds.toggleDeafen);
      const formatted = formatAcceleratorForPlatform(normalized);
      
      // Skip if this key can't be registered
      if (!canRegisterKeybind(formatted)) {
        console.warn('Keybind cannot be registered at OS level:', currentKeybinds.toggleDeafen);
      } else {
        const success = globalShortcut.register(formatted, () => {
          if (mainWindow) {
            mainWindow.webContents.send('keybind-triggered', 'toggleDeafen');
          }
        });
        if (success) {
          console.log('Registered toggleDeafen keybind:', currentKeybinds.toggleDeafen);
          successCount++;
        } else {
          // On Linux, many keybinds are reserved by the system - this is expected
          if (isLinux) {
            console.info('Info: toggleDeafen keybind already in use (common on Linux):', currentKeybinds.toggleDeafen);
          } else {
            console.warn('Failed to register toggleDeafen keybind:', currentKeybinds.toggleDeafen, '(formatted:', formatted + ')');
          }
        }
      }
    } catch (e) {
      if (isLinux) {
        console.info('Info: Could not register toggleDeafen keybind (common on Linux):', e.message);
      } else {
        console.error('Error registering toggleDeafen keybind:', e);
      }
    }
  }
  
  if (successCount > 0) {
    console.log(`Successfully registered ${successCount} keybind(s)`);
  } else if (isLinux) {
    console.info('Info: No keybinds could be registered (common on Linux where keybinds may be reserved by the system)');
  }
}

app.whenReady().then(() => {
  createWindow();
  
  // Register IPC handlers
  registerIPCHandlers();

  // Permission handlers for media devices
  // Grant microphone and camera permissions
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'camera' || permission === 'fullscreen') {
      console.log(`Granting permission: ${permission}`);
      callback(true);
    } else {
      console.log(`Denying permission: ${permission}`);
      callback(false);
    }
  });

  // Handle permission checks (for camera/microphone access and fullscreen)
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'camera' || permission === 'microphone' || permission === 'media' || permission === 'fullscreen') {
      console.log(`Permission check passed: ${permission}`);
      return true; // Always allow camera, microphone, and fullscreen
    }
    return false;
  });

  // Handle screen sharing / getDisplayMedia - desktopCapturer requires explicit permission
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log('Screen share request received');
    
    // If user has already selected a source via our picker, use it
    if (selectedDisplaySource) {
      console.log('Using user-selected source:', selectedDisplaySource.name);
      callback({ 
        video: selectedDisplaySource 
      });
      selectedDisplaySource = null; // Clear for next time
      return;
    }
    
    // Fallback: auto-select primary screen if no selection made
    console.log('No pre-selected source, auto-selecting primary display...');
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      if (!sources || sources.length === 0) {
        console.error('No display sources found');
        callback({ cancelled: true });
        return;
      }
      
      // Prefer the primary screen/display
      const primarySource = sources.find(s => s.name.toLowerCase().includes('screen') || s.name === 'Entire Screen') || sources[0];
      console.log('Auto-selected display source:', primarySource.name);
      
      callback({ 
        video: primarySource 
      });
    }).catch(err => {
      console.error('Failed to get display sources:', err);
      callback({ cancelled: true });
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (oauthCallbackServer) {
    oauthCallbackServer.close();
    oauthCallbackServer = null;
  }
});

// OAuth callback server functions
function startOAuthCallbackServer() {
  return new Promise((resolve, reject) => {
    if (oauthCallbackServer) {
      // Server already running
      resolve(true);
      return;
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:13579');
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const authorized = url.searchParams.get('authorized');
        
        // Send success response to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Login Successful</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #0d0f15 0%, #1a1035 100%);
                color: #f1f5f9;
              }
              .container {
                text-align: center;
                background: #1a1d2e;
                border: 1px solid #2d3148;
                border-radius: 12px;
                padding: 3rem 2.5rem;
                max-width: 400px;
              }
              .icon { font-size: 3rem; margin-bottom: 1rem; }
              h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
              p { color: #94a3b8; margin: 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="icon">✓</div>
              <h1>Login Successful!</h1>
              <p>You can close this window and return to SerbleChat.</p>
            </div>
          </body>
          </html>
        `);
        
        // Resolve the promise with the callback data
        if (oauthCallbackResolve) {
          oauthCallbackResolve({ code, state, authorized });
          oauthCallbackResolve = null;
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.on('error', (err) => {
      console.error('OAuth callback server error:', err);
      reject(err);
    });

    server.listen(13579, 'localhost', () => {
      console.log('OAuth callback server listening on http://localhost:13579');
      oauthCallbackServer = server;
      resolve(true);
    });
  });
}

function stopOAuthCallbackServer() {
  return new Promise((resolve) => {
    if (!oauthCallbackServer) {
      resolve();
      return;
    }
    
    oauthCallbackServer.close(() => {
      oauthCallbackServer = null;
      oauthCallbackResolve = null;
      resolve();
    });
  });
}

// Register all IPC handlers
function registerIPCHandlers() {
  // IPC handlers for any Electron-specific features
  ipcMain.handle('is-electron', () => true);
  ipcMain.handle('get-platform', () => process.platform);

  // Open an external URL in the system browser
  ipcMain.handle('open-external', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      console.error('Failed to open external URL:', err);
      return { success: false, error: err.message };
    }
  });

  // Download a file via Electron's native download manager (no page navigation)
  ipcMain.handle('download-file', async (event, url) => {
    try {
      if (!mainWindow) return { success: false, error: 'No main window' };
      mainWindow.webContents.downloadURL(url);
      return { success: true };
    } catch (err) {
      console.error('Failed to trigger download:', err);
      return { success: false, error: err.message };
    }
  });

  // Clipboard management
  ipcMain.handle('copy-to-clipboard', (event, text) => {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return { success: false, error: err.message };
    }
  });

  // Keybind management
  ipcMain.handle('get-keybinds', () => currentKeybinds);

  ipcMain.handle('set-keybinds', (event, keybinds) => {
    currentKeybinds = {
      toggleMute: keybinds.toggleMute || '',
      toggleDeafen: keybinds.toggleDeafen || ''
    };
    registerKeybinds();
    return { success: true };
  });

  ipcMain.handle('validate-keybind', (event, accelerator) => {
    if (!accelerator) return { valid: true };
    
    const normalized = normalizeAccelerator(accelerator);
    const formatted = formatAcceleratorForPlatform(normalized);
    
    try {
      // Check if it's already one of our current keybinds (allow rebinding to same key)
      const currentMuteNorm = formatAcceleratorForPlatform(normalizeAccelerator(currentKeybinds.toggleMute));
      const currentDeafenNorm = formatAcceleratorForPlatform(normalizeAccelerator(currentKeybinds.toggleDeafen));
      
      // Normalize case-insensitively for comparison
      const formattedLower = formatted.toLowerCase();
      const currentMuteLower = currentMuteNorm.toLowerCase();
      const currentDeafenLower = currentDeafenNorm.toLowerCase();
      
      const isCurrentKeybind = 
        currentMuteLower === formattedLower ||
        currentDeafenLower === formattedLower;
      
      if (isCurrentKeybind) {
        return { valid: true };
      }
      
      // Check if this is an unregisterable key - allow it anyway
      if (!canRegisterKeybind(formatted)) {
        return { valid: true };
      }
      
      // Try to register temporarily to validate
      const success = globalShortcut.register(formatted, () => {});
      if (success) {
        globalShortcut.unregister(formatted);
        return { valid: true };
      }
      
      // If registration failed, try to check if it's a syntax error or just in use
      // Allow the keybind anyway - it might work when actually saved
      return { valid: true };
    } catch (e) {
      // Even if there's an error, check basic syntax validity
      const parts = formatted.split('+');
      const validModifiers = ['control', 'shift', 'alt', 'command'];
      const allButLast = parts.slice(0, -1).map(p => p.toLowerCase());
      
      // Check if all parts except last are valid modifiers
      const validSyntax = allButLast.every(p => validModifiers.includes(p)) && parts.length > 0;
      
      if (!validSyntax) {
        return { valid: false, error: 'Invalid keybind format' };
      }
      
      // Syntax is valid, allow it
      return { valid: true };
    }
  });

  // Screen sharing - get available sources for user selection
  ipcMain.handle('get-display-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      
      // Format sources for the frontend (remove large thumbnail data for efficiency)
      const formattedSources = sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(), // Convert to data URL for preview
        isScreen: source.display_id !== undefined // Sources with display_id are screens, others are windows
      }));
      
      console.log(`Available display sources: ${formattedSources.map(s => s.name).join(', ')}`);
      return { success: true, sources: formattedSources };
    } catch (err) {
      console.error('Failed to get display sources:', err);
      return { success: false, error: err.message };
    }
  });

  // Screen sharing - get the actual source for capture (after user selection)
  ipcMain.handle('get-display-source', async (event, sourceId) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find(s => s.id === sourceId);
      
      if (!source) {
        return { success: false, error: 'Source not found' };
      }
      
      console.log(`User selected source for screen sharing: ${source.name}`);
      
      // Store the source so the display media request handler can use it
      selectedDisplaySource = source;
      
      return { success: true, source };
    } catch (err) {
      console.error('Failed to get display source:', err);
      return { success: false, error: err.message };
    }
  });

  // OAuth handlers for Electron
  ipcMain.handle('oauth-start-server', async () => {
    try {
      await startOAuthCallbackServer();
      return { success: true };
    } catch (err) {
      console.error('Failed to start OAuth callback server:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('oauth-open-browser', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      console.error('Failed to open external browser:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('oauth-wait-callback', () => {
    return new Promise((resolve) => {
      oauthCallbackResolve = resolve;
    });
  });

  ipcMain.handle('oauth-stop-server', async () => {
    try {
      await stopOAuthCallbackServer();
      return { success: true };
    } catch (err) {
      console.error('Failed to stop OAuth callback server:', err);
      return { success: false, error: err.message };
    }
  });
}

