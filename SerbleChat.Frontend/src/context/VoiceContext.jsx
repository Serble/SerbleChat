import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { joinChannel, leaveChannel, setMuted as applyVoiceMuted, setDeafened as applyVoiceDeafened, setParticipantMuted, setParticipantVolume, setMicVolume, setOutputDevice } from '../voice.js';
import { useApp } from './AppContext.jsx';
import { useClientOptions } from './ClientOptionsContext.jsx';
import { isElectron } from '../electron-utils.js';
import { playSound } from '../sound.js';

const VoiceContext = createContext();

export function VoiceProvider({ children }) {
  const { addToast } = useApp();
  const { getVoiceParticipantSetting, voiceAudioOptions, localDeviceSettings, keybinds } = useClientOptions();
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
  const previousParticipantIdsRef = useRef(new Set());
  const isPushToTalkActiveRef = useRef(false); // Track if PTT key is being held
  
  // Refs to access latest state in keybind handlers
  const voiceSessionRef = useRef(voiceSession);
  const voiceMutedRef = useRef(voiceMuted);
  const voiceDeafenedRef = useRef(voiceDeafened);
  
  useEffect(() => {
    voiceSessionRef.current = voiceSession;
    voiceMutedRef.current = voiceMuted;
    voiceDeafenedRef.current = voiceDeafened;
  }, [voiceSession, voiceMuted, voiceDeafened]);

  // Helper to safely play sounds with consistent error handling
  const playSoundSafe = (soundName) => {
    playSound(soundName).catch(e => console.warn(`[Voice] Failed to play ${soundName} sound:`, e));
  };

  function describeVoiceError(err, context) {
    if (err?.message) {
      // Provide specific error messages for common issues
      const message = err.message.toLowerCase();
      if (message.includes('microphone') || message.includes('audio')) {
        return 'Failed to access microphone. Check device permissions and ensure a microphone is connected.';
      }
      if (message.includes('permission') || message.includes('denied')) {
        return 'Access to microphone was denied. Check Electron permissions.';
      }
      if (message.includes('not found') || message.includes('no device')) {
        return 'No microphone device found. Ensure a microphone is connected.';
      }
      return err.message;
    }
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
      // Play sound effect when leaving voice channel (only if not an error state)
      if (!keepError) {
        setVoiceStatus('idle');
        setVoiceChannelId(null);
        setVoiceError(null);
        playSoundSafe('leave');
      } else {
        setVoiceStatus('error');
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
        // Play sound effect when someone starts screen sharing
        playSoundSafe('stream_start');
      }, (participantIdentity) => {
        if (!isCurrentJoin()) return;
        // Handle remote screen share stop
        setRemoteScreenShares(prev => prev.filter(s => s.participantIdentity !== participantIdentity));
        // Play sound effect when someone stops screen sharing
        playSoundSafe('stream_end');
      }, (err, context) => {
        if (!isCurrentJoin()) return;
        reportFatalError(err, context);
      }, {
        ...voiceAudioOptions,
        deviceId: localDeviceSettings.inputDeviceId,
        outputDeviceId: localDeviceSettings.outputDeviceId,
      });

      if (!isCurrentJoin()) {
        await leaveChannel(session);
        return;
      }

      setVoiceSession(session ?? {});
      setVoiceStatus('connected');
      
      // If in push-to-talk mode, auto-mute on join
      if (voiceAudioOptions.inputMode === 'push-to-talk' && !voiceMutedRef.current) {
        await applyVoiceMuted(session, true);
        setVoiceMuted(true);
      }
      
      // Play join sound for the local user who just joined
      // Ensure we're checking the current join ID to avoid playing stale sounds
      if (isCurrentJoin()) {
        // Use requestAnimationFrame to ensure DOM has updated before playing sound
        requestAnimationFrame(() => {
          playSoundSafe('join');
        });
      }
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
      // Play sound effect
      playSoundSafe(nextMuted ? 'mute' : 'unmute');
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
      
      // Play sound effect
      playSoundSafe(nextDeafened ? 'deafen' : 'undeafen');
      
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

  // Helper function to check if a keyboard event matches a keybind
  function matchesKeybind(event, keybind) {
    if (!keybind) return false;
    
    const parts = keybind.split('+');
    const modifiers = [];
    let key = '';
    
    for (const part of parts) {
      if (part === 'CommandOrControl' || part === 'Ctrl' || part === 'Control') {
        modifiers.push('ctrl');
      } else if (part === 'Shift') {
        modifiers.push('shift');
      } else if (part === 'Alt') {
        modifiers.push('alt');
      } else {
        key = part;
      }
    }
    
    // Check modifiers
    const ctrlPressed = event.ctrlKey || event.metaKey;
    const shiftPressed = event.shiftKey;
    const altPressed = event.altKey;
    
    const ctrlRequired = modifiers.includes('ctrl');
    const shiftRequired = modifiers.includes('shift');
    const altRequired = modifiers.includes('alt');
    
    if (ctrlPressed !== ctrlRequired) return false;
    if (shiftPressed !== shiftRequired) return false;
    if (altPressed !== altRequired) return false;
    
    // Check key
    let eventKey = event.key;
    
    // Normalize special keys
    if (eventKey === ' ') eventKey = 'Space';
    else if (eventKey === 'Enter') eventKey = 'Return';
    else if (eventKey.startsWith('Arrow')) eventKey = eventKey.replace('Arrow', '');
    
    // Case-insensitive comparison for letter keys
    return eventKey.toLowerCase() === key.toLowerCase();
  }

  // Web keyboard shortcuts with user-configured keybinds
  useEffect(() => {
    function handleKeyDown(e) {
      // Disable voice shortcuts if keybinds menu is open
      const keybindsOpen = document.querySelector('[data-keybinds-open="true"]');
      if (keybindsOpen) return;
      
      // Only trigger if we're in voice, not typing in an input/textarea
      if (!voiceSession || voiceStatus !== 'connected') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Check for Push to Talk key
      if (voiceAudioOptions.inputMode === 'push-to-talk' && keybinds.pushToTalk && matchesKeybind(e, keybinds.pushToTalk)) {
        e.preventDefault();
        // Unmute on PTT key down
        if (!isPushToTalkActiveRef.current) {
          isPushToTalkActiveRef.current = true;
          if (voiceMutedRef.current) {
            applyVoiceMuted(voiceSessionRef.current, false).then(() => {
              setVoiceMuted(false);
              playSoundSafe('unmute');
            }).catch(err => {
              console.error('PTT unmute failed:', err);
            });
          }
        }
        return;
      }
      
      // Check if event matches toggleMute keybind
      if (matchesKeybind(e, keybinds.toggleMute)) {
        e.preventDefault();
        handleToggleMute();
      } 
      // Check if event matches toggleDeafen keybind
      else if (matchesKeybind(e, keybinds.toggleDeafen)) {
        e.preventDefault();
        handleToggleDeafen();
      }
    }

    function handleKeyUp(e) {
      // Disable voice shortcuts if keybinds menu is open
      const keybindsOpen = document.querySelector('[data-keybinds-open="true"]');
      if (keybindsOpen) return;

      // Only trigger if we're in voice
      if (!voiceSession || voiceStatus !== 'connected') return;
      
      // Don't trigger PTT if typing in an input/textarea (but allow release while editing)
      // Actually, we should process release even in inputs to properly unmute
      // This allows PTT to work even while typing in chat

      // Check for Push to Talk key release
      if (voiceAudioOptions.inputMode === 'push-to-talk' && keybinds.pushToTalk && matchesKeybind(e, keybinds.pushToTalk)) {
        e.preventDefault();
        // Mute on PTT key up
        if (isPushToTalkActiveRef.current) {
          isPushToTalkActiveRef.current = false;
          if (!voiceMutedRef.current) {
            applyVoiceMuted(voiceSessionRef.current, true).then(() => {
              setVoiceMuted(true);
              playSoundSafe('mute');
            }).catch(err => {
              console.error('PTT mute failed:', err);
            });
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [voiceSession, voiceStatus, voiceMuted, voiceDeafened, keybinds, voiceAudioOptions.inputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Electron global keybinds listener
  useEffect(() => {
    if (!isElectron() || !window.electron?.onKeybindTriggered) return;

    const unsubscribe = window.electron.onKeybindTriggered((action) => {
      // Use refs to get current state without recreating the listener
      const session = voiceSessionRef.current;
      const status = voiceStatus;

      // Don't trigger keybinds if the keybinds settings are open
      const settingsModal = document.querySelector('[data-keybinds-open="true"]');
      if (settingsModal) return;

      if (!session || status !== 'connected') return;

      if (action === 'toggleMute') {
        const nextMuted = !voiceMutedRef.current;
        applyVoiceMuted(session, nextMuted).then(() => {
          setVoiceMuted(nextMuted);
          // Play sound effect
          playSoundSafe(nextMuted ? 'mute' : 'unmute');
        }).catch(err => {
          console.error('Keybind mute failed:', err);
        });
      } else if (action === 'toggleDeafen') {
        const nextDeafened = !voiceDeafenedRef.current;
        const shouldUnmuteAfterUndeafen = !nextDeafened && session.wasUnmutedBeforeDeafen === true;
        
        applyVoiceDeafened(session, nextDeafened).then(() => {
          setVoiceDeafened(nextDeafened);
          
          // Play sound effect
          playSoundSafe(nextDeafened ? 'deafen' : 'undeafen');
          
          if (nextDeafened) {
            if (!voiceMutedRef.current) {
              setVoiceMuted(true);
            }
          } else {
            if (shouldUnmuteAfterUndeafen) {
              setVoiceMuted(false);
            }
          }
        }).catch(err => {
          console.error('Keybind deafen failed:', err);
        });
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [voiceStatus]); // Only depend on voiceStatus since we use refs for other state

  // Apply saved participant settings when participants change
  useEffect(() => {
    if (!voiceSession || voiceParticipants.length === 0) return;
    
    // Use a small delay to ensure audio analyzer is fully set up
    const timeoutId = setTimeout(() => {
      voiceParticipants.forEach(participant => {
        if (participant.isLocal) return; // Skip local participant
        
        const settings = getVoiceParticipantSetting(participant.identity);
        
        // Only apply mute if gain node exists (audio analyzer is set up)
        if (settings.muted && voiceSession.participantMuteGainNodes?.[participant.identity]) {
          setParticipantMuted(voiceSession, participant.identity, true);
        }
        
        // Only apply volume if gain node exists (audio analyzer is set up)
        if (settings.volume !== 1 && voiceSession.participantGainNodes?.[participant.identity]) {
          setParticipantVolume(voiceSession, participant.identity, settings.volume);
        }
      });
    }, 100); // 100ms delay should be enough for audio analyzer setup
    
    return () => clearTimeout(timeoutId);
  }, [voiceParticipants, voiceSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle input mode changes (voice-activity vs push-to-talk)
  useEffect(() => {
    if (!voiceSession || voiceStatus !== 'connected') return;

    // When switching to push-to-talk mode, auto-mute
    if (voiceAudioOptions.inputMode === 'push-to-talk' && !voiceMutedRef.current) {
      applyVoiceMuted(voiceSession, true).then(() => {
        setVoiceMuted(true);
      }).catch(err => {
        console.error('Failed to auto-mute on PTT mode switch:', err);
      });
    }
  }, [voiceAudioOptions.inputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play sound when other participants join or leave the voice channel
  useEffect(() => {
    // Only track after we've successfully connected to voice
    if (voiceStatus !== 'connected') {
      previousParticipantIdsRef.current = new Set();
      return;
    }

    // Get current remote participant identities (excluding self)
    const currentRemoteIds = new Set(
      voiceParticipants
        .filter(p => !p.isLocal)
        .map(p => p.identity)
    );
    
    const previousRemoteIds = previousParticipantIdsRef.current;
    
    // Only play sounds if we've already been tracking participants (not on initial connection)
    if (previousRemoteIds.size > 0 || currentRemoteIds.size > 0) {
      // Check for new participants (someone else joined)
      for (const id of currentRemoteIds) {
        if (!previousRemoteIds.has(id)) {
          console.log(`[Sound] Remote participant joined: ${id}`);
          playSoundSafe('join');
          break; // Only play once per update cycle
        }
      }
      
      // Check for removed participants (someone left)
      for (const id of previousRemoteIds) {
        if (!currentRemoteIds.has(id)) {
          console.log(`[Sound] Remote participant left: ${id}`);
          playSoundSafe('leave');
          break; // Only play once per update cycle
        }
      }
    }
    
    // Update the ref for next time
    previousParticipantIdsRef.current = currentRemoteIds;
  }, [voiceParticipants, voiceStatus]);

  // Apply microphone volume setting when it changes
  useEffect(() => {
    if (!voiceSession) return;
    const micVolume = voiceAudioOptions.micVolume ?? 100;
    setMicVolume(voiceSession, micVolume);
  }, [voiceAudioOptions.micVolume, voiceSession]);

  // Apply RNNoise setting when it changes
  useEffect(() => {
    if (!voiceSession) return;
    const rnnoiseEnabled = voiceAudioOptions.rnnoise ?? true;
    if (voiceSession.setRnnoise) {
        voiceSession.setRnnoise(rnnoiseEnabled).catch(err => {
            console.error('Failed to update RNNoise setting:', err);
        });
    }
  }, [voiceAudioOptions.rnnoise, voiceSession]);

  // Apply output device changes to active voice session
  useEffect(() => {
    if (!voiceSession || !localDeviceSettings.outputDeviceId) return;
    
    // Apply output device change to the active session
    setOutputDevice(voiceSession, localDeviceSettings.outputDeviceId).catch(err => {
      console.warn('Failed to update output device on active session:', err);
    });
  }, [localDeviceSettings.outputDeviceId, voiceSession]);

  // Function to manually refresh participants (useful after muting/unmuting)
  function refreshParticipants() {
    if (voiceSession?.getParticipants) {
      setVoiceParticipants(voiceSession.getParticipants());
    }
  }

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
      refreshParticipants,
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