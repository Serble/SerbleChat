import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { startScreenShare, stopScreenShare, updateScreenShareQuality } from '../voice.js';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';
import ScreenShareQualityModal from './ScreenShareQualityModal.jsx';

export default function VoicePanel({ 
  channelId, 
  voiceSession,
  participants = [],
  voiceMuted, 
  voiceDeafened,
  onToggleMute, 
  onToggleDeafen,
  onLeave,
  remoteScreenShares = [],
  localScreenShare = null,
  voiceStatus = 'connected',
  voiceError,
  onRetry,
}) {
  const { resolveUser, currentUser } = useApp();
  const { setLocalScreenShare } = useVoice();
  const [userDetails, setUserDetails] = useState({});
  // Derive isScreenSharing from localScreenShare prop instead of local state
  const isScreenSharing = Boolean(localScreenShare);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [qualitySettings, setQualitySettings] = useState(() => {
    // Load saved quality settings from localStorage
    try {
      const saved = localStorage.getItem('screenShareQualitySettings');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load quality settings:', error);
    }
    return {
      bitrate: 8_000_000,
      fps: 30
    };
  });
  const canControl = voiceSession && voiceStatus === 'connected';

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
    if (!canControl) return;
    try {
      if (isScreenSharing) {
        await stopScreenShare(voiceSession, () => {
          setLocalScreenShare(null);
        });
      } else {
        await startScreenShare(voiceSession, (videoElement) => {
          setLocalScreenShare({ 
            videoElement, 
            username: currentUser?.username || 'Your Screen'
          });
        }, qualitySettings);
      }
    } catch (error) {
      console.error('Screen sharing error:', error);
      setLocalScreenShare(null);
    }
  };

  const handleApplyQualitySettings = async (newSettings) => {
    setQualitySettings(newSettings);
    
    // Save to localStorage
    try {
      localStorage.setItem('screenShareQualitySettings', JSON.stringify(newSettings));
    } catch (error) {
      console.error('Failed to save quality settings:', error);
    }
    
    // If already sharing, update settings without requiring new selection
    if (isScreenSharing && voiceSession) {
      try {
        await updateScreenShareQuality(voiceSession, newSettings);
      } catch (error) {
        console.error('Failed to apply quality settings:', error);
        // If update fails, we might need to restart
        try {
          await stopScreenShare(voiceSession, () => {
            setLocalScreenShare(null);
          });
          
          await startScreenShare(voiceSession, (videoElement) => {
            setLocalScreenShare({ 
              videoElement, 
              username: currentUser?.username || 'Your Screen'
            });
          }, newSettings);
        } catch (restartError) {
          console.error('Failed to restart screen share:', restartError);
          setLocalScreenShare(null);
        }
      }
    }
  };

  if (!voiceSession && voiceStatus === 'idle' && !voiceError) return null;

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
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: voiceStatus === 'error' ? 'var(--danger)' : 'var(--success)' }}>
            {voiceStatus === 'connecting' ? 'Connecting…' : voiceStatus === 'error' ? 'Voice Error' : 'Voice Connected'}
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
          {voiceStatus === 'error' ? 'Dismiss' : 'Disconnect'}
        </button>
      </div>

      {voiceError && (
        <div style={{
          background: 'rgba(242,63,67,0.12)',
          border: '1px solid rgba(242,63,67,0.35)',
          borderRadius: '6px',
          padding: '0.45rem 0.55rem',
          fontSize: '0.78rem',
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
        }}>
          <div>{voiceError.message || 'Voice encountered a fatal error.'}</div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={onRetry}
              disabled={!onRetry || !channelId}
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.35)',
                color: 'var(--text-primary)',
                borderRadius: '4px',
                padding: '0.2rem 0.45rem',
                cursor: onRetry && channelId ? 'pointer' : 'not-allowed',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
            <button
              onClick={onLeave}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--text-primary)',
                borderRadius: '4px',
                padding: '0.2rem 0.45rem',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Participants list */}
      {canControl && participants.length > 0 && (
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
              <UserInteraction 
                key={p.identity} 
                userId={user?.id} 
                username={name}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.25rem 0.35rem',
                    borderRadius: '4px',
                    background: p.isLocal ? 'rgba(124,58,237,0.08)' : 'transparent',
                  }}
                >
                  <Avatar userId={user?.id} name={name} size={20} color={user?.color} />
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
              </UserInteraction>
            );
          })}
        </div>
      )}

      {/* Mute and Deafen buttons */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
      }}>
        {/* Mute button */}
        <button
          onClick={onToggleMute}
          disabled={!canControl}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: voiceMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.4rem',
            cursor: canControl ? 'pointer' : 'not-allowed',
            color: voiceMuted ? 'var(--danger)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            transition: 'background 0.15s',
            opacity: canControl ? 1 : 0.6,
            flex: 1,
          }}
          onMouseEnter={e => {
            if (!canControl) return;
            e.currentTarget.style.background = voiceMuted ? 'rgba(242,63,67,0.25)' : 'rgba(255,255,255,0.15)';
          }}
          onMouseLeave={e => {
            if (!canControl) return;
            e.currentTarget.style.background = voiceMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)';
          }}
          title={voiceMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
        >
          <span style={{ fontSize: '1rem' }}>{voiceMuted ? '🔇' : '🎙️'}</span>
          <span>{voiceMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Deafen button */}
        <button
          onClick={onToggleDeafen}
          disabled={!canControl}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: voiceDeafened ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.4rem',
            cursor: canControl ? 'pointer' : 'not-allowed',
            color: voiceDeafened ? 'var(--danger)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            transition: 'background 0.15s',
            opacity: canControl ? 1 : 0.6,
            flex: 1,
          }}
          onMouseEnter={e => {
            if (!canControl) return;
            e.currentTarget.style.background = voiceDeafened ? 'rgba(242,63,67,0.25)' : 'rgba(255,255,255,0.15)';
          }}
          onMouseLeave={e => {
            if (!canControl) return;
            e.currentTarget.style.background = voiceDeafened ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.1)';
          }}
          title={voiceDeafened ? 'Undeafen (D)' : 'Deafen (D)'}
        >
          <span style={{ fontSize: '1rem' }}>{voiceDeafened ? '🔇' : '👂'}</span>
          <span>{voiceDeafened ? 'Undeafen' : 'Deafen'}</span>
        </button>
      </div>

      {/* Screen share button */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleToggleScreenShare}
          disabled={!canControl}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: isScreenSharing ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.4rem',
            cursor: canControl ? 'pointer' : 'not-allowed',
            color: isScreenSharing ? 'var(--success)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            transition: 'background 0.15s',
            opacity: canControl ? 1 : 0.6,
            flex: 1,
          }}
          onMouseEnter={e => {
            if (!canControl) return;
            e.currentTarget.style.background = isScreenSharing ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.15)';
          }}
          onMouseLeave={e => {
            if (!canControl) return;
            e.currentTarget.style.background = isScreenSharing ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.1)';
          }}
          title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
        >
          <span style={{ fontSize: '1rem' }}>{isScreenSharing ? '🛑' : '📺'}</span>
          <span>{isScreenSharing ? 'Stop Share' : 'Share Screen'}</span>
        </button>

        {isScreenSharing && (
          <button
            onClick={() => setShowQualityModal(true)}
            disabled={!canControl}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '6px',
              padding: '0.4rem 0.5rem',
              cursor: canControl ? 'pointer' : 'not-allowed',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 600,
              transition: 'background 0.15s',
              opacity: canControl ? 1 : 0.6,
            }}
            onMouseEnter={e => {
              if (!canControl) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
            }}
            onMouseLeave={e => {
              if (!canControl) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            }}
            title="Screen share quality settings"
          >
            <span style={{ fontSize: '1rem' }}>⚙️</span>
          </button>
        )}
      </div>

      <ScreenShareQualityModal
        isOpen={showQualityModal}
        onClose={() => setShowQualityModal(false)}
        currentSettings={qualitySettings}
        onApply={handleApplyQualitySettings}
      />
    </div>
  );
}