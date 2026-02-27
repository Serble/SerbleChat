const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
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
    },
    backgroundColor: '#313338',
    show: false,
    autoHideMenuBar: true,
  });

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
  // Unregister all previous shortcuts
  globalShortcut.unregisterAll();
  
  const specialKeys = ['pause', 'scrolllock', 'numlock', 'capslock'];
  
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
        if (!success) {
          console.warn('Failed to register toggleMute keybind:', currentKeybinds.toggleMute, '(formatted:', formatted + ')');
        }
      }
    } catch (e) {
      console.error('Error registering toggleMute keybind:', e);
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
        if (!success) {
          console.warn('Failed to register toggleDeafen keybind:', currentKeybinds.toggleDeafen, '(formatted:', formatted + ')');
        }
      }
    } catch (e) {
      console.error('Error registering toggleDeafen keybind:', e);
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  registerKeybinds();

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
});

// IPC handlers for any Electron-specific features
ipcMain.handle('is-electron', () => true);
ipcMain.handle('get-platform', () => process.platform);

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
