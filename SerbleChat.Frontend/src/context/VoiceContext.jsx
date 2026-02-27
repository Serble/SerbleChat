import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { joinChannel, leaveChannel, setMuted as applyVoiceMuted, setDeafened as applyVoiceDeafened, setParticipantMuted, setParticipantVolume, setMicVolume } from '../voice.js';
import { useApp } from './AppContext.jsx';
import { useClientOptions } from './ClientOptionsContext.jsx';

const VoiceContext = createContext();

export function VoiceProvider({ children }) {
  const { addToast } = useApp();
  const { getVoiceParticipantSetting, voiceAudioOptions } = useClientOptions();
  const [voiceChannelId, setVoiceChannelId] = useState(null);
  const [voiceSession, setVoiceSession] = useState(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceDeafened, setVoiceDeafened] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | connecting | connected | error
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceParticipants, setVoiceParticipants] = useState([]);
  const [remoteScreenShares, setRemoteScreenShares] = useState([]);
  const [localScreenShare, setLocalScreenShare] = useState(null); // { videoElement, username }
  const [voiceError, setVoiceError] = useState(null); // { message, context, timestamp }

  const activeJoinIdRef = useRef(0);

  function describeVoiceError(err, context) {
    if (err?.message) return err.message;
    if (typeof err === 'string') return err;
    return context ? `Voice error (${context}).` : 'Voice error.';
  }

  async function handleLeaveVoice(options = {}) {
    const { keepError = false, force = false } = options;
    if (voiceBusy && !force) return;
    setVoiceBusy(true);
    activeJoinIdRef.current += 1;
    try {
      if (voiceSession) {
        await leaveChannel(voiceSession);
      }
    } catch (err) {
      console.error('leaveChannel failed:', err);
    } finally {
      setVoiceSession(null);
      setVoiceMuted(false);
      setVoiceDeafened(false);
      setVoiceParticipants([]);
      setRemoteScreenShares([]);
      setLocalScreenShare(null);
      setVoiceBusy(false);
      if (keepError) {
        setVoiceStatus('error');
      } else {
        setVoiceStatus('idle');
        setVoiceChannelId(null);
        setVoiceError(null);
      }
    }
  }

  async function reportFatalError(err, context) {
    const message = describeVoiceError(err, context);
    setVoiceError({ message, context, timestamp: Date.now() });
    addToast({ title: 'Voice Error', body: message, type: 'danger' });
    await handleLeaveVoice({ keepError: true, force: true });
  }

  async function handleJoinVoice(channelId) {
    if (voiceBusy || voiceStatus === 'connecting') return;

    // If already in a different voice channel, leave it first
    if (voiceSession && voiceChannelId !== channelId) {
      await handleLeaveVoice({ force: true });
    }

    const joinId = activeJoinIdRef.current + 1;
    activeJoinIdRef.current = joinId;
    setVoiceError(null);
    setVoiceBusy(true);
    setVoiceStatus('connecting');
    setVoiceChannelId(channelId);

    const isCurrentJoin = () => activeJoinIdRef.current === joinId;
    
    try {
      const session = await joinChannel({ channelId }, (participants) => {
        if (!isCurrentJoin()) return;
        setVoiceParticipants(participants);
      }, (videoElement, participantIdentity) => {
        if (!isCurrentJoin()) return;
        // Handle remote screen share
        setRemoteScreenShares(prev => [...prev, { videoElement, participantIdentity }]);
      }, (participantIdentity) => {
        if (!isCurrentJoin()) return;
        // Handle remote screen share stop
        setRemoteScreenShares(prev => prev.filter(s => s.participantIdentity !== participantIdentity));
      }, (err, context) => {
        if (!isCurrentJoin()) return;
        reportFatalError(err, context);
      }, voiceAudioOptions);

      if (!isCurrentJoin()) {
        await leaveChannel(session);
        return;
      }

      setVoiceSession(session ?? {});
      setVoiceStatus('connected');
    } catch (err) {
      if (!isCurrentJoin()) return;
      console.error('joinChannel failed:', err);
      setVoiceStatus('error');
      setVoiceError({ message: describeVoiceError(err, 'join'), context: 'join', timestamp: Date.now() });
      addToast({ title: 'Voice Error', body: describeVoiceError(err, 'join'), type: 'danger' });
    } finally {
      if (isCurrentJoin()) setVoiceBusy(false);
    }
  }

  async function handleToggleMute() {
    if (!voiceSession) return;
    
    const nextMuted = !voiceMuted;
    try {
      await applyVoiceMuted(voiceSession, nextMuted);
      setVoiceMuted(nextMuted);
    } catch (err) {
      console.error('setMuted failed:', err);
    }
  }

  async function handleToggleDeafen() {
    if (!voiceSession) return;
    
    const nextDeafened = !voiceDeafened;
    try {
      // Save the value BEFORE calling applyVoiceDeafened, since it gets reset to null
      const shouldUnmuteAfterUndeafen = !nextDeafened && voiceSession.wasUnmutedBeforeDeafen === true;
      
      await applyVoiceDeafened(voiceSession, nextDeafened);
      setVoiceDeafened(nextDeafened);
      
      // Update mute state based on deafen state
      if (nextDeafened) {
        // When deafening, mute if not already muted
        console.log(`handleToggleDeafen: deafening, voiceMuted=${voiceMuted}`);
        if (!voiceMuted) {
          setVoiceMuted(true);
          console.log('handleToggleDeafen: set voiceMuted to true');
        }
      } else {
        // When undeafening, unmute if we were unmuted before deafening
        console.log(`handleToggleDeafen: undeafening, shouldUnmuteAfterUndeafen=${shouldUnmuteAfterUndeafen}`);
        if (shouldUnmuteAfterUndeafen) {
          setVoiceMuted(false);
          console.log('handleToggleDeafen: set voiceMuted to false');
        }
      }
    } catch (err) {
      console.error('setDeafened failed:', err);
    }
  }

  // Global keyboard shortcut: M to toggle mute
  useEffect(() => {
    function handleKeyDown(e) {
      // Only trigger if we're in voice, not typing in an input/textarea, and M is pressed
      if (!voiceSession || voiceStatus !== 'connected') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleToggleDeafen();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceSession, voiceStatus, voiceMuted, voiceDeafened]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply saved participant settings when participants change
  useEffect(() => {
    if (!voiceSession || voiceParticipants.length === 0) return;
    
    voiceParticipants.forEach(participant => {
      if (participant.isLocal) return; // Skip local participant
      
      const settings = getVoiceParticipantSetting(participant.identity);
      if (settings.muted) {
        setParticipantMuted(voiceSession, participant.identity, true);
      }
      if (settings.volume !== 1) {
        setParticipantVolume(voiceSession, participant.identity, settings.volume);
      }
    });
  }, [voiceParticipants, voiceSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply microphone volume setting when it changes
  useEffect(() => {
    if (!voiceSession) return;
    const micVolume = voiceAudioOptions.micVolume ?? 100;
    setMicVolume(voiceSession, micVolume);
  }, [voiceAudioOptions.micVolume, voiceSession]);

  return (
    <VoiceContext.Provider value={{
      voiceChannelId,
      voiceSession,
      voiceMuted,
      voiceDeafened,
      voiceStatus,
      voiceBusy,
      voiceParticipants,
      remoteScreenShares,
      localScreenShare,
      voiceError,
      setLocalScreenShare,
      joinVoice: handleJoinVoice,
      leaveVoice: handleLeaveVoice,
      toggleMute: handleToggleMute,
      toggleDeafen: handleToggleDeafen,
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
}