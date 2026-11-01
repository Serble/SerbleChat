package net.serble.chat.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import net.serble.chat.data.ThemeColors

/** The web theme's colours that Material's scheme has no slot for, plus a few derived ones. */
@Immutable
data class ChatColors(
    val dark: Boolean,
    val base: Color,
    val panel: Color,
    val rail: Color,
    val input: Color,
    val hover: Color,
    val active: Color,
    val overlay: Color,
    val userPanel: Color,
    val voicePanel: Color,
    val border: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val textSubtle: Color,
    val link: Color,
    val accent: Color,
    val onAccent: Color,
    val danger: Color,
    val success: Color,
    val online: Color,
    val away: Color,
    val dnd: Color,
    val offline: Color,
    val mention: Color,
    val mentionBg: Color,
    val codeBg: Color,
    val muted: Color,
)

val LocalChatColors = staticCompositionLocalOf { chatColors(ThemeColors()) }

fun hex(value: String, fallback: Color = Color.Magenta): Color {
    val clean = value.trim().removePrefix("#")
    val v = clean.toLongOrNull(16) ?: return fallback
    return when (clean.length) {
        6 -> Color(0xFF000000 or v)
        3 -> {
            val r = (v shr 8) and 0xF; val g = (v shr 4) and 0xF; val b = v and 0xF
            Color(0xFF000000 or (r * 17 shl 16) or (g * 17 shl 8) or (b * 17))
        }
        else -> fallback
    }
}

/** Black or white, whichever reads better on [background]. */
fun contrastOn(background: Color): Color = if (background.luminance() > 0.45f) Color(0xFF060607) else Color.White

fun chatColors(t: ThemeColors): ChatColors {
    val base = hex(t.bgBase)
    val accent = hex(t.accent)
    val link = hex(t.textLink)
    val danger = hex(t.danger)
    val success = hex(t.success)
    return ChatColors(
        dark = base.luminance() < 0.5f,
        base = base,
        panel = hex(t.bgSecondary),
        rail = hex(t.bgTertiary),
        input = hex(t.bgInput),
        hover = hex(t.bgHover),
        active = hex(t.bgActive),
        overlay = hex(t.bgOverlay),
        userPanel = hex(t.bgUserPanel),
        voicePanel = hex(t.bgVoicePanel),
        border = hex(t.border),
        textPrimary = hex(t.textPrimary),
        textSecondary = hex(t.textSecondary),
        textMuted = hex(t.textMuted),
        textSubtle = hex(t.textSubtle),
        link = link,
        accent = accent,
        onAccent = contrastOn(accent),
        danger = danger,
        success = success,
        online = success,
        // Away has no theme colour on the web either
        away = Color(0xFFF0B232),
        dnd = danger,
        offline = hex(t.textSubtle),
        mention = link,
        mentionBg = accent.copy(alpha = 0.18f),
        codeBg = hex(t.bgTertiary),
        muted = hex(t.textMuted),
    )
}

@Composable
fun SerbleChatTheme(colors: ThemeColors, content: @Composable () -> Unit) {
    val chat = remember(colors) { chatColors(colors) }
    val scheme = remember(chat) {
        val base = if (chat.dark) darkColorScheme() else lightColorScheme()
        base.copy(
            primary = chat.accent,
            onPrimary = chat.onAccent,
            primaryContainer = chat.accent,
            onPrimaryContainer = chat.onAccent,
            inversePrimary = chat.link,
            secondary = chat.textMuted,
            onSecondary = chat.base,
            secondaryContainer = chat.active,
            onSecondaryContainer = chat.textPrimary,
            tertiary = chat.link,
            onTertiary = contrastOn(chat.link),
            tertiaryContainer = chat.active,
            onTertiaryContainer = chat.textPrimary,
            background = chat.base,
            onBackground = chat.textPrimary,
            surface = chat.base,
            onSurface = chat.textPrimary,
            // Material picks text colours by matching a background against these in order, and
            // surfaceVariant comes before surfaceContainerLow; were it the panel colour, every panel
            // would get muted text. The alpha keeps it distinct even when a theme repeats colours.
            surfaceVariant = chat.hover.copy(alpha = 0.99f),
            onSurfaceVariant = chat.textMuted,
            surfaceTint = chat.base,
            surfaceBright = chat.base,
            surfaceDim = chat.base,
            surfaceContainerLowest = chat.rail,
            surfaceContainerLow = chat.panel,
            surfaceContainer = chat.overlay,
            surfaceContainerHigh = chat.overlay,
            surfaceContainerHighest = chat.active,
            inverseSurface = chat.textPrimary,
            inverseOnSurface = chat.base,
            error = chat.danger,
            onError = contrastOn(chat.danger),
            errorContainer = chat.danger.copy(alpha = 0.2f),
            onErrorContainer = chat.textPrimary,
            outline = chat.textSubtle,
            outlineVariant = chat.border,
            scrim = Color.Black,
        )
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.decorView.setBackgroundColor(android.graphics.Color.argb(255,
                (chat.base.red * 255).toInt(), (chat.base.green * 255).toInt(), (chat.base.blue * 255).toInt()))
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !chat.dark
                isAppearanceLightNavigationBars = !chat.dark
            }
        }
    }
    CompositionLocalProvider(LocalChatColors provides chat) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
