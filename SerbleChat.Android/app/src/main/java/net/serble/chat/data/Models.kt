package net.serble.chat.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * The backend writes dates read back from the database without a zone ("2026-02-24T14:30:00"),
 * and fresh ones with a Z. Both are UTC.
 */
fun parseInstant(value: String?): Instant? {
    if (value.isNullOrBlank()) return null
    return try {
        Instant.parse(value)
    } catch (_: DateTimeParseException) {
        try {
            LocalDateTime.parse(value).toInstant(ZoneOffset.UTC)
        } catch (_: DateTimeParseException) {
            null
        }
    }
}

object ChannelType {
    const val GUILD = 0
    const val DM = 1
    const val GROUP = 2
}

/** Values of NotificationPreference on the backend. */
object NotifyLevel {
    const val INHERIT = 0
    const val ALL = 1
    const val MENTIONS = 2
    const val NOTHING = 3
}

@Serializable
data class NotifPrefs(val notifications: Int = NotifyLevel.INHERIT, val unreads: Int = NotifyLevel.INHERIT)

@Serializable
data class Account(
    val id: String,
    val username: String,
    val isAdmin: Boolean = false,
    val createdAt: String = "",
    val defaultDmNotificationPreferences: NotifPrefs = NotifPrefs(NotifyLevel.ALL, NotifyLevel.ALL),
    val defaultGroupNotificationPreferences: NotifPrefs = NotifPrefs(NotifyLevel.MENTIONS, NotifyLevel.ALL),
    val defaultGuildNotificationPreferences: NotifPrefs = NotifPrefs(NotifyLevel.MENTIONS, NotifyLevel.ALL),
    val notificationsWhileOnline: Boolean = false,
    val notificationsWhileAway: Boolean = true,
    val webPushIncludeContent: Boolean = true,
    val blurb: String = "",
    val color: String = "",
    val statusType: String = "online",
    val statusMessage: String = "",
    val statusExpiresAt: String? = null,
)

@Serializable
data class User(
    val id: String,
    val username: String,
    val isAdmin: Boolean = false,
    val isBanned: Boolean = false,
    val createdAt: String = "",
    val isOnline: Boolean = false,
    val blurb: String = "",
    val color: String = "",
    val status: String = "offline",
    val statusMessage: String = "",
    val statusExpiresAt: String? = null,
)

@Serializable
data class Channel(
    val id: Long,
    val createdAt: String = "",
    val guildId: Long? = null,
    val type: Int = ChannelType.GUILD,
    val name: String = "",
    val voiceCapable: Boolean = false,
)

@Serializable
data class Guild(
    val id: Long,
    val name: String,
    val createdAt: String = "",
    val ownerId: String = "",
)

@Serializable
data class GuildChannel(val channelId: Long, val guildId: Long, val index: Int = 0, val channel: Channel)

@Serializable
data class DmChannel(val channelId: Long, val user1Id: String, val user2Id: String, val channel: Channel) {
    fun otherUser(me: String) = if (user1Id == me) user2Id else user1Id
}

@Serializable
data class GroupMembership(val userId: String, val groupChatId: Long)

@Serializable
data class GroupChat(val channelId: Long, val ownerId: String, val channel: Channel)

@Serializable
data class Friendship(
    val id: Long,
    val createdAt: String = "",
    val user1Id: String,
    val user2Id: String,
    val pending: Boolean,
) {
    fun other(me: String) = if (user1Id == me) user2Id else user1Id

    /** user1 is the one who sent the request. */
    fun incoming(me: String) = pending && user2Id == me
}

@Serializable
data class PollOption(val id: Long, val text: String, val voterIds: List<String> = emptyList())

@Serializable
data class Poll(
    val id: Long,
    val messageId: Long,
    val channelId: Long,
    val authorId: String,
    val question: String,
    val allowMultiple: Boolean = false,
    val createdAt: String = "",
    val expiresAt: String? = null,
    val closedAt: String? = null,
    val options: List<PollOption> = emptyList(),
) {
    fun ended(now: Instant = Instant.now()): Boolean =
        closedAt != null || (parseInstant(expiresAt)?.isBefore(now) ?: false)
}

@Serializable
data class Message(
    val id: Long,
    val channelId: Long,
    val createdAt: String = "",
    val authorId: String? = null,
    val webhookId: Long? = null,
    val webhookUsername: String? = null,
    val webhookAvatarUrl: String? = null,
    val content: String = "",
    val editedAt: String? = null,
    val poll: Poll? = null,
) {
    val sentAt: Instant by lazy { parseInstant(createdAt) ?: Instant.EPOCH }
}

/** A message the user sent that the server hasn't confirmed yet. */
data class PendingMessage(val localId: Long, val channelId: Long, val content: String, val failed: Boolean = false)

/** PermissionState: 0 Allow, 1 Deny, 2 Inherit. */
@Serializable
data class Permissions(
    val administrator: Int = 2,
    val manageGuild: Int = 2,
    val manageRoles: Int = 2,
    val manageChannels: Int = 2,
    val kickMembers: Int = 2,
    val banMembers: Int = 2,
    val createInvites: Int = 2,
    val sendMessages: Int = 2,
    val manageMessages: Int = 2,
    val joinVoice: Int = 2,
    val speak: Int = 2,
    val muteMembers: Int = 2,
    val deafenMembers: Int = 2,
    val moveMembers: Int = 2,
    val videoStream: Int = 2,
    val viewChannel: Int = 2,
    val createPolls: Int = 2,
    val manageWebhooks: Int = 2,
) {
    private fun allowed(state: Int) = administrator == 0 || state == 0
    val canManageGuild get() = allowed(manageGuild)
    val canManageChannels get() = allowed(manageChannels)
    val canKick get() = allowed(kickMembers)
    val canBan get() = allowed(banMembers)
    val canInvite get() = allowed(createInvites)
    val canSend get() = allowed(sendMessages)
    val canManageMessages get() = allowed(manageMessages)
    val canJoinVoice get() = allowed(joinVoice)
    val canSpeak get() = allowed(speak)
    val canCreatePolls get() = allowed(createPolls)

    companion object {
        /** Outside guilds (DMs and groups) everything a member can do is allowed. */
        val Everything = Permissions(administrator = 0)
    }
}

@Serializable
data class GuildMember(val user: User, val color: String = "")

@Serializable
data class Role(
    val id: Long,
    val guildId: Long,
    val priority: Int = 0,
    val color: String = "",
    val name: String,
    val displaySeparately: Boolean = false,
    val mentionable: Boolean = false,
)

@Serializable
data class Invite(val id: String, val guildId: Long, val guild: Guild? = null)

@Serializable
data class VoiceState(val userId: String, val muted: Boolean = false, val deafened: Boolean = false)

@Serializable
data class VoiceUsers(val users: List<String> = emptyList(), val states: List<VoiceState> = emptyList())

@Serializable
data class TokenResponse(val token: String)

@Serializable
data class AuthResponse(val success: Boolean = false, val accessToken: String? = null)

@Serializable
data class UnreadCount(val count: Int = 0)

@Serializable
data class ChannelNotifPrefs(val notifications: Int = 0, val unreads: Int = 0)

@Serializable
data class GuildNotifPrefsResponse(val preferences: NotifPrefs = NotifPrefs())

/** What the push payload carries. snake_case, unlike the REST API. */
@Serializable
data class PushPayload(
    val type: String,
    val message: PushMessageBody? = null,
    @kotlinx.serialization.SerialName("channel_id") val channelId: Long? = null,
    @kotlinx.serialization.SerialName("message_id") val messageId: Long? = null,
)

@Serializable
data class PushMessageBody(
    val id: Long,
    @kotlinx.serialization.SerialName("channel_id") val channelId: Long,
    @kotlinx.serialization.SerialName("author_id") val authorId: String? = null,
    val content: String? = null,
    @kotlinx.serialization.SerialName("content_hidden") val contentHidden: Boolean = false,
    @kotlinx.serialization.SerialName("created_at") val createdAt: String? = null,
    @kotlinx.serialization.SerialName("webhook_username") val webhookUsername: String? = null,
    val author: PushUser? = null,
    val channel: PushChannel? = null,
)

@Serializable
data class PushUser(val id: String, val username: String)

@Serializable
data class PushChannel(
    val id: Long,
    val name: String = "",
    val type: Int = 0,
    @kotlinx.serialization.SerialName("guild_id") val guildId: Long? = null,
)
