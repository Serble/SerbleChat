// Serble OAuth settings
export const CLIENT_ID = '1ebf51ca-9eae-46ad-aa98-b984c47ad94d';
export const REDIRECT_URI = `${window.location.origin}/callback`;
export const OAUTH_URL = 'https://serble.net/oauth/authorize';

// Backend base URL – set VITE_API_BASE_URL in your .env file
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://100.115.82.61:5210';

function authHeaders() {
  const jwt = localStorage.getItem('jwt');
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

async function handle(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** POST /auth  – exchange Serble OAuth code for a backend JWT */
export async function exchangeCode(code) {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return handle(res);
}

/** GET /auth  – verify the current JWT is still valid */
export async function verifyAuth() {
  const res = await fetch(`${BASE}/auth`, { headers: authHeaders() });
  return handle(res);
}

// ── Account ───────────────────────────────────────────────────────────────────

/** GET /account  – own profile */
export async function getMyAccount() {
  const res = await fetch(`${BASE}/account`, { headers: authHeaders() });
  return handle(res);
}

/** GET /account/:id  – public profile by id */
export async function getAccountById(id) {
  const res = await fetch(`${BASE}/account/${encodeURIComponent(id)}`, { headers: authHeaders() });
  return handle(res);
}

/** GET /account/from-username/:username  – public profile by username */
export async function getAccountByUsername(username) {
  const res = await fetch(`${BASE}/account/from-username/${encodeURIComponent(username)}`, { headers: authHeaders() });
  return handle(res);
}

// ── Friends ───────────────────────────────────────────────────────────────────

/** GET /friends  – list my friendships */
export async function getFriends() {
  const res = await fetch(`${BASE}/friends`, { headers: authHeaders() });
  return handle(res);
}

/** POST /friends/:friendId  – send/accept a friend request */
export async function addFriend(friendId) {
  const res = await fetch(`${BASE}/friends/${encodeURIComponent(friendId)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handle(res);
}

/** DELETE /friends/:friendId  – remove a friend or cancel a request */
export async function removeFriend(friendId) {
  const res = await fetch(`${BASE}/friends/${encodeURIComponent(friendId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

// ── Channels ──────────────────────────────────────────────────────────────────

/** GET /channel/dm  – list all my DM channels */
export async function getDmChannels() {
  const res = await fetch(`${BASE}/channel/dm`, { headers: authHeaders() });
  return handle(res);
}

/** GET /channel/dm/:otherId  – get (or create) a DM channel with a user */
export async function getOrCreateDmChannel(otherId) {
  const res = await fetch(`${BASE}/channel/dm/${encodeURIComponent(otherId)}`, { headers: authHeaders() });
  return handle(res);
}

/** GET /channel/:channelId  – get a channel by id */
export async function getChannel(channelId) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}`, { headers: authHeaders() });
  return handle(res);
}

// ── Messages ──────────────────────────────────────────────────────────────────

/** GET /channel/:channelId/messages?limit&offset  – list messages */
export async function getMessages(channelId, limit = 50, offset = 0) {
  const params = new URLSearchParams({ limit, offset });
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/messages?${params}`, { headers: authHeaders() });
  return handle(res);
}

/** DELETE /channel/:channelId/message/:messageId  – delete a message */
export async function deleteMessage(channelId, messageId) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/message/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** POST /channel/:channelId  – send a message */
export async function sendMessage(channelId, content) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return handle(res);
}

// ── Group Chats ───────────────────────────────────────────────────────────────

/** POST /channel/group  – create a new group chat */
export async function createGroupChat(name, users) {
  const res = await fetch(`${BASE}/channel/group`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, users }),
  });
  return handle(res);
}

/** GET /channel/:channelId/members  – list members of a channel */
export async function getChannelMembers(channelId) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/members`, { headers: authHeaders() });
  return handle(res);
}

/** DELETE /channel/group/:groupId  – leave (or delete if owner) a group chat */
export async function leaveOrDeleteGroupChat(groupId) {
  const res = await fetch(`${BASE}/channel/group/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** POST /channel/group/:groupId/members  – add members to a group chat (owner only) */
export async function addGroupChatMembers(groupId, userIds) {
  const res = await fetch(`${BASE}/channel/group/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
  return handle(res);
}

/** GET /channel/group  – list all group chats the authenticated user is in */
export async function getGroupChats() {
  const res = await fetch(`${BASE}/channel/group`, { headers: authHeaders() });
  return handle(res);
}

/** GET /channel/group/:groupId  – get a specific group chat by channel ID */
export async function getGroupChat(groupId) {
  const res = await fetch(`${BASE}/channel/group/${encodeURIComponent(groupId)}`, { headers: authHeaders() });
  return handle(res);
}
