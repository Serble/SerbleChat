import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
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
import { useMobile } from '../context/MobileContext.jsx';

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
  const { isMobile, openSidebar } = useMobile();
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isMobile && (
        <div style={{
          height: 48, display: 'flex', alignItems: 'center',
          padding: '0 0.75rem', borderBottom: '1px solid var(--border)',
          flexShrink: 0, background: 'var(--bg-base)',
        }}>
          <button
            title="Open sidebar"
            onClick={openSidebar}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
              padding: '0.25rem', flexShrink: 0,
            }}
          >☰</button>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#72767d' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🏰</div>
          <div style={{ fontWeight: 700, color: '#b5bac1', marginBottom: '0.3rem', fontSize: '1rem' }}>
            No channels yet
          </div>
          <div style={{ fontSize: '0.85rem' }}>Create a channel to start chatting!</div>
        </div>
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
  const { isMobile, sidebarOpen, closeSidebar } = useMobile();
  const location = useLocation();

  // Auto-close the sidebar when the user navigates on mobile
  useEffect(() => {
    if (isMobile) closeSidebar();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const sidebar = activeGuildId
    ? <GuildSidebar guildId={activeGuildId} />
    : <DmSidebar />;

  return (
    <div style={{ display: 'flex', height: 'var(--app-height, 100dvh)', overflow: 'hidden' }}>

      {/* ── Desktop: sidebars inline ── */}
      {!isMobile && (
        <>
          <ServerStrip />
          {sidebar}
        </>
      )}

      {/* ── Mobile: sidebars as slide-in drawer ── */}
      {isMobile && (
        <>
          {/* Backdrop */}
          {sidebarOpen && (
            <div
              onClick={closeSidebar}
              style={{
                position: 'fixed', inset: 0, zIndex: 190,
                background: 'rgba(0,0,0,0.6)',
              }}
            />
          )}
          {/* Drawer */}
          <div style={{
            position: 'fixed', top: 0, left: 0,
            height: 'var(--app-height, 100dvh)',
            zIndex: 200,
            display: 'flex',
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s ease',
            willChange: 'transform',
          }}>
            <ServerStrip />
            {sidebar}
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
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