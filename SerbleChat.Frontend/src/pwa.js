/**
 * pwa.js — PWA install prompt and utilities
 * 
 * Handles the "beforeinstallprompt" event to provide a custom install button
 */

let deferredPrompt = null;

/**
 * Returns true if the app can be installed (beforeinstallprompt event fired)
 */
export function canInstall() {
  return deferredPrompt !== null;
}

/**
 * Returns true if the app is currently running in standalone mode (already installed)
 */
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true || // iOS Safari
    document.referrer.includes('android-app://') // Android TWA
  );
}

/**
 * Initialize PWA install prompt handling
 * Call this once when the app starts
 */
export function initPWAInstallPrompt(onStateChange) {
  // Capture the beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar from appearing
    e.preventDefault();
    deferredPrompt = e;
    
    // Notify listeners that install is available
    if (onStateChange) onStateChange(true);
    
    console.log('[PWA] Install prompt available');
  });

  // Listen for successful installation
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (onStateChange) onStateChange(false);
    console.log('[PWA] App installed successfully');
  });
}

/**
 * Show the install prompt
 * Returns: { outcome: 'accepted' | 'dismissed' | 'not-available' }
 */
export async function promptInstall() {
  if (!deferredPrompt) {
    return { outcome: 'not-available' };
  }

  // Show the install prompt
  deferredPrompt.prompt();

  // Wait for the user to respond
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[PWA] User ${outcome} the install prompt`);

  // Clear the prompt
  deferredPrompt = null;

  return { outcome };
}

/**
 * Check if service worker is registered and active
 */
export async function isServiceWorkerActive() {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active !== undefined;
  } catch (err) {
    console.error('[PWA] Failed to check service worker:', err);
    return false;
  }
}

/**
 * Get PWA display mode
 */
export function getDisplayMode() {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return 'standalone';
  }
  if (window.matchMedia('(display-mode: fullscreen)').matches) {
    return 'fullscreen';
  }
  if (window.matchMedia('(display-mode: minimal-ui)').matches) {
    return 'minimal-ui';
  }
  return 'browser';
}

/**
 * Listen for display mode changes
 */
export function onDisplayModeChange(callback) {
  const modes = ['standalone', 'fullscreen', 'minimal-ui'];
  
  modes.forEach(mode => {
    const mq = window.matchMedia(`(display-mode: ${mode})`);
    mq.addEventListener('change', (e) => {
      if (e.matches) {
        callback(mode);
      }
    });
  });
}
