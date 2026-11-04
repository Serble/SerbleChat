// Loads the renderer halves of client mods (desktop app only) and builds the `api` they get.
// See MODDING.md for what a mod looks like, and electron/mods.cjs for the main halves.

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactRouter from 'react-router-dom';
import * as LiveKit from 'livekit-client';
import * as SignalR from '@microsoft/signalr';
import * as httpApi from '../api.js';
import * as voice from '../voice.js';
import * as sound from '../sound.js';
import * as electronUtils from '../electron-utils.js';
import * as ui from '../components/ui/index.js';
import * as icons from '../icons.jsx';
import Avatar from '../components/Avatar.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import ModSlot from './ModSlot.jsx';
import { registerSlot, getContextValue, subscribeContext, rendererStatus, enabledAtLoad } from './store.js';

const START_TIMEOUT_MS = 5000;

/**
 * The app's own modules, so mods use the same instances (one React, one LiveKit) rather than
 * bundling their own copies.
 */
export const modules = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react-router-dom': ReactRouter,
  'livekit-client': LiveKit,
  '@microsoft/signalr': SignalR,
  api: httpApi,
  voice,
  sound,
  electron: electronUtils,
  ui: { ...ui, Avatar, ModSlot },
  icons,
  hooks: { useApp, useVoice, useClientOptions, useTheme, useMobile },
};

/** The `api` a mod's renderer half is started with. */
function createModApi(mod) {
  const bridge = window.electron.mods;
  const prefix = `[mod:${mod.id}]`;
  const stopFns = [];
  const track = (fn) => { stopFns.push(fn); return fn; };

  const contextApi = (key) => ({
    /** The latest value, or null outside the app (on the login page, say). */
    get: () => getContextValue(key),
    /** Calls fn(value) every time it changes; returns an unsubscribe function. */
    subscribe: (fn) => track(subscribeContext(key, fn)),
  });

  const storageKey = (key) => `mod:${mod.id}:${key}`;

  const api = {
    id: mod.id,
    mod,
    React,
    modules,

    log: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),

    /** Talking to this mod's main half (ctx.ipc there). */
    ipc: {
      invoke: (channel, ...args) => bridge.invoke(mod.id, channel, ...args),
      send: (channel, ...args) => bridge.send(mod.id, channel, ...args),
      on: (channel, fn) => track(bridge.on(mod.id, channel, fn)),
    },

    ui: {
      /**
       * Puts a React component in a slot (see MODDING.md for the list and the props each passes).
       * Returns a function that removes it.
       */
      register: (slot, Component, options) => track(registerSlot(slot, mod.id, Component, options)),
      /** A settings panel for this mod, shown under it in Settings → Mods. */
      settings: (Component) => track(registerSlot(`settings:${mod.id}`, mod.id, Component)),
    },

    app: contextApi('app'),
    clientOptions: contextApi('clientOptions'),
    theme: contextApi('theme'),

    voice: {
      ...contextApi('voice'),
      /** The current call's session (voice.js VoiceSession), or null when not in one. */
      session: () => getContextValue('voice')?.voiceSession ?? null,
      /** The current call's LiveKit Room, or null. */
      room: () => getContextValue('voice')?.voiceSession?.room ?? null,
      /** The AudioContext calls play through (nodes you connect to a call must come from it). */
      audioContext: voice.audioContext,
      /**
       * Calls fn(session) whenever you join a call (and now, if you're in one). If fn returns a
       * function, that runs when the call ends. Returns a function that stops watching.
       */
      onSession(fn) {
        let current = null;
        let cleanup = null;
        const end = () => {
          if (!cleanup) return;
          try { cleanup(); } catch (err) { console.error(prefix, 'onSession cleanup threw:', err); }
          cleanup = null;
        };
        const check = (value) => {
          const session = value?.voiceSession ?? null;
          if (session === current) return;
          end();
          current = session;
          if (!session) return;
          try {
            const result = fn(session);
            if (typeof result === 'function') cleanup = result;
          } catch (err) {
            console.error(prefix, 'onSession callback threw:', err);
          }
        };
        check(getContextValue('voice'));
        const unsubscribe = subscribeContext('voice', check);
        return track(() => { unsubscribe(); end(); });
      },
    },

    /** Navigates the app (e.g. "/app/channel/123"). Does nothing outside the app. */
    navigate: (to, options) => getContextValue('navigate')?.(to, options),

    /** Shows a toast: { title, body, type: 'info' | 'success' | 'error', duration }. */
    toast: (options) => getContextValue('app')?.addToast(options),

    /** Small JSON settings kept in this browser profile, namespaced to this mod. */
    storage: {
      get(key, fallback = null) {
        try {
          const raw = localStorage.getItem(storageKey(key));
          return raw == null ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        localStorage.setItem(storageKey(key), JSON.stringify(value));
      },
      remove(key) {
        localStorage.removeItem(storageKey(key));
      },
    },

    /** Runs when the page goes away (reload, mods reloaded, app closing). */
    onStop: (fn) => track(fn),

    _stop() {
      for (const fn of stopFns.splice(0).reverse()) {
        try { fn(); } catch (err) { console.error(prefix, 'stop function threw:', err); }
      }
    },
  };
  return api;
}

async function loadOne(mod) {
  const api = createModApi(mod);
  try {
    const exported = await import(/* @vite-ignore */ mod.rendererUrl);
    const start = typeof exported.default === 'function' ? exported.default : exported.start;
    if (typeof exported.stop === 'function') api.onStop(() => exported.stop());
    if (typeof start === 'function') {
      const started = Promise.resolve(start(api)).then(result => {
        if (typeof result === 'function') api.onStop(result);
      });
      // Don't hold up the app for a slow mod
      await Promise.race([started, new Promise(resolve => setTimeout(resolve, START_TIMEOUT_MS))]);
    }
    rendererStatus.set(mod.id, { status: 'running', error: null });
    window.addEventListener('pagehide', () => api._stop(), { once: true });
    loaded.push({ ...mod, api });
    console.log(`[mods] Loaded ${mod.id}`);
  } catch (err) {
    api._stop();
    rendererStatus.set(mod.id, { status: 'error', error: err?.stack || String(err) });
    console.error(`[mods] ${mod.id} failed to load:`, err);
  }
}

const loaded = [];

/** Loads every enabled mod's renderer half. Resolves once they've started (or failed to). */
export async function loadMods() {
  const bridge = window.electron?.mods;
  window.SerbleChat = { modules, mods: loaded };
  if (!bridge) return;

  bridge.onLog((id, level, message) => {
    (console[level] ?? console.log)(`[mod:${id}] (main)`, message);
  });

  let list = [];
  try {
    list = await bridge.list();
  } catch (err) {
    console.error('[mods] Failed to list mods:', err);
    return;
  }
  for (const mod of list) enabledAtLoad.set(mod.id, mod.enabled);
  for (const mod of list) {
    // A mod whose main half failed doesn't get its renderer half run either
    if (!mod.enabled || !mod.rendererUrl || mod.status === 'error') continue;
    await loadOne(mod);
  }
}
