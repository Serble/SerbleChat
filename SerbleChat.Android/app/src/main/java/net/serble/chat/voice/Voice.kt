package net.serble.chat.voice

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.twilio.audioswitch.AudioDevice
import io.livekit.android.AudioOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.audio.AudioProcessorOptions
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.serble.chat.data.Api
import net.serble.chat.data.Hub
import net.serble.chat.data.LocalSettings
import net.serble.chat.data.NoiseSuppression

enum class CallPhase { Connecting, Connected, Reconnecting }

data class AudioOutput(val name: String, val device: AudioDevice)

/**
 * Someone's camera or screen, mine included. [key] is the track's ID, so it stays the same while it's up.
 * [hasAudio]: a screen that comes with its sound (desktop or tab audio).
 */
data class VideoFeed(val key: String, val userId: String, val screen: Boolean, val track: VideoTrack, val local: Boolean, val hasAudio: Boolean = false)

data class CallState(
    val channelId: Long,
    val phase: CallPhase = CallPhase.Connecting,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    /** User IDs currently speaking, me included. */
    val speaking: Set<String> = emptySet(),
    val outputs: List<AudioOutput> = emptyList(),
    val output: AudioOutput? = null,
    val noiseSuppression: NoiseSuppression = NoiseSuppression.RnNoise,
    val cameraOn: Boolean = false,
    val frontCamera: Boolean = true,
    val screenSharing: Boolean = false,
    /** Screens first, then cameras. */
    val videos: List<VideoFeed> = emptyList(),
    /** User IDs whose stream audio we've muted (saved, so it lasts between calls). */
    val mutedStreams: Set<String> = emptySet(),
)

/**
 * The one voice call the app can be in. LiveKit does the media; the backend hands out the token and
 * tells everyone else who's in which channel, and we report mute/deafen to it so people outside the
 * call see them too.
 */
class Voice(
    private val context: Context,
    private val api: Api,
    private val hub: Hub,
    private val scope: CoroutineScope,
    private val liveKitUrl: String,
    private val settings: suspend () -> LocalSettings,
    private val updateSettings: suspend ((LocalSettings) -> LocalSettings) -> Unit,
) {
    private val _call = MutableStateFlow<CallState?>(null)
    val call: StateFlow<CallState?> = _call.asStateFlow()

    private val _errors = MutableStateFlow<String?>(null)
    val errors: StateFlow<String?> = _errors.asStateFlow()

    private var room: Room? = null
    private var rnnoise: RnNoiseProcessor? = null
    private var events: Job? = null
    private val lock = Mutex()
    private val sounds by lazy { Sounds(context.applicationContext) }

    fun clearError() { _errors.value = null }

    /** Streams that were already up when we joined arrive just after; they don't get a sound. */
    private var quietStreamsUntil = 0L

    private fun play(sound: Sound, inCall: Boolean = true) {
        scope.launch {
            if (!settings().callSounds) return@launch
            Log.d(TAG, "Playing $sound")
            runCatching { sounds.play(sound, inCall) }
        }
    }

    fun join(channelId: Long) {
        scope.launch {
            lock.withLock {
                if (_call.value?.channelId == channelId) return@withLock
                leaveLocked()
                val local = settings()
                _call.value = CallState(channelId, noiseSuppression = local.noiseSuppression, mutedStreams = local.mutedStreams)
                sounds // loads them while connecting, so the join sound is ready
                CallService.start(context)
                try {
                    val token = api.voiceToken(channelId)
                    val processor = RnNoiseProcessor().apply { enabled = local.noiseSuppression == NoiseSuppression.RnNoise }
                    rnnoise = processor
                    val newRoom = LiveKit.create(
                        context.applicationContext,
                        RoomOptions(
                            adaptiveStream = true,
                            dynacast = true,
                            audioTrackCaptureDefaults = LocalAudioTrackOptions(
                                noiseSuppression = local.noiseSuppression == NoiseSuppression.WebRtc,
                                echoCancellation = local.echoCancellation,
                                autoGainControl = local.autoGainControl,
                                highPassFilter = true,
                                typingNoiseDetection = local.noiseSuppression == NoiseSuppression.WebRtc,
                            ),
                        ),
                        LiveKitOverrides(
                            audioOptions = AudioOptions(
                                audioProcessorOptions = AudioProcessorOptions(capturePostProcessor = processor),
                                javaAudioDeviceModuleCustomizer = { builder ->
                                    // RNNoise only works on 48 kHz audio, and WebRTC processes at
                                    // the capture rate, which some phones (and the emulator) would
                                    // otherwise pick at 16 kHz
                                    builder.setInputSampleRate(48_000)
                                    // The phone's own suppressor would fight RNNoise, and "Off" means off
                                    builder.setUseHardwareNoiseSuppressor(local.noiseSuppression == NoiseSuppression.WebRtc)
                                    builder.setUseHardwareAcousticEchoCanceler(local.echoCancellation)
                                },
                            ),
                        ),
                    )
                    room = newRoom
                    (newRoom.audioHandler as? AudioSwitchHandler)?.registerAudioDeviceChangeListener { devices, selected ->
                        _call.update { c ->
                            c?.copy(outputs = devices.map { AudioOutput(it.name, it) }, output = selected?.let { AudioOutput(it.name, it) })
                        }
                    }
                    events = scope.launch { watch(newRoom) }
                    newRoom.connect(liveKitUrl, token)
                    newRoom.localParticipant.setMicrophoneEnabled(true)
                    _call.update { it?.copy(phase = CallPhase.Connected) }
                    play(Sound.Join)
                    quietStreamsUntil = android.os.SystemClock.elapsedRealtime() + 3000
                    refreshVideos(newRoom)
                    reportState()
                } catch (e: Exception) {
                    Log.e(TAG, "Couldn't join voice", e)
                    _errors.value = "Couldn't join the call: ${e.message ?: "unknown error"}"
                    leaveLocked()
                }
            }
        }
    }

    fun leave() {
        scope.launch { lock.withLock { leaveLocked() } }
    }

    private fun leaveLocked() {
        events?.cancel()
        events = null
        if (_call.value?.phase == CallPhase.Connected) play(Sound.Leave, inCall = false)
        room?.let {
            runCatching { it.disconnect() }
            runCatching { it.release() }
        }
        room = null
        synchronized(this) { streamVolumes.clear() }
        rnnoise?.release()
        rnnoise = null
        if (_call.value != null) {
            _call.value = null
            CallService.stop(context)
        }
    }

    fun toggleMute() {
        val c = _call.value ?: return
        // Unmuting while deafened undeafens too, as on the web
        if (c.muted && c.deafened) return setDeafened(false)
        setMuted(!c.muted)
    }

    fun setMuted(muted: Boolean) {
        val c = _call.value ?: return
        if (c.muted == muted) return
        _call.value = c.copy(muted = muted)
        play(if (muted) Sound.Mute else Sound.Unmute)
        scope.launch {
            runCatching { room?.localParticipant?.setMicrophoneEnabled(!muted) }
            reportState()
        }
    }

    fun toggleDeafen() {
        val c = _call.value ?: return
        setDeafened(!c.deafened)
    }

    private fun setDeafened(deafened: Boolean) {
        val c = _call.value ?: return
        // Deafening mutes you as well; undeafening restores the mic
        _call.value = c.copy(deafened = deafened, muted = deafened)
        play(if (deafened) Sound.Deafen else Sound.Undeafen)
        scope.launch {
            room?.setSpeakerMute(deafened)
            runCatching { room?.localParticipant?.setMicrophoneEnabled(!deafened) }
            reportState()
        }
    }

    fun selectOutput(output: AudioOutput) {
        (room?.audioHandler as? AudioSwitchHandler)?.selectDevice(output.device)
    }

    /** RNNoise can be switched on and off mid-call; WebRTC's own suppression applies from the next call. */
    fun applyNoiseSuppression(mode: NoiseSuppression) {
        rnnoise?.enabled = mode == NoiseSuppression.RnNoise
        _call.update { it?.copy(noiseSuppression = mode) }
    }

    /** Turns the camera on or off. The caller has the camera permission already. */
    fun setCamera(on: Boolean) {
        scope.launch {
            val r = room ?: return@launch
            val front = _call.value?.frontCamera ?: true
            try {
                if (on) r.localParticipant.videoTrackCaptureDefaults =
                    r.localParticipant.videoTrackCaptureDefaults.copy(position = if (front) CameraPosition.FRONT else CameraPosition.BACK)
                r.localParticipant.setCameraEnabled(on)
                _call.update { it?.copy(cameraOn = on) }
            } catch (e: Exception) {
                Log.e(TAG, "Couldn't switch the camera", e)
                _errors.value = "Couldn't turn the camera ${if (on) "on" else "off"}: ${e.message ?: "unknown error"}"
            }
            // The call's service needs the camera type to keep it running with the screen off
            CallService.start(context)
            refreshVideos(r)
        }
    }

    /** Front to back camera and back again. */
    fun flipCamera() {
        val c = _call.value ?: return
        val track = room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack ?: return
        val front = !c.frontCamera
        runCatching { track.switchCamera(position = if (front) CameraPosition.FRONT else CameraPosition.BACK) }
            .onSuccess { _call.update { it?.copy(frontCamera = front) } }
            .onFailure { Log.e(TAG, "Couldn't flip the camera", it) }
    }

    /** Starts sharing the screen, with the result of Android's screen capture prompt. */
    fun startScreenShare(permission: Intent) {
        scope.launch {
            val r = room ?: return@launch
            try {
                r.localParticipant.setScreenShareEnabled(
                    true,
                    ScreenCaptureParams(permission, CallService.SCREEN_NOTIFICATION_ID, CallService.screenNotification(context),
                        // Stopped from outside the app, e.g. the status bar's screen sharing chip
                        onStop = { stopScreenShare() }),
                )
                _call.update { it?.copy(screenSharing = true) }
            } catch (e: Exception) {
                Log.e(TAG, "Couldn't share the screen", e)
                _errors.value = "Couldn't share your screen: ${e.message ?: "unknown error"}"
            }
            refreshVideos(r)
        }
    }

    fun stopScreenShare() {
        scope.launch {
            val r = room ?: return@launch
            if (_call.value?.screenSharing != true) return@launch
            runCatching { r.localParticipant.setScreenShareEnabled(false) }
            _call.update { it?.copy(screenSharing = false) }
            refreshVideos(r)
        }
    }

    /** Readies a view to show this call's video. False when there's no call to show any from. */
    fun initRenderer(renderer: TextureViewRenderer): Boolean {
        val r = room ?: return false
        return runCatching { r.initVideoRenderer(renderer) }.isSuccess
    }

    /**
     * Works out the video feeds afresh from the room, playing the stream sounds for screens that came or went.
     * Synchronized: our own changes and the room's events both call it, and each change should sound once.
     */
    @Synchronized
    private fun refreshVideos(room: Room) {
        val feeds = mutableListOf<VideoFeed>()
        fun collect(p: Participant, local: Boolean) {
            val userId = p.identity?.value ?: return
            for ((pub, track) in p.videoTrackPublications) {
                val video = track as? VideoTrack ?: continue
                if (pub.muted) continue
                val screen = when (pub.source) {
                    Track.Source.SCREEN_SHARE -> true
                    Track.Source.CAMERA -> false
                    else -> continue
                }
                val hasAudio = screen && p.getTrackPublication(Track.Source.SCREEN_SHARE_AUDIO) != null
                feeds += VideoFeed(pub.sid, userId, screen, video, local, hasAudio)
            }
        }
        collect(room.localParticipant, local = true)
        room.remoteParticipants.values.forEach { collect(it, local = false) }
        feeds.sortBy { if (it.screen) 0 else 1 }

        val before = _call.value?.videos?.filter { it.screen }?.map { it.key }?.toSet() ?: return
        val after = feeds.filter { it.screen }.map { it.key }.toSet()
        if (android.os.SystemClock.elapsedRealtime() >= quietStreamsUntil) {
            if ((after - before).isNotEmpty()) play(Sound.StreamStart)
            else if ((before - after).isNotEmpty()) play(Sound.StreamEnd)
        }
        _call.update { it?.copy(videos = feeds, screenSharing = room.localParticipant.isScreenShareEnabled) }
        applyStreamAudio(room)
    }

    /** Silences the stream audio of everyone we've muted, and puts everyone else's back. */
    @Synchronized
    private fun applyStreamAudio(room: Room) {
        val muted = _call.value?.mutedStreams ?: return
        for (p in room.remoteParticipants.values) {
            val track = p.getTrackPublication(Track.Source.SCREEN_SHARE_AUDIO)?.track as? RemoteAudioTrack ?: continue
            val userId = p.identity?.value ?: continue
            val volume = if (userId in muted) 0.0 else 1.0
            if (streamVolumes.put(track, volume) == volume) continue
            Log.d(TAG, "Stream audio from $userId ${if (volume == 0.0) "muted" else "playing"}")
            runCatching { track.setVolume(volume) }
        }
    }

    /**
     * The volume last set on each stream audio track. By track object, not ID: rejoining gets a new
     * track (at full volume) for the same publication. Only touched under the object lock.
     */
    private val streamVolumes = java.util.WeakHashMap<RemoteAudioTrack, Double>()

    /** Mutes or unmutes someone's stream audio (only for us), and remembers it. */
    fun setStreamMuted(userId: String, muted: Boolean) {
        val c = _call.value ?: return
        val next = if (muted) c.mutedStreams + userId else c.mutedStreams - userId
        _call.value = c.copy(mutedStreams = next)
        room?.let { applyStreamAudio(it) }
        scope.launch {
            runCatching { updateSettings { s -> s.copy(mutedStreams = if (muted) s.mutedStreams + userId else s.mutedStreams - userId) } }
        }
    }

    private fun reportState() {
        val c = _call.value ?: return
        hub.send("UpdateVoiceState", c.channelId, c.muted, c.deafened)
    }

    private suspend fun watch(room: Room) {
        room.events.collect { event ->
            when (event) {
                is RoomEvent.ActiveSpeakersChanged -> {
                    _call.update { it?.copy(speaking = event.speakers.map { p -> p.identity?.value ?: "" }.toSet()) }
                }
                is RoomEvent.Reconnecting -> _call.update { it?.copy(phase = CallPhase.Reconnecting) }
                is RoomEvent.Reconnected -> {
                    _call.update { it?.copy(phase = CallPhase.Connected) }
                    reportState()
                }
                is RoomEvent.ParticipantConnected -> play(Sound.Join)
                is RoomEvent.ParticipantDisconnected -> {
                    play(Sound.Leave)
                    refreshVideos(room)
                }
                is RoomEvent.TrackSubscribed, is RoomEvent.TrackUnsubscribed, is RoomEvent.TrackPublished,
                is RoomEvent.TrackUnpublished, is RoomEvent.TrackMuted, is RoomEvent.TrackUnmuted -> refreshVideos(room)
                is RoomEvent.Disconnected -> {
                    if (_call.value != null) {
                        _errors.value = "You were disconnected from the call."
                        scope.launch { lock.withLock { leaveLocked() } }
                    }
                }
                else -> Unit
            }
        }
    }

    /** The hub reconnected: tell it our mute state again. */
    fun onHubConnected() = reportState()

    private companion object {
        const val TAG = "Voice"
    }
}

/** Starts the call's foreground service, which keeps the microphone alive with the screen off. */
fun CallService.Companion.start(context: Context) {
    ContextCompat.startForegroundService(context, Intent(context, CallService::class.java))
}

fun CallService.Companion.stop(context: Context) {
    context.stopService(Intent(context, CallService::class.java))
}
