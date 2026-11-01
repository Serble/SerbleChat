package net.serble.chat.voice

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import net.serble.chat.ChatApp
import net.serble.chat.MainActivity
import net.serble.chat.R
import net.serble.chat.push.Notifier

/**
 * Foreground service for the duration of a call: Android stops apps from using the microphone in
 * the background without one. Its notification shows the call and has mute and leave buttons.
 */
class CallService : Service() {
    private val app get() = application as ChatApp
    private var watcher: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_LEAVE -> app.voice.leave()
            ACTION_MUTE -> app.voice.toggleMute()
        }
        val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        ServiceCompat.startForeground(this, Notifier.CALL_NOTIFICATION_ID, notification(), type)
        if (watcher == null) {
            watcher = app.scope.launch {
                app.voice.call.collect { call ->
                    if (call == null) return@collect
                    val nm = getSystemService(android.app.NotificationManager::class.java)
                    nm.notify(Notifier.CALL_NOTIFICATION_ID, notification())
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        watcher?.cancel()
        super.onDestroy()
    }

    private fun notification(): android.app.Notification {
        val call = app.voice.call.value
        val channel = call?.let { app.store.channel(it.channelId) }
        val title = channel?.let { app.store.channelTitle(it) } ?: "Voice"
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = call?.let { Uri.parse("serblechat://channel/${it.channelId}") }
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        fun action(name: String) = PendingIntent.getService(this, name.hashCode(),
            Intent(this, CallService::class.java).setAction(name), PendingIntent.FLAG_IMMUTABLE)
        val status = when {
            call == null -> "Connecting…"
            call.phase == CallPhase.Connecting -> "Connecting…"
            call.phase == CallPhase.Reconnecting -> "Reconnecting…"
            call.deafened -> "Deafened"
            call.muted -> "Muted"
            else -> "In call"
        }
        return NotificationCompat.Builder(this, Notifier.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(title)
            .setContentText(status)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .addAction(0, if (call?.muted == true) "Unmute" else "Mute", action(ACTION_MUTE))
            .addAction(0, "Leave", action(ACTION_LEAVE))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        const val ACTION_LEAVE = "net.serble.chat.LEAVE_CALL"
        const val ACTION_MUTE = "net.serble.chat.MUTE"
    }
}
