// Serble OAuth settings
export const CLIENT_ID = '1ebf51ca-9eae-46ad-aa98-b984c47ad94d';
export const REDIRECT_URI = `${window.location.origin}/callback`;
export const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL?.replace(/\/$/, '') ?? window.location.origin;
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
  if (!res.ok) {
    const err = new Error(typeof data === 'string' ? data : JSON.stringify(data));
    err.status = res.status;
    throw err;
  }
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

/** PATCH /account  – update own account settings (e.g. default notification prefs) */
export async function patchAccount(body) {
  const res = await fetch(`${BASE}/account`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

// ── Blocks ────────────────────────────────────────────────────────────────────

/** GET /account/blocks  – list all blocked users */
export async function getBlockedUsers() {
  const res = await fetch(`${BASE}/account/blocks`, { headers: authHeaders() });
  return handle(res);
}

/** POST /account/blocks/:id  – block a user */
export async function blockUser(id) {
  const res = await fetch(`${BASE}/account/blocks/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handle(res);
}

/** DELETE /account/blocks/:id  – unblock a user */
export async function unblockUser(id) {
  const res = await fetch(`${BASE}/account/blocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** GET /account/unreads  – map of channelId -> unread count (already filtered by per-channel prefs) */
export async function getUnreads() {
  const res = await fetch(`${BASE}/account/unreads`, { headers: authHeaders() });
  return handle(res); // { [channelId: string]: number }
}

/** GET /channel/:channelId/notification-preferences  – get notification prefs for a channel */
export async function getChannelNotifPrefs(channelId) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/notification-preferences`, { headers: authHeaders() });
  return handle(res); // { notifications: 0|1|2, unreads: 0|1|2 }
}

/** PUT /channel/:channelId/notification-preferences  – update notification prefs */
export async function setChannelNotifPrefs(channelId, { notifications, unreads }) {
  const res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/notification-preferences`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ notifications, unreads }),
  });
  return handle(res);
}

/** GET /guild/:guildId/notification-preferences  – get guild-level notification prefs */
export async function getGuildNotifPrefs(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/notification-preferences`, { headers: authHeaders() });
  return handle(res); // { preferences: { notifications: 0|1|2|3, unreads: 0|1|2|3 } }
}

/** PUT /guild/:guildId/notification-preferences  – update guild-level notification prefs */
export async function setGuildNotifPrefs(guildId, preferences) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/notification-preferences`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
  return handle(res);
}

/** GET /account/client-options  – get client-side settings blob (returns a JSON string) */
export async function getClientOptions() {
  const res = await fetch(`${BASE}/account/client-options`, { headers: authHeaders() });
  return handle(res); // returns a JS string (the serialized options JSON)
}

/** PUT /account/client-options  – save client-side settings blob */
export async function setClientOptions(optionsJson) {
  // The backend expects [FromBody] string, so the body must be a JSON-encoded string value
  const res = await fetch(`${BASE}/account/client-options`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(optionsJson), // double-encode: JSON string of a JSON string
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

/** POST /channel/:channelId/voice  – get a LiveKit token for a channel */
export async function getChannelVoiceToken(channelId) {
  let res = await fetch(`${BASE}/channel/${encodeURIComponent(channelId)}/voice`, {
    method: 'POST',
    headers: authHeaders(),
  });
  
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

// ── Guilds ────────────────────────────────────────────────────────────────────

/** GET /guild  – list all guilds the current user is in */
export async function getMyGuilds() {
  const res = await fetch(`${BASE}/guild`, { headers: authHeaders() });
  return handle(res);
}

/** GET /guild/:id  – get a specific guild */
export async function getGuild(id) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(id)}`, { headers: authHeaders() });
  return handle(res);
}

/** POST /guild  – create a new guild; returns the created Guild */
export async function createGuild(name) {
  const res = await fetch(`${BASE}/guild`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handle(res);
}

/** DELETE /guild/:id  – delete a guild (owner only) */
export async function deleteGuild(id) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** PATCH /guild/:id  – update guild (name and/or defaultPermissions) */
export async function updateGuild(id, patch) {
  // Accept either (id, nameString) for legacy callers or (id, {name, defaultPermissions})
  const body = typeof patch === 'string' ? { name: patch } : patch;
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle(res);
}

/** GET /guild/:guildId/channel  – list channels in a guild, sorted by index */
export async function getGuildChannels(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel`, { headers: authHeaders() });
  const guildChannels = await handle(res); // GuildChannel[] — { channelId, guildId, index, channel }
  // Sort by index then extract the inner channel, adding id = channelId for consistency
  return guildChannels
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(gc => ({ ...gc.channel, id: gc.channelId ?? gc.channel?.id }));
}

/** POST /guild/:guildId/channel  – create a channel in a guild; returns Channel */
export async function createGuildChannel(guildId, name, voiceCapable = false) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, voiceCapable }),
  });
  return handle(res);
}

/** DELETE /guild/:guildId/channel/:channelId  – delete a channel */
export async function deleteGuildChannel(guildId, channelId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** PATCH /guild/:guildId/channel/:channelId  – update a channel (name and/or voiceCapable) */
export async function updateGuildChannel(guildId, channelId, patch) {
  // Accept either a plain string (legacy) or a { name?, voiceCapable? } object
  const body = typeof patch === 'string' ? { name: patch } : patch;
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle(res);
}

/** GET /guild/:guildId/my-permissions – get the current user's resolved permissions */
export async function getMyGuildPermissions(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/my-permissions`, { headers: authHeaders() });
  return handle(res);
}

/** GET /guild/:guildId/members – list members with role colours */
export async function getGuildMembers(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/members`, { headers: authHeaders() });
  return handle(res);
}

/** GET /guild/:guildId/channel/:channelId/members – guild member list with role colours */
export async function getGuildChannelMembersDetails(guildId, channelId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/members`, { headers: authHeaders() });
  return handle(res);
}

/** POST /guild/:guildId/channel/:channelId/reorder – move channel to newIndex */
export async function reorderGuildChannel(guildId, channelId, newIndex) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/reorder`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ newIndex }),
  });
  return handle(res);
}

// ── Guild Roles ───────────────────────────────────────────────────────────────

/** GET /guild/:guildId/roles */
export async function getGuildRoles(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/roles`, { headers: authHeaders() });
  return handle(res);
}

/** POST /guild/:guildId/roles */
export async function createGuildRole(guildId, { name, color = '', displaySeparately = false, mentionable = true, permissions = null }) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/roles`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, displaySeparately, mentionable, permissions }),
  });
  return handle(res);
}

/** PATCH /guild/:guildId/roles/:roleId */
export async function updateGuildRole(guildId, roleId, patch) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle(res);
}

/** DELETE /guild/:guildId/roles/:roleId */
export async function deleteGuildRole(guildId, roleId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** GET /guild/:guildId/members/:userId/roles */
export async function getUserGuildRoles(guildId, userId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles`, { headers: authHeaders() });
  return handle(res);
}

/** POST /guild/:guildId/members/:userId/roles/:roleId */
export async function addUserGuildRole(guildId, userId, roleId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handle(res);
}

/** DELETE /guild/:guildId/members/:userId/roles/:roleId */
export async function removeUserGuildRole(guildId, userId, roleId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

// ── Guild Invites ─────────────────────────────────────────────────────────────
/** POST /guild/:guildId/invite  – create an invite; returns GuildInvite */
export async function createGuildInvite(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/invite`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handle(res);
}

/** GET /guild/:guildId/invite  – list invites for a guild (owner only) */
export async function getGuildInvites(guildId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/invite`, { headers: authHeaders() });
  return handle(res);
}

/** DELETE /guild/invite/:inviteId  – delete an invite (owner only) */
export async function deleteGuildInvite(inviteId) {
  const res = await fetch(`${BASE}/guild/invite/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}

/** POST /guild/invite/:inviteId/accept  – accept an invite; returns Guild */
export async function acceptGuildInvite(inviteId) {
  const res = await fetch(`${BASE}/guild/invite/${encodeURIComponent(inviteId)}/accept`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handle(res);
}

// ── Channel Permission Overrides ──────────────────────────────────────────────

/** GET /guild/:guildId/channel/:channelId/my-permissions – resolved perms for this specific channel */
export async function getMyChannelPermissions(guildId, channelId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/my-permissions`, { headers: authHeaders() });
  return handle(res);
}

/** GET /guild/:guildId/channel/:channelId/permission-overrides – list all overrides */
export async function getChannelPermissionOverrides(guildId, channelId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/permission-overrides`, { headers: authHeaders() });
  return handle(res);
}

/** POST /guild/:guildId/channel/:channelId/permission-overrides – create an override */
export async function createChannelPermissionOverride(guildId, channelId, { userId, roleId, permissions }) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/permission-overrides`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, roleId, permissions }),
  });
  return handle(res);
}

/** PATCH /guild/:guildId/channel/:channelId/permission-overrides/:overrideId – update permissions */
export async function updateChannelPermissionOverride(guildId, channelId, overrideId, permissions) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/permission-overrides/${encodeURIComponent(overrideId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions }),
  });
  return handle(res);
}

/** DELETE /guild/:guildId/channel/:channelId/permission-overrides/:overrideId */
export async function deleteChannelPermissionOverride(guildId, channelId, overrideId) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildId)}/channel/${encodeURIComponent(channelId)}/permission-overrides/${encodeURIComponent(overrideId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handle(res);
}
