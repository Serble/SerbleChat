import {getChannelVoiceToken} from "./api.js";
import {createLocalAudioTrack, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent} from "https://unpkg.com/livekit-client@2.17.2/dist/livekit-client.esm.mjs";

class VoiceSession {
    constructor(room, onParticipantsChange) {
        this.room = room;
        this.onParticipantsChange = onParticipantsChange;
    }

    /** @type {Room} */
    room;
    /** @type {Object<string, HTMLElement>} */
    trackElements = {};
    /** @type {LocalAudioTrack} */
    micTrack;
    /** @type {LocalVideoTrack} */
    streamTrack;
    /** @type {Function} */
    onParticipantsChange;
    
    getParticipants() {
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

export async function joinChannel(channelId, onParticipantsChange, onRemoteScreenShare, onRemoteUnScreenShare) {
    let token = await getChannelVoiceToken(channelId.channelId);
    token = token.token;

    let room = new Room();
    let session = new VoiceSession(room, onParticipantsChange, onRemoteScreenShare);

    // Play remote tracks
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(`Subscribed to track type: ${track.kind}`);
        if (track.kind === "audio") {
            const audio = document.createElement("audio");
            audio.srcObject = new MediaStream([track.mediaStreamTrack]);
            audio.autoplay = true;
            document.body.appendChild(audio);
            session.trackElements[track.sid] = audio;
            // Update participants when audio track is subscribed
            if (onParticipantsChange) onParticipantsChange(session.getParticipants());
        }
        else if (track.kind === "video") {
            // TODO: Detect if this is a screen share track or regular video
            // Check track metadata or source to determine if it's a screen share
            // For screen shares, call onRemoteScreenShare(videoElement, participantIdentity)
            // For regular video, continue with current behavior
            
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
    });

    // Handle track unsubscribed (when remote participant stops sharing)
    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        console.log(`Unsubscribed from track type: ${track.kind}`);
        if (track.kind === "video" && onRemoteUnScreenShare) {
            // TODO: You can add additional checks here to verify it's a screen share
            onRemoteUnScreenShare(participant.identity);
        }
    });
    
    // Notify when participants join/leave
    room.on(RoomEvent.ParticipantConnected, () => {
        console.log("Participant connected!");
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.ParticipantDisconnected, () => {
        console.log("Participant disconnected!");
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    // Listen for when remote participants publish tracks
    room.on(RoomEvent.TrackPublished, () => {
        console.log('Track published by remote participant');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.TrackUnpublished, () => {
        console.log('Track unpublished by remote participant');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    // Listen for track muted/unmuted events
    room.on(RoomEvent.TrackMuted, () => {
        console.log('Track muted');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.TrackUnmuted, () => {
        console.log('Track unmuted');
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    // Listen for local track published (when we mute/unmute ourselves)
    room.on(RoomEvent.LocalTrackPublished, () => {
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });
    
    room.on(RoomEvent.LocalTrackUnpublished, () => {
        if (onParticipantsChange) onParticipantsChange(session.getParticipants());
    });

    await room.connect(import.meta.env.VITE_LIVEKIT_URL, token);

    // Publish microphone
    session.micTrack = await createLocalAudioTrack({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false
    });

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
    if (nextMuted) {
        await session.micTrack.mute();
    } else {
        await session.micTrack.unmute();
    }
}

/**
 * Start screen sharing
 * @param {VoiceSession} session
 * @param {Function} onScreenTrack - Callback that receives the video element to display the screen share. Called with (videoElement)
 * @returns {Promise<void>}
 */
export async function startScreenShare(session, onScreenTrack) {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true // optional: can capture system audio in some browsers
        });

        session.streamTrack = new LocalVideoTrack(screenStream.getTracks()[0]);
        await session.room.localParticipant.publishTrack(session.streamTrack);
        
        // Create video element to display the local screen share
        const video = document.createElement("video");
        video.srcObject = new MediaStream([session.streamTrack.mediaStreamTrack]);
        video.autoplay = true;
        
        onScreenTrack(video);

        console.log("Screen shared!");
    } catch (err) {
        console.error("Screen share failed:", err);
    }
}

/**
 * Stop screen sharing
 * @param {VoiceSession} session
 * @param {Function} onScreenTrackRemoved - Callback that's called when screen share is stopped
 * @returns {Promise<void>}
 */
export async function stopScreenShare(session, onScreenTrackRemoved) {
    await session.room.localParticipant.unpublishTrack(session.streamTrack);
    session.streamTrack = null;
    onScreenTrackRemoved();
}
