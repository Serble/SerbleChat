package net.serble.chat.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.File

/** How the microphone is cleaned up in calls. */
enum class NoiseSuppression(val label: String, val detail: String) {
    RnNoise("RNNoise", "A neural network that removes background noise, like the web app. Best quality."),
    WebRtc("Standard", "WebRTC's built-in noise suppression. Lighter, less thorough."),
    Off("Off", "Your microphone as it is."),
}

/** What this phone has set. Account-wide settings live on the server. */
data class LocalSettings(
    val noiseSuppression: NoiseSuppression = NoiseSuppression.RnNoise,
    val echoCancellation: Boolean = true,
    val autoGainControl: Boolean = true,
    /** Off means the user turned push off on this phone. */
    val pushEnabled: Boolean = true,
    /** The joined, left, muted, deafened and stream sounds in calls. */
    val callSounds: Boolean = true,
    /** User IDs whose stream (screen share) audio we've muted. */
    val mutedStreams: Set<String> = emptySet(),
)

// Two stores on purpose: the session holds the sign-in token and is excluded from backups
// (res/xml/backup_rules.xml); the settings are harmless to restore onto a new phone.
private val Context.sessionStore by preferencesDataStore("session")
private val Context.settingsStore by preferencesDataStore("settings")

class SettingsStore(private val context: Context) {
    private object K {
        val token = stringPreferencesKey("token")
        val userId = stringPreferencesKey("user_id")
        val oauthState = stringPreferencesKey("oauth_state")
        val pushEndpoint = stringPreferencesKey("push_endpoint")
        val pushKeys = stringPreferencesKey("push_keys")
        val pushRegisteredAt = stringPreferencesKey("push_registered_at")
        val vapidKey = stringPreferencesKey("vapid_key")
        val lastChannel = stringPreferencesKey("last_channel")
        val noise = stringPreferencesKey("noise")
        val echo = stringPreferencesKey("echo")
        val agc = stringPreferencesKey("agc")
        val push = stringPreferencesKey("push")
        val sounds = stringPreferencesKey("sounds")
        val mutedStreams = stringPreferencesKey("muted_streams")
        val filesToken = stringPreferencesKey("files_token")
        val filesConsentState = stringPreferencesKey("files_consent_state")
    }

    val settings: Flow<LocalSettings> = context.settingsStore.data.map { p -> settingsFrom(p) }

    suspend fun current(): LocalSettings = settings.first()

    suspend fun update(change: (LocalSettings) -> LocalSettings) {
        context.settingsStore.edit { p ->
            val now = settingsFrom(p)
            val next = change(now)
            p[K.noise] = next.noiseSuppression.name
            p[K.echo] = next.echoCancellation.toString()
            p[K.agc] = next.autoGainControl.toString()
            p[K.push] = next.pushEnabled.toString()
            p[K.sounds] = next.callSounds.toString()
            p[K.mutedStreams] = next.mutedStreams.joinToString(",")
        }
    }

    private fun settingsFrom(p: Preferences) = LocalSettings(
        noiseSuppression = p[K.noise]?.let { runCatching { NoiseSuppression.valueOf(it) }.getOrNull() } ?: NoiseSuppression.RnNoise,
        echoCancellation = p[K.echo] != "false",
        autoGainControl = p[K.agc] != "false",
        pushEnabled = p[K.push] != "false",
        callSounds = p[K.sounds] != "false",
        mutedStreams = p[K.mutedStreams]?.split(',')?.filter { it.isNotBlank() }?.toSet() ?: emptySet(),
    )

    data class Session(val token: String?, val userId: String?)

    suspend fun session(): Session {
        val p = context.sessionStore.data.first()
        return Session(p[K.token], p[K.userId])
    }

    suspend fun saveSession(token: String, userId: String) {
        context.sessionStore.edit {
            it[K.token] = token
            it[K.userId] = userId
        }
    }

    suspend fun clearSession() {
        context.sessionStore.edit {
            it.remove(K.token)
            it.remove(K.userId)
            it.remove(K.oauthState)
            it.remove(K.pushEndpoint)
            it.remove(K.pushKeys)
            it.remove(K.pushRegisteredAt)
            it.remove(K.vapidKey)
            it.remove(K.lastChannel)
            it.remove(K.filesToken)
            it.remove(K.filesConsentState)
        }
    }

    /** The channel that was open last, so the app reopens on it. */
    suspend fun lastChannel(): Long? = context.sessionStore.data.first()[K.lastChannel]?.toLongOrNull()
    suspend fun setLastChannel(id: Long?) {
        context.sessionStore.edit { if (id == null) it.remove(K.lastChannel) else it[K.lastChannel] = id.toString() }
    }

    suspend fun oauthState(): String? = context.sessionStore.data.first()[K.oauthState]
    suspend fun setOauthState(state: String?) {
        context.sessionStore.edit { if (state == null) it.remove(K.oauthState) else it[K.oauthState] = state }
    }

    /** This phone's Serble Files token: obtained through the backend, so it lives with the session. */
    suspend fun filesToken(): String? = context.sessionStore.data.first()[K.filesToken]
    suspend fun setFilesToken(token: String?) {
        context.sessionStore.edit { if (token == null) it.remove(K.filesToken) else it[K.filesToken] = token }
    }

    suspend fun filesConsentState(): String? = context.sessionStore.data.first()[K.filesConsentState]
    suspend fun setFilesConsentState(state: String?) {
        context.sessionStore.edit { if (state == null) it.remove(K.filesConsentState) else it[K.filesConsentState] = state }
    }

    /** The push endpoint last registered with the backend, so it can be unregistered when it changes. */
    suspend fun pushEndpoint(): String? = context.sessionStore.data.first()[K.pushEndpoint]
    suspend fun setPushEndpoint(url: String?) {
        context.sessionStore.edit {
            if (url == null) {
                it.remove(K.pushEndpoint)
                it.remove(K.pushKeys)
                it.remove(K.pushRegisteredAt)
            } else {
                it[K.pushEndpoint] = url
            }
        }
    }

    /** What was last registered with the backend and when, so a push waking the app doesn't register again. */
    data class PushRegistration(val endpoint: String?, val keys: String?, val registeredAt: Long)

    suspend fun pushRegistration(): PushRegistration {
        val p = context.sessionStore.data.first()
        return PushRegistration(p[K.pushEndpoint], p[K.pushKeys], p[K.pushRegisteredAt]?.toLongOrNull() ?: 0L)
    }

    suspend fun setPushRegistration(endpoint: String, keys: String, registeredAt: Long) {
        context.sessionStore.edit {
            it[K.pushEndpoint] = endpoint
            it[K.pushKeys] = keys
            it[K.pushRegisteredAt] = registeredAt.toString()
        }
    }

    /** The server's VAPID public key, cached so registering doesn't need a request every time. */
    suspend fun vapidKey(): String? = context.sessionStore.data.first()[K.vapidKey]
    suspend fun setVapidKey(key: String) {
        context.sessionStore.edit { it[K.vapidKey] = key }
    }
}

/** Small JSON files on disk, so the app opens straight onto what it showed last time. */
class JsonCache(root: File) {
    private val dir = File(root, "state").apply { mkdirs() }

    fun read(key: String): String? {
        val file = File(dir, "$key.json")
        return if (file.exists()) runCatching { file.readText() }.getOrNull() else null
    }

    fun write(key: String, text: String) {
        runCatching {
            val file = File(dir, "$key.json")
            val tmp = File(dir, "$key.json.tmp")
            tmp.writeText(text)
            tmp.renameTo(file)
        }
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }
}
