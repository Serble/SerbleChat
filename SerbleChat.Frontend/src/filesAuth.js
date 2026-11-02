// Serble Files sign-in, without a second login.
//
// The backend asks Serble for a Files sign-in code on the user's behalf (cross-app sign-in) and we
// redeem it at the Files API for a Files token. SerbleChat and Serble Files are both official, so
// this normally just works. If Serble ever needs the user's approval first, the status becomes
// 'consent_required' and startFilesConsent() sends them to Serble's consent page, which comes
// back to /files-callback (or the Electron callback server).
//
// The token is per device and per chat account, kept in localStorage. Files tokens expire, so a
// token near its expiry, or one the Files API answers 401 to, is replaced silently.

import { useEffect, useSyncExternalStore } from 'react';
import { requestFilesSignInCode } from './api.js';
import { filesAuthenticateWithCode, filesGetAccount } from './filesApi.js';
import { isElectron, electronOAuthFlow } from './electron-utils.js';

export const FILES_CONSENT_REDIRECT_URI = `${window.location.origin}/files-callback`;
const ELECTRON_REDIRECT_URI = 'http://localhost:13579/callback';

const TOKEN_KEY_PREFIX = 'filesApiToken:';
const CONSENT_STATE_KEY = 'files_consent_state';
const CONSENT_RETURN_KEY = 'files_consent_return';

/** Statuses that need the user to do something; automatic connects don't retry them. */
const NEEDS_USER = new Set(['consent_required', 'denied', 'reauth_required']);
/** How long after a failed connect ('unavailable') an automatic connect may try again. */
const RETRY_AFTER_MS = 30_000;
/** Replace a token this close to its expiry rather than risk it lapsing mid-upload. */
const EXPIRY_MARGIN_S = 120;

// ── Helpers ───────────────────────────────────────────────────────────────────

function jwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The chat account the stored Files token belongs to: the nameid claim of the chat JWT. */
function chatUserId() {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return null;
  const p = jwtPayload(jwt);
  return p?.nameid ?? p?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ?? p?.sub ?? null;
}

function isFresh(token) {
  if (!token) return false;
  const exp = jwtPayload(token)?.exp;
  if (typeof exp !== 'number') return true; // not a JWT we can read: let the API decide
  return exp - EXPIRY_MARGIN_S > Date.now() / 1000;
}

function readToken(userId) {
  if (!userId) return null;
  try { return localStorage.getItem(TOKEN_KEY_PREFIX + userId); } catch { return null; }
}

function writeToken(userId, token) {
  if (!userId) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY_PREFIX + userId, token);
    else localStorage.removeItem(TOKEN_KEY_PREFIX + userId);
  } catch { /* storage unavailable: the token just won't outlive the page */ }
}

function randomState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

// ── Store ─────────────────────────────────────────────────────────────────────

// status: 'idle' | 'connecting' | 'connected' | 'consent_required' | 'denied' | 'reauth_required' | 'unavailable'
let snapshot = null;
let failedAt = 0;
let inflight = null;
// A stored token is checked once per page load: the upload and limits endpoints accept anonymous
// calls, so a token Files no longer accepts would otherwise quietly turn uploads into guest ones.
let verifiedToken = null;
let verifying = null;
const listeners = new Set();

function initialSnapshot(userId) {
  const token = readToken(userId);
  return { userId, token, status: isFresh(token) ? 'connected' : 'idle', message: null, consentUrl: null };
}

function current() {
  const userId = chatUserId();
  if (!snapshot || snapshot.userId !== userId) {
    snapshot = initialSnapshot(userId);
    failedAt = 0;
    inflight = null;
  }
  return snapshot;
}

function update(patch) {
  snapshot = { ...current(), ...patch };
  if ('token' in patch) writeToken(snapshot.userId, patch.token);
  listeners.forEach(l => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * A usable Files token, connecting first if there isn't one. Resolves to null when Files can't be
 * connected right now; the status says why. Automatic calls don't retry a status that needs the
 * user; `force` (a button press, or a 401) always tries.
 */
export async function getFilesToken({ force = false } = {}) {
  const s = current();
  if (!s.userId) return null;
  if (!force && isFresh(s.token)) {
    if (verifiedToken === s.token) return s.token;
    verifying ??= verifyToken(s.token).finally(() => { verifying = null; });
    return verifying;
  }
  if (inflight) return inflight;
  if (!force && NEEDS_USER.has(s.status)) return null;
  if (!force && s.status === 'unavailable' && Date.now() - failedAt < RETRY_AFTER_MS) return null;

  const userId = s.userId;
  const run = (async () => {
    update({ status: 'connecting', message: null });
    try {
      const r = await requestFilesSignInCode();
      if (current().userId !== userId) return null; // signed out or switched account meanwhile

      if (r?.status === 'ok' && r.code) {
        const data = await filesAuthenticateWithCode(r.code);
        if (!data?.accessToken) throw new Error('Serble Files did not return an access token');
        if (current().userId !== userId) return null;
        verifiedToken = data.accessToken;
        update({ status: 'connected', token: data.accessToken, consentUrl: null, message: null });
        return data.accessToken;
      }

      update({
        status: ['consent_required', 'denied', 'reauth_required'].includes(r?.status) ? r.status : 'unavailable',
        token: null,
        consentUrl: r?.consentUrl ?? null,
        message: r?.message ?? null,
      });
      if (current().status === 'unavailable') failedAt = Date.now();
      return null;
    } catch (err) {
      if (current().userId !== userId) return null;
      failedAt = Date.now();
      update({
        status: err.status === 403 ? 'denied' : 'unavailable',
        token: null,
        message: filesErrorMessage(err),
      });
      return null;
    } finally {
      inflight = null;
    }
  })();
  inflight = run;
  return run;
}

/**
 * Whether Files turned the token down. Files sends its 401s without CORS headers, so in a browser
 * a rejection usually shows up as a failed fetch with no status. While online, count that too:
 * being wrong costs one silent reconnect.
 */
function looksRejected(err) {
  return err?.status === 401 || (err?.status === undefined && navigator.onLine);
}

async function verifyToken(token) {
  try {
    await filesGetAccount(token);
  } catch (err) {
    if (looksRejected(err)) {
      if (current().token === token) update({ token: null, status: 'idle' });
      return getFilesToken({ force: true });
    }
    // Offline or Files hiccup: keep the token, the next call will tell
  }
  verifiedToken = token;
  return token;
}

/** Messages the Files API sends come as JSON { message }; show just that. */
function filesErrorMessage(err) {
  try {
    const parsed = JSON.parse(err.message);
    if (parsed?.message) return parsed.message;
  } catch { /* not JSON */ }
  return err.message || 'Could not connect to Serble Files';
}

/** Connect (or reconnect) now. For the Connect / Try again buttons. */
export function connectFiles() {
  return getFilesToken({ force: true });
}

/**
 * Runs `fn(token)` with a Files token (null when not connected, for anonymous calls). If the Files
 * API rejects the token as expired, gets a new one and runs `fn` once more.
 */
export async function withFilesToken(fn) {
  const token = await getFilesToken();
  try {
    return await fn(token);
  } catch (err) {
    if (!looksRejected(err) || !token) throw err;
    if (current().token === token) update({ token: null, status: 'idle' });
    const fresh = await getFilesToken({ force: true });
    if (!fresh) throw err;
    return fn(fresh);
  }
}

/** Forget this device's Files token, e.g. when signing out of SerbleChat. */
export function clearFilesAuth() {
  const s = current();
  writeToken(s.userId, null);
  snapshot = null;
  listeners.forEach(l => l());
}

function consentUrlFor(redirectUri, state) {
  const url = new URL(current().consentUrl);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Sends the user to Serble to allow SerbleChat to sign them in to Serble Files. On the web this
 * leaves the page and comes back through /files-callback; in Electron it waits for the browser.
 */
export async function startFilesConsent() {
  if (!current().consentUrl) return connectFiles();
  const state = randomState();

  if (!isElectron()) {
    sessionStorage.setItem(CONSENT_STATE_KEY, state);
    sessionStorage.setItem(CONSENT_RETURN_KEY, window.location.pathname + window.location.search);
    window.location.href = consentUrlFor(FILES_CONSENT_REDIRECT_URI, state);
    return null;
  }

  try {
    const callback = await electronOAuthFlow(consentUrlFor(ELECTRON_REDIRECT_URI, state));
    if (callback.state !== state) throw new Error('State mismatch - please try again');
    if (callback.error || !callback.target) {
      update({ message: 'Access to Serble Files was not allowed.' });
      return null;
    }
  } catch (err) {
    update({ message: err.message });
    return null;
  }
  return connectFiles();
}

/**
 * Completes the consent redirect on /files-callback. Returns { ok, error, returnTo }: on success
 * Files is connected by the time it resolves.
 */
export async function finishFilesConsent(params) {
  const saved = sessionStorage.getItem(CONSENT_STATE_KEY);
  const returnTo = sessionStorage.getItem(CONSENT_RETURN_KEY) || '/app';
  sessionStorage.removeItem(CONSENT_STATE_KEY);
  sessionStorage.removeItem(CONSENT_RETURN_KEY);

  if (!saved || params.get('state') !== saved) {
    return { ok: false, returnTo, error: 'This page was opened without a matching request. Please try again from Settings › Files.' };
  }
  if (params.get('error') || !params.get('target')) {
    return { ok: false, returnTo, error: 'Access to Serble Files was not allowed.' };
  }
  const token = await connectFiles();
  if (!token) {
    return { ok: false, returnTo, error: current().message || 'Could not connect to Serble Files.' };
  }
  return { ok: true, returnTo };
}

/**
 * The Files connection: { status, token, message, consentUrl }. Connects in the background on
 * mount unless `auto` is false.
 */
export function useFilesAuth({ auto = true } = {}) {
  const s = useSyncExternalStore(subscribe, current);
  useEffect(() => {
    if (auto) getFilesToken().catch(() => {});
  }, [auto, s.userId]);
  return s;
}
