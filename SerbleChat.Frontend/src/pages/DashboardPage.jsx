import { useNavigate } from 'react-router-dom';
import EndpointCard from '../components/EndpointCard.jsx';
import SignalRPanel from '../components/SignalRPanel.jsx';
import {
  verifyAuth,
  getMyAccount,
  getAccountById,
  getAccountByUsername,
  getFriends,
  addFriend,
  getDmChannels,
  getOrCreateDmChannel,
  getChannel,
  getMessages,
  sendMessage,
  createGroupChat,
  getGroupChats,
  getGroupChat,
} from '../api.js';

const s = {
  page: { maxWidth: '860px', margin: '0 auto', padding: '2rem 1.5rem' },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '2rem', paddingBottom: '1rem',
    borderBottom: '1px solid #2d3148',
  },
  logo: { fontSize: '1.5rem', fontWeight: 700, color: '#a78bfa', margin: 0 },
  logoutBtn: {
    padding: '0.4rem 1rem', borderRadius: '6px', background: '#7f1d1d',
    color: '#fca5a5', fontWeight: 600, fontSize: '0.85rem',
    cursor: 'pointer', border: 'none',
  },
  section: { marginBottom: '2.5rem' },
  sectionTitle: {
    fontSize: '1.05rem', fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: '0.75rem', borderLeft: '3px solid #7c3aed',
    paddingLeft: '0.6rem',
  },
  jwt: {
    background: '#0f1117', borderRadius: '8px', padding: '0.75rem 1rem',
    fontSize: '0.75rem', color: '#4a5568', wordBreak: 'break-all',
    marginBottom: '2rem', border: '1px solid #1e2133',
  },
};

export default function DashboardPage() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('jwt');
    navigate('/');
  }

  const jwt = localStorage.getItem('jwt') ?? '';

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <h1 style={s.logo}>SerbleChat — API Dashboard</h1>
        <button style={s.logoutBtn} onClick={logout}>Logout</button>
      </div>

      <div style={s.jwt}>
        <strong style={{ color: '#7c3aed' }}>JWT: </strong>{jwt}
      </div>

      {/* ── Auth ─────────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Auth</div>

        <EndpointCard
          method="POST"
          path="/auth"
          description="Exchange a Serble OAuth code for a backend JWT. (Used automatically during login — re-test here.)"
          inputs={[{ name: 'code', placeholder: 'Serble OAuth code' }]}
          onCall={({ code }) => {
            if (!code) throw new Error('Code is required');
            return import('../api.js').then(m => m.exchangeCode(code));
          }}
        />

        <EndpointCard
          method="GET"
          path="/auth"
          description="Verify that the current JWT is valid (returns 200 OK when authenticated)."
          onCall={() => verifyAuth()}
        />
      </div>

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Account</div>

        <EndpointCard
          method="GET"
          path="/account"
          description="Get the authenticated user's own profile."
          onCall={() => getMyAccount()}
        />

        <EndpointCard
          method="GET"
          path="/account/{id}"
          description="Get a public user profile by their ID."
          inputs={[{ name: 'id', placeholder: 'User ID' }]}
          onCall={({ id }) => {
            if (!id) throw new Error('ID is required');
            return getAccountById(id);
          }}
        />

        <EndpointCard
          method="GET"
          path="/account/from-username/{username}"
          description="Get a public user profile by username."
          inputs={[{ name: 'username', placeholder: 'Username' }]}
          onCall={({ username }) => {
            if (!username) throw new Error('Username is required');
            return getAccountByUsername(username);
          }}
        />
      </div>

      {/* ── Friends ──────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Friends</div>

        <EndpointCard
          method="GET"
          path="/friends"
          description="List all friendships for the authenticated user."
          onCall={() => getFriends()}
        />

        <EndpointCard
          method="POST"
          path="/friends/{friendId}"
          description="Send a friend request to a user, or accept an incoming request."
          inputs={[{ name: 'friendId', placeholder: 'Target User ID' }]}
          onCall={({ friendId }) => {
            if (!friendId) throw new Error('Friend ID is required');
            return addFriend(friendId);
          }}
        />
      </div>

      {/* ── Channels ─────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Channels</div>

        <EndpointCard
          method="GET"
          path="/channel/dm"
          description="List all DM channels the authenticated user is part of."
          onCall={() => getDmChannels()}
        />

        <EndpointCard
          method="GET"
          path="/channel/dm/{otherId}"
          description="Get the DM channel with another user, creating it if it doesn't exist yet."
          inputs={[{ name: 'otherId', placeholder: 'Other User ID' }]}
          onCall={({ otherId }) => {
            if (!otherId) throw new Error('Other User ID is required');
            return getOrCreateDmChannel(otherId);
          }}
        />

        <EndpointCard
          method="GET"
          path="/channel/{channelId}"
          description="Get a channel by its numeric ID."
          inputs={[{ name: 'channelId', placeholder: 'Channel ID (number)' }]}
          onCall={({ channelId }) => {
            if (!channelId) throw new Error('Channel ID is required');
            return getChannel(channelId);
          }}
        />
      </div>

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Messages</div>

        <EndpointCard
          method="GET"
          path="/channel/{channelId}/messages"
          description="Fetch messages from a channel. Supports limit (default 50) and offset (default 0) for pagination."
          inputs={[
            { name: 'channelId', placeholder: 'Channel ID (number)' },
            { name: 'limit', placeholder: 'limit (default 50)' },
            { name: 'offset', placeholder: 'offset (default 0)' },
          ]}
          onCall={({ channelId, limit, offset }) => {
            if (!channelId) throw new Error('Channel ID is required');
            return getMessages(channelId, limit || 50, offset || 0);
          }}
        />

        <EndpointCard
          method="POST"
          path="/channel/{channelId}"
          description="Send a message to a channel."
          inputs={[
            { name: 'channelId', placeholder: 'Channel ID (number)' },
            { name: 'content', placeholder: 'Message content' },
          ]}
          onCall={({ channelId, content }) => {
            if (!channelId) throw new Error('Channel ID is required');
            if (!content) throw new Error('Message content is required');
            return sendMessage(channelId, content);
          }}
        />
      </div>

      {/* ── Group Chats ──────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Group Chats</div>

        <EndpointCard
          method="POST"
          path="/channel/group"
          description="Create a new group chat. Provide a name and a comma-separated list of user IDs to add as initial members."
          inputs={[
            { name: 'name', placeholder: 'Group name' },
            { name: 'users', placeholder: 'User IDs (comma-separated)' },
          ]}
          onCall={({ name, users }) => {
            if (!name) throw new Error('Group name is required');
            const userList = (users ?? '').split(',').map(u => u.trim()).filter(Boolean);
            return createGroupChat(name, userList);
          }}
        />

        <EndpointCard
          method="GET"
          path="/channel/group"
          description="List all group chats the authenticated user is a member of."
          onCall={() => getGroupChats()}
        />

        <EndpointCard
          method="GET"
          path="/channel/group/{groupId}"
          description="Get a specific group chat by its channel ID."
          inputs={[{ name: 'groupId', placeholder: 'Group Channel ID (number)' }]}
          onCall={({ groupId }) => {
            if (!groupId) throw new Error('Group ID is required');
            return getGroupChat(groupId);
          }}
        />
      </div>

      {/* ── SignalR ───────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>SignalR Hub — Real-time</div>
        <SignalRPanel />
      </div>
    </div>
  );
}
