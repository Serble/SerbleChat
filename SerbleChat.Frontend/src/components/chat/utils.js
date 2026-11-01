// Shared helpers for parsing message content and timestamps.
import { getWebhookAvatarUrl } from '../../api.js';

/** Messages from webhooks have no user author (the webhook itself may since have been deleted). */
export function isWebhookMessage(msg) {
  return msg.authorId == null && !msg._pending;
}

/** Who a message is "from", for grouping runs: a user, or a webhook posting under a given name. */
export function senderKey(msg) {
  return msg.authorId ?? `webhook:${msg.webhookId ?? ''}:${msg.webhookUsername ?? ''}`;
}

/** Avatar for a webhook message: the per-message override, else the webhook's own (may 404). */
export function webhookAvatarSrc(msg) {
  if (msg.webhookAvatarUrl) return msg.webhookAvatarUrl;
  return msg.webhookId != null ? getWebhookAvatarUrl(msg.webhookId) : null;
}

// Regex that matches invite links anywhere in a message.
// Intentionally origin-agnostic so that links shared from a different
// hostname/port (or after a Vite port reassignment on reload) still work.
export const INVITE_RE = () => /https?:\/\/[^\s/]+\/invite\/([a-zA-Z0-9_-]+)/g;

// Regex that matches message links: /app/channel/:channelId?message=:messageId
// Also origin-agnostic for the same reasons as invite links.
export const MESSAGE_RE = () => /https?:\/\/[^\s/]+\/app\/channel\/(\d+)\?message=(\d+)/g;

// Regex that matches files API URLs: /files/something
// Matches the VITE_SERBLE_FILES_API_URL base with /files/ path
export const FILE_RE = () => /https?:\/\/[^\s/]+\/files\/[^\s]+/g;

/** Run a global regex over `content` and collect unique values produced by `pick(match)`. */
function collectUnique(re, content, pick, keyOf = v => v) {
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const value = pick(m);
    const key = keyOf(value);
    if (!seen.has(key)) { seen.add(key); out.push(value); }
  }
  return out;
}

/** Extract unique invite IDs from a message string */
export function extractInviteIds(content) {
  return collectUnique(INVITE_RE(), content, m => m[1]);
}

/** Extract unique message links (channelId, messageId pairs) from a message string */
export function extractMessageLinks(content) {
  return collectUnique(
    MESSAGE_RE(), content,
    m => ({ channelId: m[1], messageId: m[2] }),
    l => `${l.channelId}-${l.messageId}`,
  );
}

/** Extract unique file URLs from a message string */
export function extractFileUrls(content) {
  return collectUnique(FILE_RE(), content, m => m[0]);
}

/**
 * Parse a timestamp string from the server as UTC.
 * The backend sends ISO-8601 strings without a timezone designator (e.g.
 * "2026-02-24T14:30:00"), which JS Date parses as *local* time — wrong.
 * Appending 'Z' forces UTC interpretation.
 */
export function parseUtcDate(str) {
  if (!str) return new Date(NaN);
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(str) ? str : str + 'Z');
}

/** Files API limits use -1 to mean "unlimited". */
export function isUnlimited(value) {
  return value === -1;
}
