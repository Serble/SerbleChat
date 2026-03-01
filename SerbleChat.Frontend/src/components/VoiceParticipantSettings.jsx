import { useState, useEffect } from 'react';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { setParticipantMuted, setParticipantVolume } from '../voice.js';

export default function VoiceParticipantSettings({ 
  participantIdentity,
  participantName,
  voiceSession,
  onSettingsChange,
}) {
  const { getVoiceParticipantSetting, setVoiceParticipantSetting } = useClientOptions();
  const { refreshParticipants } = useVoice();
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1.0); // 1.0 = 100% = normal volume

  // Load settings on mount
  useEffect(() => {
    const settings = getVoiceParticipantSetting(participantIdentity);
    setIsMuted(settings.muted);
    setVolume(settings.volume ?? 1.0); // Default to 1.0 if not set
  }, [participantIdentity]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    setVoiceParticipantSetting(participantIdentity, { muted: newMuted });
    setParticipantMuted(voiceSession, participantIdentity, newMuted);
    // Refresh participants to update UI immediately
    if (refreshParticipants) {
      refreshParticipants();
    }
  };

  const handleVolumeChange = (e) => {
    const newVolumePercent = parseFloat(e.target.value); // 0-500
    const newVolume = newVolumePercent / 100; // Convert to 0.0-5.0
    setVolume(newVolume);
    setVoiceParticipantSetting(participantIdentity, { volume: newVolume });
    setParticipantVolume(voiceSession, participantIdentity, newVolume);
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.35rem',
    }}>
      {/* Settings button */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        title={`Settings for ${participantName}`}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          padding: '0.15rem 0.2rem',
          fontSize: '0.7rem',
          opacity: 0.6,
          transition: 'opacity 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.2rem',
          height: '1.2rem',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
      >
        ⚙️
      </button>

      {/* Settings popup */}
      {showSettings && (
        <div style={{
          position: 'absolute',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          padding: '0.5rem',
          marginTop: '0.2rem',
          minWidth: '140px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
        }}>
          {/* Mute button */}
          <button
            onClick={handleToggleMute}
            style={{
              background: isMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: isMuted ? 'var(--danger)' : 'var(--text-primary)',
              borderRadius: '4px',
              padding: '0.35rem 0.45rem',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              transition: 'background 0.15s',
              textAlign: 'center',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = isMuted ? 'rgba(242,63,67,0.25)' : 'rgba(255,255,255,0.12)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = isMuted ? 'rgba(242,63,67,0.15)' : 'rgba(255,255,255,0.08)';
            }}
          >
            {isMuted ? '🔇 Unmute' : '🔊 Mute'}
          </button>

          {/* Volume slider */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}>
            <label style={{
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              Volume: {Math.round(volume * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={500}
              step={5}
              value={Math.round(volume * 100)}
              onChange={(e) => {
                const newVolume = parseInt(e.target.value) / 100;
                setVolume(newVolume);
                setVoiceParticipantSetting(participantIdentity, { volume: newVolume });
                setParticipantVolume(voiceSession, participantIdentity, newVolume);
              }}
              style={{
                cursor: 'pointer',
                height: '4px',
                width: '100%',
              }}
            />
          </div>

          {/* Reset button */}
          {(isMuted || volume !== 1) && (
            <button
              onClick={() => {
                setIsMuted(false);
                setVolume(1);
                setVoiceParticipantSetting(participantIdentity, { muted: false, volume: 1 });
                setParticipantMuted(voiceSession, participantIdentity, false);
                setParticipantVolume(voiceSession, participantIdentity, 1);
              }}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--text-secondary)',
                borderRadius: '4px',
                padding: '0.25rem 0.35rem',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontWeight: 500,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
