// Stream audio: the sound shared along with a screen share, and how each platform gets it.
//
//  - Linux desktop app: our own PipeWire virtual mic, fed with every app's sound except ours
//    (electron/linuxStreamAudio.cjs). We capture it like a microphone.
//  - Windows desktop app: Chromium's system audio loopback, which leaves our own sound out on
//    recent Windows.
//  - Browsers: whatever the browser's own picker offers (tab audio, or system audio on Windows).
//  - macOS desktop app, Firefox, Safari: not possible yet.

/** What the Linux virtual mic is called. Kept out of the microphone list. */
export const STREAM_AUDIO_DEVICE_LABEL = 'Serble Chat Stream Audio';

export const DEFAULT_STREAM_AUDIO = { audio: true, audioApps: null };

let supportPromise = null;

/**
 * Whether, and how, audio can be shared here.
 * @returns {Promise<{
 *   method: 'pipewire' | 'loopback' | 'browser' | null,
 *   supported: boolean,
 *   reason: string | null,      // Why not, when unsupported
 *   hint: string | null,        // What will be shared, when supported
 *   canPickApps: boolean,       // Can choose which apps' sound to share
 *   canChangeLive: boolean,     // Can turn audio on/off (or change apps) mid-stream without re-picking the screen
 * }>}
 */
export function getStreamAudioSupport() {
    supportPromise ??= detectSupport().catch(err => {
        console.error('Checking stream audio support failed:', err);
        supportPromise = null;
        return { method: null, supported: false, reason: 'Couldn\'t check whether audio can be shared.', hint: null, canPickApps: false, canChangeLive: false };
    });
    return supportPromise;
}

async function detectSupport() {
    const desktop = typeof window !== 'undefined' ? window.electron?.streamAudio : null;
    if (desktop) {
        const s = await desktop.support();
        if (!s.supported) return { method: null, supported: false, reason: s.reason, hint: null, canPickApps: false, canChangeLive: false };
        if (s.method === 'pipewire') {
            return {
                method: 'pipewire', supported: true, reason: null,
                hint: 'Shares the sound your other apps are playing. Serble Chat\'s own sound, like the call, is never included.',
                canPickApps: true, canChangeLive: true,
            };
        }
        return {
            method: 'loopback', supported: true, reason: null,
            hint: s.excludesSelf
                ? 'Shares your computer\'s sound. Serble Chat\'s own sound, like the call, is left out.'
                : 'Shares all of your computer\'s sound. This version of Windows can\'t leave out the call, so viewers may hear themselves.',
            canPickApps: false, canChangeLive: false,
        };
    }

    const ua = navigator.userAgent;
    const isChromium = /Chrome\/|Chromium\/|Edg\//.test(ua);
    if (!isChromium || !navigator.mediaDevices?.getDisplayMedia) {
        const browser = /Firefox\//.test(ua) ? 'Firefox' : 'This browser';
        return {
            method: null, supported: false,
            reason: `${browser} can't share audio with a screen share. Use Chrome or Edge, or the desktop app.`,
            hint: null, canPickApps: false, canChangeLive: false,
        };
    }
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const hasSystemAudio = /win|cros|chrome os/i.test(platform);
    return {
        method: 'browser', supported: true, reason: null,
        hint: hasSystemAudio
            ? 'When picking what to share, turn on "Share system audio" (or "Share tab audio" for a tab).'
            : 'Browsers here can only share a tab\'s sound: pick a tab and turn on "Share tab audio". For your whole computer\'s sound, use the desktop app.',
        canPickApps: false, canChangeLive: false,
    };
}

/** The apps playing sound right now (Linux desktop app only). */
export async function listStreamAudioApps() {
    return (await window.electron?.streamAudio?.listApps?.()) ?? [];
}

/**
 * Linux desktop app: starts the virtual mic and captures it.
 * @param {string[] | null} apps - Only these apps' sound, or null for every app
 * @returns {Promise<MediaStreamTrack>}
 */
export async function captureLinuxStreamAudio(apps) {
    const api = window.electron.streamAudio;
    const result = await api.start({ apps: apps?.length ? apps : null });
    if (!result?.success) throw new Error(result?.error || 'Couldn\'t start sharing audio');

    try {
        // Chromium may take a moment to notice the new device
        let device = null;
        for (let i = 0; i < 30 && !device; i++) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            device = devices.find(d => d.kind === 'audioinput' && d.label === result.label) ?? null;
            if (!device) await new Promise(r => setTimeout(r, 100));
        }
        if (!device) throw new Error('The stream audio device didn\'t show up');

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: device.deviceId },
                // It's sound for listening to, not a voice: no voice processing
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: 48000,
            },
        });
        return stream.getAudioTracks()[0];
    } catch (err) {
        await api.stop();
        throw err;
    }
}

/** Linux desktop app: changes which apps' sound is shared, mid-stream. */
export function setLinuxStreamAudioApps(apps) {
    return window.electron?.streamAudio?.setApps(apps?.length ? apps : null);
}

/** Linux desktop app: stops the virtual mic (and with it, all the links into it). */
export function stopLinuxStreamAudio() {
    return window.electron?.streamAudio?.stop();
}
