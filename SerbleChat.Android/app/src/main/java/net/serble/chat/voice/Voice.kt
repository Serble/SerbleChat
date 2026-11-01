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
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalAudioTrackOptions
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
) {
    private val _call = MutableStateFlow<CallState?>(null)
    val call: StateFlow<CallState?> = _call.asStateFlow()

    private val _errors = MutableStateFlow<String?>(null)
    val errors: StateFlow<String?> = _errors.asStateFlow()

    private var room: Room? = null
    private var rnnoise: RnNoiseProcessor? = null
    private var events: Job? = null
    private val lock = Mutex()

    fun clearError() { _errors.value = null }

    fun join(channelId: Long) {
        scope.launch {
            lock.withLock {
                if (_call.value?.channelId == channelId) return@withLock
                leaveLocked()
                val local = settings()
                _call.value = CallState(channelId, noiseSuppression = local.noiseSuppression)
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
        room?.let {
            runCatching { it.disconnect() }
            runCatching { it.release() }
        }
        room = null
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
        _call.value = c.copy(muted = muted)
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
