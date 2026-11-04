import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { startScreenShare, stopScreenShare, updateScreenShareQuality, updateScreenShareAudio, startCamera, stopCamera } from '../voice.js';
import { DEFAULT_STREAM_AUDIO } from '../streamAudio.js';
import { playSound } from '../sound.js';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';
import ScreenShareQualityModal from './ScreenShareQualityModal.jsx';
import { VoiceButton, VoiceStatusIcons } from './voice/VoiceControls.jsx';
import { MicIcon, MegaphoneIcon, ScreenShareIcon, StopScreenShareIcon, GearIcon, VideoIcon, VideoOffIcon, PollIcon, ChevronRightIcon } from '../icons.jsx';
import { useActivePolls } from './poll/useActivePolls.js';
import ModSlot from '../mods/ModSlot.jsx';
import './poll/poll.css';

// Helper to safely play sounds with consistent error handling
const playSoundSafe = (soundName) => {
  playSound(soundName).catch(e => console.warn(`[VoicePanel] Failed to play ${soundName} sound:`, e));
};

export default function VoicePanel({ 
  channelId, 
  voiceSession,
  participants = [],
  voiceMuted, 
  onToggleMute, 
  onLeave,
  remoteScreenShares = [],
  localScreenShare = null,
  voiceStatus = 'connected',
  voiceError,
  onRetry,
}) {
  const { resolveUser, currentUser, addToast, voiceStatesByChannel } = useApp();
  const voiceStates = voiceStatesByChannel[String(channelId)] ?? {};
  const { setLocalScreenShare, localCamera, setLocalCamera } = useVoice();
  const { voiceAudioOptions, localDeviceSettings } = useClientOptions();
  const isCameraOn = Boolean(localCamera);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [userDetails, setUserDetails] = useState({});
  // Derive isScreenSharing from localScreenShare prop instead of local state
  const isScreenSharing = Boolean(localScreenShare);
  const [showQualityModal, setShowQualityModal] = useState(false);
  // Whether the speak button is currently held down in push-to-talk mode. A ref, not state,
  // so the button's mouseup, mouseleave and the window mouseup can't each release it.
  const pttHeldRef = useRef(false);
  const [qualitySettings, setQualitySettings] = useState(() => {
    const defaults = { bitrate: 8_000_000, fps: 30, ...DEFAULT_STREAM_AUDIO };
    // Load saved stream settings from localStorage (older saves have no audio settings)
    try {
      const saved = localStorage.getItem('screenShareQualitySettings');
      if (saved) {
        return { ...defaults, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.error('Failed to load quality settings:', error);
    }
    return defaults;
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

  // Sharing stopped from the browser's own "Stop sharing" bar
  const handleShareEnded = () => {
    setLocalScreenShare(null);
    playSoundSafe('stream_end');
  };

  // Asked for sound but the stream has none: say why, rather than leave people guessing
  const warnNoAudio = (audioIssue) => {
    if (audioIssue) addToast({ title: 'Sharing without audio', body: audioIssue, type: 'warning' });
  };

  const beginScreenShare = (settings, { sound = true } = {}) =>
    startScreenShare(voiceSession, (videoElement, { hasAudio, audioIssue } = {}) => {
      setLocalScreenShare({
        videoElement,
        hasAudio,
        username: currentUser?.username || 'Your Screen'
      });
      warnNoAudio(audioIssue);
      // Play sound effect when starting screen share
      if (sound) playSoundSafe('stream_start');
    }, settings, handleShareEnded);

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
        await beginScreenShare(qualitySettings);
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

  const handleToggleCamera = async () => {
    if (!canControl || cameraBusy) return;
    setCameraBusy(true);
    try {
      if (isCameraOn) {
        await stopCamera(voiceSession);
        setLocalCamera(null);
      } else {
        const videoElement = await startCamera(voiceSession, {
          deviceId: localDeviceSettings.cameraDeviceId,
          // Camera stopped on its own (e.g. unplugged)
          onEnded: () => setLocalCamera(null),
        });
        if (videoElement) {
          setLocalCamera({ videoElement, username: currentUser?.username || 'Your Camera' });
        }
      }
    } catch (error) {
      console.error('Camera error:', error);
      addToast({ title: 'Camera Error', body: error.message || 'Failed to turn on the camera.', type: 'danger' });
    } finally {
      setCameraBusy(false);
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
      let needsRestart = false;
      try {
        await updateScreenShareQuality(voiceSession, newSettings);
        const audioResult = await updateScreenShareAudio(voiceSession, newSettings);
        needsRestart = audioResult.needsRestart;
        if (!needsRestart) {
          setLocalScreenShare(prev => prev && { ...prev, hasAudio: audioResult.hasAudio });
          warnNoAudio(audioResult.audioIssue);
        }
      } catch (error) {
        console.error('Failed to apply quality settings:', error);
        // If update fails, we might need to restart
        needsRestart = true;
      }
      // Some changes (turning on audio in a browser, say) need the screen picking again
      if (needsRestart) {
        try {
          await stopScreenShare(voiceSession, () => {
            setLocalScreenShare(null);
          });
          await beginScreenShare(newSettings, { sound: false });
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
                  <VoiceStatusIcons isSpeaking={p.isSpeaking} isMuted={p.isMuted} isDeafened={voiceStates[p.identity]?.deafened} isClientMuted={p.isClientMuted} isVideoDisabled={p.videoDisabled} />
                </div>
              </UserInteraction>
            );
          })}
        </div>
      )}

      <ModSlot name="voice-panel" channelId={channelId} voiceSession={voiceSession} participants={participants} />

      {/* Hold-to-talk button in push-to-talk mode. (Mute and deafen live in the
          user panel below, which shows them in and out of calls.) */}
      {isPtt && (
        <VoiceButton
          tone={voiceMuted ? 'neutral' : 'success'}
          disabled={!canControl}
          onMouseDown={pressPtt}
          onMouseUp={e => { e.preventDefault(); releasePtt(); }}
          onMouseLeave={releasePtt}
          title={voiceMuted ? 'Speak (hold key or button)' : 'Release to stop speaking'}
        >
          {voiceMuted ? <MicIcon size={16} /> : <MegaphoneIcon size={16} />}
          <span>{voiceMuted ? 'Speak' : 'Speaking'}</span>
        </VoiceButton>
      )}

      {canControl && <VoicePollChip channelId={channelId} />}

      {/* Camera and screen share buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <VoiceButton
          // Red while on: pressing it stops something
          tone={isCameraOn ? 'danger' : 'neutral'}
          disabled={!canControl || cameraBusy}
          style={{ flex: 1 }}
          onClick={handleToggleCamera}
          title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {isCameraOn ? <VideoOffIcon size={16} /> : <VideoIcon size={16} />}
          <span>Video</span>
        </VoiceButton>

        <VoiceButton
          tone={isScreenSharing ? 'danger' : 'neutral'}
          disabled={!canControl}
          style={{ flex: 1 }}
          onClick={handleToggleScreenShare}
          title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
        >
          {isScreenSharing ? <StopScreenShareIcon size={16} /> : <ScreenShareIcon size={16} />}
          <span>Share</span>
        </VoiceButton>

        {/* Always there, so audio and quality can be set up before going live */}
        <VoiceButton
          disabled={!canControl}
          style={{ padding: '0.4rem 0.5rem' }}
          onClick={() => setShowQualityModal(true)}
          title="Stream settings"
        >
          <GearIcon size={16} />
        </VoiceButton>
      </div>

      <ScreenShareQualityModal
        isOpen={showQualityModal}
        onClose={() => setShowQualityModal(false)}
        currentSettings={qualitySettings}
        onApply={handleApplyQualitySettings}
        isLive={isScreenSharing}
      />
    </div>
  );
}
/**
 * "Poll: <question>" when the call's channel has polls running, so people in the call
 * who are looking at another channel notice them. Hidden while viewing that channel,
 * where the voice panel above the messages already shows them.
 */
function VoicePollChip({ channelId }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const active = useActivePolls(channelId);
  if (active.length === 0 || pathname === `/app/channel/${channelId}`) return null;
  const newest = active[0];
  return (
    <button
      type="button"
      className="poll-voice-chip"
      onClick={() => nav(`/app/channel/${channelId}`)}
      title={newest.question}
    >
      <PollIcon size={14} />
      <span className="poll-voice-chip-text">
        {active.length === 1 ? `Poll: ${newest.question}` : `${active.length} polls running`}
      </span>
      <ChevronRightIcon size={14} />
    </button>
  );
}
