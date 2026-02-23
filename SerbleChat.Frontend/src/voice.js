import {getChannelVoiceToken} from "./api.js";
import {createLocalAudioTrack, LocalAudioTrack, Room, RoomEvent} from "https://unpkg.com/livekit-client@2.17.2/dist/livekit-client.esm.mjs";

class VoiceSession {
    constructor(room) {
        this.room = room;
    }

    /** @type {Room} */
    room;
    /** @type {HTMLElement[]} */
    trackElements = [];
    /** @type {LocalAudioTrack} */
    micTrack
}

export async function joinChannel(channelId) {
    let token = await getChannelVoiceToken(channelId.channelId);
    token = token.token;

    let room = new Room();
    let session = new VoiceSession(room);

    // Play remote tracks
    room.on(RoomEvent.TrackSubscribed, (track) => {
        console.log(`Subscribed to track type: ${track.kind}`);
        if (track.kind === "audio") {
            const audio = document.createElement("audio");
            audio.srcObject = new MediaStream([track.mediaStreamTrack]);
            audio.autoplay = true;
            document.body.appendChild(audio);
            session.trackElements.push(audio);
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
