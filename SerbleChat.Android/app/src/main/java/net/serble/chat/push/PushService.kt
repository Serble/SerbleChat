package net.serble.chat.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import kotlinx.coroutines.launch
import net.serble.chat.ChatApp
import net.serble.chat.data.AppJson
import net.serble.chat.data.PushPayload
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/** Receives UnifiedPush events: new endpoints, and the backend's (already decrypted) Web Push messages. */
class PushService : org.unifiedpush.android.connector.PushService() {
    private val app get() = application as ChatApp

    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        app.push.onNewEndpoint(endpoint)
    }

    override fun onMessage(message: PushMessage, instance: String) {
        if (!message.decrypted) {
            Log.w(TAG, "Dropped a push message that couldn't be decrypted")
            return
        }
        val payload = runCatching {
            AppJson.decodeFromString(PushPayload.serializer(), message.content.decodeToString())
        }.getOrElse {
            Log.w(TAG, "Unreadable push payload", it)
            return
        }
        // onMessage runs on the main thread; notifications may need an avatar from the network
        app.scope.launch { app.messageNotifications.onPush(payload) }
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        app.push.onRegistrationFailed(reason)
    }

    override fun onUnregistered(instance: String) {
        app.push.onUnregistered()
    }

    private companion object {
        const val TAG = "PushService"
    }
}

/** Handles the buttons on message notifications. */
class NotificationActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as ChatApp
        val channelId = intent.getLongExtra(EXTRA_CHANNEL, -1)
        if (channelId < 0) return
        val result = goAsync()
        app.scope.launch {
            try {
                when (intent.action) {
                    ACTION_REPLY -> {
                        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()
                        if (!text.isNullOrBlank()) app.messageNotifications.reply(channelId, text)
                    }
                    ACTION_MARK_READ -> app.messageNotifications.markRead(channelId)
                    ACTION_DISMISSED -> app.notifier.forget(channelId)
                }
            } finally {
                result.finish()
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "net.serble.chat.REPLY"
        const val ACTION_MARK_READ = "net.serble.chat.MARK_READ"
        const val ACTION_DISMISSED = "net.serble.chat.DISMISSED"
        const val EXTRA_CHANNEL = "channel"
    }
}
