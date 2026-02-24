import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import CreateGuildModal from './CreateGuildModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import GuildNotifContextMenu from './GuildNotifContextMenu.jsx';

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

function GuildIcon({ guild, active, onClick, onContextMenu }) {
  const [hov, setHov] = useState(false);
  const hue = guild.name
    ? (guild.name.charCodeAt(0) * 37 + guild.name.charCodeAt(guild.name.length - 1) * 17) % 360
    : 200;
  const initial = guild.name ? guild.name[0].toUpperCase() : '?';

  return (
    <button
      title={guild.name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 48, height: 48,
        borderRadius: active || hov ? '30%' : '50%',
        background: active
          ? `hsl(${hue},50%,48%)`
          : hov
          ? `hsl(${hue},45%,42%)`
          : `hsl(${hue},40%,32%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: '1.2rem',
        transition: 'border-radius 0.2s, background 0.2s',
        userSelect: 'none', border: 'none', flexShrink: 0,
        boxShadow: active ? `0 0 0 3px hsl(${hue},50%,55%)` : 'none',
      }}
    >
      {initial}
    </button>
  );
}

export default function ServerStrip() {
  const nav = useNavigate();
  const { guilds, refreshGuilds, activeGuildId, setActiveGuildId } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { guildId, guildName, x, y }

  const onHome = !activeGuildId;

  function handleGuildContextMenu(e, guild) {
    e.preventDefault();
    setCtxMenu({ guildId: guild.id, guildName: guild.name, x: e.clientX, y: e.clientY });
  }

  return (
    <div style={{
      width: 72, background: 'var(--bg-tertiary)', flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: '0.75rem', paddingBottom: '0.75rem', gap: '0.5rem',
      borderRight: '1px solid var(--border)', overflowY: 'auto',
    }}>
      {/* Home */}
      <StripButton title="Home" active={onHome} onClick={() => { setActiveGuildId(null); nav('/app/friends'); }}>
        🏠
      </StripButton>

      {/* Divider */}
      <div style={{ width: 32, height: 2, background: 'var(--bg-active)', borderRadius: 1, flexShrink: 0 }} />

      {/* Guild icons */}
      {guilds.map(g => (
        <GuildIcon
          key={g.id}
          guild={g}
          active={String(activeGuildId) === String(g.id)}
          onClick={() => { setActiveGuildId(String(g.id)); nav(`/app/guild/${g.id}`); }}
          onContextMenu={e => handleGuildContextMenu(e, g)}
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