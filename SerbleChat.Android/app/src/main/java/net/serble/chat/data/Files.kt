package net.serble.chat.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicLong

/** What the backend says about connecting to Serble Files. See the backend's FilesConnectResponse. */
@Serializable
data class FilesConnectResponse(val status: String = "", val code: String? = null, val consentUrl: String? = null, val message: String? = null)

@Serializable
data class FilesAccount(val id: String = "", val username: String = "", val isAdmin: Boolean = false, val isBanned: Boolean = false)

/** -1 means no limit. */
@Serializable
data class FilesLimits(
    val noExpirySingleFileSize: Long = 0,
    val expirySingleFileSize: Long = 0,
    val maxExpiryHours: Long = 0,
    val accountFilesSize: Long = 0,
)

@Serializable
data class FilesUsage(val usedStorage: Long = 0)

@Serializable
private data class FilesAuthResponse(val accessToken: String? = null)

@Serializable
private data class UploadedFile(val id: String = "")

@Serializable
private data class FileCreateResponse(val file: UploadedFile? = null, val uploadUrl: String = "", val uploadFields: Map<String, String> = emptyMap())

/** Whether this phone can upload to the user's Serble Files account, and if not, why. */
sealed interface FilesStatus {
    data object Idle : FilesStatus
    data object Connecting : FilesStatus
    data object Connected : FilesStatus
    /** Serble wants the user to allow SerbleChat to sign them in to Files first. */
    data class ConsentRequired(val consentUrl: String, val message: String? = null) : FilesStatus
    data class Denied(val message: String) : FilesStatus
    /** The user's Serble sign-in behind SerbleChat is gone: signing in again fixes it. */
    data class ReauthRequired(val message: String) : FilesStatus
    /** Couldn't reach Serble or Files. Retried automatically after a while. */
    data class Unavailable(val message: String) : FilesStatus

    /** Needs the user to act, so automatic connects leave it alone. */
    val needsUser get() = this is ConsentRequired || this is Denied || this is ReauthRequired
}

/** A file picked for the next message. `expirationHours` null means it never expires. */
data class Attachment(
    val localId: Long,
    val uri: Uri,
    val name: String,
    val size: Long,
    val mimeType: String?,
    val expirationHours: Long? = null,
    val error: String? = null,
)

data class ChannelUploads(val items: List<Attachment> = emptyList(), val uploading: Boolean = false)

/**
 * Serble Files: the connection (cross-app sign-in through the backend, no second login) and the
 * attachment queue for each channel. Uploads run in the app's scope, so leaving the chat doesn't
 * stop them; the message is sent once every file in it has uploaded.
 */
class Files(
    private val baseUrl: String,
    private val http: OkHttpClient,
    private val api: Api,
    private val settings: SettingsStore,
    private val store: ChatStore,
    private val resolver: ContentResolver,
    private val scope: CoroutineScope,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val mutex = Mutex()
    private val localIds = AtomicLong()
    @Volatile private var token: String? = null
    @Volatile private var failedAt = 0L
    @Volatile private var verified: String? = null

    private val _status = MutableStateFlow<FilesStatus>(FilesStatus.Idle)
    val status: StateFlow<FilesStatus> = _status.asStateFlow()

    private val _uploads = MutableStateFlow<Map<Long, ChannelUploads>>(emptyMap())
    val uploads: StateFlow<Map<Long, ChannelUploads>> = _uploads.asStateFlow()

    private val _limits = MutableStateFlow<FilesLimits?>(null)
    /** The limits uploads are checked against: the account's, or the guest ones when not connected. */
    val limits: StateFlow<FilesLimits?> = _limits.asStateFlow()

    fun fileUrl(id: String) = "${baseUrl.trimEnd('/')}/files/$id"

    // ── Connection ──────────────────────────────────────────────────────────────────────

    /**
     * A usable Files token, connecting first if there isn't one; null when Files can't be
     * connected right now (the status says why). Automatic calls skip a status that needs the
     * user; `force` always tries.
     */
    suspend fun token(force: Boolean = false): String? = mutex.withLock {
        if (token == null) token = settings.filesToken()
        val current = token
        if (!force && current != null && fresh(current)) {
            if (verified == current) return current
            // Checked once per run: uploads and limits accept anonymous calls, so a token Files no
            // longer accepts would otherwise quietly turn uploads into guest ones.
            try {
                call("GET", "/account", null, current)
                verified = current
                if (_status.value !is FilesStatus.Connected) _status.value = FilesStatus.Connected
                return current
            } catch (e: ApiException) {
                if (e.status != 401) { verified = current; return current }
                setToken(null)
            }
        }
        val s = _status.value
        if (!force && s.needsUser) return null
        if (!force && s is FilesStatus.Unavailable && System.currentTimeMillis() - failedAt < 30_000) return null

        _status.value = FilesStatus.Connecting
        try {
            val r = api.filesSignInCode()
            if (r.status == "ok" && r.code != null) {
                val auth = AppJson.decodeFromString<FilesAuthResponse>(
                    call("POST", "/account", buildJsonObject { put("code", r.code) }.toString(), null))
                val newToken = auth.accessToken ?: throw ApiException(500, "Serble Files didn't return a token.")
                token = newToken
                verified = newToken
                settings.setFilesToken(newToken)
                _status.value = FilesStatus.Connected
                scope.launch { refreshLimits() }
                return newToken
            }
            setToken(null)
            _status.value = when (r.status) {
                "consent_required" -> if (r.consentUrl != null) FilesStatus.ConsentRequired(r.consentUrl)
                    else FilesStatus.Unavailable(r.message ?: "Serble asked for permission but didn't say where.")
                "denied" -> FilesStatus.Denied(r.message ?: "Serble Files won't accept SerbleChat right now.")
                "reauth_required" -> FilesStatus.ReauthRequired(r.message ?: "Sign in to SerbleChat again to use Serble Files.")
                else -> FilesStatus.Unavailable(r.message ?: "Couldn't connect to Serble Files.")
            }
            if (_status.value is FilesStatus.Unavailable) failedAt = System.currentTimeMillis()
            null
        } catch (e: ApiException) {
            setToken(null)
            failedAt = System.currentTimeMillis()
            _status.value = if (e.status == 403) FilesStatus.Denied(e.message ?: "Your Serble Files account can't be used.")
                else FilesStatus.Unavailable(e.message ?: "Couldn't connect to Serble Files.")
            null
        }
    }

    /** Connects in the background if not connected yet. */
    fun ensureConnected() {
        scope.launch {
            token()
            if (_limits.value == null) refreshLimits()
        }
    }

    /** Try again now, for a button. */
    suspend fun reconnect(): Boolean = token(force = true) != null

    private suspend fun setToken(value: String?) {
        token = value
        settings.setFilesToken(value)
    }

    /** Builds the Serble page that asks the user to allow SerbleChat into Files, remembering its state. */
    suspend fun consentUrl(redirectUri: String): Uri? {
        val url = (_status.value as? FilesStatus.ConsentRequired)?.consentUrl ?: return null
        val state = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        settings.setFilesConsentState(state)
        return Uri.parse(url).buildUpon()
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("state", state)
            .build()
    }

    /** The user came back from the consent page. Returns a message to show. */
    suspend fun finishConsent(uri: Uri): String {
        val expected = settings.filesConsentState()
        settings.setFilesConsentState(null)
        if (expected == null || uri.getQueryParameter("state") != expected) return "That didn't match a request from this app. Try again from Settings."
        if (uri.getQueryParameter("error") != null || uri.getQueryParameter("target") == null) {
            (_status.value as? FilesStatus.ConsentRequired)?.let { _status.value = it.copy(message = "Access to Serble Files wasn't allowed.") }
            return "Access to Serble Files wasn't allowed."
        }
        return if (reconnect()) "Serble Files connected" else statusMessage(_status.value)
    }

    fun clear() {
        token = null
        verified = null
        _status.value = FilesStatus.Idle
        _uploads.value = emptyMap()
        _limits.value = null
    }

    private fun fresh(jwt: String): Boolean {
        val exp = runCatching {
            val payload = String(Base64.decode(jwt.split(".")[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            AppJson.parseToJsonElement(payload).jsonObject["exp"]?.jsonPrimitive?.longOrNull
        }.getOrNull() ?: return true
        return exp - 120 > System.currentTimeMillis() / 1000
    }

    // ── Files API ───────────────────────────────────────────────────────────────────────

    private suspend fun call(method: String, path: String, body: String?, auth: String?): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        auth?.let { builder.header("Authorization", "Bearer $it") }
        builder.method(method, body?.toRequestBody(jsonType) ?: if (method == "POST") "".toRequestBody(jsonType) else null)
        val response = try {
            http.newCall(builder.build()).await()
        } catch (e: IOException) {
            throw ApiException(0, "Serble Files can't be reached.")
        }
        response.use {
            val text = runCatching { it.body.string() }.getOrDefault("")
            if (!it.isSuccessful) throw ApiException(it.code, filesMessage(text, it.code))
            text
        }
    }

    /** Runs `fn` with a token (null: anonymous), replacing a token the API rejects once. */
    private suspend fun <T> withToken(fn: suspend (String?) -> T): T {
        val t = token()
        return try {
            fn(t)
        } catch (e: ApiException) {
            if (e.status != 401 || t == null) throw e
            mutex.withLock { if (token == t) setToken(null) }
            val again = token(force = true) ?: throw e
            fn(again)
        }
    }

    suspend fun account(): FilesAccount = withToken { t -> AppJson.decodeFromString<FilesAccount>(call("GET", "/account", null, t)) }
    suspend fun usage(): FilesUsage = withToken { t -> AppJson.decodeFromString<FilesUsage>(call("GET", "/limits/usage", null, t)) }

    suspend fun refreshLimits(): FilesLimits? = runCatching {
        withToken { t -> AppJson.decodeFromString<FilesLimits>(call("GET", "/limits", null, t)) }
    }.getOrNull()?.also {
        _limits.value = it
        requireExpiries(it)
    }

    /** Gives an expiry to queued files that now need one (limits arrived, or changed on connecting). */
    private fun requireExpiries(limits: FilesLimits) = _uploads.update { all ->
        all.mapValues { (_, c) ->
            if (c.uploading) c else c.copy(items = c.items.map {
                if (it.expirationHours == null && expiryRequired(it.size, limits)) it.copy(expirationHours = 1) else it
            })
        }
    }

    private fun filesMessage(body: String, code: Int): String {
        val fromBody = runCatching { AppJson.parseToJsonElement(body).jsonObject["message"]?.jsonPrimitive?.content }.getOrNull()
        if (!fromBody.isNullOrBlank()) return fromBody
        if (body.isNotBlank() && !body.trimStart().startsWith("{") && !body.trimStart().startsWith("<") && body.length < 300) return body.trim().removeSurrounding("\"")
        return when (code) {
            401 -> "Serble Files didn't accept the sign-in."
            403 -> "Serble Files refused the upload."
            413 -> "That file is too big."
            else -> "Serble Files had a problem (HTTP $code)."
        }
    }

    // ── Attachments ─────────────────────────────────────────────────────────────────────

    /** Adds picked files to a channel's next message. */
    fun attach(channelId: Long, uris: List<Uri>) {
        if (uris.isEmpty()) return
        ensureConnected()
        scope.launch {
            val picked = withContext(Dispatchers.IO) { uris.mapNotNull { describe(it) } }
            val limits = _limits.value ?: refreshLimits()
            _uploads.update { all ->
                val current = all[channelId] ?: ChannelUploads()
                val added = picked.map { a -> if (expiryRequired(a.size, limits)) a.copy(expirationHours = 1) else a }
                all + (channelId to current.copy(items = current.items.map { it.copy(error = null) } + added))
            }
        }
    }

    fun remove(channelId: Long, localId: Long) = _uploads.update { all ->
        val current = all[channelId] ?: return@update all
        all + (channelId to current.copy(items = current.items.filterNot { it.localId == localId }))
    }

    fun setExpiry(channelId: Long, localId: Long, hours: Long?) = _uploads.update { all ->
        val current = all[channelId] ?: return@update all
        all + (channelId to current.copy(items = current.items.map { if (it.localId == localId) it.copy(expirationHours = hours, error = null) else it }))
    }

    /**
     * Uploads the channel's attachments, then sends `text` with their links. If any upload fails
     * nothing is sent: the files stay queued with their errors, and the caller keeps the text.
     */
    fun send(channelId: Long, text: String, onDone: (sent: Boolean) -> Unit = {}) {
        val queued = _uploads.value[channelId]?.takeIf { it.items.isNotEmpty() && !it.uploading } ?: run {
            store.sendMessage(channelId, text); onDone(true); return
        }
        _uploads.update { it + (channelId to queued.copy(uploading = true, items = queued.items.map { a -> a.copy(error = null) })) }
        scope.launch {
            val links = mutableListOf<String>()
            val errors = mutableMapOf<Long, String>()
            val limits = _limits.value ?: refreshLimits()
            for (a in queued.items) {
                try {
                    validate(a, limits)
                    links += fileUrl(upload(a))
                } catch (e: ApiException) {
                    errors[a.localId] = e.message ?: "Upload failed"
                } catch (e: Exception) {
                    errors[a.localId] = e.message ?: "Upload failed"
                }
            }
            if (errors.isEmpty()) {
                _uploads.update { it - channelId }
                val content = if (text.isBlank()) links.joinToString("\n") else "$text\n\n" + links.joinToString("\n")
                store.sendMessage(channelId, content)
                withContext(Dispatchers.Main) { onDone(true) }
            } else {
                _uploads.update { all ->
                    val current = all[channelId] ?: queued
                    all + (channelId to current.copy(uploading = false, items = current.items.map { it.copy(error = errors[it.localId]) }))
                }
                withContext(Dispatchers.Main) { onDone(false) }
            }
        }
    }

    private fun validate(a: Attachment, limits: FilesLimits?) {
        if (a.expirationHours == null && expiryRequired(a.size, limits)) throw ApiException(400, "This file is too big to keep forever. Pick when it expires.")
        val hours = a.expirationHours ?: return
        if (hours < 1) throw ApiException(400, "Expiry must be at least an hour.")
        if (limits != null && limits.maxExpiryHours != -1L && hours > limits.maxExpiryHours)
            throw ApiException(400, "Expiry can be at most ${limits.maxExpiryHours} hours.")
    }

    /** Returns the new file's id. */
    private suspend fun upload(a: Attachment): String {
        val created = withToken { t ->
            AppJson.decodeFromString<FileCreateResponse>(call("POST", "/files", buildJsonObject {
                put("fileName", a.name)
                put("fileSize", a.size)
                put("expirationHours", a.expirationHours)
            }.toString(), t))
        }
        val id = created.file?.id?.takeIf { it.isNotEmpty() } ?: throw ApiException(500, "Serble Files didn't return a file id.")

        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
        created.uploadFields.forEach { (k, v) -> form.addFormDataPart(k, v) }
        form.addFormDataPart("file", a.name, UriBody(resolver, a.uri, a.mimeType?.toMediaTypeOrNull(), a.size))
        withContext(Dispatchers.IO) {
            val response = try {
                http.newBuilder().writeTimeout(0, java.util.concurrent.TimeUnit.SECONDS).build()
                    .newCall(Request.Builder().url(created.uploadUrl).post(form.build()).build()).await()
            } catch (e: IOException) {
                throw ApiException(0, "The upload was interrupted.")
            }
            response.use { if (!it.isSuccessful) throw ApiException(it.code, "The upload failed (HTTP ${it.code}).") }
        }
        return id
    }

    private fun describe(uri: Uri): Attachment? {
        var name: String? = null
        var size: Long? = null
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) }
                    c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                }
            }
        }
        val bytes = size ?: runCatching { resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull()?.takeIf { it >= 0 }
            ?: return null
        return Attachment(localIds.incrementAndGet(), uri, name ?: uri.lastPathSegment ?: "file", bytes, resolver.getType(uri))
    }

    companion object {
        /** Whether a file must expire under these limits (-1 unlimited, 0 or unknown: always). */
        fun expiryRequired(size: Long, limits: FilesLimits?): Boolean {
            val max = limits?.noExpirySingleFileSize ?: return false
            if (max == -1L) return false
            return max == 0L || size > max
        }

        fun statusMessage(s: FilesStatus): String = when (s) {
            is FilesStatus.ConsentRequired -> s.message ?: "Serble needs your permission before SerbleChat can use Serble Files."
            is FilesStatus.Denied -> s.message
            is FilesStatus.ReauthRequired -> s.message
            is FilesStatus.Unavailable -> s.message
            FilesStatus.Connected -> "Connected"
            else -> "Connecting…"
        }

        const val ANON_HINT = "Uploads are anonymous and use the guest limits until this is sorted."
    }
}

/** Streams a picked file straight from its provider, so big files never sit in memory. */
private class UriBody(private val resolver: ContentResolver, private val uri: Uri, private val type: MediaType?, private val length: Long) : RequestBody() {
    override fun contentType() = type
    override fun contentLength() = length
    override fun writeTo(sink: BufferedSink) {
        val input = resolver.openInputStream(uri) ?: throw IOException("The file can't be read any more.")
        input.source().use { sink.writeAll(it) }
    }
}

/** Human sizes, as the web app shows them. */
fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = listOf("B", "KiB", "MiB", "GiB", "TiB")
    var value = bytes.toDouble()
    var i = 0
    while (value >= 1024 && i < units.size - 1) { value /= 1024; i++ }
    return if (i == 0) "$bytes B" else "%.2f %s".format(value, units[i]).replace(".00 ", " ")
}
