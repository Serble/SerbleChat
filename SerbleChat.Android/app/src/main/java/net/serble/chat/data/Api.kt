package net.serble.chat.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A refusal or failure, with a message fit to show. */
class ApiException(val status: Int, message: String) : Exception(message) {
    val offline get() = status == 0
}

/**
 * The backend's REST API over plain OkHttp. Every call runs on the IO dispatcher, body included.
 */
class Api(
    val baseUrl: String,
    val client: OkHttpClient,
    private val token: () -> String?,
    private val onUnauthorized: () -> Unit,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun raw(method: String, path: String, body: String? = null, auth: Boolean = true): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        if (auth) token()?.let { builder.header("Authorization", "Bearer $it") }
        val requestBody = when {
            body != null -> body.toRequestBody(jsonType)
            method == "POST" || method == "PUT" || method == "PATCH" -> "".toRequestBody(jsonType)
            else -> null
        }
        builder.method(method, requestBody)

        val response = try {
            client.newCall(builder.build()).await()
        } catch (e: IOException) {
            throw ApiException(0, "You're offline, or the server can't be reached.")
        }

        response.use {
            val text = try {
                it.body.string()
            } catch (e: IOException) {
                throw ApiException(0, "The connection dropped. Try again.")
            }
            if (!it.isSuccessful) {
                if (it.code == 401 && auth && token() != null) onUnauthorized()
                throw ApiException(it.code, messageOf(text, it.code))
            }
            text
        }
    }

    suspend inline fun <reified T> get(path: String): T = AppJson.decodeFromString(serializer<T>(), raw("GET", path))
    suspend inline fun <reified T> post(path: String, body: JsonObject? = null): T =
        AppJson.decodeFromString(serializer<T>(), raw("POST", path, body?.toString()))

    suspend fun send(method: String, path: String, body: JsonObject? = null) {
        raw(method, path, body?.toString())
    }

    private fun messageOf(body: String, code: Int): String {
        // The backend answers refusals with a plain string, or ASP.NET's problem details
        val trimmed = body.trim()
        if (trimmed.isNotEmpty() && !trimmed.startsWith("{") && !trimmed.startsWith("<") && trimmed.length < 300) {
            return trimmed.removeSurrounding("\"")
        }
        val fromBody = runCatching {
            val obj = AppJson.parseToJsonElement(body).jsonObject
            (obj["message"] ?: obj["title"])?.jsonPrimitive?.content
        }.getOrNull()
        if (!fromBody.isNullOrBlank() && fromBody != "Bad Request") return fromBody
        return when (code) {
            401 -> "Your session has ended. Sign in again."
            403 -> "You're not allowed to do that."
            404 -> "That couldn't be found."
            429 -> "Slow down a little."
            else -> "Something went wrong. Try again."
        }
    }

    // ── Auth and account ────────────────────────────────────────────────────────────────

    suspend fun exchangeCode(code: String): String {
        val response = AppJson.decodeFromString<AuthResponse>(
            raw("POST", "/auth", buildJsonObject { put("code", code) }.toString(), auth = false))
        return response.accessToken ?: throw ApiException(400, "Sign-in failed.")
    }

    /** A Serble Files sign-in code (cross-app sign-in), or what has to happen first. */
    suspend fun filesSignInCode(): FilesConnectResponse = post("/auth/files")

    suspend fun vapidPublicKey(): String = raw("GET", "/auth/vapid-public-key", auth = false).trim().removeSurrounding("\"")

    suspend fun account(): Account = get("/account")
    suspend fun user(id: String): User = get("/account/${q(id)}")
    suspend fun userByName(username: String): User = get("/account/from-username/${q(username)}")
    suspend fun unreads(): Map<String, Int> = get("/account/unreads")
    suspend fun blocks(): List<User> = get("/account/blocks")
    suspend fun block(id: String) = send("POST", "/account/blocks/${q(id)}")
    suspend fun unblock(id: String) = send("DELETE", "/account/blocks/${q(id)}")

    suspend fun updateAccount(body: JsonObject) = send("PATCH", "/account", body)

    suspend fun setStatus(type: String, message: String?, expiresAt: String?) = send("PUT", "/account/status", buildJsonObject {
        put("type", type)
        put("message", message)
        put("expiresAt", expiresAt)
    })

    suspend fun clearStatus() = send("DELETE", "/account/status")
    suspend fun expireStatus() = send("POST", "/account/status/expire")

    suspend fun registerPush(url: String, p256dh: String, auth: String) = send("POST", "/account/web-push-subscription", buildJsonObject {
        put("url", url)
        put("p256dh", p256dh)
        put("auth", auth)
        put("kind", "unifiedpush")
    })

    /** Tells the server a pushed notification went up at [shownAt] (this phone's clock). Only used for delivery statistics. */
    suspend fun ackDelivery(id: String, shownAt: Long) = raw("POST", "/notifications/ack/${q(id)}?shownAt=$shownAt", auth = false)

    suspend fun unregisterPush(url: String) {
        try {
            send("DELETE", "/account/web-push-subscription", buildJsonObject { put("url", url) })
        } catch (e: ApiException) {
            if (e.status != 404) throw e
        }
    }

    // ── Friends ─────────────────────────────────────────────────────────────────────────

    suspend fun friends(): List<Friendship> = get("/friends")
    suspend fun addFriend(id: String) = send("POST", "/friends/${q(id)}")
    suspend fun removeFriend(id: String) = send("DELETE", "/friends/${q(id)}")

    // ── Channels and messages ───────────────────────────────────────────────────────────

    suspend fun channel(id: Long): Channel = get("/channel/$id")
    suspend fun channelMembers(id: Long): List<User> = get("/channel/$id/members")
    suspend fun dms(): List<DmChannel> = get("/channel/dm")
    suspend fun openDm(userId: String): Channel = get("/channel/dm/${q(userId)}")
    suspend fun groupMemberships(): List<GroupMembership> = get("/channel/group")
    suspend fun group(id: Long): GroupChat = get("/channel/group/$id")
    suspend fun createGroup(name: String, users: List<String>): GroupChat = post("/channel/group", buildJsonObject {
        put("name", name)
        putJsonArray("users") { users.forEach { add(JsonPrimitive(it)) } }
    })

    suspend fun addGroupMembers(groupId: Long, users: List<String>) = send("POST", "/channel/group/$groupId/members", buildJsonObject {
        putJsonArray("userIds") { users.forEach { add(JsonPrimitive(it)) } }
    })

    suspend fun leaveGroup(groupId: Long) = send("DELETE", "/channel/group/$groupId")

    /** Newest first. */
    suspend fun messages(channelId: Long, limit: Int = 50, before: Long? = null, after: Long? = null): List<Message> {
        val query = buildString {
            append("?limit=$limit")
            before?.let { append("&before=$it") }
            after?.let { append("&after=$it") }
        }
        return get("/channel/$channelId/messages$query")
    }

    suspend fun message(channelId: Long, id: Long): Message = get("/channel/$channelId/messages/$id")
    /** The server answers with nothing; the message itself arrives as a NewMessage event. */
    suspend fun sendMessage(channelId: Long, content: String) =
        send("POST", "/channel/$channelId", buildJsonObject { put("content", content) })

    suspend fun editMessage(channelId: Long, id: Long, content: String) =
        send("PUT", "/channel/$channelId/message/$id", buildJsonObject { put("content", content) })

    suspend fun deleteMessage(channelId: Long, id: Long) = send("DELETE", "/channel/$channelId/message/$id")
    suspend fun markRead(channelId: Long, messageId: Long) = send("POST", "/channel/$channelId/messages/$messageId/read")

    suspend fun channelNotifPrefs(channelId: Long): ChannelNotifPrefs = get("/channel/$channelId/notification-preferences")
    suspend fun setChannelNotifPrefs(channelId: Long, prefs: ChannelNotifPrefs) =
        send("PUT", "/channel/$channelId/notification-preferences", AppJson.encodeToJsonElement(ChannelNotifPrefs.serializer(), prefs).jsonObject)

    suspend fun voiceToken(channelId: Long): String = post<TokenResponse>("/channel/$channelId/voice").token
    suspend fun voiceUsers(channelId: Long): VoiceUsers = get("/channel/$channelId/voice")

    // ── Polls ───────────────────────────────────────────────────────────────────────────

    suspend fun createPoll(channelId: Long, question: String, options: List<String>, allowMultiple: Boolean, durationSeconds: Long?) =
        send("POST", "/channel/$channelId/poll", buildJsonObject {
            put("question", question)
            putJsonArray("options") { options.forEach { add(JsonPrimitive(it)) } }
            put("allowMultiple", allowMultiple)
            put("durationSeconds", durationSeconds)
        })

    suspend fun vote(channelId: Long, pollId: Long, optionIds: List<Long>) =
        send("PUT", "/channel/$channelId/poll/$pollId/vote", buildJsonObject {
            putJsonArray("optionIds") { optionIds.forEach { add(JsonPrimitive(it)) } }
        })

    suspend fun closePoll(channelId: Long, pollId: Long) = send("POST", "/channel/$channelId/poll/$pollId/close")

    // ── Guilds ──────────────────────────────────────────────────────────────────────────

    suspend fun guilds(): List<Guild> = get("/guild")
    suspend fun guild(id: Long): Guild = get("/guild/$id")
    suspend fun createGuild(name: String): Guild = post("/guild", buildJsonObject { put("name", name) })
    suspend fun renameGuild(id: Long, name: String) = send("PATCH", "/guild/$id", buildJsonObject { put("name", name) })
    suspend fun deleteGuild(id: Long) = send("DELETE", "/guild/$id")
    suspend fun leaveGuild(id: Long) = send("POST", "/guild/$id/leave")
    suspend fun guildChannels(id: Long): List<GuildChannel> = get("/guild/$id/channel")
    suspend fun guildMembers(id: Long): List<GuildMember> = get("/guild/$id/members")
    suspend fun guildRoles(id: Long): List<Role> = get("/guild/$id/roles")
    suspend fun myPermissions(guildId: Long): Permissions = get("/guild/$guildId/my-permissions")
    suspend fun myChannelPermissions(guildId: Long, channelId: Long): Permissions = get("/guild/$guildId/channel/$channelId/my-permissions")

    suspend fun createChannel(guildId: Long, name: String, voice: Boolean): Channel =
        post("/guild/$guildId/channel", buildJsonObject {
            put("name", name)
            put("voiceCapable", voice)
        })

    suspend fun updateChannel(guildId: Long, channelId: Long, name: String, voice: Boolean) =
        send("PATCH", "/guild/$guildId/channel/$channelId", buildJsonObject {
            put("name", name)
            put("voiceCapable", voice)
        })

    suspend fun deleteChannel(guildId: Long, channelId: Long) = send("DELETE", "/guild/$guildId/channel/$channelId")

    suspend fun createInvite(guildId: Long): Invite = post("/guild/$guildId/invite")
    suspend fun invites(guildId: Long): List<Invite> = get("/guild/$guildId/invite")
    suspend fun deleteInvite(id: String) = send("DELETE", "/guild/invite/${q(id)}")
    suspend fun invite(id: String): Invite = get("/guild/invite/${q(id)}")
    suspend fun acceptInvite(id: String) = send("POST", "/guild/invite/${q(id)}/accept")

    suspend fun kick(guildId: Long, userId: String) = send("POST", "/guild/$guildId/members/${q(userId)}/kick")

    suspend fun guildNotifPrefs(guildId: Long): NotifPrefs = get<GuildNotifPrefsResponse>("/guild/$guildId/notification-preferences").preferences
    suspend fun setGuildNotifPrefs(guildId: Long, prefs: NotifPrefs) =
        send("PUT", "/guild/$guildId/notification-preferences", AppJson.encodeToJsonElement(NotifPrefs.serializer(), prefs).jsonObject)

    companion object {
        fun q(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")
    }
}

inline fun <reified T> JsonObject.decode(): T = AppJson.decodeFromJsonElement(this)

/** Runs the call on OkHttp's own threads and cancels it when the coroutine is cancelled. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = continuation.resume(response)
        override fun onFailure(call: Call, e: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(e)
        }
    })
    continuation.invokeOnCancellation { runCatching { cancel() } }
}
