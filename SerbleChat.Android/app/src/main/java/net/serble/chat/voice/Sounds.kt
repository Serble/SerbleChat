package net.serble.chat.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import net.serble.chat.R

/** The web app's call sounds (public/sounds), same files. */
enum class Sound(val res: Int) {
    Join(R.raw.sound_join),
    Leave(R.raw.sound_leave),
    Mute(R.raw.sound_mute),
    Unmute(R.raw.sound_unmute),
    Deafen(R.raw.sound_deafen),
    Undeafen(R.raw.sound_undeafen),
    StreamStart(R.raw.sound_stream_start),
    StreamEnd(R.raw.sound_stream_end),
}

/**
 * Plays [Sound]s. In a call they go out as part of the call's audio, so they follow it to the
 * earpiece, speaker or headset and use the call volume. Outside one (the sound for leaving)
 * they're ordinary interface sounds.
 */
class Sounds(context: Context) {
    private fun pool(usage: Int) = SoundPool.Builder()
        .setMaxStreams(3)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        .build()

    private val inCall = pool(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    private val outside = pool(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
    private val inCallIds = Sound.entries.associateWith { inCall.load(context, it.res, 1) }
    private val outsideIds = Sound.entries.associateWith { outside.load(context, it.res, 1) }

    fun play(sound: Sound, inCall: Boolean = true) {
        if (inCall) this.inCall.play(inCallIds.getValue(sound), VOLUME, VOLUME, 1, 0, 1f)
        else outside.play(outsideIds.getValue(sound), VOLUME, VOLUME, 1, 0, 1f)
    }

    private companion object {
        const val VOLUME = 0.8f
    }
}
