package net.serble.chat.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import net.serble.chat.MainActivity
import net.serble.chat.R
import net.serble.chat.data.ChannelType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** One message to show, already turned into plain text. */
data class IncomingNotification(
    val messageId: Long,
    val channelId: Long,
    val channelType: Int,
    /** "#general (My Guild)" or the group's name; null for DMs. */
    val conversationTitle: String?,
    val authorId: String,
    val authorName: String,
    val text: String,
    val mentioned: Boolean,
    val sentAt: Long,
)

/**
 * Posts message notifications as conversations: one per channel, with the recent messages stacked
 * in it, an inline reply and a "mark read" action. Android groups them in the conversations
 * section because each one has a long-lived sharing shortcut.
 */
class Notifier(private val context: Context, private val http: OkHttpClient, private val avatarOf: (String) -> AvatarSource) {
    /** Where a user's avatar is: [url] is null when they have none; [version] as in [net.serble.chat.data.ImageVersion]. */
    data class AvatarSource(val url: String?, val version: Long)

    private val manager = NotificationManagerCompat.from(context)
    private val avatars = ConcurrentHashMap<String, IconCompat>()
    private val avatarFetches = ConcurrentHashMap.newKeySet<String>()
    private val avatarClient = http.newBuilder().callTimeout(10, TimeUnit.SECONDS).build()
    private val avatarDir = java.io.File(context.cacheDir, "notification-avatars")

    fun createChannels() {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannelGroup(NotificationChannelGroup(GROUP_MESSAGES, "Messages"))
        fun channel(id: String, name: String, importance: Int, description: String, group: String? = GROUP_MESSAGES) =
            NotificationChannel(id, name, importance).apply {
                this.description = description
                group?.let { this.group = it }
            }
        nm.createNotificationChannels(listOf(
            channel(CHANNEL_DMS, "Direct messages", NotificationManager.IMPORTANCE_HIGH, "Messages sent to you directly"),
            channel(CHANNEL_GROUPS, "Group chats", NotificationManager.IMPORTANCE_HIGH, "Messages in group chats"),
            channel(CHANNEL_MENTIONS, "Mentions", NotificationManager.IMPORTANCE_HIGH, "When someone mentions you in a guild"),
            channel(CHANNEL_GUILDS, "Guild messages", NotificationManager.IMPORTANCE_DEFAULT, "Guild channels set to notify for every message"),
            channel(CHANNEL_CALLS, "Ongoing call", NotificationManager.IMPORTANCE_LOW, "Shown while you're in a voice channel", group = null),
            channel(CHANNEL_GENERAL, "Other", NotificationManager.IMPORTANCE_DEFAULT, "Friend requests and the like", group = null),
        ))
    }

    private fun canPost(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** One line of a conversation's notification; replies of ours have no message ID (-1). */
    private class Line(val id: Long, val text: CharSequence, val time: Long, var person: Person)

    private class Conversation(val channelId: Long, val me: Person) {
        var title: String? = null
        var type: Int = ChannelType.DM
        var mentioned = false
        var shortcutId = "channel_$channelId"
        var alert = false
        val lines = mutableListOf<Line>()
        val messageIds get() = lines.filter { it.id >= 0 }.map { it.id }
    }

    // The conversations as we last posted them. Kept here rather than read back from the posted
    // notifications: posting is asynchronous, so a read straight after a post sees the old one, and a
    // burst of messages would overwrite each other.
    private val conversations = HashMap<Long, Conversation>()
    private val pending = HashMap<Long, Job>()
    private val lastPosted = HashMap<Long, Long>()
    private val postScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** After the process restarts, picks up a conversation still showing from before. */
    private fun restore(channelId: Long, me: Person): Conversation? {
        val existing = manager.activeNotifications.firstOrNull { it.id == notificationId(channelId) }?.notification ?: return null
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(existing) ?: return null
        val ids = existing.extras.getLongArray(EXTRA_IDS)?.sorted() ?: emptyList()
        val conv = Conversation(channelId, me)
        conv.title = style.conversationTitle?.toString()
        conv.type = existing.extras.getInt(EXTRA_TYPE, ChannelType.DM)
        // IDs and messages are both oldest first; pair them from the newest end
        val msgs = style.messages.sortedBy { it.timestamp }
        msgs.forEachIndexed { i, m ->
            val id = ids.getOrNull(ids.size - msgs.size + i) ?: -1
            conv.lines += Line(id, m.text ?: "", m.timestamp, m.person ?: me)
        }
        return conv
    }

    /**
     * Shows a message straight away. The author's avatar comes from memory or disk; if we don't have it yet the
     * notification goes up with their initials and is quietly updated once the avatar has downloaded. Waiting for the
     * download first cost up to a second on every push that started the app.
     */
    fun showMessage(n: IncomingNotification, me: Person) {
        if (!canPost()) return
        val source = if (n.authorId == WEBHOOK_AUTHOR) null else avatarOf(n.authorId)
        val cached = source?.let { cachedAvatar(n.authorId, it) }
        val author = person(n.authorId, n.authorName, cached ?: initialsIcon(n.authorName))
        synchronized(this) {
            val conv = conversations.getOrPut(n.channelId) { restore(n.channelId, me) ?: Conversation(n.channelId, me) }
            if (conv.lines.any { it.id == n.messageId }) return  // the same message from push and from the socket
            conv.lines += Line(n.messageId, n.text, n.sentAt, author)
            // Pushes can arrive out of order; show the conversation in the order it was written
            conv.lines.sortBy { it.time }
            conv.title = n.conversationTitle
            conv.type = n.channelType
            conv.mentioned = conv.mentioned || n.mentioned
            conv.shortcutId = pushShortcut(n, author)
            conv.alert = true
            schedule(conv)
        }
        if (cached == null && source?.url != null) fetchAvatar(n.authorId, n.authorName, source)
    }

    private fun person(key: String, name: String, icon: IconCompat): Person =
        Person.Builder().setKey(key).setName(name).setIcon(icon).build()

    /** Adds the user's own reply to a conversation's notification, which also ends the reply spinner. */
    @Synchronized
    fun appendReply(channelId: Long, text: String, me: Person) {
        if (!canPost()) return
        val conv = conversations[channelId] ?: restore(channelId, me)?.also { conversations[channelId] = it } ?: return
        conv.lines += Line(-1, text, System.currentTimeMillis(), me)
        schedule(conv)
    }

    /** Removes what's been read: the whole notification, unless newer messages came in since. */
    @Synchronized
    fun clearRead(channelId: Long, upTo: Long = Long.MAX_VALUE) {
        val conv = conversations[channelId] ?: restore(channelId, Person.Builder().setName("You").build())
        if (conv == null || conv.messageIds.all { it <= upTo }) {
            forget(channelId)
            manager.cancel(notificationId(channelId))
            return
        }
        // Keep only what's still unread, and our replies after the first of it
        val firstUnread = conv.lines.first { it.id > upTo }.time
        conv.lines.removeAll { (it.id in 0..upTo) || (it.id < 0 && it.time < firstUnread) }
        conv.alert = false
        conversations[channelId] = conv
        schedule(conv)
    }

    /** The user dismissed the notification: start afresh next time. */
    @Synchronized
    fun forget(channelId: Long) {
        conversations.remove(channelId)
        pending.remove(channelId)?.cancel()
    }

    /**
     * Posts a conversation, at most four times a second per conversation. Android drops updates
     * from an app that posts faster than that, which would leave the notification out of date.
     */
    private fun schedule(conv: Conversation) {
        val channelId = conv.channelId
        pending.remove(channelId)?.cancel()
        val since = SystemClock.uptimeMillis() - (lastPosted[channelId] ?: 0L)
        if (since >= MIN_GAP_MS) post(conv)
        else pending[channelId] = postScope.launch {
            delay(MIN_GAP_MS - since)
            synchronized(this@Notifier) {
                if (conversations[channelId] === conv) post(conv)
            }
        }
    }

    private fun post(conv: Conversation) {
        val ids = conv.messageIds
        if (ids.isEmpty()) {
            forget(conv.channelId)
            manager.cancel(notificationId(conv.channelId))
            return
        }
        val style = NotificationCompat.MessagingStyle(conv.me)
        style.conversationTitle = conv.title
        style.isGroupConversation = conv.type != ChannelType.DM
        // The newest few; a busy channel would otherwise grow without end
        conv.lines.takeLast(MAX_MESSAGES).forEach { style.addMessage(NotificationCompat.MessagingStyle.Message(it.text, it.time, it.person)) }
        val channel = when {
            conv.type == ChannelType.DM -> CHANNEL_DMS
            conv.type == ChannelType.GROUP -> CHANNEL_GROUPS
            conv.mentioned -> CHANNEL_MENTIONS
            else -> CHANNEL_GUILDS
        }
        // Tapping jumps to the oldest unread message, so reading starts there
        val notification = baseBuilder(conv.channelId, ids.min(), channel, conv.shortcutId)
            .setStyle(style)
            .setWhen(conv.lines.last().time)
            .setNumber(ids.size)
            .setOnlyAlertOnce(!conv.alert)
            .addExtras(android.os.Bundle().apply {
                putLongArray(EXTRA_IDS, ids.toLongArray())
                putInt(EXTRA_TYPE, conv.type)
            })
            .build()
        conv.alert = false
        manager.notify(notificationId(conv.channelId), notification)
        lastPosted[conv.channelId] = SystemClock.uptimeMillis()
    }

    fun showInfo(title: String, text: String) {
        if (!canPost()) return
        val notification = NotificationCompat.Builder(context, CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openApp(null))
            .build()
        manager.notify((title + text).hashCode(), notification)
    }

    private fun baseBuilder(channelId: Long, messageId: Long, notificationChannel: String, shortcutId: String): NotificationCompat.Builder {
        val reply = RemoteInput.Builder(KEY_REPLY).setLabel("Message").build()
        val replyAction = NotificationCompat.Action.Builder(
            IconCompat.createWithResource(context, R.drawable.ic_notification), "Reply",
            actionIntent(NotificationActions.ACTION_REPLY, channelId, mutable = true))
            .addRemoteInput(reply)
            .setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
        val readAction = NotificationCompat.Action.Builder(
            IconCompat.createWithResource(context, R.drawable.ic_notification), "Mark read",
            actionIntent(NotificationActions.ACTION_MARK_READ, channelId, mutable = false))
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
        return NotificationCompat.Builder(context, notificationChannel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF7C3AED.toInt())
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShortcutId(shortcutId)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY)
            .setContentIntent(openApp(channelId, messageId))
            .setDeleteIntent(actionIntent(NotificationActions.ACTION_DISMISSED, channelId, mutable = false))
            .addAction(replyAction)
            .addAction(readAction)
    }

    private fun openApp(channelId: Long?, messageId: Long? = null): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = channelId?.let { Uri.parse("serblechat://channel/$it" + (messageId?.let { m -> "?message=$m" } ?: "")) }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(context, (channelId ?: 0).toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun actionIntent(action: String, channelId: Long, mutable: Boolean): PendingIntent {
        val intent = Intent(context, NotificationActions::class.java).apply {
            this.action = action
            putExtra(NotificationActions.EXTRA_CHANNEL, channelId)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, (action.hashCode() * 31 + channelId).toInt(), intent, flags)
    }

    private fun pushShortcut(n: IncomingNotification, author: Person): String =
        pushShortcut(n.channelId, n.channelType, n.conversationTitle ?: n.authorName, author)

    private fun pushShortcut(channelId: Long, channelType: Int, label: String, author: Person): String {
        val id = "channel_$channelId"
        val shortcut = ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(label.take(24))
            .setLongLabel(label)
            .setLongLived(true)
            .setCategories(setOf("net.serble.chat.CONVERSATION"))
            .setIntent(Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("serblechat://channel/${channelId}")
            })
            .apply {
                if (channelType == ChannelType.DM) {
                    setPerson(author)
                    author.icon?.let { setIcon(it) }
                } else {
                    setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                }
            }
            .build()
        runCatching { ShortcutManagerCompat.pushDynamicShortcut(context, shortcut) }
        return id
    }

    /** The avatar from memory or the disk cache, without touching the network. Null if we've never fetched it. */
    private fun cachedAvatar(userId: String, source: AvatarSource): IconCompat? {
        if (source.url == null) return null  // they have none: initials
        val key = cacheKey(userId, source)
        avatars[key]?.let { return it }
        val file = avatarFile(key)
        val bitmap = runCatching { BitmapFactory.decodeFile(file.path) }.getOrNull() ?: return null
        val icon = IconCompat.createWithBitmap(bitmap)
        avatars[key] = icon
        // A versioned copy is right for good. Without a version, refresh it now and then in case it changed.
        if (source.version <= 0 && System.currentTimeMillis() - file.lastModified() > AVATAR_MAX_AGE_MS) fetchAvatar(userId, null, source)
        return icon
    }

    /** A new version is a new key, so a changed picture is fetched rather than the old one shown. */
    private fun cacheKey(userId: String, source: AvatarSource) = if (source.version > 0) "$userId-v${source.version}" else userId

    private fun initialsIcon(name: String): IconCompat = IconCompat.createWithBitmap(circle(initials(name)))

    private fun avatarFile(key: String) = java.io.File(avatarDir, key.filter { it.isLetterOrDigit() || it == '-' } + ".png")

    /**
     * Downloads an avatar (or settles on initials when they don't have one), keeps it on disk, and updates any
     * notification showing that author.
     */
    private fun fetchAvatar(userId: String, name: String?, source: AvatarSource) {
        val url = source.url ?: return
        val key = cacheKey(userId, source)
        if (!avatarFetches.add(key)) return
        postScope.launch(Dispatchers.IO) {
            try {
                val downloaded = runCatching {
                    avatarClient.newCall(Request.Builder().url(url).build()).execute().use { r ->
                        when {
                            r.isSuccessful -> BitmapFactory.decodeStream(r.body.byteStream())?.let(::circle)
                            r.code == 404 -> NO_AVATAR
                            else -> null
                        }
                    }
                }.getOrNull() ?: return@launch  // offline or a server error: try again next time
                val authorName = name ?: return@launch  // a refresh that found no avatar keeps the cached one
                val bitmap = if (downloaded === NO_AVATAR) circle(initials(authorName)) else downloaded
                runCatching {
                    avatarDir.mkdirs()
                    avatarFile(key).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
                val icon = IconCompat.createWithBitmap(bitmap)
                avatars[key] = icon
                if (downloaded !== NO_AVATAR) refreshAuthor(userId, icon)
            } finally {
                avatarFetches.remove(key)
            }
        }
    }

    /** Swaps in an author's avatar on the notifications showing them, without alerting again. */
    @Synchronized
    private fun refreshAuthor(userId: String, icon: IconCompat) {
        for (conv in conversations.values) {
            var changed = false
            for (line in conv.lines) {
                val p = line.person
                if (p.key == userId) {
                    line.person = person(userId, p.name?.toString() ?: "", icon)
                    changed = true
                }
            }
            if (!changed) continue
            if (conv.type == ChannelType.DM) {
                conv.lines.lastOrNull { it.person.key == userId }?.let { line ->
                    conv.shortcutId = pushShortcut(conv.channelId, conv.type, conv.title ?: line.person.name?.toString() ?: "", line.person)
                }
            }
            schedule(conv)
        }
    }

    private fun initials(name: String): Bitmap {
        val size = 128
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val hue = (name.hashCode() and 0x7fffffff) % 360
        canvas.drawColor(android.graphics.Color.HSVToColor(floatArrayOf(hue.toFloat(), 0.45f, 0.75f)))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = 60f
            textAlign = Paint.Align.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        val letter = name.firstOrNull()?.uppercase() ?: "?"
        canvas.drawText(letter, size / 2f, size / 2f - (paint.descent() + paint.ascent()) / 2, paint)
        return bmp
    }

    private fun circle(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        val left = (src.width - size) / 2
        val top = (src.height - size) / 2
        canvas.drawBitmap(src, Rect(left, top, left + size, top + size), Rect(0, 0, size, size), paint)
        return out
    }

    companion object {
        const val CHANNEL_DMS = "dms"
        const val CHANNEL_GROUPS = "groups"
        const val CHANNEL_MENTIONS = "mentions"
        const val CHANNEL_GUILDS = "guilds"
        const val CHANNEL_CALLS = "calls"
        const val CHANNEL_GENERAL = "general"
        const val GROUP_MESSAGES = "messages"
        const val GROUP_KEY = "net.serble.chat.MESSAGES"
        const val KEY_REPLY = "reply"
        const val EXTRA_IDS = "net.serble.chat.message_ids"
        const val EXTRA_TYPE = "net.serble.chat.channel_type"
        const val CALL_NOTIFICATION_ID = 1
        private const val MAX_MESSAGES = 12
        private const val MIN_GAP_MS = 250L
        private const val AVATAR_MAX_AGE_MS = 24 * 60 * 60 * 1000L
        private const val WEBHOOK_AUTHOR = "webhook"
        /** Marks "they have no avatar" apart from "couldn't fetch it". */
        private val NO_AVATAR: Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

        fun notificationId(channelId: Long): Int = (channelId xor (channelId ushr 32)).toInt().let { if (it == CALL_NOTIFICATION_ID) -1 else it }
    }
}
