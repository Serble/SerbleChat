import { createContext, useContext, useState, useEffect } from 'react';
import { joinChannel, leaveChannel, setMuted as applyVoiceMuted } from '../voice.js';

const VoiceContext = createContext();

export function VoiceProvider({ children }) {
  const [voiceChannelId, setVoiceChannelId] = useState(null);
  const [voiceSession, setVoiceSession] = useState(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | connecting | connected | error
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceParticipants, setVoiceParticipants] = useState([]);

  async function handleJoinVoice(channelId) {
    if (voiceBusy || voiceStatus === 'connecting') return;
    
    // If already in a different voice channel, leave it first
    if (voiceSession && voiceChannelId !== channelId) {
      await handleLeaveVoice();
    }
    
    setVoiceBusy(true);
    setVoiceStatus('connecting');
    setVoiceChannelId(channelId);
    
    try {
      const session = await joinChannel({ channelId }, (participants) => {
        console.log(participants);
        setVoiceParticipants(participants);
      });
      setVoiceSession(session ?? {});
      setVoiceStatus('connected');
    } catch (err) {
      console.error('joinChannel failed:', err);
      setVoiceStatus('error');
      setVoiceChannelId(null);
    } finally {
      setVoiceBusy(false);
    }
  }

  async function handleLeaveVoice() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      if (voiceSession) {
        await leaveChannel(voiceSession);
      }
    } catch (err) {
      console.error('leaveChannel failed:', err);
    } finally {
      setVoiceSession(null);
      setVoiceMuted(false);
      setVoiceStatus('idle');
      setVoiceBusy(false);
      setVoiceChannelId(null);
      setVoiceParticipants([]);
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

  // Global keyboard shortcut: M to toggle mute
  useEffect(() => {
    function handleKeyDown(e) {
      // Only trigger if we're in voice, not typing in an input/textarea, and M is pressed
      if (!voiceSession || voiceStatus !== 'connected') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceSession, voiceStatus, voiceMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <VoiceContext.Provider value={{
      voiceChannelId,
      voiceSession,
      voiceMuted,
      voiceStatus,
      voiceBusy,
      voiceParticipants,
      joinVoice: handleJoinVoice,
      leaveVoice: handleLeaveVoice,
      toggleMute: handleToggleMute,
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
