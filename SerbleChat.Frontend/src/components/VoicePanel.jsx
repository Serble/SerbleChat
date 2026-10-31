import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { startScreenShare, stopScreenShare, updateScreenShareQuality } from '../voice.js';
import { playSound } from '../sound.js';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';
import ScreenShareQualityModal from './ScreenShareQualityModal.jsx';
import { VoiceButton, VoiceStatusIcons } from './voice/VoiceControls.jsx';
import { MicIcon, SpeakerMutedIcon, HeadphonesIcon, MegaphoneIcon, ScreenShareIcon, StopScreenShareIcon, GearIcon } from '../icons.jsx';

// Helper to safely play sounds with consistent error handling
const playSoundSafe = (soundName) => {
  playSound(soundName).catch(e => console.warn(`[VoicePanel] Failed to play ${soundName} sound:`, e));
};

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
  const { voiceAudioOptions } = useClientOptions();
  const [userDetails, setUserDetails] = useState({});
  // Derive isScreenSharing from localScreenShare prop instead of local state
  const isScreenSharing = Boolean(localScreenShare);
  const [showQualityModal, setShowQualityModal] = useState(false);
  // Whether the speak button is currently held down in push-to-talk mode. A ref, not state,
  // so the button's mouseup, mouseleave and the window mouseup can't each release it.
  const pttHeldRef = useRef(false);
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
  const isPtt = voiceAudioOptions.inputMode === 'push-to-talk';

  // Latest values for the window mouseup listener, which is registered once
  const latestRef = useRef({});
  latestRef.current = { voiceMuted, onToggleMute };

  // Push-to-talk via the button: unmute while held, mute again on release.
  // (Outside PTT mode, clicking the button toggles mute normally.)
  function pressPtt(e) {
    e.preventDefault();
    if (!isPtt || !canControl) return;
    pttHeldRef.current = true;
    if (voiceMuted) onToggleMute();
  }

  function releasePtt() {
    if (!pttHeldRef.current) return;
    pttHeldRef.current = false;
    const { voiceMuted: muted, onToggleMute: toggle } = latestRef.current;
    if (!muted) toggle();
  }

  // Release even if the mouse button comes up outside the speak button
  useEffect(() => {
    window.addEventListener('mouseup', releasePtt);
    return () => window.removeEventListener('mouseup', releasePtt);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          // Play sound effect when stopping screen share
          playSoundSafe('stream_end');
        });
      } else {
        await startScreenShare(voiceSession, (videoElement) => {
          setLocalScreenShare({ 
            videoElement, 
            username: currentUser?.username || 'Your Screen'
          });
          // Play sound effect when starting screen share
          playSoundSafe('stream_start');
        }, qualitySettings);
      }
    } catch (error) {
      console.error('Screen sharing error:', error);
      setLocalScreenShare(null);
      
      // Show user-friendly error message
      let errorMessage = error.message || 'Failed to start screen sharing';
      if (error.name === 'NotSupportedError' || errorMessage.includes('not supported')) {
        errorMessage = 'Screen sharing is not supported in this environment. Check Electron permissions if on desktop.';
      } else if (error.name === 'NotAllowedError' || errorMessage.includes('denied')) {
        errorMessage = 'Screen sharing was denied. Please allow access and try again.';
      } else if (error.name === 'AbortError' || errorMessage.includes('cancelled')) {
        errorMessage = 'Screen sharing was cancelled.';
      }
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
          <MicIcon size={14} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: voiceStatus === 'error' ? 'var(--danger)' : 'var(--success)' }}>
            {voiceStatus === 'connecting' ? 'Connecting…' : voiceStatus === 'error' ? 'Voice Error' : 'Voice Connected'}
          </span>
        </div>
        <VoiceButton tone="danger" size="sm" onClick={onLeave} title="Leave Voice">
          {voiceStatus === 'error' ? 'Dismiss' : 'Disconnect'}
        </VoiceButton>
      </div>

      {voiceError && (
        <div style={{
          background: 'var(--danger-soft)',
          border: '1px solid var(--danger-border)',
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
            <VoiceButton tone="accent" size="sm" onClick={onRetry} disabled={!onRetry || !channelId}>
              Retry
            </VoiceButton>
            <VoiceButton size="sm" onClick={onLeave}>
              Close
            </VoiceButton>
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
                  className="voice-speaking-ring"
                  data-speaking={!!p.isSpeaking}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.25rem 0.35rem', borderRadius: '4px',
                    background: p.isLocal ? 'var(--accent-softer)' : 'transparent',
                  }}
                >
                  <Avatar userId={user?.id} name={name} size={20} color={user?.color} />
                  <span style={{
                    fontSize: '0.8rem', color: 'var(--text-secondary)', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {name}
                    {p.isLocal && <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>(you)</span>}
                  </span>
                  <VoiceStatusIcons isSpeaking={p.isSpeaking} isMuted={p.isMuted} isClientMuted={p.isClientMuted} />
                </div>
              </UserInteraction>
            );
          })}
        </div>
      )}

      {/* Mute and Deafen buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {/* Mute/Speak button — in PTT mode it's hold-to-talk instead of a toggle */}
        <VoiceButton
          tone={voiceMuted ? 'danger' : 'neutral'}
          disabled={!canControl}
          style={{ flex: 1 }}
          onClick={() => { if (!isPtt) onToggleMute(); }}
          onMouseDown={pressPtt}
          onMouseUp={e => { e.preventDefault(); releasePtt(); }}
          onMouseLeave={releasePtt}
          title={isPtt
            ? (voiceMuted ? 'Speak (hold key or button)' : 'Release to stop speaking')
            : (voiceMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)')}
        >
          {isPtt
            ? (voiceMuted ? <MicIcon size={16} /> : <MegaphoneIcon size={16} />)
            : (voiceMuted ? <SpeakerMutedIcon size={16} /> : <MicIcon size={16} />)}
          <span>
            {isPtt
              ? (voiceMuted ? 'Speak' : 'Speaking')
              : (voiceMuted ? 'Unmute' : 'Mute')}
          </span>
        </VoiceButton>

        <VoiceButton
          tone={voiceDeafened ? 'danger' : 'neutral'}
          disabled={!canControl}
          style={{ flex: 1 }}
          onClick={onToggleDeafen}
          title={voiceDeafened ? 'Undeafen (D)' : 'Deafen (D)'}
        >
          {voiceDeafened ? <SpeakerMutedIcon size={16} /> : <HeadphonesIcon size={16} />}
          <span>{voiceDeafened ? 'Undeafen' : 'Deafen'}</span>
        </VoiceButton>
      </div>

      {/* Screen share button */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <VoiceButton
          tone={isScreenSharing ? 'success' : 'neutral'}
          disabled={!canControl}
          style={{ flex: 1 }}
          onClick={handleToggleScreenShare}
          title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
        >
          {isScreenSharing ? <StopScreenShareIcon size={16} /> : <ScreenShareIcon size={16} />}
          <span>{isScreenSharing ? 'Stop Share' : 'Share Screen'}</span>
        </VoiceButton>

        {isScreenSharing && (
          <VoiceButton
            disabled={!canControl}
            style={{ padding: '0.4rem 0.5rem' }}
            onClick={() => setShowQualityModal(true)}
            title="Screen share quality settings"
          >
            <GearIcon size={16} />
          </VoiceButton>
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