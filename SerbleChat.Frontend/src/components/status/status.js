import { parseUtcDate } from '../chat/utils.js';
import { formatTime, formatDate } from '../../dateFormat.js';

/**
 * Status helpers.
 *
 * A user *picks* a type: online | away | dnd | invisible.
 * What others *see* (the presence) is online | away | dnd | offline: offline
 * when they aren't connected, and always offline while invisible.
 * A status (type + message) can expire, after which it reads as online with no message.
 */

export const MAX_STATUS_MESSAGE = 128;

// Away has no theme token; this amber reads on both light and dark backgrounds
const AWAY_COLOR = '#f0b232';

export const STATUS_META = {
  online:    { label: 'Online',         color: 'var(--success)',     description: '' },
  away:      { label: 'Away',           color: AWAY_COLOR,           description: '' },
  dnd:       { label: 'Do Not Disturb', color: 'var(--danger)',      description: 'Mutes all notifications and sounds' },
  invisible: { label: 'Invisible',      color: 'var(--text-subtle)', description: "You'll appear offline" },
  offline:   { label: 'Offline',        color: 'var(--text-subtle)', description: '' },
};

/** The types a user can pick, in menu order. */
export const STATUS_TYPES = ['online', 'away', 'dnd', 'invisible'];

/** ms timestamp, or null for "never". */
export function expiresAtMs(expiresAt) {
  if (!expiresAt) return null;
  const t = parseUtcDate(expiresAt).getTime();
  return Number.isNaN(t) ? null : t;
}

function expired(expiresAt, now) {
  const t = expiresAtMs(expiresAt);
  return t != null && t <= now;
}

/**
 * What someone else's status looks like right now.
 * `record` is a UserStatusUpdated payload or a PublicUserResponse
 * ({ status, statusMessage, statusExpiresAt }, or only isOnline from older data).
 */
export function resolvePublicStatus(record, now = Date.now()) {
  if (!record) return { presence: 'offline', message: '', expiresAt: null };
  let presence = record.status ?? (record.isOnline ? 'online' : 'offline');
  if (!STATUS_META[presence]) presence = 'offline';
  if (expired(record.statusExpiresAt, now)) {
    return { presence: presence === 'offline' ? 'offline' : 'online', message: '', expiresAt: null };
  }
  return { presence, message: record.statusMessage ?? '', expiresAt: record.statusExpiresAt ?? null };
}

/**
 * Your own status. `type` is what you picked (including invisible);
 * `presence` is how your own UI shows you: offline while disconnected,
 * invisible while invisible, otherwise your type.
 */
export function resolveOwnStatus(user, connected, now = Date.now()) {
  if (!user) return { type: 'online', presence: 'offline', message: '', expiresAt: null };
  const isExpired = expired(user.statusExpiresAt, now);
  const type = isExpired || !STATUS_META[user.statusType] ? 'online' : user.statusType;
  return {
    type,
    presence: connected ? type : 'offline',
    message: isExpired ? '' : (user.statusMessage ?? ''),
    expiresAt: isExpired ? null : (user.statusExpiresAt ?? null),
  };
}

/** Whether a presence belongs in the "Online" group of a member list. */
export function isShownOnline(presence) {
  return presence === 'online' || presence === 'away' || presence === 'dnd';
}

/** "until 5:30 PM", "until Tue 9:00 AM", "until 12/11/2026 9:00 AM", or '' when it never expires. */
export function formatUntil(expiresAt, now = Date.now()) {
  const t = expiresAtMs(expiresAt);
  if (t == null) return '';
  const d = new Date(t);
  const time = formatTime(d);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return `until ${time}`;
  const withinWeek = t - now < 6 * 24 * 3600 * 1000;
  const day = withinWeek ? d.toLocaleDateString([], { weekday: 'short' }) : formatDate(d);
  return `until ${day} ${time}`;
}

/** Choices for "Clear after". `at(now)` returns the expiry as a Date, or null for never. */
export const DURATIONS = [
  { key: 'never', label: "Don't clear",  at: () => null },
  { key: '30m',   label: '30 minutes',   at: now => new Date(now + 30 * 60 * 1000) },
  { key: '1h',    label: '1 hour',       at: now => new Date(now + 60 * 60 * 1000) },
  { key: '4h',    label: '4 hours',      at: now => new Date(now + 4 * 60 * 60 * 1000) },
  { key: 'today', label: 'Today',        at: now => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d; } },
  { key: 'week',  label: 'This week',    at: now => {
    // Until the end of Sunday (the next Monday 00:00), local time
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
    return d;
  } },
];

// ── Custom "clear after" ──────────────────────────────────────────────────────

export const DURATION_UNITS = [
  { key: 'minutes', label: 'minutes', ms: 60 * 1000 },
  { key: 'hours',   label: 'hours',   ms: 60 * 60 * 1000 },
  { key: 'days',    label: 'days',    ms: 24 * 60 * 60 * 1000 },
];

/** Longest custom expiry allowed. Anything longer may as well be "Don't clear". */
export const MAX_CUSTOM_MS = 365 * 24 * 60 * 60 * 1000;

/** A Date as the value of an <input type="datetime-local"> (local time, minute precision). */
export function toLocalInputValue(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** "in 45 min", "in 3 h 20 min", "in 4 days". */
export function formatRelative(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const days = Math.round(mins / (24 * 60));
  return `in ${days} days`;
}

/**
 * "today at 18:30", "tomorrow at 09:00", "Tuesday at 09:00", "on 12/11/2026 at 09:00".
 * Exactly midnight reads as the end of the day before ("at the end of today"),
 * which is how the Today / This week presets are meant.
 */
export function formatClearTime(date, now = Date.now()) {
  const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiffOf = d => Math.round((startOf(d) - startOf(new Date(now))) / (24 * 3600 * 1000));
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    const dayBefore = new Date(date.getTime() - 60 * 1000);
    const diff = dayDiffOf(dayBefore);
    if (diff === 0) return 'at the end of today';
    if (diff === 1) return 'at the end of tomorrow';
    if (diff > 1 && diff < 7) return `at the end of ${dayBefore.toLocaleDateString([], { weekday: 'long' })}`;
  }
  const time = formatTime(date);
  const dayDiff = dayDiffOf(date);
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `on ${formatDate(date)} at ${time}`;
}
