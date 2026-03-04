import {getChannelVoiceToken} from "./api.js";
import {createLocalAudioTrack, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track} from "livekit-client";
import { NoiseSuppressorWorklet_Name } from "@timephy/rnnoise-wasm";
import NoiseSuppressorWorklet from "@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url";

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Global promise to ensure worklet is loaded only once
let rnnoiseLoadPromise = null;
async function ensureRnnoiseLoaded(ctx) {
    if (rnnoiseLoadPromise) return rnnoiseLoadPromise;
    
    rnnoiseLoadPromise = (async () => {
        try {
            await ctx.audioWorklet.addModule(NoiseSuppressorWorklet);
            console.log('RNNoise worklet loaded');
        } catch (err) {
            console.error('Failed to load RNNoise worklet:', err);
            throw err;
        }
    })();
    
    return rnnoiseLoadPromise;
}

class VoiceSession {
    constructor(room, onParticipantsChange) {
        this.room = room;
        this.onParticipantsChange = onParticipantsChange;
        this.isActive = true;
        this.speakingStates = {};
        this.speakingCheckInterval = null;
        this.micGainNode = null;
        this.micSourceNode = null;
        this.micRnnoiseNode = null;
        this.micChannelMerger = null; // For converting RNNoise mono output to stereo
        this.micDestination = null;
        this.micAnalyzer = null;
        this.rawMicTrack = null; // Store raw track to rebuild chain
        this.rnnoiseEnabled = false;
    }
    /** @type {Room} */
    room;
    /** @type {Object<string, HTMLElement>} */
    trackElements = {};
    /** @type {Object<string, boolean>} */
    speakingStates;
    /** @type {number} */
    speakingCheckInterval;
    /** @type {GainNode} */
    micGainNode;
    /** @type {MediaStreamAudioSourceNode} */
    micSourceNode;
    /** @type {AudioWorkletNode} */
    micRnnoiseNode;
    /** @type {ChannelMergerNode} */
    micChannelMerger;
    /** @type {MediaStreamAudioDestinationNode} */
    micDestination;
    /** @type {AnalyserNode} */
    micAnalyzer;
    /** @type {LocalAudioTrack} */
    micTrack;
    /** @type {LocalAudioTrack} */
    rawMicTrack;
    /** @type {LocalVideoTrack} */
    streamTrack;
    /** @type {Function} */
    onParticipantsChange;
    /** @type {boolean} */
    isActive;
    /** @type {boolean} */
    isDeafened = false;
    /** @type {boolean | null} */
    wasUnmutedBeforeDeafen = null; // Track mute state before deafening
    /** @type {Map<string, {source: MediaStreamAudioSourceNode, muteNode: GainNode | null, gainNode: GainNode, element: HTMLMediaElement | null, analyzer: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>}>} */
    audioGraph = new Map();
    /** @type {boolean} */
    rnnoiseEnabled;

    getParticipants() {
        if (!this.room) return [];
        // Returns array of { identity: string, isSpeaking: boolean, isMuted: boolean, isClientMuted: boolean }
        const participants = Array.from(this.room.remoteParticipants.values()).map(p => {
            // Check if participant has an audio track and if it's muted
            let isMuted = false;
            const audioTrack = Array.from(p.audioTrackPublications.values())[0];
            if (audioTrack) {
                isMuted = audioTrack.isMuted || !audioTrack.isSubscribed;
            } else {
                // No audio track published yet
                isMuted = false;
            }
            
            // Check if participant is client-side muted
            let isClientMuted = false;
            const graph = this.audioGraph?.[p.identity];
            if (graph) {
                isClientMuted = graph.muteNode.gain < 0.5;
            }
            
            return {
                identity: p.identity,
                isSpeaking: this.speakingStates[p.identity] || false, // Use our detected speaking state
                isMuted: isMuted,
                isClientMuted: isClientMuted
            };
        });
        
        // Include local participant
        const local = this.room.localParticipant;
        if (local) {
            let localMuted = false;
            const localAudioTrack = Array.from(local.audioTrackPublications.values())[0];
            if (localAudioTrack) {
                localMuted = localAudioTrack.isMuted;
            }
            
            participants.unshift({
                identity: local.identity,
                isSpeaking: this.speakingStates[local.identity] || false, // Use our detected speaking state
                isMuted: localMuted,
                isLocal: true,
                isClientMuted: false // Local participant can't be client-muted
            });
        }
        
        return participants;
    }

    cleanAudio(participantId) {
        const refs = this.audioGraph.get(participantId);
        if (refs) {
            refs.source.disconnect();
            if (refs.muteNode) refs.muteNode.disconnect();
            refs.gainNode.disconnect();
            if (refs.element) refs.element.remove(); // Remove the dummy audio element
            this.audioGraph.delete(participantId);
        }
    }
    
    /**
     * Set the audio output device for all remote participants
     * @param {string} deviceId - The device ID to use for audio output
     */
    async setOutputDevice(deviceId) {
        if (!deviceId || deviceId === 'default') return;
        
        // Update output device for all audio elements
        for (const [participantId, refs] of this.audioGraph.entries()) {
            if (refs.element && typeof refs.element.setSinkId === 'function') {
                try {
                    await refs.element.setSinkId(deviceId);
                    console.log(`Set output device for ${participantId} to ${deviceId}`);
                } catch (err) {
                    console.warn(`Failed to set output device for ${participantId}:`, err);
                }
            }
        }
    }
    
    checkSpeakingLevels() {
        let hasChanges = false;

        this.audioGraph.forEach(({analyzer, dataArray}, participantIdentity) => {
            let isSpeaking = false;

            // don't show voice activity for yourself when you are muted
            if (this.room.localParticipant.identity !== participantIdentity || !this.micTrack.isMuted) {
                // Get frequency data
                analyzer.getByteFrequencyData(dataArray);

                // Calculate average audio level
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;

                // Threshold for detecting speech (adjust as needed)
                const SPEAKING_THRESHOLD = 10; // Lower = more sensitive
                isSpeaking = average > SPEAKING_THRESHOLD;
            }

            // Update speaking state if changed
            if (this.speakingStates[participantIdentity] !== isSpeaking) {
                this.speakingStates[participantIdentity] = isSpeaking;
                hasChanges = true;
            }
        });
        
        // Notify if any speaking states changed
        if (hasChanges && this.onParticipantsChange) {
            this.onParticipantsChange(this.getParticipants());
        }
    }
    
    startSpeakingDetection() {
        if (this.speakingCheckInterval) return;
        
        // Check speaking levels every 100ms
        this.speakingCheckInterval = setInterval(() => {
            if (!this.isActive) return;
            this.checkSpeakingLevels();
        }, 100);
    }
    
    stopSpeakingDetection() {
        if (this.speakingCheckInterval) {
            clearInterval(this.speakingCheckInterval);
            this.speakingCheckInterval = null;
        }
    }
    
    setMicVolume(volumePercent) {
        if (!this.micGainNode) {
            console.warn('Mic gain node not initialized - volume control unavailable');
            return false;
        }
        
        // Convert percentage (0-200) to gain value (0.0-2.0)
        const gainValue = volumePercent / 100;
        this.micGainNode.gain.value = gainValue;
        console.log(`✓ Mic volume updated to ${volumePercent}% (gain: ${gainValue.toFixed(2)})`);
        return true;
    }

    async setRnnoise(enabled) {
        if (this.rnnoiseEnabled === enabled) return;
        this.rnnoiseEnabled = enabled;
        console.log(`Toggling RNNoise: ${enabled}`);
        await this.rebuildMicChain();
    }

    async rebuildMicChain() {
        if (!this.micSourceNode || !this.micGainNode || !this.micDestination) return;

        // Disconnect everything first to clear the graph
        try { this.micSourceNode.disconnect(); } catch (e) {}
        try { if(this.micRnnoiseNode) this.micRnnoiseNode.disconnect(); } catch (e) {}
        try { if(this.micChannelMerger) this.micChannelMerger.disconnect(); } catch (e) {}
        try { this.micGainNode.disconnect(); } catch (e) {}

        let currentNode = this.micSourceNode;

        // Insert RNNoise node if enabled
        if (this.rnnoiseEnabled) {
            try {
                await ensureRnnoiseLoaded(audioContext);
                if (!this.micRnnoiseNode) {
                    this.micRnnoiseNode = new AudioWorkletNode(audioContext, NoiseSuppressorWorklet_Name);
                }
                currentNode.connect(this.micRnnoiseNode);
                currentNode = this.micRnnoiseNode;
                
                // RNNoise outputs mono, so we need to convert back to stereo
                // by duplicating the mono output to both left and right channels
                if (!this.micChannelMerger) {
                    this.micChannelMerger = audioContext.createChannelMerger(2);
                }
                // Connect mono RNNoise output to both channels
                currentNode.connect(this.micChannelMerger, 0, 0);
                currentNode.connect(this.micChannelMerger, 0, 1);
                currentNode = this.micChannelMerger;
                console.log("RNNoise node connected with stereo conversion");
            } catch (err) {
                console.error("Failed to enable RNNoise:", err);
                // Fallback to bypass if it fails
            }
        }

        // Connect to Gain Node (Volume)
        currentNode.connect(this.micGainNode);
        
        // Connect Gain to Destination (Output) and Analyzer (Visualization)
        this.micGainNode.connect(this.micDestination);
        this.micGainNode.connect(this.micAnalyzer);
        
        console.log("Mic audio chain rebuilt");
    }
}

export async function joinChannel(channelId, onParticipantsChange, onRemoteScreenShare, onRemoteUnScreenShare, onFatalError, audioOptions = {}) {
    await audioContext.resume();

    let token = await getChannelVoiceToken(channelId.channelId);
    token = token.token;

    let room = new Room();
    let session = new VoiceSession(room, onParticipantsChange, onRemoteScreenShare);
    session.rnnoiseEnabled = audioOptions.rnnoise ?? true;

    const reportFatal = (err, context) => {
        if (onFatalError) onFatalError(err, context);
    };

    const removeTrackElement = (trackSid) => {
        const element = session.trackElements[trackSid];
        if (element) {
            element.remove();
            delete session.trackElements[trackSid];
        }
    };

    const removeParticipantTracks = (participant) => {
        if (!participant?.trackPublications) return;
        for (const publication of participant.trackPublications.values()) {
            const sid = publication.trackSid || publication.track?.sid;
            if (sid) removeTrackElement(sid);
        }
    };

    const isParticipantPresent = (participant) => {
        if (!participant?.identity) return false;
        return room.remoteParticipants.has(participant.identity);
    };

    // Play remote tracks
    room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        if (!session.isActive) return;
        if (!isParticipantPresent(participant)) {
            console.warn('Track subscribed for missing participant, ignoring.', participant?.identity, track?.sid);
            return;
        }

        try {
            console.log(`Subscribed to track type: ${track.kind}`);
            if (track.kind === "audio") {
                if (session.audioGraph.get(participant.identity)) return; // Use .get() for Map

                console.log(`Processing audio track for ${participant.identity}`);

                // 1. Ensure AudioContext is running
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }

                // 2. THE TRICK: Attach the track to a hidden, muted audio element.
                // Chromium browsers often won't "start" the stream unless it's attached to a DOM element.
                const element = track.attach();
                element.muted = true; // Mute the element so we don't get double audio
                element.style.display = 'none'; // Hide it

                // Set output device if specified
                if (audioOptions.outputDeviceId && audioOptions.outputDeviceId !== 'default' && typeof element.setSinkId === 'function') {
                    try {
                        await element.setSinkId(audioOptions.outputDeviceId);
                        console.log(`Set output device to ${audioOptions.outputDeviceId}`);
                    } catch (err) {
                        console.warn('Failed to set output device:', err);
                    }
                }

                // 3. Create the Web Audio Graph
                const source = audioContext.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
                const muteNode = audioContext.createGain();
                const gainNode = audioContext.createGain();
                muteNode.gain.value = 1.0;
                gainNode.gain.value = 1.0;

                const analyzer = audioContext.createAnalyser();
                analyzer.fftSize = 256;
                const bufferLength = analyzer.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                source.connect(muteNode);
                muteNode.connect(gainNode);
                gainNode.connect(analyzer);
                analyzer.connect(audioContext.destination);

                // 4. Store references so they aren't garbage collected
                session.audioGraph.set(participant.identity, { source, muteNode, gainNode, element, analyzer, dataArray });

                // Update participants when audio track is subscribed
                if (onParticipantsChange) onParticipantsChange(session.getParticipants());
            }
            else if (track.kind === "video") {
                // TODO: Detect if this is a screen share track or regular video
                // Check track metadata or source to determine if it's a screen share
                // For screen shares, call onRemoteScreenShare(videoElement, participantIdentity)
                // For regular video, continue with current behavior
                if (session.trackElements[track.sid]) return;
                const video = document.createElement("video");
                video.srcObject = new MediaStream([track.mediaStreamTrack]);
                video.autoplay = true;
                video.muted = true; // Mute video element (audio comes from audio track)
                video.playsInline = true; // Important for mobile devices
                session.trackElements[track.sid] = video;
                
                // Explicitly call play() to ensure video starts playing
                // This is especially important when re-subscribing to tracks after navigation
                video.play().catch(err => {
                    console.warn('Auto-play failed for video track, will retry:', err);
                    // If autoplay fails, try again after a short delay
                    setTimeout(() => {
                        video.play().catch(retryErr => {
                            console.error('Video play retry failed:', retryErr);
                        });
                    }, 100);
                });
                
                // Call the callback with video element and participant identity
                if (onRemoteScreenShare) {
                    onRemoteScreenShare(video, participant.identity);
                }
            }
        } catch (err) {
            console.error('TrackSubscribed handler failed:', err);
            reportFatal(err, 'track-subscribed');
        }
    });

    // Handle track unsubscribed (when remote participant stops sharing)
    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        if (!session.isActive) return;
        console.log(`Unsubscribed from track type: ${track.kind}`);
        
        // Clean up audio analyzer if it's an audio track
        if (track.kind === "audio") {
            session.cleanAudio(participant.identity);
        }
        
        removeTrackElement(track.sid);
        if (track.kind === "video" && onRemoteUnScreenShare) {
            // TODO: You can add additional checks here to verify it's a screen share
            onRemoteUnScreenShare(participant.identity);
        }
    });
    
    // Notify when participants join/leave
    room.on(RoomEvent.ParticipantConnected, (_participant) => {
        if (!session.isActive) return;
        console.log("Participant connected!");
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!session.isActive) return;
        console.log("Participant disconnected!");
        
        // Clean up audio analyzer for disconnected participant
        session.cleanAudio(participant.identity);
        
        removeParticipantTracks(participant);
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });

    room.on(RoomEvent.Disconnected, (reason) => {
        if (!session.isActive) return;
        const message = typeof reason === 'string' ? reason : 'Disconnected from voice server.';
        reportFatal(new Error(message), 'disconnected');
    });
    
    // Listen for when remote participants publish tracks
    room.on(RoomEvent.TrackPublished, () => {
        if (!session.isActive) return;
        console.log('Track published by remote participant');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.TrackUnpublished, () => {
        if (!session.isActive) return;
        console.log('Track unpublished by remote participant');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    // Listen for track muted/unmuted events
    room.on(RoomEvent.TrackMuted, () => {
        if (!session.isActive) return;
        console.log('Track muted');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.TrackUnmuted, () => {
        if (!session.isActive) return;
        console.log('Track unmuted');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    // Listen for local track published (when we mute/unmute ourselves)
    room.on(RoomEvent.LocalTrackPublished, () => {
        if (!session.isActive) return;
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.LocalTrackUnpublished, () => {
        if (!session.isActive) return;
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });

    await room.connect(import.meta.env.VITE_LIVEKIT_URL, token);

    // Create the initial raw microphone track with error handling
    // Browser audio processing is always disabled - all processing is done via RNNoise worklet
    let rawMicTrack;
    try {
        const audioTrackOptions = {
            // Explicitly disable all browser audio processing - use RNNoise instead
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            voiceIsolation: false,
        };
        
        // Add deviceId if specified
        if (audioOptions.deviceId && audioOptions.deviceId !== 'default') {
            audioTrackOptions.deviceId = audioOptions.deviceId;
        }
        
        rawMicTrack = await createLocalAudioTrack(audioTrackOptions);
    } catch (micErr) {
        console.error('Failed to create microphone track:', micErr);
        // Try with minimal constraints as fallback
        try {
            rawMicTrack = await createLocalAudioTrack({
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                voiceIsolation: false,
            });
            console.log('Fallback: created microphone track with all browser processing disabled');
        } catch (fallbackErr) {
            console.error('Failed to create microphone track even with fallback:', fallbackErr);
            throw new Error(`Cannot access microphone: ${fallbackErr.message}`);
        }
    }
    
    session.rawMicTrack = rawMicTrack; // Store raw track

    // Setup audio processing chain with gain control for microphone volume
    let processedMicTrack = rawMicTrack; // Default to raw track
    
    try {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        // Create the audio processing chain to apply gain
        const rawStream = new MediaStream([rawMicTrack.mediaStreamTrack]);
        const source = audioContext.createMediaStreamSource(rawStream);
        
        // Create gain node for volume control
        const gainNode = audioContext.createGain();
        const micVolume = audioOptions.micVolume ?? 100;
        gainNode.gain.value = micVolume / 100;
        
        // Create destination to capture the processed audio
        const destination = audioContext.createMediaStreamDestination();
        
        // Create analyzer for speaking detection
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 256;
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Store nodes in session
        session.micSourceNode = source;
        session.micGainNode = gainNode;
        session.micDestination = destination;
        session.micAnalyzer = analyzer;

        // Build the chain initially
        await session.rebuildMicChain();
        
        // Get the processed audio track
        const processedMediaStreamTrack = destination.stream.getAudioTracks()[0];
        
        // Create a LocalAudioTrack from the processed MediaStreamTrack
        // Note: We can't use createLocalAudioTrack here as it creates a new raw track
        // Instead, wrap the processed track directly
        processedMicTrack = new LocalAudioTrack(processedMediaStreamTrack);
        
        // Copy over the track name from the raw track
        Object.defineProperty(processedMicTrack, 'name', {
            value: rawMicTrack.name || 'microphone',
            writable: false
        });
        
        session.audioGraph.set(room.localParticipant.identity, { source, muteNode: null, gainNode, element: null, analyzer, dataArray });
        console.log(`Audio processing chain created (mic volume: ${micVolume}%, RNNoise: ${session.rnnoiseEnabled})`);
    } catch (err) {
        console.error('Failed to setup audio processing chain:', err);
        processedMicTrack = rawMicTrack; // Fallback to raw track
    }
    
    // Store and publish the processed track
    session.micTrack = processedMicTrack;
    await room.localParticipant.publishTrack(session.micTrack);

    console.log("Connected to room:", room.name);
    
    // Initial participant list
    if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    
    // Start monitoring audio levels for speaking detection
    session.startSpeakingDetection();
    
    return session;
}

/**
 * @param {VoiceSession} session
 * @returns {Promise<void>}
 */
export async function leaveChannel(session) {
    session.isActive = false;
    
    // Stop speaking detection
    session.stopSpeakingDetection();
    
    // Clean up all audio analyzers
    Object.keys(session.audioGraph).forEach(participantIdentity => {
        session.cleanAudio(participantIdentity);
    });
    
    // Close audio context
    // if (session.audioContext) {
    //     try {
    //         await session.audioContext.close();
    //     } catch (err) {
    //         console.warn('Failed to close audio context:', err);
    //     }
    //     session.audioContext = null;
    // }
    
    session.room?.removeAllListeners?.();

    for (const element of Object.values(session.trackElements)) {
        element.remove();
    }

    await session.room.disconnect(true);
}

/**
 * @param {VoiceSession} session
 * @param {boolean} nextMuted
 * @returns {Promise<void>}
 */
export async function setMuted(session, nextMuted) {
    if (!session?.isActive) return;
    if (nextMuted) {
        await session.micTrack.mute();
    } else {
        await session.micTrack.unmute();
    }
}

/**
 * Set deafened state (mute all incoming audio)
 * @param {VoiceSession} session
 * @param {boolean} nextDeafened
 * @returns {Promise<void>}
 */
export async function setDeafened(session, nextDeafened) {
    if (!session?.isActive) return;
    
    if (nextDeafened) {
        // Going deafened - track if we were unmuted so we can unmute when undeafening
        // Check the actual mic track mute state
        const isCurrentlyMuted = session.micTrack.isMuted;
        session.wasUnmutedBeforeDeafen = !isCurrentlyMuted;
        console.log(`Deafening: was unmuted before = ${session.wasUnmutedBeforeDeafen}, current muted state = ${isCurrentlyMuted}`);
        
        // Also mute when deafening if not already muted
        if (!isCurrentlyMuted) {
            await session.micTrack.mute();
            console.log('Deafening: muted microphone');
        }
    } else {
        // Going undeafened - restore previous mute state if applicable
        console.log(`Undeafening: wasUnmutedBeforeDeafen = ${session.wasUnmutedBeforeDeafen}`);
        if (session.wasUnmutedBeforeDeafen === true) {
            // We were unmuted before deafening, so unmute now
            await session.micTrack.unmute();
            console.log('Undeafening: unmuted microphone');
        } else {
            console.log('Undeafening: keeping microphone muted');
        }
        // If wasUnmutedBeforeDeafen is false, they were already muted, keep muted
        // If wasUnmutedBeforeDeafen is null, this shouldn't happen but keep muted to be safe
        session.wasUnmutedBeforeDeafen = null;
    }
    
    session.isDeafened = nextDeafened;
    
    // Mute/unmute all remote audio tracks
    for (const participant of session.room.remoteParticipants.values()) {
        for (const track of participant.audioTrackPublications.values()) {
            if (track.kind === 'audio') {
                if (nextDeafened) {
                    track.setSubscribed(false);
                } else {
                    track.setSubscribed(true);
                }
            }
        }
    }
}

/**
 * Start screen sharing
 * @param {VoiceSession} session
 * @param {Function} onScreenTrack - Callback that receives the video element to display the screen share. Called with (videoElement)
 * @param {Object} qualitySettings - Optional quality settings { bitrate, fps }
 * @returns {Promise<void>}
 */
export async function startScreenShare(session, onScreenTrack, qualitySettings = {}) {
    if (!session?.isActive) return;
    
    // Default quality settings
    const {
        bitrate = 8_000_000,
        fps = 30
    } = qualitySettings;
    
    try {
        // For Electron, show source picker before starting capture
        const isElectron = typeof window !== 'undefined' && window.electron;
        if (isElectron) {
            // Dynamically import to avoid circular dependencies
            const { pickDisplaySourceElectron } = await import('./electron-utils.js');
            
            console.log('Showing display source picker for Electron...');
            const selectedSourceId = await pickDisplaySourceElectron();
            
            if (!selectedSourceId) {
                throw new Error('Screen sharing was cancelled - no source selected');
            }
            
            console.log('User selected source, proceeding with getDisplayMedia...');
        }
        
        // For Electron, simpler constraints work better
        const constraintOptions = isElectron 
          ? { video: true, audio: false }  // Electron handles screen sharing differently
          : {
              video: {
                frameRate: { ideal: fps, max: fps }
                // Resolution automatically matches the content being shared
              },
              audio: true // optional: can capture system audio in some browsers
            };

        const screenStream = await navigator.mediaDevices.getDisplayMedia(constraintOptions);

        const screenTrack = screenStream.getVideoTracks()[0];

        // Log the actual track settings
        const settings = screenTrack.getSettings();
        console.log("Initial screen track settings:", settings);
        
        // Get track capabilities
        const capabilities = screenTrack.getCapabilities?.();
        if (capabilities) {
          console.log("Screen track capabilities:", capabilities);
        }

        // Apply constraints to the track (only if not Electron, as it's already constrained)
        try {
            await screenTrack.applyConstraints({
                frameRate: { ideal: fps, max: fps }
            });
            
            // Log settings after applying constraints
            const newSettings = screenTrack.getSettings();
            console.log("Screen track settings after applyConstraints:", newSettings);
        } catch (err) {
            console.warn("Failed to apply frame rate constraints:", err);
        }

        session.streamTrack = new LocalVideoTrack(screenTrack);
        session.screenShareQualitySettings = qualitySettings; // Store settings for later updates
        
        await session.room.localParticipant.publishTrack(session.streamTrack, {
            source: Track.Source.ScreenShare,

            videoEncoding: {
                maxBitrate: bitrate,
                maxFramerate: fps
            },

            simulcast: false
        });
        
        // Create video element to display the local screen share
        const video = document.createElement("video");
        video.srcObject = new MediaStream([session.streamTrack.mediaStreamTrack]);
        video.autoplay = true;
        
        onScreenTrack(video);

        console.log("Screen shared with requested settings:", { bitrate, fps });
        console.log("Actual track frame rate:", screenTrack.getSettings().frameRate);
    } catch (err) {
        console.error("Screen share failed:", err);
        console.error("Screen share error details - Name:", err.name, "Message:", err.message, "Stack:", err.stack);
        
        // Provide more specific error messages
        let errorMessage = err.message || 'Unknown error';
        if (err.name === 'NotSupportedError') {
            errorMessage = 'Screen sharing is not supported in this context. Check Electron permissions.';
        } else if (err.name === 'NotAllowedError') {
            errorMessage = 'Screen sharing was denied. Permission required.';
        } else if (err.name === 'AbortError') {
            if (errorMessage.includes('starting capture')) {
                errorMessage = 'Failed to start screen capture. Ensure Electron display handler is properly set up. Try again.';
            } else {
                errorMessage = 'Screen share was cancelled or aborted.';
            }
        }
        
        const error = new Error(errorMessage);
        error.originalError = err;
        throw error;
    }
}

/**
 * Update screen share quality settings without requiring new screen selection
 * @param {VoiceSession} session
 * @param {Object} qualitySettings - Quality settings { bitrate, fps }
 * @returns {Promise<void>}
 */
export async function updateScreenShareQuality(session, qualitySettings) {
    if (!session?.isActive || !session.streamTrack) {
        throw new Error("No active screen share to update");
    }
    
    const { bitrate = 8_000_000, fps = 30 } = qualitySettings;
    
    try {
        // Update the underlying MediaStreamTrack constraints
        const mediaStreamTrack = session.streamTrack.mediaStreamTrack;
        
        console.log("Before update - track settings:", mediaStreamTrack.getSettings());
        
        await mediaStreamTrack.applyConstraints({
            frameRate: { ideal: fps, max: fps }
        });
        
        console.log("After applyConstraints - track settings:", mediaStreamTrack.getSettings());

        // Get the track publication
        const publication = session.room.localParticipant.videoTrackPublications.get(session.streamTrack.sid);
        
        if (publication) {
            console.log("Found publication for screen share track");
            // Update the sender encoding parameters
            const sender = publication.sender;
            if (sender) {
                const parameters = sender.getParameters();
                console.log("Current sender parameters:", parameters);
                
                if (parameters.encodings && parameters.encodings.length > 0) {
                    parameters.encodings[0].maxBitrate = bitrate;
                    parameters.encodings[0].maxFramerate = fps;
                    console.log("Updated encoding parameters:", parameters.encodings[0]);
                    await sender.setParameters(parameters);
                    console.log("Sender parameters updated successfully");
                } else {
                    console.warn("No encodings found in sender parameters");
                }
            } else {
                console.warn("No sender found for publication");
            }
        } else {
            console.warn("No publication found for screen share track");
        }

        session.screenShareQualitySettings = qualitySettings;
        console.log("Screen share quality updated:", { bitrate, fps });
        console.log("Final track frame rate:", mediaStreamTrack.getSettings().frameRate);
    } catch (err) {
        console.error("Failed to update screen share quality:", err);
        throw err;
    }
}

/**
 * Stop screen sharing
 * @param {VoiceSession} session
 * @param {Function} onScreenTrackRemoved - Callback that's called when screen share is stopped
 * @returns {Promise<void>}
 */
export async function stopScreenShare(session, onScreenTrackRemoved) {
    if (!session?.isActive) return;
    await session.room.localParticipant.unpublishTrack(session.streamTrack);
    session.streamTrack = null;
    onScreenTrackRemoved();
}

/**
 * Mute/unmute a participant's audio (client-side only)
 * @param {VoiceSession} session
 * @param {string} participantIdentity
 * @param {boolean} isMuted
 * @returns {void}
 */
export function setParticipantMuted(session, participantIdentity, isMuted) {
    if (!session?.isActive) return;
    
    // Use the mute gain node for proper muting in the Web Audio API chain
    const { muteNode } = session.audioGraph.get(participantIdentity);
    if (muteNode) {
        muteNode.gain.value = isMuted ? 0.0 : 1.0;
        console.log(`Participant ${participantIdentity} ${isMuted ? 'muted' : 'unmuted'} (via mute gain node)`);
    } else {
        console.warn(`No mute gain node found for participant ${participantIdentity}`);
        console.warn(`Available mute gain nodes:`, Object.keys(session.audioGraph || {}));
        console.warn(`Available audio elements:`, Object.keys(session.audioGraph || {}));
    }
}

/**
 * Set a participant's volume (client-side only)
 * @param {VoiceSession} session
 * @param {string} participantIdentity
 * @param {number} volume - 0.0 to 5.0 (0% to 500%)
 * @returns {void}
 */
export function setParticipantVolume(session, participantIdentity, volume) {
    if (!session?.isActive) return;
    
    // Clamp volume to valid range
    const clampedVolume = Math.max(0, Math.min(5, volume));
    
    // Convert volume to gain:
    // volume 0.0 = gain 0 (complete silence)
    // volume 1.0 = gain 1.0 (normal/baseline)
    // volume 5.0 = gain 5.0 (5x amplified)
    // Use linear scaling: gain = volume
    const gainValue = clampedVolume;
    
    // Use the gain node (required for proper volume control with Web Audio API)
    const { gainNode } = session.audioGraph.get(participantIdentity);
    if (gainNode) {
        gainNode.gain.value = gainValue;
        console.log(`Participant ${participantIdentity} volume set to ${Math.round(clampedVolume * 100)}% (gain: ${gainValue.toFixed(2)})`);
    } else {
        console.warn(`No volume gain node found for participant ${participantIdentity}`);
        console.warn(`Available volume gain nodes:`, Object.keys(session.audioGraph || {}));
        console.warn(`Available audio elements:`, Object.keys(session.audioGraph || {}));
    }
}

/**
 * Set the local microphone volume
 * @param {VoiceSession} session
 * @param {number} volumePercent - 0 to 200 (percentage)
 * @returns {void}
 */
export function setMicVolume(session, volumePercent) {
    if (!session?.isActive) return;
    session.setMicVolume(volumePercent);
}

/**
 * Change the output audio device for an active voice session
 * @param {VoiceSession} session
 * @param {string} deviceId - The device ID to use for audio output
 * @returns {Promise<void>}
 */
export async function setOutputDevice(session, deviceId) {
    if (!session?.isActive) return;
    await session.setOutputDevice(deviceId);
}
