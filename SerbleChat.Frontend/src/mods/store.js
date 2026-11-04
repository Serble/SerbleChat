// Shared state between the app and its mods: what mods have put in UI slots, and the latest
// app/voice context values (published by ModBridge from inside the React tree).

const EMPTY = Object.freeze([]);

// ── UI slots ──

/** slot name -> frozen array of { key, modId, Component, order }, replaced on every change */
const slots = new Map();
const slotListeners = new Set();
let nextKey = 0;

/** Puts a component in a slot; returns a function that takes it out again. */
export function registerSlot(name, modId, Component, { order = 0 } = {}) {
  if (typeof Component !== 'function' && typeof Component !== 'object') {
    throw new TypeError(`ui.register("${name}", ...) needs a React component`);
  }
  const entry = { key: `${modId}:${nextKey++}`, modId, Component, order };
  const next = [...(slots.get(name) ?? EMPTY), entry].sort((a, b) => a.order - b.order);
  slots.set(name, Object.freeze(next));
  slotListeners.forEach(fn => fn());
  return () => {
    const list = slots.get(name) ?? EMPTY;
    if (!list.includes(entry)) return;
    slots.set(name, Object.freeze(list.filter(e => e !== entry)));
    slotListeners.forEach(fn => fn());
  };
}

export function getSlot(name) {
  return slots.get(name) ?? EMPTY;
}

export function subscribeSlots(fn) {
  slotListeners.add(fn);
  return () => slotListeners.delete(fn);
}

// ── Context values (app, voice, clientOptions, theme, navigate) ──

const contexts = {};
const contextListeners = new Map(); // key -> Set<fn>

export function setContextValue(key, value) {
  if (contexts[key] === value) return;
  contexts[key] = value;
  for (const fn of contextListeners.get(key) ?? []) {
    try { fn(value); } catch (err) { console.error(`[mods] ${key} listener threw:`, err); }
  }
}

export function getContextValue(key) {
  return contexts[key] ?? null;
}

export function subscribeContext(key, fn) {
  if (!contextListeners.has(key)) contextListeners.set(key, new Set());
  contextListeners.get(key).add(fn);
  return () => contextListeners.get(key)?.delete(fn);
}

// ── Loaded mods (for the settings tab) ──

/** id -> { status: 'running' | 'error', error } for each renderer half the page tried to load */
export const rendererStatus = new Map();
/** id -> whether the mod was on when the page loaded (to tell when a reload is needed) */
export const enabledAtLoad = new Map();
