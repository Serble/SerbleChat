package net.serble.chat.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * A theme's colours, with the same keys as the web app's THEME_PROPS, so themes made on either
 * one work on the other. Values are #rrggbb.
 */
@Serializable
data class ThemeColors(
    val bgBase: String = "#313338",
    val bgSecondary: String = "#2b2d31",
    val bgTertiary: String = "#1e1f22",
    val bgInput: String = "#383a40",
    val bgHover: String = "#2e3035",
    val bgActive: String = "#404249",
    val bgOverlay: String = "#111214",
    val bgUserPanel: String = "#232428",
    val bgVoicePanel: String = "#1e1f22",
    val border: String = "#1e1f22",
    val textPrimary: String = "#f2f3f5",
    val textSecondary: String = "#dbdee1",
    val textMuted: String = "#72767d",
    val textSubtle: String = "#4f5660",
    val textLink: String = "#7c9ef8",
    val accent: String = "#7c3aed",
    val accentHover: String = "#6d28d9",
    val danger: String = "#ed4245",
    val success: String = "#23a55a",
) {
    operator fun get(key: String): String = when (key) {
        "bgBase" -> bgBase; "bgSecondary" -> bgSecondary; "bgTertiary" -> bgTertiary; "bgInput" -> bgInput
        "bgHover" -> bgHover; "bgActive" -> bgActive; "bgOverlay" -> bgOverlay; "bgUserPanel" -> bgUserPanel
        "bgVoicePanel" -> bgVoicePanel; "border" -> border; "textPrimary" -> textPrimary
        "textSecondary" -> textSecondary; "textMuted" -> textMuted; "textSubtle" -> textSubtle
        "textLink" -> textLink; "accent" -> accent; "accentHover" -> accentHover; "danger" -> danger
        "success" -> success
        else -> error("Unknown theme key $key")
    }

    fun with(key: String, value: String): ThemeColors = when (key) {
        "bgBase" -> copy(bgBase = value); "bgSecondary" -> copy(bgSecondary = value)
        "bgTertiary" -> copy(bgTertiary = value); "bgInput" -> copy(bgInput = value)
        "bgHover" -> copy(bgHover = value); "bgActive" -> copy(bgActive = value)
        "bgOverlay" -> copy(bgOverlay = value); "bgUserPanel" -> copy(bgUserPanel = value)
        "bgVoicePanel" -> copy(bgVoicePanel = value); "border" -> copy(border = value)
        "textPrimary" -> copy(textPrimary = value); "textSecondary" -> copy(textSecondary = value)
        "textMuted" -> copy(textMuted = value); "textSubtle" -> copy(textSubtle = value)
        "textLink" -> copy(textLink = value); "accent" -> copy(accent = value)
        "accentHover" -> copy(accentHover = value); "danger" -> copy(danger = value)
        "success" -> copy(success = value)
        else -> this
    }
}

/** One editable colour, as the web app's theme editor lists them. */
data class ThemeProp(val key: String, val label: String, val group: String)

val THEME_PROPS = listOf(
    ThemeProp("bgBase", "Chat background", "Backgrounds"),
    ThemeProp("bgSecondary", "Sidebar background", "Backgrounds"),
    ThemeProp("bgTertiary", "Strip background", "Backgrounds"),
    ThemeProp("bgInput", "Message input", "Backgrounds"),
    ThemeProp("bgHover", "Hover state", "Backgrounds"),
    ThemeProp("bgActive", "Selected item", "Backgrounds"),
    ThemeProp("bgOverlay", "Menu / dialog background", "Backgrounds"),
    ThemeProp("bgUserPanel", "User panel background", "Backgrounds"),
    ThemeProp("bgVoicePanel", "Voice panel background", "Backgrounds"),
    ThemeProp("border", "Border / divider", "Backgrounds"),
    ThemeProp("textPrimary", "Primary text", "Text"),
    ThemeProp("textSecondary", "Secondary text", "Text"),
    ThemeProp("textMuted", "Muted text", "Text"),
    ThemeProp("textSubtle", "Subtle text", "Text"),
    ThemeProp("textLink", "Link / mention", "Text"),
    ThemeProp("accent", "Accent", "Accent"),
    ThemeProp("accentHover", "Accent hover", "Accent"),
    ThemeProp("danger", "Danger", "Status"),
    ThemeProp("success", "Success", "Status"),
)

val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")

@Serializable
data class AppTheme(val id: String, val name: String, val builtIn: Boolean = false, val colors: ThemeColors = ThemeColors())

/** What the web app keeps under "theme" in the account's client options. */
@Serializable
data class ThemeState(val activeId: String = "dark", val customThemes: List<AppTheme> = emptyList())

private val DARK = ThemeColors()

/** The web app's built-in themes, colour for colour. */
val BUILT_IN_THEMES = listOf(
    AppTheme("dark", "Dark", true, DARK),
    AppTheme("midnight", "Midnight", true, DARK.copy(
        bgBase = "#1a1b2e", bgSecondary = "#16213e", bgTertiary = "#0f3460",
        bgInput = "#1f2040", bgHover = "#1f2040", bgActive = "#2a2b4a",
        bgOverlay = "#0d0d1a", bgUserPanel = "#16213e", bgVoicePanel = "#0f3460", border = "#0f3460",
        textLink = "#a78bfa", accent = "#5b21b6", accentHover = "#4c1d95",
    )),
    AppTheme("forest", "Forest", true, DARK.copy(
        bgBase = "#1e2a1e", bgSecondary = "#192219", bgTertiary = "#111a11",
        bgInput = "#263526", bgHover = "#223022", bgActive = "#2e442e",
        bgOverlay = "#0e150e", bgUserPanel = "#1a251a", bgVoicePanel = "#111a11", border = "#111a11",
        textLink = "#86efac", accent = "#16a34a", accentHover = "#15803d",
    )),
    AppTheme("crimson", "Crimson", true, DARK.copy(
        bgBase = "#2a1a1a", bgSecondary = "#231515", bgTertiary = "#180e0e",
        bgInput = "#352020", bgHover = "#2e1f1f", bgActive = "#422525",
        bgOverlay = "#120a0a", bgUserPanel = "#1e1212", bgVoicePanel = "#180e0e", border = "#180e0e",
        textLink = "#fca5a5", accent = "#dc2626", accentHover = "#b91c1c",
    )),
    AppTheme("light", "Light", true, ThemeColors(
        bgBase = "#f0f2f5", bgSecondary = "#e3e5e8", bgTertiary = "#d4d7dc",
        bgInput = "#ffffff", bgHover = "#d9dce0", bgActive = "#c9cdd4",
        bgOverlay = "#ffffff", bgUserPanel = "#d4d7dc", bgVoicePanel = "#d4d7dc", border = "#c4c7cd",
        textPrimary = "#060607", textSecondary = "#2e3338", textMuted = "#4f5660",
        textSubtle = "#747f8d", textLink = "#5865f2",
        accent = "#5865f2", accentHover = "#4752c4",
        danger = "#d83c3e", success = "#248046",
    )),
)

/**
 * The account's themes, shared with the web app: they live under "theme" in the client options
 * blob, which also holds the web's other settings, so writes merge into it instead of replacing it.
 * A copy is kept on disk so the app opens in the right colours before the network answers.
 */
class ThemeStore(private val api: Api, private val cache: JsonCache, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(readLocal())
    val state: StateFlow<ThemeState> = _state.asStateFlow()

    val all: StateFlow<List<AppTheme>> = _state.map { BUILT_IN_THEMES + it.customThemes }
        .stateIn(scope, SharingStarted.Eagerly, BUILT_IN_THEMES + _state.value.customThemes)

    val active: StateFlow<AppTheme> = _state.map { resolve(it) }
        .stateIn(scope, SharingStarted.Eagerly, resolve(_state.value))

    private var saveJob: Job? = null
    /** Set while loading from the server, so applying what it says doesn't write it straight back. */
    @Volatile private var loading = false

    private fun resolve(s: ThemeState) = (BUILT_IN_THEMES + s.customThemes).firstOrNull { it.id == s.activeId } ?: BUILT_IN_THEMES[0]

    private fun readLocal(): ThemeState = cache.read(KEY)?.let {
        runCatching { AppJson.decodeFromString(ThemeState.serializer(), it) }.getOrNull()
    } ?: ThemeState()

    private fun set(next: ThemeState, push: Boolean = true) {
        _state.value = next
        cache.write(KEY, AppJson.encodeToString(ThemeState.serializer(), next))
        if (push && !loading) scheduleSave()
    }

    /** Pulls the account's themes, e.g. after signing in or coming back to the app. */
    suspend fun sync() {
        val blob = readBlob() ?: return
        val theme = blob["theme"] as? JsonObject ?: return
        val parsed = runCatching { AppJson.decodeFromJsonElement(ThemeState.serializer(), theme) }.getOrNull() ?: return
        loading = true
        try {
            // Themes saved by older web versions can lack colours added since: fill from Dark
            set(parsed.copy(customThemes = parsed.customThemes.map { it.copy(builtIn = false) }), push = false)
        } finally {
            loading = false
        }
    }

    fun reset() {
        saveJob?.cancel()
        set(ThemeState(), push = false)
    }

    fun activate(id: String) = set(_state.value.copy(activeId = id))

    /** Makes a new custom theme and returns its ID. */
    fun create(name: String, colors: ThemeColors): String {
        val id = "custom_${System.currentTimeMillis()}"
        set(_state.value.copy(customThemes = _state.value.customThemes + AppTheme(id, name, false, colors)))
        return id
    }

    fun update(id: String, name: String? = null, colors: ThemeColors? = null) {
        set(_state.value.copy(customThemes = _state.value.customThemes.map {
            if (it.id == id) it.copy(name = name ?: it.name, colors = colors ?: it.colors) else it
        }))
    }

    fun delete(id: String) {
        val s = _state.value
        set(s.copy(
            customThemes = s.customThemes.filterNot { it.id == id },
            activeId = if (s.activeId == id) "dark" else s.activeId,
        ))
    }

    /** The web app's export format: { name, colors }. */
    fun export(theme: AppTheme): String = AppJson.encodeToString(JsonObject.serializer(), buildJsonObject {
        put("name", JsonPrimitive(theme.name))
        put("colors", AppJson.encodeToJsonElement(ThemeColors.serializer(), theme.colors))
    })

    /** Imports a theme exported from either app; unknown or malformed colours keep the active theme's. */
    fun import(json: String, fallbackName: String = "Imported theme"): String {
        val obj = runCatching { AppJson.parseToJsonElement(json).jsonObject }.getOrNull()
            ?: throw IllegalArgumentException("That isn't a theme file.")
        val colors = obj["colors"] as? JsonObject ?: throw IllegalArgumentException("It has no \"colors\" in it.")
        var merged = active.value.colors
        var found = 0
        for ((key, value) in colors) {
            val hex = (value as? JsonPrimitive)?.contentOrNull ?: continue
            if (THEME_PROPS.any { it.key == key } && HEX_COLOR.matches(hex)) {
                merged = merged.with(key, hex.lowercase())
                found++
            }
        }
        if (found == 0) throw IllegalArgumentException("No valid colours in it.")
        val name = (obj["name"] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } ?: fallbackName
        return create(name, merged)
    }

    private suspend fun readBlob(): JsonObject? {
        val raw = runCatching { api.raw("GET", "/account/client-options") }.getOrElse {
            Log.w(TAG, "Couldn't load client options: ${it.message}")
            return null
        }.trim()
        if (raw.isEmpty()) return JsonObject(emptyMap())
        // Usually the options object itself; older responses wrap it in a JSON string
        return runCatching {
            val element = AppJson.parseToJsonElement(raw)
            if (element is JsonPrimitive && element.isString) AppJson.parseToJsonElement(element.content).jsonObject
            else element.jsonObject
        }.getOrDefault(JsonObject(emptyMap()))
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(1000)
            try {
                // Read-modify-write: the blob holds the web app's other settings too
                val blob = readBlob() ?: return@launch
                val merged = JsonObject(blob + ("theme" to AppJson.encodeToJsonElement(ThemeState.serializer(), _state.value)))
                api.raw("PUT", "/account/client-options", JsonPrimitive(merged.toString()).toString())
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't save themes: ${e.message}")
            }
        }
    }

    private companion object {
        const val TAG = "ThemeStore"
        const val KEY = "theme"
    }
}
