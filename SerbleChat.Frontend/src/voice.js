import {getChannelVoiceToken} from "./api.js";
import {createLocalAudioTrack, LocalAudioTrack, Room, RoomEvent} from "https://unpkg.com/livekit-client@2.17.2/dist/livekit-client.esm.mjs";

class VoiceSession {
    constructor(room, onParticipantsChange) {
        this.room = room;
        this.onParticipantsChange = onParticipantsChange;
    }

    /** @type {Room} */
    room;
    /** @type {HTMLElement[]} */
    trackElements = [];
    /** @type {LocalAudioTrack} */
    micTrack;
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

export async function joinChannel(channelId, onParticipantsChange) {
    let token = await getChannelVoiceToken(channelId.channelId);
    token = token.token;

    let room = new Room();
    let session = new VoiceSession(room, onParticipantsChange);

    // Play remote tracks
    room.on(RoomEvent.TrackSubscribed, (track) => {
        console.log(`Subscribed to track type: ${track.kind}`);
        if (track.kind === "audio") {
            const audio = document.createElement("audio");
            audio.srcObject = new MediaStream([track.mediaStreamTrack]);
            audio.autoplay = true;
            document.body.appendChild(audio);
            session.trackElements.push(audio);
            // Update participants when audio track is subscribed
            if (onParticipantsChange) onParticipantsChange(session.getParticipants());
        }
        else if (track.kind === "video") {
            const video = document.createElement("video");
            video.srcObject = new MediaStream([track.mediaStreamTrack]);
            video.autoplay = true;
            video.controls = true;
            document.body.appendChild(video);
            session.trackElements.push(video);
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
 * @returns {void}
 */
export async function leaveChannel(session) {
    for (const element of session.trackElements) {
        element.remove();
    }

    await session.room.disconnect(true);
}

/**
 * @param {VoiceSession} session
 * @param {boolean} nextMuted
 * @returns {void}
 */
export async function setMuted(session, nextMuted) {
    if (nextMuted) {
        await session.micTrack.mute();
    } else {
        await session.micTrack.unmute();
    }
}
