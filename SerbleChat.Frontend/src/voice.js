import {getChannelVoiceToken} from "./api.js";
import {AudioPresets, createLocalAudioTrack, createLocalVideoTrack, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track, VideoPresets} from "livekit-client";
import { NoiseSuppressorWorklet_Name } from "@timephy/rnnoise-wasm";
import NoiseSuppressorWorklet from "@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url";
import { getStreamAudioSupport, captureLinuxStreamAudio, setLinuxStreamAudioApps, stopLinuxStreamAudio } from "./streamAudio.js";

// Exported for mods, whose audio nodes must live in the same context as the call's
export const audioContext = new (window.AudioContext || window.webkitAudioContext)();

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

/**
 * Whether a remote video publication is a screen share or a camera.
 * @returns {'screen' | 'camera'}
 */
function videoKind(publication) {
    return publication?.source === Track.Source.Camera ? 'camera' : 'screen';
}

/** Whether a remote audio publication is someone's stream (desktop/tab) audio rather than their mic. */
function isStreamAudio(publication) {
    return publication?.source === Track.Source.ScreenShareAudio;
}

/**
 * Someone's mic publication. Older web clients published it without a source ("unknown"),
 * so fall back to any audio that isn't their stream's.
 */
function micPublication(participant) {
    return participant.getTrackPublication(Track.Source.Microphone)
        ?? Array.from(participant.audioTrackPublications.values()).find(pub => !isStreamAudio(pub));
}

/** Volume (0-5) to gain: squared, so the top end gets loud quickly. Shared by voices and streams. */
function volumeToGain(volume) {
    const clamped = Math.max(0, Math.min(5, Number(volume) || 0));
    return clamped === 0 ? 0 : Math.pow(clamped, 2);
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
    /** The audio captured with the screen share, if the browser gave us any. @type {LocalAudioTrack | null} */
    streamAudioTrack = null;
    /** Whether the Linux desktop app's virtual stream audio mic is running for us. */
    linuxStreamAudio = false;
    /** @type {LocalVideoTrack | null} */
    cameraTrack = null;
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
    /**
     * Remote stream (screen share) audio, by participant identity. Kept apart from voices so it
     * can be muted on its own and doesn't count towards speaking detection.
     * @type {Map<string, {source: MediaStreamAudioSourceNode, muteNode: GainNode, gainNode: GainNode, element: HTMLMediaElement, trackSid: string}>}
     */
    streamAudioGraph = new Map();
    /** @type {boolean} */
    rnnoiseEnabled;
    /**
     * Saved per-person settings, by identity (from client options). @type {(identity: string) => object | undefined}
     */
    getParticipantSetting = () => undefined;
    /** Video track sids we just turned back on, so their return doesn't sound like a new stream. @type {Set<string>} */
    resumedVideo = new Set();

    /** Whether we've turned off someone's video (screen share and camera) to save bandwidth. */
    isVideoDisabled(identity) {
        return !!this.getParticipantSetting(String(identity))?.videoDisabled;
    }

    getParticipants() {
        if (!this.room) return [];
        // Returns array of { identity: string, isSpeaking: boolean, isMuted: boolean, isClientMuted: boolean }
        const participants = Array.from(this.room.remoteParticipants.values()).map(p => {
            // Check if participant has an audio track and if it's muted
            // (Only the mic counts: someone streaming also has a stream audio track)
            let isMuted = false;
            const audioTrack = micPublication(p);
            if (audioTrack) {
                isMuted = audioTrack.isMuted || !audioTrack.isSubscribed;
            }

            // Check if participant is client-side muted
            const graph = this.audioGraph.get(p.identity);
            const isClientMuted = !!graph?.muteNode && graph.muteNode.gain.value < 0.5;

            // Whether they're sending audio with their stream, and whether we've muted it
            const streamGraph = this.streamAudioGraph.get(p.identity);

            return {
                identity: p.identity,
                isSpeaking: this.speakingStates[p.identity] || false, // Use our detected speaking state
                isMuted: isMuted,
                isClientMuted: isClientMuted,
                hasStreamAudio: !!p.getTrackPublication(Track.Source.ScreenShareAudio),
                isStreamMuted: !!streamGraph && streamGraph.muteNode.gain.value < 0.5,
                // Whether we've turned their video off, and what they're sending (so a
                // placeholder can stand in for each feed we aren't receiving)
                videoDisabled: this.isVideoDisabled(p.identity),
                videoPublications: Array.from(p.videoTrackPublications.values())
                    .map(pub => ({ trackSid: pub.trackSid, source: videoKind(pub) })),
            };
        });
        
        // Include local participant
        const local = this.room.localParticipant;
        if (local) {
            let localMuted = false;
            const localAudioTrack = micPublication(local);
            if (localAudioTrack) {
                localMuted = localAudioTrack.isMuted;
            }
            
            participants.unshift({
                identity: local.identity,
                isSpeaking: this.speakingStates[local.identity] || false, // Use our detected speaking state
                isMuted: localMuted,
                isLocal: true,
                isClientMuted: false, // Local participant can't be client-muted
                hasStreamAudio: !!this.streamAudioTrack,
                isStreamMuted: false,
                videoDisabled: false,
                videoPublications: [],
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

    cleanStreamAudio(participantId) {
        const refs = this.streamAudioGraph.get(participantId);
        if (refs) {
            refs.source.disconnect();
            refs.muteNode.disconnect();
            refs.gainNode.disconnect();
            refs.element.remove();
            this.streamAudioGraph.delete(participantId);
        }
    }
    
    /**
     * Set the audio output device for all remote participants
     * @param {string} deviceId - The device ID to use for audio output
     */
    async setOutputDevice(deviceId) {
        if (!deviceId || deviceId === 'default') return;
        
        // Update output device for all audio elements
        for (const [participantId, refs] of [...this.audioGraph.entries(), ...this.streamAudioGraph.entries()]) {
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
        console.log(`Mic volume updated to ${volumePercent}% (gain: ${gainValue.toFixed(2)})`);
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
    if (audioOptions.getParticipantSetting) session.getParticipantSetting = audioOptions.getParticipantSetting;
    // Deafened before joining: start deafened so no remote audio plays at all
    if (audioOptions.startDeafened) {
        session.isDeafened = true;
        session.wasUnmutedBeforeDeafen = audioOptions.wasUnmutedBeforeDeafen ?? false;
    }

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

    // Someone's stream audio: its own mute and volume, and no speaking detection (it isn't their voice)
    const attachStreamAudio = async (track, publication, participant) => {
        const existing = session.streamAudioGraph.get(participant.identity);
        if (existing?.trackSid === track.sid) return;
        if (existing) session.cleanStreamAudio(participant.identity);

        if (audioContext.state === 'suspended') audioContext.resume();

        // Same trick as voices: a muted element keeps Chromium pulling the stream
        const element = track.attach();
        element.muted = true;
        element.style.display = 'none';
        if (audioOptions.outputDeviceId && audioOptions.outputDeviceId !== 'default' && typeof element.setSinkId === 'function') {
            try { await element.setSinkId(audioOptions.outputDeviceId); } catch (err) { console.warn('Failed to set output device:', err); }
        }

        const source = audioContext.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        const muteNode = audioContext.createGain();
        const gainNode = audioContext.createGain();
        const saved = audioOptions.getParticipantSetting?.(participant.identity);
        muteNode.gain.value = saved?.streamMuted ? 0 : 1;
        gainNode.gain.value = volumeToGain(saved?.streamVolume ?? 1);
        source.connect(muteNode);
        muteNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        session.streamAudioGraph.set(participant.identity, { source, muteNode, gainNode, element, trackSid: track.sid });
        console.log(`Playing stream audio from ${participant.identity}`);
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
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
                // While deafened, don't play anyone — this also covers people who
                // join after you deafened. Undeafening re-subscribes every track.
                if (session.isDeafened) {
                    publication.setSubscribed(false);
                    return;
                }
                if (isStreamAudio(publication)) {
                    await attachStreamAudio(track, publication, participant);
                    return;
                }
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

                // Saved per-person mute/volume
                const saved = audioOptions.getParticipantSetting?.(participant.identity);
                if (saved?.muted) muteNode.gain.value = 0;
                if (saved?.volume !== undefined && saved.volume !== 1) gainNode.gain.value = volumeToGain(saved.volume);

                // 4. Store references so they aren't garbage collected
                session.audioGraph.set(participant.identity, { source, muteNode, gainNode, element, analyzer, dataArray });

                // Update participants when audio track is subscribed
                if (onParticipantsChange) onParticipantsChange(session.getParticipants());
            }
            else if (track.kind === "video") {
                // Their video is turned off: don't take it (the server stops sending it)
                if (session.isVideoDisabled(participant.identity)) {
                    publication.setSubscribed(false);
                    return;
                }
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
                
                // Call the callback with the video element, who it's from, and whether
                // it's a screen share or a camera (one person can send both at once).
                // Quiet when it's one we turned back on, rather than a new stream.
                const quiet = session.resumedVideo.delete(publication.trackSid);
                if (onRemoteScreenShare) {
                    onRemoteScreenShare(video, participant.identity, videoKind(publication), track.sid, { quiet });
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
            if (isStreamAudio(publication)) {
                if (session.streamAudioGraph.get(participant.identity)?.trackSid === track.sid) {
                    session.cleanStreamAudio(participant.identity);
                }
                if (onParticipantsChange) onParticipantsChange(session.getParticipants());
            } else {
                session.cleanAudio(participant.identity);
            }
        }
        
        removeTrackElement(track.sid);
        if (track.kind === "video" && onRemoteUnScreenShare) {
            // Quiet when we turned it off ourselves: they're still streaming
            onRemoteUnScreenShare(participant.identity, videoKind(publication), track.sid, { quiet: !publication.isDesired });
        }
        if (track.kind === "video" && onParticipantsChange) onParticipantsChange(session.getParticipants());
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
        session.cleanStreamAudio(participant.identity);
        
        removeParticipantTracks(participant);
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });

    room.on(RoomEvent.Disconnected, (reason) => {
        if (!session.isActive) return;
        const message = typeof reason === 'string' ? reason : 'Disconnected from voice server.';
        reportFatal(new Error(message), 'disconnected');
    });
    
    // Listen for when remote participants publish tracks
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
        if (!session.isActive) return;
        console.log('Track published by remote participant');
        // Turned-off video: turn the server's automatic subscription down before it sends much
        if (publication.kind === 'video' && session.isVideoDisabled(participant.identity)) {
            publication.setSubscribed(false);
        }
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

    // People already streaming when we joined, whose video we've turned off
    for (const participant of room.remoteParticipants.values()) {
        if (!session.isVideoDisabled(participant.identity)) continue;
        for (const publication of participant.videoTrackPublications.values()) publication.setSubscribed(false);
    }

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
    // Muted before joining: mute before publishing so the mic is never live
    if (audioOptions.startMuted) await session.micTrack.mute();
    await room.localParticipant.publishTrack(session.micTrack, { source: Track.Source.Microphone });

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

    // Disconnecting ends the stream, but the Linux virtual mic is ours to remove
    if (session.linuxStreamAudio) {
        session.linuxStreamAudio = false;
        stopLinuxStreamAudio()?.catch?.(err => console.warn('Stopping stream audio failed:', err));
    }
    
    // Stop speaking detection
    session.stopSpeakingDetection();
    
    // Clean up all audio graphs
    for (const participantIdentity of [...session.audioGraph.keys()]) {
        session.cleanAudio(participantIdentity);
    }
    for (const participantIdentity of [...session.streamAudioGraph.keys()]) {
        session.cleanStreamAudio(participantIdentity);
    }
    
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
 * @param {Function} onScreenTrack - Callback that receives the video element to display the screen share.
 *   Called with (videoElement, { hasAudio, audioIssue }): audioIssue says why there's no sound when some was asked for.
 * @param {Object} qualitySettings - Optional settings { bitrate, fps, audio, audioApps }
 * @param {Function} [onEnded] - Called if the share stops from outside the app (e.g. the browser's "Stop sharing" bar)
 * @returns {Promise<void>}
 */
export async function startScreenShare(session, onScreenTrack, qualitySettings = {}, onEnded = null) {
    if (!session?.isActive) return;
    
    // Default quality settings
    const {
        bitrate = 8_000_000,
        fps = 30,
        audio: wantAudio = true,
        audioApps = null,
    } = qualitySettings;
    const audioSupport = wantAudio ? await getStreamAudioSupport() : null;
    const audioMethod = audioSupport?.supported ? audioSupport.method : null;
    
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
        
        // For Electron, simpler constraints work better. On Windows, asking for audio gets the
        // system loopback (see main.cjs). On Linux we capture it ourselves, after.
        const constraintOptions = isElectron 
          ? { video: true, audio: audioMethod === 'loopback' }
          : audioMethod !== 'browser' ? {
              video: { frameRate: { ideal: fps, max: fps } },
              audio: false,
            } : {
              video: {
                frameRate: { ideal: fps, max: fps }
                // Resolution automatically matches the content being shared
              },
              // Tab audio (Chromium), or system audio where the browser offers it (Chrome on
              // Windows/ChromeOS). It's sound for listening to, so no voice processing.
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                // Keep playing it locally, so sharing doesn't silence it for the sharer
                suppressLocalAudioPlayback: false,
                // Leave out this page's own sound (the call), so people don't hear themselves.
                // Ignored by browsers that don't support it yet.
                restrictOwnAudio: true,
              },
              systemAudio: 'include',
            };

        const screenStream = await navigator.mediaDevices.getDisplayMedia(constraintOptions);

        const screenTrack = screenStream.getVideoTracks()[0];
        // In a browser, only there if the user left "Share audio" ticked (and the browser supports it)
        let screenAudioTrack = screenStream.getAudioTracks()[0] ?? null;
        let audioIssue = null;
        if (wantAudio && !audioMethod) audioIssue = audioSupport?.reason ?? null;
        else if (audioMethod === 'browser' && !screenAudioTrack) audioIssue = audioSupport.hint;

        // Left the call while the picker was open
        if (!session.isActive) {
            screenStream.getTracks().forEach(t => t.stop());
            return;
        }

        if (audioMethod === 'pipewire') {
            try {
                screenAudioTrack = await captureLinuxStreamAudio(audioApps);
                session.linuxStreamAudio = true;
            } catch (err) {
                // The picture still works without the sound
                console.error("Failed to capture stream audio:", err);
                audioIssue = `Couldn't share audio: ${err.message}`;
            }
            if (!session.isActive) {
                screenStream.getTracks().forEach(t => t.stop());
                screenAudioTrack?.stop();
                if (session.linuxStreamAudio) { session.linuxStreamAudio = false; stopLinuxStreamAudio(); }
                return;
            }
        }

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

        if (screenAudioTrack) {
            if (!await publishStreamAudio(session, screenAudioTrack)) audioIssue = 'Couldn\'t share audio: sending it failed.';
        }

        // Stopped from the browser's own UI: LiveKit unpublishes the track itself,
        // so we only need to drop the audio with it and tell the UI
        const videoTrackAtStart = session.streamTrack;
        screenTrack.addEventListener('ended', () => {
            if (session.streamTrack !== videoTrackAtStart) return;
            stopScreenShare(session, () => onEnded?.()).catch(err => console.warn('Cleaning up ended screen share failed:', err));
        });

        // Create video element to display the local screen share
        const video = document.createElement("video");
        video.srcObject = new MediaStream([session.streamTrack.mediaStreamTrack]);
        video.autoplay = true;
        video.muted = true;

        onScreenTrack(video, { hasAudio: !!session.streamAudioTrack, audioIssue });

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
 * Publishes a screen share's sound. False if that failed (the picture carries on without it).
 * @param {VoiceSession} session
 * @param {MediaStreamTrack} mediaTrack
 */
async function publishStreamAudio(session, mediaTrack) {
    try {
        session.streamAudioTrack = new LocalAudioTrack(mediaTrack, undefined, true);
        await session.room.localParticipant.publishTrack(session.streamAudioTrack, {
            source: Track.Source.ScreenShareAudio,
            // Music, not speech: stereo, high bitrate, and no dropping "silence"
            audioPreset: AudioPresets.musicHighQualityStereo,
            forceStereo: true,
            dtx: false,
            red: false,
        });
        console.log("Screen share audio published:", mediaTrack.getSettings());
        return true;
    } catch (err) {
        console.error("Failed to publish screen share audio:", err);
        mediaTrack.stop();
        session.streamAudioTrack = null;
        if (session.linuxStreamAudio) { session.linuxStreamAudio = false; stopLinuxStreamAudio(); }
        return false;
    }
}

/** Stops sending a screen share's sound (and capturing it). */
async function unpublishStreamAudio(session) {
    const audioTrack = session.streamAudioTrack;
    session.streamAudioTrack = null;
    // Unpublishing also stops the captured track
    if (audioTrack) {
        try { await session.room.localParticipant.unpublishTrack(audioTrack); } catch (err) { console.warn('Unpublishing screen share audio failed:', err); audioTrack.stop(); }
    }
    if (session.linuxStreamAudio) {
        session.linuxStreamAudio = false;
        await stopLinuxStreamAudio();
    }
}

/**
 * Applies changed audio settings to a running screen share.
 * @param {VoiceSession} session
 * @param {{ audio?: boolean, audioApps?: string[] | null }} settings
 * @returns {Promise<{ hasAudio: boolean, needsRestart: boolean, audioIssue: string | null }>}
 *   needsRestart: this platform can't change it without picking the screen again
 */
export async function updateScreenShareAudio(session, { audio: wantAudio = true, audioApps = null } = {}) {
    if (!session?.isActive || !session.streamTrack) return { hasAudio: false, needsRestart: false, audioIssue: null };
    const hasAudio = !!session.streamAudioTrack;
    const support = await getStreamAudioSupport();

    if (!support.canChangeLive) {
        // Only a browser picker (or Windows' loopback) gives us the sound, so turning it on
        // means picking again. Turning it off doesn't.
        if (!wantAudio && hasAudio) {
            await unpublishStreamAudio(session);
            return { hasAudio: false, needsRestart: false, audioIssue: null };
        }
        return { hasAudio, needsRestart: wantAudio && !hasAudio && support.supported, audioIssue: null };
    }

    // Linux: the sound is ours to start and stop
    if (!wantAudio) {
        if (hasAudio) await unpublishStreamAudio(session);
        return { hasAudio: false, needsRestart: false, audioIssue: null };
    }
    if (hasAudio) {
        await setLinuxStreamAudioApps(audioApps);
        return { hasAudio: true, needsRestart: false, audioIssue: null };
    }
    try {
        const track = await captureLinuxStreamAudio(audioApps);
        session.linuxStreamAudio = true;
        if (!session.isActive || !session.streamTrack) {
            track.stop();
            session.linuxStreamAudio = false;
            await stopLinuxStreamAudio();
            return { hasAudio: false, needsRestart: false, audioIssue: null };
        }
        const ok = await publishStreamAudio(session, track);
        return { hasAudio: ok, needsRestart: false, audioIssue: ok ? null : 'Couldn\'t share audio: sending it failed.' };
    } catch (err) {
        console.error("Failed to capture stream audio:", err);
        return { hasAudio: false, needsRestart: false, audioIssue: `Couldn't share audio: ${err.message}` };
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
    const videoTrack = session.streamTrack;
    session.streamTrack = null;
    // Unpublishing also stops the captured tracks
    await unpublishStreamAudio(session);
    try {
        if (videoTrack) await session.room.localParticipant.unpublishTrack(videoTrack);
    } finally {
        onScreenTrackRemoved();
    }
}

/**
 * Start sending the local camera
 * @param {VoiceSession} session
 * @param {Object} options - { deviceId, onEnded } - onEnded is called if the camera stops on its own (e.g. unplugged)
 * @returns {Promise<HTMLVideoElement>} - A (mirrored) video element showing the local camera
 */
export async function startCamera(session, { deviceId, onEnded } = {}) {
    if (!session?.isActive) return null;
    if (session.cameraTrack) throw new Error('Camera is already on');

    let cameraTrack;
    try {
        cameraTrack = await createLocalVideoTrack({
            ...(deviceId && deviceId !== 'default' ? { deviceId } : {}),
            resolution: VideoPresets.h720.resolution,
        });
    } catch (err) {
        console.error('Failed to open camera:', err);
        let message = err.message || 'Unknown error';
        if (err.name === 'NotAllowedError') message = 'Camera access was denied.';
        else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') message = 'No camera found. Check that one is connected.';
        else if (err.name === 'NotReadableError') message = 'The camera is in use by another app.';
        const error = new Error(message);
        error.originalError = err;
        throw error;
    }

    // Left the call while the camera was opening
    if (!session.isActive) {
        cameraTrack.stop();
        return null;
    }

    session.cameraTrack = cameraTrack;
    try {
        await session.room.localParticipant.publishTrack(cameraTrack, {
            source: Track.Source.Camera,
            // Simulcast so small tiles (and slow connections) get a lower layer
            simulcast: true,
        });
    } catch (err) {
        session.cameraTrack = null;
        cameraTrack.stop();
        throw err;
    }

    cameraTrack.mediaStreamTrack.addEventListener('ended', () => {
        if (session.cameraTrack !== cameraTrack) return;
        stopCamera(session).finally(() => onEnded?.());
    });

    const video = document.createElement("video");
    video.srcObject = new MediaStream([cameraTrack.mediaStreamTrack]);
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.transform = 'scaleX(-1)'; // Mirror your own camera, like a mirror
    return video;
}

/**
 * Stop sending the local camera
 * @param {VoiceSession} session
 * @returns {Promise<void>}
 */
export async function stopCamera(session) {
    const cameraTrack = session?.cameraTrack;
    if (!cameraTrack) return;
    session.cameraTrack = null;
    if (session.isActive) {
        await session.room.localParticipant.unpublishTrack(cameraTrack); // also stops it
    } else {
        cameraTrack.stop();
    }
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
    const muteNode = session.audioGraph.get(participantIdentity)?.muteNode;
    if (muteNode) {
        muteNode.gain.value = isMuted ? 0.0 : 1.0;
        console.log(`Participant ${participantIdentity} ${isMuted ? 'muted' : 'unmuted'} (via mute gain node)`);
    } else {
        console.warn(`No mute gain node found for participant ${participantIdentity}`);
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

    // Volume to gain is squared (0 = silent, 1 = normal, 5 = 25x) so the
    // increase feels natural and gets loud quickly
    const gainValue = volumeToGain(clampedVolume);

    // Use the gain node (required for proper volume control with Web Audio API)
    const gainNode = session.audioGraph.get(participantIdentity)?.gainNode;
    if (gainNode) {
        gainNode.gain.value = gainValue;
        console.log(`Participant ${participantIdentity} volume set to ${Math.round(clampedVolume * 100)}% (gain: ${gainValue.toFixed(2)})`);
    } else {
        console.warn(`No volume gain node found for participant ${participantIdentity}`);
    }
}

/**
 * Mute/unmute someone's stream audio, and/or set its volume (client-side only).
 * Does nothing if they aren't sending any; the saved setting is applied when it arrives.
 * @param {VoiceSession} session
 * @param {string} participantIdentity
 * @param {{muted?: boolean, volume?: number}} setting - volume is 0.0 to 5.0, like voices
 * @returns {void}
 */
export function setStreamAudio(session, participantIdentity, { muted, volume } = {}) {
    if (!session?.isActive) return;
    const graph = session.streamAudioGraph?.get(participantIdentity);
    if (!graph) return;
    if (muted !== undefined) graph.muteNode.gain.value = muted ? 0 : 1;
    if (volume !== undefined) graph.gainNode.gain.value = volumeToGain(volume);
}

/**
 * Turn someone's video (screen share and camera) off or back on, client-side. Off means
 * unsubscribing, so the server stops sending it and it costs no bandwidth. The setting is
 * read from client options (`videoDisabled`), so save it there first; it also covers video
 * they start later.
 * @param {VoiceSession} session
 * @param {string} participantIdentity
 * @param {boolean} disabled
 * @returns {void}
 */
export function setParticipantVideoDisabled(session, participantIdentity, disabled) {
    if (!session?.isActive) return;
    const participant = session.room?.remoteParticipants.get(String(participantIdentity));
    if (!participant) return;
    for (const publication of participant.videoTrackPublications.values()) {
        if (disabled) {
            publication.setSubscribed(false);
        } else if (!publication.isDesired) {
            session.resumedVideo.add(publication.trackSid);
            publication.setSubscribed(true);
        }
    }
    if (session.onParticipantsChange) session.onParticipantsChange(session.getParticipants());
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
