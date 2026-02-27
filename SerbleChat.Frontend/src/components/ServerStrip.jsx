import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import CreateGuildModal from './CreateGuildModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import GuildNotifContextMenu from './GuildNotifContextMenu.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import { getGuildIconUrl } from '../api.js';

function StripButton({ title, active, onClick, children }) {
  const base = {
    width: 48, height: 48, borderRadius: active ? '30%' : '50%',
    background: active ? 'var(--accent)' : 'var(--bg-active)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: '1.25rem',
    transition: 'border-radius 0.2s, background 0.2s',
    userSelect: 'none', border: 'none', flexShrink: 0,
  };
  return (
    <button
      title={title}
      onClick={onClick}
      style={base}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderRadius = '30%';
          e.currentTarget.style.background = 'var(--accent)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderRadius = '50%';
          e.currentTarget.style.background = 'var(--bg-active)';
        }
      }}
    >
      {children}
    </button>
  );
}

function GuildIcon({ guild, active, onClick, onContextMenu, unreadCount, imageRefreshKey }) {
  const [hov, setHov] = useState(false);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef(null);
  const hue = guild.name
    ? (guild.name.charCodeAt(0) * 37 + guild.name.charCodeAt(guild.name.length - 1) * 17) % 360
    : 200;
  const initial = guild.name ? guild.name[0].toUpperCase() : '?';
  const hasIcon = !imageError;

  // Reset image error when imageRefreshKey changes (signals guild was updated)
  useEffect(() => {
    setImageError(false);
  }, [imageRefreshKey]);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        title={guild.name}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width: 48, height: 48,
          borderRadius: active || hov ? '30%' : '50%',
          background: hasIcon ? 'transparent' : active
            ? `hsl(${hue},50%,48%)`
            : hov
            ? `hsl(${hue},45%,42%)`
            : `hsl(${hue},40%,32%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: '1.2rem',
          transition: 'border-radius 0.2s, background 0.2s',
          userSelect: 'none', border: 'none', flexShrink: 0,
          boxShadow: active ? `0 0 0 3px ${hasIcon ? 'rgba(124,58,237,0.4)' : `hsl(${hue},50%,55%)`}` : 'none',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
        {hasIcon && (
          <img
            ref={imgRef}
            key={imageRefreshKey}
            src={getGuildIconUrl(guild.id) + '?t=' + imageRefreshKey}
            alt={guild.name}
            onError={() => setImageError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 'inherit',
              display: 'block',
            }}
          />
        )}
        {!hasIcon && initial}
      </button>
      {unreadCount > 0 && !active && (
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          minWidth: 18, height: 18,
          background: 'var(--danger, #ed4245)',
          borderRadius: 9,
          border: '2px solid var(--bg-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.65rem', fontWeight: 700, color: '#fff',
          padding: '0 4px',
          pointerEvents: 'none',
          lineHeight: 1,
        }}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </div>
      )}
    </div>
  );
}

export default function ServerStrip() {
  const nav = useNavigate();
  const { guilds, refreshGuilds, activeGuildId, setActiveGuildId, guildUnreads, homeUnreads, guildUpdatedEvent } = useApp();
  const { isMobile } = useMobile() ?? { isMobile: false };
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { guildId, guildName, x, y }
  const [guildRefreshKeys, setGuildRefreshKeys] = useState({}); // { guildId: key }

  const onHome = !activeGuildId;

  // When a guild is updated, increment its refresh key to trigger image reload
  useEffect(() => {
    if (!guildUpdatedEvent) return;
    const guildId = String(guildUpdatedEvent.guildId);
    setGuildRefreshKeys(prev => ({
      ...prev,
      [guildId]: (prev[guildId] || 0) + 1,
    }));
  }, [guildUpdatedEvent]);

  function handleGuildContextMenu(e, guild) {
    e.preventDefault();
    setCtxMenu({ guildId: guild.id, guildName: guild.name, x: e.clientX, y: e.clientY });
  }

  function handleGuildClick(g) {
    setActiveGuildId(String(g.id));
    // On mobile, don't navigate — keep the sidebar open so the user can pick a channel.
    // On desktop, navigate to the guild which auto-selects the first channel.
    if (!isMobile) nav(`/app/guild/${g.id}`);
  }

  function handleHomeClick() {
    setActiveGuildId(null);
    // On mobile, stay in the sidebar (DmSidebar will show).
    // On desktop, navigate to friends.
    if (!isMobile) nav('/app/friends');
  }

  return (
    <div style={{
      width: 72, background: 'var(--bg-tertiary)', flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: '0.75rem', paddingBottom: '0.75rem', gap: '0.5rem',
      borderRight: '1px solid var(--border)', overflowY: 'auto',
    }}>
      {/* Home */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <StripButton title="Home" active={onHome} onClick={handleHomeClick}>
          🏠
        </StripButton>
        {homeUnreads > 0 && !onHome && (
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            minWidth: 18, height: 18,
            background: 'var(--danger, #ed4245)',
            borderRadius: 9,
            border: '2px solid var(--bg-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', fontWeight: 700, color: '#fff',
            padding: '0 4px',
            pointerEvents: 'none',
            lineHeight: 1,
          }}>
            {homeUnreads > 99 ? '99+' : homeUnreads}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: 32, height: 2, background: 'var(--bg-active)', borderRadius: 1, flexShrink: 0 }} />

      {/* Guild icons */}
      {guilds.map(g => (
        <GuildIcon
          key={g.id}
          guild={g}
          active={String(activeGuildId) === String(g.id)}
          onClick={() => handleGuildClick(g)}
          onContextMenu={e => handleGuildContextMenu(e, g)}
          unreadCount={guildUnreads?.[String(g.id)] ?? 0}
          imageRefreshKey={guildRefreshKeys[String(g.id)] ?? 0}
        />
      ))}

      {/* Add guild button */}
      <button
        title="Create a Guild"
        onClick={() => setShowCreate(true)}
        style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--bg-active)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--success)', fontSize: '1.6rem', fontWeight: 400,
          transition: 'border-radius 0.2s, background 0.2s, color 0.2s',
          userSelect: 'none', flexShrink: 0, lineHeight: 1,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderRadius = '30%';
          e.currentTarget.style.background = 'var(--success)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderRadius = '50%';
          e.currentTarget.style.background = 'var(--bg-active)';
          e.currentTarget.style.color = 'var(--success)';
        }}
      >+</button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings button */}
      <button
        title="Settings"
        onClick={() => setShowSettings(true)}
        style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--bg-active)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: '1.3rem',
          transition: 'border-radius 0.2s, background 0.2s',
          userSelect: 'none', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderRadius = '30%'; e.currentTarget.style.background = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderRadius = '50%'; e.currentTarget.style.background = 'var(--bg-active)'; }}
      >⚙️</button>

      {showCreate && (
        <CreateGuildModal
          onClose={() => setShowCreate(false)}
          onCreated={refreshGuilds}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {ctxMenu && (
        <GuildNotifContextMenu
          guildId={ctxMenu.guildId}
          guildName={ctxMenu.guildName}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}