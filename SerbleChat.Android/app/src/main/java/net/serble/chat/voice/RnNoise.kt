package net.serble.chat.voice

import android.util.Log
import io.livekit.android.audio.AudioProcessorInterface
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** The native RNNoise denoiser (app/src/main/cpp). One instance holds its own state. */
internal object RnNoise {
    init {
        System.loadLibrary("serblechat_audio")
    }

    @JvmStatic external fun nativeCreate(): Long
    @JvmStatic external fun nativeDestroy(handle: Long)
    @JvmStatic external fun nativeProcess(handle: Long, buffer: ByteBuffer, offset: Int, frames: Int): Float
}

/**
 * Runs RNNoise on the microphone, after WebRTC's own capture processing (echo cancellation, gain).
 *
 * WebRTC hands external processors 10 ms of the first channel, full band, as floats on the int16
 * scale - exactly RNNoise's input at 48 kHz, where 10 ms is its 480-sample frame. At any other rate
 * the audio passes through untouched (Android captures at 48 kHz on every phone that matters).
 */
class RnNoiseProcessor : AudioProcessorInterface {
    @Volatile var enabled: Boolean = true
    private var handle = 0L
    private var sampleRate = 0
    private var logged = false
    private var warned = false

    override fun isEnabled(): Boolean = enabled
    override fun getName(): String = "rnnoise"

    @Synchronized
    override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) {
        sampleRate = sampleRateHz
        if (handle == 0L) handle = RnNoise.nativeCreate()
    }

    @Synchronized
    override fun resetAudioProcessing(newRate: Int) {
        sampleRate = newRate
        // A fresh state: the old one was tuned to audio that no longer follows on
        if (handle != 0L) RnNoise.nativeDestroy(handle)
        handle = RnNoise.nativeCreate()
    }

    @Synchronized
    override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
        if (!enabled || handle == 0L) return
        // WebRTC starts at 16 kHz and moves to the capture rate once the mic opens, so only audio
        // that actually arrives at another rate is worth a warning
        if (sampleRate != RATE || numFrames % FRAME != 0) {
            if (!warned) {
                warned = true
                Log.w(TAG, "Audio is at $sampleRate Hz ($numFrames frames); RNNoise needs $RATE, so it's passing through")
            }
            return
        }
        if (!buffer.isDirect) return
        buffer.order(ByteOrder.nativeOrder())
        val voice = RnNoise.nativeProcess(handle, buffer, 0, numFrames)
        if (!logged) {
            logged = true
            Log.i(TAG, "Denoising: $numFrames frames per call, $numBands bands, first voice probability $voice")
        }
    }

    @Synchronized
    fun release() {
        if (handle != 0L) RnNoise.nativeDestroy(handle)
        handle = 0L
    }

    private companion object {
        const val TAG = "RnNoise"
        const val RATE = 48_000
        const val FRAME = 480
    }
}
