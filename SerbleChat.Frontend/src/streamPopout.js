/**
 * streamPopout.js — popping a stream (screen share or camera) out of the call view.
 *
 * In the desktop app each stream gets its own window, which can be moved, resized, kept on
 * top or made fullscreen. In browsers it uses picture-in-picture, which only allows one at
 * a time (opening another replaces it).
 *
 * The popout plays its own <video> of the same MediaStream, so the call view can drop its
 * copy while it's out. Popouts are keyed by `popoutKey(share)`; VoiceContext closes them
 * when their stream ends.
 */
import { useSyncExternalStore } from 'react';
import { isElectron } from './electron-utils.js';

/** @type {Map<string, { close: () => void, focus: () => void, source: HTMLVideoElement }>} */
const popouts = new Map();
const listeners = new Set();
let snapshot = new Set();

function changed() {
  snapshot = new Set(popouts.keys());
  listeners.forEach(fn => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Identifies a stream: its track for remote ones, which kind for our own. */
export function popoutKey(share) {
  return share.isLocal ? `local-${share.source}` : String(share.trackSid);
}

/** The keys of streams that are popped out right now (re-renders when that changes). */
export function usePoppedOutStreams() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Whether streams can be popped out here at all (Firefox has no picture-in-picture API). */
export function canPopOut() {
  if (isElectron()) return true;
  return typeof document !== 'undefined' && !!document.pictureInPictureEnabled
    && typeof HTMLVideoElement !== 'undefined' && 'requestPictureInPicture' in HTMLVideoElement.prototype;
}

export function closePopout(key) {
  popouts.get(key)?.close();
}

/**
 * Closes every popout whose stream isn't in `active` (key → the stream's video element) any
 * more, or has been replaced by a new one (our own screen share restarted, say).
 */
export function closePopoutsExcept(active) {
  for (const [key, popout] of [...popouts]) {
    if (active.get(key) !== popout.source) popout.close();
  }
}

/**
 * Pops a stream out, or brings its window to the front if it's out already.
 * @param {string} key - from popoutKey()
 * @param {HTMLVideoElement} videoElement - the stream's video in the call view
 * @param {string} title - e.g. "alice's screen"
 */
export async function popOutStream(key, videoElement, title) {
  const existing = popouts.get(key);
  if (existing) {
    existing.focus();
    return;
  }
  const stream = videoElement?.srcObject;
  if (!(stream instanceof MediaStream)) throw new Error('This stream has no video to pop out');

  if (isElectron() && openWindow(key, videoElement, stream, title)) return;
  await openPictureInPicture(key, videoElement, stream);
}

// ── Desktop app: a window per stream ──────────────────────────────────────────

const POPOUT_CSS = `
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; user-select: none; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .bar {
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; align-items: center; gap: 6px; padding: 8px 10px;
    background: linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0));
    opacity: 0; transition: opacity 0.15s;
  }
  body:hover .bar, body.show-bar .bar { opacity: 1; }
  .title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 2px #000; }
  button {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.55); color: #fff; cursor: pointer;
  }
  button:hover { background: rgba(255,255,255,0.15); }
  button[aria-pressed='true'] { background: rgba(255,255,255,0.28); border-color: rgba(255,255,255,0.55); }
  svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
`;

const ICON_PIN = '<svg viewBox="0 0 24 24"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
const ICON_FULLSCREEN = '<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

/** Opens the stream in its own window. Returns false if the app wouldn't open one. */
function openWindow(key, source, stream, title) {
  // Size it to the stream, at most 960 wide
  const vw = source.videoWidth || 16;
  const vh = source.videoHeight || 9;
  const width = Math.min(960, Math.max(320, vw));
  const height = Math.max(180, Math.round(width * vh / vw));
  const name = `serble-stream-${key.replace(/[^\w-]/g, '_')}`;
  let win;
  try {
    win = window.open('', name, `width=${width},height=${height}`);
  } catch (err) {
    console.warn('[popout] window.open failed:', err);
  }
  // Older desktop builds don't allow these windows: fall back to picture-in-picture
  if (!win) return false;

  let doc;
  try {
    doc = win.document;
  } catch (err) {
    console.warn('[popout] popout window is not scriptable:', err);
    win.close();
    return false;
  }

  doc.head.innerHTML = '';
  doc.body.innerHTML = '';
  doc.title = title; // (after clearing the head, which holds it)
  const style = doc.createElement('style');
  style.textContent = POPOUT_CSS;
  doc.head.appendChild(style);

  const video = doc.createElement('video');
  video.autoplay = true;
  video.muted = true; // Stream audio plays through the call
  video.playsInline = true;
  video.srcObject = stream;
  video.title = 'Double-click for fullscreen';
  doc.body.appendChild(video);

  const bar = doc.createElement('div');
  bar.className = 'bar';
  const label = doc.createElement('div');
  label.className = 'title';
  label.textContent = title;
  bar.appendChild(label);

  const electronApi = window.electron;
  if (electronApi?.setStreamPopoutOnTop) {
    const pin = doc.createElement('button');
    pin.type = 'button';
    pin.innerHTML = ICON_PIN;
    pin.title = 'Keep on top';
    pin.setAttribute('aria-pressed', 'false');
    pin.addEventListener('click', () => {
      const on = pin.getAttribute('aria-pressed') !== 'true';
      pin.setAttribute('aria-pressed', String(on));
      pin.title = on ? 'Stop keeping on top' : 'Keep on top';
      electronApi.setStreamPopoutOnTop(name, on).catch(err => console.warn('[popout] always-on-top failed:', err));
    });
    bar.appendChild(pin);
  }

  const toggleFullscreen = () => {
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
    else doc.documentElement.requestFullscreen().catch(err => console.warn('[popout] fullscreen failed:', err));
  };
  const full = doc.createElement('button');
  full.type = 'button';
  full.innerHTML = ICON_FULLSCREEN;
  full.title = 'Fullscreen';
  full.addEventListener('click', toggleFullscreen);
  bar.appendChild(full);
  doc.body.appendChild(bar);
  video.addEventListener('dblclick', toggleFullscreen);

  // Show the bar for a moment when the window opens, so it's clear what it is
  doc.body.classList.add('show-bar');
  win.setTimeout(() => doc.body.classList.remove('show-bar'), 2000);

  video.play().catch(err => console.warn('[popout] video play failed:', err));

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    video.srcObject = null;
    if (popouts.get(key)?.source === source) {
      popouts.delete(key);
      changed();
    }
  };
  // Closed by the user (pagehide), or by anything else (polled, since a closed window
  // can't always tell us)
  win.addEventListener('pagehide', cleanup);
  const poll = setInterval(() => { if (win.closed) cleanup(); }, 500);

  popouts.set(key, {
    source,
    focus: () => win.focus(),
    close: () => {
      cleanup();
      try { win.close(); } catch { /* already gone */ }
    },
  });
  changed();
  return true;
}

// ── Browsers: picture-in-picture ──────────────────────────────────────────────

async function openPictureInPicture(key, source, stream) {
  if (!canPopOut()) throw new Error('Picture-in-picture is not supported in this browser');

  // A video of our own, so the popout doesn't depend on the call view keeping its element.
  // It has to stay in the page (a removed video pauses) but needn't be seen.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  Object.assign(video.style, {
    position: 'fixed', right: '0', bottom: '0', width: '2px', height: '2px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(video);

  const cleanup = () => {
    video.removeEventListener('leavepictureinpicture', cleanup);
    video.srcObject = null;
    video.remove();
    if (popouts.get(key)?.source === source) {
      popouts.delete(key);
      changed();
    }
  };

  try {
    // Picture-in-picture needs the first frame's size
    if (video.readyState < 1) {
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('The stream could not be played')), { once: true });
      });
    }
    await video.play().catch(() => {});
    await video.requestPictureInPicture();
  } catch (err) {
    video.srcObject = null;
    video.remove();
    throw err;
  }

  // Only one picture-in-picture window exists at a time: another popout replaces this one,
  // and closing it (or "back to tab") ends it
  video.addEventListener('leavepictureinpicture', cleanup);
  popouts.set(key, {
    source,
    focus: () => {},
    close: () => {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      cleanup();
    },
  });
  changed();
}

// Reloading or closing the app takes its popouts with it
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const popout of [...popouts.values()]) popout.close();
  });
}
