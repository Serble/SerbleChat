package net.serble.chat.push

import android.util.Log
import androidx.core.app.Person
import net.serble.chat.data.Api
import net.serble.chat.data.ChannelType
import net.serble.chat.data.ChatStore
import net.serble.chat.data.Message
import net.serble.chat.data.PushPayload
import net.serble.chat.data.parseInstant
import net.serble.chat.data.plainText

/**
 * Turns messages (from push, or from the socket while the app is open) into notifications, and
 * carries out what the notification's buttons ask for.
 */
class MessageNotifications(
    private val store: ChatStore,
    private val api: Api,
    private val notifier: Notifier,
) {
    private val me: Person
        get() = Person.Builder().setKey(store.userId ?: "me").setName("You").build()

    suspend fun onPush(payload: PushPayload) {
        when (payload.type) {
            "message" -> {
                val m = payload.message ?: return
                val channelType = m.channel?.type ?: store.channel(m.channelId)?.type ?: ChannelType.GUILD
                show(
                    messageId = m.id,
                    channelId = m.channelId,
                    channelType = channelType,
                    channelName = m.channel?.name,
                    guildId = m.channel?.guildId,
                    authorId = m.authorId ?: "webhook",
                    authorName = m.author?.username ?: m.webhookUsername ?: store.users.value[m.authorId]?.username ?: "Someone",
                    content = if (m.contentHidden) null else m.content,
                    sentAt = parseInstant(m.createdAt)?.toEpochMilli() ?: System.currentTimeMillis(),
                )
            }
            "read" -> {
                val channelId = payload.channelId ?: return
                notifier.clearRead(channelId, payload.messageId ?: Long.MAX_VALUE)
            }
            else -> Log.i(TAG, "Ignored push of type ${payload.type}")
        }
    }

    /** A notification the server sent over the socket while we're connected. */
    fun onSocketNotification(message: Message) {
        val channel = store.channel(message.channelId)
        show(
            messageId = message.id,
            channelId = message.channelId,
            channelType = channel?.type ?: ChannelType.GUILD,
            channelName = channel?.name,
            guildId = channel?.guildId,
            authorId = message.authorId ?: "webhook",
            authorName = message.authorId?.let { store.users.value[it]?.username } ?: message.webhookUsername ?: "Someone",
            content = message.content,
            sentAt = message.sentAt.toEpochMilli(),
        )
    }

    private fun show(
        messageId: Long, channelId: Long, channelType: Int, channelName: String?, guildId: Long?,
        authorId: String, authorName: String, content: String?, sentAt: Long = System.currentTimeMillis(),
    ) {
        val myId = store.userId
        val mentioned = myId != null && content != null && content.contains("<@user:$myId>")
        val title = when (channelType) {
            ChannelType.DM -> null
            ChannelType.GROUP -> channelName ?: "Group chat"
            else -> {
                val guildName = guildId?.let { g -> store.guilds.value.firstOrNull { it.id == g }?.name }
                "#${channelName ?: "channel"}" + (guildName?.let { " · $it" } ?: "")
            }
        }
        val text = content?.let { plainText(it, store.users.value, store.roles.value.values.flatten(), store::channel) }
            ?.takeIf { it.isNotBlank() }
            ?: if (mentioned) "Mentioned you" else "New message"
        try {
            notifier.showMessage(
                IncomingNotification(messageId, channelId, channelType, title, authorId, authorName, text, mentioned, sentAt),
                me,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Couldn't show notification", e)
        }
    }

    suspend fun reply(channelId: Long, text: String) {
        try {
            api.sendMessage(channelId, text)
            notifier.appendReply(channelId, text, me)
        } catch (e: Exception) {
            Log.w(TAG, "Reply failed", e)
            notifier.appendReply(channelId, "⚠ Not sent: $text", me)
        }
    }

    suspend fun markRead(channelId: Long) {
        notifier.clearRead(channelId)
        try {
            val newest = api.messages(channelId, limit = 1).firstOrNull() ?: return
            api.markRead(channelId, newest.id)
        } catch (e: Exception) {
            Log.w(TAG, "Mark read failed", e)
        }
    }

    private companion object {
        const val TAG = "MessageNotifications"
    }
}
