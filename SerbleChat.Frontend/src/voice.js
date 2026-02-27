import {getChannelVoiceToken} from "./api.js";
import {createLocalAudioTrack, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track} from "livekit-client";

class VoiceSession {
    constructor(room, onParticipantsChange) {
        this.room = room;
        this.onParticipantsChange = onParticipantsChange;
        this.isActive = true;
    }

    /** @type {Room} */
    room;
    /** @type {Object<string, HTMLElement>} */
    trackElements = {};
    /** @type {Object<string, HTMLAudioElement>} */
    participantAudioElements = {}; // Maps participant identity to audio element
    /** @type {LocalAudioTrack} */
    micTrack;
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

    getParticipants() {
        if (!this.room) return [];
        // Returns array of { identity: string, isSpeaking: boolean, isMuted: boolean }
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
            
            return {
                identity: p.identity,
                isSpeaking: p.isSpeaking,
                isMuted: isMuted
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
                isSpeaking: local.isSpeaking,
                isMuted: localMuted,
                isLocal: true
            });
        }
        
        return participants;
    }
}

export async function joinChannel(channelId, onParticipantsChange, onRemoteScreenShare, onRemoteUnScreenShare, onFatalError, audioOptions = {}) {
    let token = await getChannelVoiceToken(channelId.channelId);
    token = token.token;

    let room = new Room();
    let session = new VoiceSession(room, onParticipantsChange, onRemoteScreenShare);

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
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (!session.isActive) return;
        if (!isParticipantPresent(participant)) {
            console.warn('Track subscribed for missing participant, ignoring.', participant?.identity, track?.sid);
            return;
        }

        try {
            console.log(`Subscribed to track type: ${track.kind}`);
            if (track.kind === "audio") {
                if (session.trackElements[track.sid]) return;
                const audio = document.createElement("audio");
                audio.srcObject = new MediaStream([track.mediaStreamTrack]);
                audio.autoplay = true;
                document.body.appendChild(audio);
                session.trackElements[track.sid] = audio;
                // Store reference by participant identity for easier access to mute/volume controls
                session.participantAudioElements[participant.identity] = audio;
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
                session.trackElements[track.sid] = video;
                
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
        removeTrackElement(track.sid);
        if (track.kind === "video" && onRemoteUnScreenShare) {
            // TODO: You can add additional checks here to verify it's a screen share
            onRemoteUnScreenShare(participant.identity);
        }
    });
    
    // Notify when participants join/leave
    room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (!session.isActive) return;
        console.log("Participant connected!");
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!session.isActive) return;
        console.log("Participant disconnected!");
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

    // Publish microphone with audio options
    const audioTrackOptions = {
        echoCancellation: audioOptions.echoCancellation ?? false,
        noiseSuppression: audioOptions.noiseSuppression ?? false,
        autoGainControl: audioOptions.autoGainControl ?? false,
        voiceIsolation: audioOptions.voiceIsolation ?? false,
    };
    session.micTrack = await createLocalAudioTrack(audioTrackOptions);

    await room.localParticipant.publishTrack(session.micTrack);

    console.log("Connected to room:", room.name);
    
    // Initial participant list
    if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    
    return session;
}

/**
 * @param {VoiceSession} session
 * @returns {Promise<void>}
 */
export async function leaveChannel(session) {
    session.isActive = false;
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
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: fps, max: fps }
                // Resolution automatically matches the content being shared
            },
            audio: true // optional: can capture system audio in some browsers
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        // Log the actual track settings
        const settings = screenTrack.getSettings();
        console.log("Initial screen track settings:", settings);
        
        // Get track capabilities
        const capabilities = screenTrack.getCapabilities();
        console.log("Screen track capabilities:", capabilities);

        // Apply constraints to the track
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
        throw err;
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
    const audio = session.participantAudioElements[participantIdentity];
    if (audio) {
        audio.muted = isMuted;
        console.log(`Participant ${participantIdentity} audio ${isMuted ? 'muted' : 'unmuted'}`);
    }
}

/**
 * Set a participant's volume (client-side only)
 * @param {VoiceSession} session
 * @param {string} participantIdentity
 * @param {number} volume - 0.0 to 1.0
 * @returns {void}
 */
export function setParticipantVolume(session, participantIdentity, volume) {
    if (!session?.isActive) return;
    const audio = session.participantAudioElements[participantIdentity];
    if (audio) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        audio.volume = clampedVolume;
        console.log(`Participant ${participantIdentity} volume set to ${clampedVolume}`);
    } else {
        console.warn(`No audio element found for participant ${participantIdentity}, available:`, Object.keys(session.participantAudioElements));
    }
}