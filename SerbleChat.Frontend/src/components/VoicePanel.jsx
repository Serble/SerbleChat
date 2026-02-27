import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { startScreenShare, stopScreenShare } from '../voice.js';

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

export default function VoicePanel({ 
  channelId, 
  voiceSession,
  participants = [],
  voiceMuted, 
  onToggleMute, 
  onLeave,
  remoteScreenShares = []
}) {
  const { resolveUser, currentUser } = useApp();
  const { setLocalScreenShare } = useVoice();
  const [userDetails, setUserDetails] = useState({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Resolve usernames for all participants whenever the list changes
  useEffect(() => {
    participants.forEach(p => {
      if (!userDetails[p.identity]) {
        resolveUser(p.identity).then(user => {
          setUserDetails(prev => ({ ...prev, [p.identity]: user }));
        });
      }
    });
  }, [participants]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        await stopScreenShare(voiceSession, () => {
          setLocalScreenShare(null);
        });
        setIsScreenSharing(false);
      } else {
        await startScreenShare(voiceSession, (videoElement) => {
          setLocalScreenShare({ 
            videoElement, 
            username: currentUser?.username || 'Your Screen'
          });
        });
        setIsScreenSharing(true);
      }
    } catch (error) {
      console.error('Screen sharing error:', error);
      setIsScreenSharing(false);
      setLocalScreenShare(null);
    }
  };

  if (!voiceSession) return null;

  return (
    <div style={{
      background: 'var(--bg-voice-panel)',
      borderBottom: '1px solid var(--border)',
      padding: '0.6rem 0.75rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      flexShrink: 0,
    }}>
      {/* Header with channel name and controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.9rem' }}>🎙️</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success)' }}>
            Voice Connected
          </span>
        </div>
        <button
          onClick={onLeave}
          title="Leave Voice"
          style={{
            background: 'rgba(242,63,67,0.15)',
            border: '1px solid rgba(242,63,67,0.35)',
            color: 'var(--danger)',
            borderRadius: '4px',
            padding: '0.2rem 0.45rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(242,63,67,0.28)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(242,63,67,0.15)'}
        >
          Disconnect
        </button>
      </div>

      {/* Participants list */}
      {participants.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          maxHeight: '120px',
          overflowY: 'auto',
        }}>
          {participants.map(p => {
            const user = userDetails[p.identity];
            const name = user?.username ?? p.identity.slice(0, 10);
            return (
              <div
                key={p.identity}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.25rem 0.35rem',
                  borderRadius: '4px',
                  background: p.isLocal ? 'rgba(124,58,237,0.08)' : 'transparent',
                }}
              >
                <Avatar name={name} size={20} />
                <span style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                  {p.isLocal && <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>(you)</span>}
                </span>
                {p.isMuted && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="Muted">
                    🔇
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mute button */}
      <button
        onClick={onToggleMute}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          background: voiceMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)',
          border: 'none',
          borderRadius: '6px',
          padding: '0.4rem',
          cursor: 'pointer',
          color: voiceMuted ? 'var(--danger)' : 'var(--text-primary)',
          fontSize: '0.85rem',
          fontWeight: 600,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = voiceMuted ? 'rgba(242,63,67,0.25)' : 'rgba(255,255,255,0.15)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = voiceMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)';
        }}
        title={voiceMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
      >
        <span style={{ fontSize: '1rem' }}>{voiceMuted ? '🔇' : '🎙️'}</span>
        <span>{voiceMuted ? 'Unmute' : 'Mute'}</span>
      </button>

      {/* Screen share button */}
      <button
        onClick={handleToggleScreenShare}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          background: isScreenSharing ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.1)',
          border: 'none',
          borderRadius: '6px',
          padding: '0.4rem',
          cursor: 'pointer',
          color: isScreenSharing ? 'var(--success)' : 'var(--text-primary)',
          fontSize: '0.85rem',
          fontWeight: 600,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = isScreenSharing ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.15)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = isScreenSharing ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.1)';
        }}
        title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
      >
        <span style={{ fontSize: '1rem' }}>{isScreenSharing ? '🛑' : '📺'}</span>
        <span>{isScreenSharing ? 'Stop Share' : 'Share Screen'}</span>
      </button>
    </div>
  );
}
