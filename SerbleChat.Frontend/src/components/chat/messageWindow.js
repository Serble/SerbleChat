/**
 * The open channel shows one contiguous run of its history (the "window"), which can sit anywhere:
 * at the present, or far back after a jump to an old message. Pages load at whichever end the user
 * scrolls toward, and once the window grows past MAX_WINDOW messages the far end is dropped, so any
 * part of the history can be reached without keeping all of it in memory.
 *
 * These helpers are pure: they take the current list (oldest first, pending sends at the end) and an
 * API page (newest first, as the server returns them) and give the new list.
 */

export const PAGE_SIZE = 50;
export const MAX_WINDOW = 200;

const isPending = m => !!m._pending;

function byId(a, b) {
  return Number(a.id) - Number(b.id);
}

/** Real (sent) messages in the list. */
export function realMessages(list) {
  return list.filter(m => !isPending(m));
}

/**
 * Put an older page in front of the list. With `trimNewest`, the newest messages beyond MAX_WINDOW are
 * dropped (the caller only asks for that when there are no pending sends, which belong at the very end).
 */
export function prependOlder(list, pageNewestFirst, trimNewest) {
  const known = new Set(list.map(m => String(m.id)));
  const older = pageNewestFirst.filter(m => !known.has(String(m.id))).reverse();
  const next = [...older, ...list];
  return trimNewest ? realMessages(next).slice(0, MAX_WINDOW) : next;
}

/**
 * Add newer messages (an API page and/or held live messages, in any order) after the list, keeping it
 * sorted and free of duplicates. Copies already in the list win, so their render keys stay put.
 * With `trimOldest`, the oldest messages beyond MAX_WINDOW are dropped. Pending sends stay at the end.
 */
export function appendNewer(list, newer, trimOldest) {
  const real = realMessages(list);
  const pending = list.filter(isPending);
  const known = new Set(real.map(m => String(m.id)));
  const added = [];
  for (const m of newer) {
    const id = String(m.id);
    if (known.has(id)) continue;
    known.add(id);
    added.push(m);
  }
  let merged = real;
  if (added.length > 0) {
    added.sort(byId);
    // Usually everything new comes after what we have, so this stays a cheap concatenation
    const last = real[real.length - 1];
    merged = !last || byId(added[0], last) > 0 ? [...real, ...added] : [...real, ...added].sort(byId);
  }
  if (trimOldest && merged.length > MAX_WINDOW) merged = merged.slice(merged.length - MAX_WINDOW);
  return pending.length > 0 ? [...merged, ...pending] : merged;
}

/** Put a message back where it belongs (e.g. after a failed delete), if it falls inside the window. */
export function reinsert(list, msg) {
  const real = realMessages(list);
  if (real.some(m => String(m.id) === String(msg.id))) return list;
  const first = real[0], last = real[real.length - 1];
  if (!first || byId(msg, first) < 0 || byId(msg, last) > 0) return list;
  return [...[...real, msg].sort(byId), ...list.filter(isPending)];
}

/**
 * Flags for a window loaded around `aroundId`: the server sends up to PAGE_SIZE/2 messages on each side,
 * so a full side means there's more history that way.
 */
export function aroundFlags(pageNewestFirst, aroundId) {
  const half = Math.floor(PAGE_SIZE / 2);
  const target = Number(aroundId);
  const older = pageNewestFirst.filter(m => Number(m.id) < target).length;
  const newer = pageNewestFirst.filter(m => Number(m.id) > target).length;
  return { hasOlder: older >= half, hasNewer: newer >= half };
}
