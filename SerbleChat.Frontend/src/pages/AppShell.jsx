import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import ServerStrip     from '../components/ServerStrip.jsx';
import DmSidebar       from '../components/DmSidebar.jsx';
import GuildSidebar    from '../components/GuildSidebar.jsx';
import FriendsHome     from '../components/FriendsHome.jsx';
import ChatView        from '../components/ChatView.jsx';
import ToastContainer  from '../components/ToastContainer.jsx';
import { getGuildChannels } from '../api.js';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

// Redirect old /app/guild/:guildId/channel/:channelId URLs to /app/channel/:channelId
function GuildChannelRedirect() {
  const { channelId } = useParams();
  return <Navigate to={`/app/channel/${channelId}`} replace />;
}

// Auto-navigates to the guild's first channel, or shows a placeholder
function GuildLanding() {
  const { guildId } = useParams();
  const nav = useNavigate();
  const { setActiveGuildId } = useApp();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setActiveGuildId(guildId);
    getGuildChannels(guildId)
      .then(channels => {
        if (channels && channels.length > 0) {
          nav(`/app/channel/${channels[0].id}`, { replace: true });
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#72767d' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🏰</div>
        <div style={{ fontWeight: 700, color: '#b5bac1', marginBottom: '0.3rem', fontSize: '1rem' }}>
          No channels yet
        </div>
        <div style={{ fontSize: '0.85rem' }}>Create a channel to start chatting!</div>
      </div>
    </div>
  );
}

// Ensure ChatView always remounts when the channel changes, giving it
// clean state and guaranteeing messages are loaded (and reversed) fresh.
function ChannelPage() {
  const { channelId } = useParams();
  return <ChatView key={channelId} />;
}

export default function AppShell() {
  const { activeGuildId } = useApp();

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <ServerStrip />
      {activeGuildId
        ? <GuildSidebar guildId={activeGuildId} />
        : <DmSidebar />
      }
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#313338' }}>
        <Routes>
          <Route index                                    element={<Navigate to="friends" replace />} />
          <Route path="friends"                          element={<FriendsHome />} />
          {/* Single unified route for all channel types */}
          <Route path="channel/:channelId"               element={<ChannelPage />} />
          <Route path="guild/:guildId"                   element={<GuildLanding />} />
          {/* Redirect legacy guild-channel URLs */}
          <Route path="guild/:guildId/channel/:channelId" element={<GuildChannelRedirect />} />
        </Routes>
      </div>
      <ToastContainer />
    </div>
  );
}