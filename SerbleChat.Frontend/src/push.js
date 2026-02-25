/**
 * push.js — Web Push subscription helpers for SerbleChat.
 *
 * Flow:
 *  1. Register the service worker (sw.js in /public).
 *  2. Request notification permission.
 *  3. Subscribe to push using the server's VAPID public key.
 *  4. POST the subscription to the backend via addWebPushSubscription().
 *
 * The `enabled` state is persisted in localStorage under the key
 * 'push_enabled' so the app can auto-resubscribe on each page load.
 *
 * enablePush() returns { outcome: 'granted'|'denied'|'error', message: string }
 * so callers can surface the exact failure reason in the UI.
 */

import { getVapidPublicKey, addWebPushSubscription } from './api.js';

const LS_KEY = 'push_enabled';
const SW_PATH = '/sw.js';

/** Returns true if the current browser supports push notifications. */
export function isPushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Returns a human-readable description of why push is not usable in this
 * environment, or null if everything looks fine.
 */
export function getPushUnsupportedReason() {
  if (!('serviceWorker' in navigator)) return 'Service Workers are not supported by this browser.';
  if (!('PushManager' in window))       return 'PushManager is not supported by this browser.';
  if (!('Notification' in window))      return 'The Notification API is not supported by this browser.';
  if (!window.isSecureContext) {
    return (
      `Push notifications require a secure context (HTTPS or localhost).\n` +
      `Current origin: ${window.location.origin}\n` +
      `Either serve the app over HTTPS or access it via http://localhost instead of an IP address.`
    );
  }
  return null;
}

/** Returns the current Notification permission: 'default' | 'granted' | 'denied' */
export function getPermissionState() {
  return Notification.permission;
}

/** Returns whether the user has previously opted in (localStorage flag). */
export function isPushEnabled() {
  return localStorage.getItem(LS_KEY) === 'true';
}

/**
 * Register the service worker and wait until it is active.
 * navigator.serviceWorker.ready resolves only once there is an active SW
 * controlling the page, which is required before calling pushManager.subscribe().
 */
async function getOrRegisterSW() {
  let reg;
  try {
    reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch (err) {
    throw new Error(
      `Service worker registration failed.\n` +
      `Path: ${SW_PATH}\n` +
      `Reason: ${err.message ?? err}`
    );
  }

  // Log SW state for diagnostics
  const sw = reg.installing ?? reg.waiting ?? reg.active;
  console.debug('[push] SW state after register:', sw?.state ?? 'unknown', reg);

  try {
    return await navigator.serviceWorker.ready;
  } catch (err) {
    throw new Error(
      `Service worker did not become ready.\n` +
      `Reason: ${err.message ?? err}`
    );
  }
}

/**
 * Compare two Uint8Arrays for equality.
 */
function uint8ArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Convert a base64url VAPID public key to a Uint8Array.
 * PushManager.subscribe() requires an ArrayBuffer / Uint8Array.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Enable push notifications for the current user.
 * - Requests notification permission if not yet granted.
 * - Subscribes the browser to push using the server's VAPID key.
 * - Posts the subscription to the backend.
 *
 * @returns {Promise<{ outcome: 'granted'|'denied'|'error', message: string }>}
 */
export async function enablePush() {
  const unsupportedReason = getPushUnsupportedReason();
  if (unsupportedReason) {
    return { outcome: 'error', message: unsupportedReason };
  }

  // 1. Request permission
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return { outcome: 'error', message: `Notification.requestPermission() threw: ${err.message ?? err}` };
  }

  if (permission === 'denied') {
    return { outcome: 'denied', message: 'Notification permission was denied by the browser.' };
  }
  if (permission !== 'granted') {
    return { outcome: 'denied', message: `Unexpected permission result: "${permission}". Please try again.` };
  }

  try {
    // 2. Register + activate service worker
    console.debug('[push] Registering service worker…');
    const sw = await getOrRegisterSW();
    console.debug('[push] SW ready:', sw);

    // 3. Get VAPID public key from server
    console.debug('[push] Fetching VAPID public key…');
    let rawKey;
    try {
      rawKey = await getVapidPublicKey();
    } catch (err) {
      throw new Error(
        `Failed to fetch VAPID public key from server.\n` +
        `URL: /auth/vapid-public-key\n` +
        `Reason: ${err.message ?? err}`
      );
    }

    const vapidPublicKey = (typeof rawKey === 'string' ? rawKey : String(rawKey)).trim();
    console.debug('[push] VAPID public key length:', vapidPublicKey.length, 'key:', vapidPublicKey.slice(0, 20) + '…');

    if (!vapidPublicKey) {
      throw new Error('Server returned an empty VAPID public key.');
    }

    let applicationServerKey;
    try {
      applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    } catch (err) {
      throw new Error(
        `Failed to decode VAPID public key (base64url → Uint8Array).\n` +
        `Key value: "${vapidPublicKey}"\n` +
        `Reason: ${err.message ?? err}`
      );
    }

    // 4. Subscribe to push
    // Always unsubscribe any existing subscription first. If the VAPID key has
    // changed since the subscription was created the browser will throw an
    // AbortError("push service error") when subscribe() is called with the new
    // key while the old subscription is still active.
    console.debug('[push] Subscribing to push…');
    let subscription;
    try {
      const existingSub = await sw.pushManager.getSubscription();
      if (existingSub) {
        console.debug('[push] Unsubscribing stale subscription before resubscribing…');
        await existingSub.unsubscribe();
      }
      subscription = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (err) {
      // AbortError with "push service error" is almost always one of:
      //   1. Page not served over HTTPS / not a secure context
      //   2. Browser cannot reach the push service (network/firewall)
      //   3. VAPID keys are invalid or have changed
      const isAbort = err.name === 'AbortError';
      throw new Error(
        `pushManager.subscribe() failed.\n` +
        `Error name: ${err.name}\n` +
        `Reason: ${err.message ?? err}\n` +
        `isSecureContext: ${window.isSecureContext} (origin: ${window.location.origin})\n` +
        (isAbort
          ? `Most likely causes:\n` +
            `  1. Page is not served over HTTPS or localhost — current origin is "${window.location.origin}"\n` +
            `  2. Browser cannot reach the push service (check firewall / network)\n` +
            `  3. VAPID keys on the server are invalid or have changed`
          : ``)
      );
    }

    console.debug('[push] Subscription endpoint:', subscription.endpoint);

    // 5. Extract the keys
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh ?? '';
    const auth   = json.keys?.auth   ?? '';
    const url    = subscription.endpoint;

    if (!p256dh || !auth) {
      throw new Error(
        `Push subscription is missing keys.\n` +
        `p256dh: "${p256dh}", auth: "${auth}"\n` +
        `The browser may not support encrypted push payloads.`
      );
    }

    // 6. Register with backend
    console.debug('[push] Registering subscription with backend…');
    try {
      await addWebPushSubscription({ url, p256dh, auth });
    } catch (err) {
      throw new Error(
        `Failed to register push subscription with the backend.\n` +
        `Endpoint: POST /account/web-push-subscription\n` +
        `Reason: ${err.message ?? err}`
      );
    }

    // 7. Persist opt-in flag
    localStorage.setItem(LS_KEY, 'true');
    console.debug('[push] Push notifications enabled successfully.');
    return { outcome: 'granted', message: 'Push notifications enabled.' };

  } catch (err) {
    const message = err.message ?? String(err);
    console.error('[push] enablePush failed:\n' + message, err);
    localStorage.removeItem(LS_KEY);
    return { outcome: 'error', message };
  }
}

/**
 * Disable push notifications for the current user.
 * Unsubscribes from the browser's PushManager.
 */
export async function disablePush() {
  localStorage.removeItem(LS_KEY);
  try {
    const sw = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!sw) return;
    const sub = await sw.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    console.debug('[push] Unsubscribed successfully.');
  } catch (err) {
    console.warn('[push] disablePush error:', err.message ?? err, err);
  }
}

/**
 * Re-subscribe silently (called on app start when the user has previously
 * opted in). Refreshes the subscription in case it expired and re-registers
 * it with the backend. If anything goes wrong the opt-in flag is cleared so
 * the user is not silently stuck.
 */
export async function resubscribeIfEnabled() {
  if (!isPushSupported()) return;
  if (!isPushEnabled()) return;
  if (getPermissionState() !== 'granted') {
    console.warn('[push] resubscribeIfEnabled: permission is no longer granted — clearing flag.');
    localStorage.removeItem(LS_KEY);
    return;
  }

  try {
    console.debug('[push] resubscribeIfEnabled: ensuring SW is active…');
    const sw = await getOrRegisterSW();

    let rawKey;
    try {
      rawKey = await getVapidPublicKey();
    } catch (err) {
      throw new Error(`Failed to fetch VAPID key: ${err.message ?? err}`);
    }

    const vapidPublicKey = (typeof rawKey === 'string' ? rawKey : String(rawKey)).trim();
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // Reuse existing subscription only if it was created with the same VAPID key.
    // If the key has changed (or options.applicationServerKey is unavailable) we
    // unsubscribe and create a fresh one to avoid a stale-key AbortError later.
    let sub = await sw.pushManager.getSubscription();
    if (sub) {
      const existingKeyBuffer = sub.options?.applicationServerKey;
      const keysMatch =
        existingKeyBuffer &&
        uint8ArraysEqual(new Uint8Array(existingKeyBuffer), applicationServerKey);

      if (keysMatch) {
        console.debug('[push] resubscribeIfEnabled: reusing existing subscription:', sub.endpoint);
      } else {
        console.debug('[push] resubscribeIfEnabled: VAPID key mismatch — unsubscribing and resubscribing…');
        await sub.unsubscribe();
        try {
          sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        } catch (err) {
          throw new Error(
            `pushManager.subscribe() failed during resubscribe (key mismatch recovery).\n` +
            `Error name: ${err.name}\nReason: ${err.message ?? err}`
          );
        }
      }
    } else {
      console.debug('[push] resubscribeIfEnabled: no existing subscription, creating new one…');
      try {
        sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      } catch (err) {
        throw new Error(
          `pushManager.subscribe() failed during resubscribe.\n` +
          `Error name: ${err.name}\nReason: ${err.message ?? err}`
        );
      }
    }

    const json = sub.toJSON();
    try {
      await addWebPushSubscription({
        url:    sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth:   json.keys?.auth   ?? '',
      });
    } catch (err) {
      throw new Error(`Failed to register subscription with backend: ${err.message ?? err}`);
    }

    console.debug('[push] resubscribeIfEnabled: done.');
  } catch (err) {
    console.warn('[push] resubscribeIfEnabled failed — clearing push flag.\n' + (err.message ?? err), err);
    localStorage.removeItem(LS_KEY);
  }
}