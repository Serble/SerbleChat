import { useEffect, useState } from 'react';
import { parseUtcDate } from '../chat/utils.js';

export const QUESTION_MAX = 300;
export const OPTION_MAX = 100;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

/** Choices for the create dialog; `null` runs until someone ends it. */
export const DURATION_OPTIONS = [
  { value: null,       label: 'No time limit' },
  { value: 5 * 60,     label: '5 minutes' },
  { value: 15 * 60,    label: '15 minutes' },
  { value: 60 * 60,    label: '1 hour' },
  { value: 4 * 3600,   label: '4 hours' },
  { value: 24 * 3600,  label: '1 day' },
  { value: 3 * 86400,  label: '3 days' },
  { value: 7 * 86400,  label: '1 week' },
];

export function pollExpiresAtMs(poll) {
  return poll?.expiresAt ? parseUtcDate(poll.expiresAt).getTime() : null;
}

/** Voting has stopped: someone ended it, or its time ran out. */
export function isPollEnded(poll, now = Date.now()) {
  if (!poll) return true;
  if (poll.closedAt) return true;
  const expires = pollExpiresAtMs(poll);
  return expires != null && expires <= now;
}

/** Number of distinct people who voted (multiple-choice voters count once). */
export function countVoters(poll) {
  const ids = new Set();
  for (const o of poll?.options ?? []) for (const id of o.voterIds) ids.add(id);
  return ids.size;
}

/** "45s left", "12m left", "3h 5m left", "2d 4h left". */
export function formatTimeLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m left` : `${h}h left`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h left` : `${d}d left`;
}

/**
 * The current time, re-rendering every `intervalMs` while `active`.
 * Used for countdowns and to drop polls from the voice strip once they expire.
 */
export function useNow(active, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return active ? now : Date.now();
}

/** Copy of `poll` with `userId`'s choices replaced by `optionIds` (for optimistic votes). */
export function withVotes(poll, userId, optionIds) {
  const chosen = new Set(optionIds.map(String));
  return {
    ...poll,
    options: poll.options.map(o => {
      const others = o.voterIds.filter(id => id !== userId);
      return { ...o, voterIds: chosen.has(String(o.id)) ? [...others, userId] : others };
    }),
  };
}
