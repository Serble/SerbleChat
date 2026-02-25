import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';

function Avatar({ name, size = 24 }) {
  const initial = name ? name[0].toUpperCase() : '?';
  const hue = name ? (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},45%,40%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

export default function VoiceParticipantPreview({ channelId, compact = false }) {
  const { resolveUser, voiceUsersByChannel, primeVoiceUsers } = useApp();
  const [users, setUsers] = useState({});
  const [showTooltip, setShowTooltip] = useState(false);
  const userIds = voiceUsersByChannel[String(channelId)] ?? [];

  useEffect(() => {
    primeVoiceUsers(channelId);
  }, [channelId, primeVoiceUsers]);

  useEffect(() => {
    userIds.forEach(id => {
      if (!users[id]) {
        resolveUser(id).then(user => {
          setUsers(prev => ({ ...prev, [id]: user }));
        });
      }
    });
  }, [userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // For compact mode, always show the badge (even if empty)
  if (compact) {
    return (
      <div
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Participant count badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.15rem 0.4rem',
          borderRadius: '9999px',
          background: userIds.length > 0 ? 'rgba(35,165,90,0.15)' : 'rgba(100,100,100,0.1)',
          border: userIds.length > 0 ? '1px solid rgba(35,165,90,0.3)' : '1px solid rgba(100,100,100,0.2)',
          fontSize: '0.7rem',
          fontWeight: 600,
          color: userIds.length > 0 ? 'var(--success)' : 'var(--text-muted)',
          cursor: userIds.length > 0 ? 'pointer' : 'default',
        }}>
          <span>🎙️</span>
          <span>{userIds.length}</span>
        </div>

        {/* Tooltip showing participant names (only if there are users) */}
        {showTooltip && userIds.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '0.5rem',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 1000,
            minWidth: '120px',
            whiteSpace: 'nowrap',
          }}>
            <div style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.35rem',
            }}>
              In Voice ({userIds.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {userIds.map(id => {
                const user = users[id];
                const name = user?.username ?? id.slice(0, 10);
                return (
                  <div key={id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                  }}>
                    <Avatar name={name} size={16} />
                    <span>{name}</span>
                  </div>
                );
              })}
            </div>
            {/* Arrow pointing down */}
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--border)',
            }} />
          </div>
        )}
      </div>
    );
  }

  // For full panel mode, only show if there are users
  if (userIds.length === 0) {
    return null;
  }

  // Full panel mode (for main chat area)
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      padding: '0.75rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        color: 'var(--text-secondary)',
      }}>
        <span style={{ fontSize: '0.95rem' }}>🎙️</span>
        <span>In Voice ({userIds.length})</span>
      </div>

      {/* Participants grid */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        {userIds.map(id => {
          const user = users[id];
          const name = user?.username ?? id.slice(0, 10);
          return (
            <div
              key={id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.3rem 0.5rem',
                borderRadius: '4px',
                background: 'rgba(124,58,237,0.08)',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
              }}
            >
              <Avatar name={name} size={20} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
