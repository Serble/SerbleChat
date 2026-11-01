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
        val lastChannel = stringPreferencesKey("last_channel")
        val noise = stringPreferencesKey("noise")
        val echo = stringPreferencesKey("echo")
        val agc = stringPreferencesKey("agc")
        val push = stringPreferencesKey("push")
    }

    val settings: Flow<LocalSettings> = context.settingsStore.data.map { p ->
        LocalSettings(
            noiseSuppression = p[K.noise]?.let { runCatching { NoiseSuppression.valueOf(it) }.getOrNull() } ?: NoiseSuppression.RnNoise,
            echoCancellation = p[K.echo] != "false",
            autoGainControl = p[K.agc] != "false",
            pushEnabled = p[K.push] != "false",
        )
    }

    suspend fun current(): LocalSettings = settings.first()

    suspend fun update(change: (LocalSettings) -> LocalSettings) {
        context.settingsStore.edit { p ->
            val now = settingsFrom(p)
            val next = change(now)
            p[K.noise] = next.noiseSuppression.name
            p[K.echo] = next.echoCancellation.toString()
            p[K.agc] = next.autoGainControl.toString()
            p[K.push] = next.pushEnabled.toString()
        }
    }

    private fun settingsFrom(p: Preferences) = LocalSettings(
        noiseSuppression = p[K.noise]?.let { runCatching { NoiseSuppression.valueOf(it) }.getOrNull() } ?: NoiseSuppression.RnNoise,
        echoCancellation = p[K.echo] != "false",
        autoGainControl = p[K.agc] != "false",
        pushEnabled = p[K.push] != "false",
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
            it.remove(K.lastChannel)
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

    /** The push endpoint last registered with the backend, so it can be unregistered when it changes. */
    suspend fun pushEndpoint(): String? = context.sessionStore.data.first()[K.pushEndpoint]
    suspend fun setPushEndpoint(url: String?) {
        context.sessionStore.edit { if (url == null) it.remove(K.pushEndpoint) else it[K.pushEndpoint] = url }
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
