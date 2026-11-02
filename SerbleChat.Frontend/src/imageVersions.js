import { useSyncExternalStore } from 'react';

/**
 * Versions of avatars and icons, as the server reports them (avatarVersion on users, iconVersion on guilds and
 * channels). A version changes whenever its picture does and goes in the image URL, so a cached copy of an old
 * picture is never shown for a new one, and an unchanged one never has to be downloaded again.
 *
 *   0          there is no picture: show the fallback without requesting anything
 *   > 0        the picture's version
 *   undefined  not known (an older server, or a row it hasn't checked yet): use the bare URL
 *
 * Filled from every API response (see api.js) and from UserUpdated events, so components don't have to pass
 * versions around: they look them up by ID.
 */

const users = new Map();
const guilds = new Map();
const channels = new Map();
const listeners = new Set();
let revision = 0;

function set(map, id, version) {
  if (id == null || typeof version !== 'number' || version < 0) return false;
  const key = String(id);
  if (map.get(key) === version) return false;
  map.set(key, version);
  return true;
}

function changed() {
  revision++;
  for (const l of listeners) l();
}

/** Records the versions in a user, guild or channel object. Returns whether anything changed. */
export function noteUser(u) { if (set(users, u?.id, u?.avatarVersion)) { changed(); return true; } return false; }
export function noteGuild(g) { if (set(guilds, g?.id, g?.iconVersion)) { changed(); return true; } return false; }
export function noteChannel(c) { if (set(channels, c?.id, c?.iconVersion)) { changed(); return true; } return false; }

/**
 * Picks up every user, guild and channel in an API response, however deeply nested (guild members, DM
 * channels, group chats...). Users have avatarVersion; channels have iconVersion and a type; guilds have
 * iconVersion and no type.
 */
export function noteVersionsIn(data, depth = 0) {
  if (data == null || typeof data !== 'object' || depth > 4) return;
  if (Array.isArray(data)) {
    for (const item of data) noteVersionsIn(item, depth + 1);
    return;
  }
  let any = false;
  if (typeof data.avatarVersion === 'number') any = set(users, data.id, data.avatarVersion) || any;
  if (typeof data.iconVersion === 'number') {
    any = set('type' in data ? channels : guilds, data.id, data.iconVersion) || any;
  }
  if (any) changed();
  for (const value of Object.values(data)) {
    if (value !== null && typeof value === 'object') noteVersionsIn(value, depth + 1);
  }
}

export const avatarVersionOf = id => users.get(String(id));
export const guildIconVersionOf = id => guilds.get(String(id));
export const channelIconVersionOf = id => channels.get(String(id));

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller whenever any known version changes, and returns the current one for this user. */
export function useAvatarVersion(userId) {
  useSyncExternalStore(subscribe, () => revision);
  return userId == null ? undefined : users.get(String(userId));
}

/** Re-renders the caller whenever any known version changes. */
export function useImageVersions() {
  return useSyncExternalStore(subscribe, () => revision);
}

/** The URL for an image with this version, or null when there is no image. */
export function versionedUrl(url, version) {
  if (version === 0) return null;
  return typeof version === 'number' && version > 0 ? `${url}?v=${version}` : url;
}

/** Adds a query parameter to a URL that may already have some. */
export function withQuery(url, query) {
  if (!url || !query) return url;
  return url + (url.includes('?') ? '&' : '?') + query.replace(/^[?&]/, '');
}
