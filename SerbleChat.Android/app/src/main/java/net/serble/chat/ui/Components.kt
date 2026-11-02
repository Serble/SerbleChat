package net.serble.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import net.serble.chat.ChatApp
import net.serble.chat.data.ImageVersion
import net.serble.chat.ui.theme.LocalChatColors

/** Copies text to the clipboard; returns a function to call with what to copy. */
@Composable
fun rememberCopy(): (String) -> Unit {
    val clipboard = androidx.compose.ui.platform.LocalClipboard.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    return remember(clipboard, scope) {
        { text ->
            scope.launch {
                clipboard.setClipEntry(androidx.compose.ui.platform.ClipEntry(android.content.ClipData.newPlainText("Serble Chat", text)))
            }
        }
    }
}

/** A stable colour for someone without a picture, from their name. */
fun fallbackColor(seed: String): Color {
    val hue = ((seed.hashCode() and 0x7fffffff) % 360).toFloat()
    return Color.hsv(hue, 0.45f, 0.72f)
}

/**
 * A member's role colour, or null for the default. The backend reports members without a coloured
 * role as #ffffff, which would be invisible on the light theme.
 */
fun memberColor(hex: String?): Color? = hex?.takeIf { !it.equals("#ffffff", ignoreCase = true) }?.let(::parseColor)

/** "#ff8800" to a colour; null for empty or unreadable values. */
fun parseColor(hex: String?): Color? {
    if (hex.isNullOrBlank()) return null
    val clean = hex.trim().removePrefix("#")
    val value = clean.toLongOrNull(16) ?: return null
    return when (clean.length) {
        6 -> Color(0xFF000000 or value)
        8 -> Color(value)
        else -> null
    }
}

@Composable
fun Initials(name: String, size: Dp, shape: Shape = CircleShape, color: Color = fallbackColor(name)) {
    Box(Modifier.size(size).clip(shape).background(color), contentAlignment = Alignment.Center) {
        Text(
            name.firstOrNull()?.uppercase() ?: "?",
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = (size.value * 0.42f).sp,
        )
    }
}

/** A remote image with initials while it loads or when there is none (most users have none). */
@Composable
fun RemoteImage(url: String?, name: String, size: Dp, shape: Shape = CircleShape) {
    if (url == null) return Initials(name, size, shape)
    SubcomposeAsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(shape),
        loading = { Initials(name, size, shape) },
        error = { Initials(name, size, shape) },
    )
}

/** User ID to avatar version, from [net.serble.chat.data.ChatStore.avatarVersions]. Provided at the root. */
val LocalAvatarVersions = compositionLocalOf<Map<String, Long>> { emptyMap() }

@Composable
fun Avatar(userId: String?, name: String, size: Dp = 40.dp, status: String? = null) {
    val app = LocalContext.current.applicationContext as ChatApp
    val versions = LocalAvatarVersions.current
    Box {
        RemoteImage(userId?.let { app.avatarUrl(it, versions[it] ?: ImageVersion.UNKNOWN) }, name, size)
        if (status != null) {
            StatusDot(status, Modifier.align(Alignment.BottomEnd), size = (size.value * 0.32f).coerceAtLeast(10f).dp)
        }
    }
}

@Composable
fun StatusDot(status: String, modifier: Modifier = Modifier, size: Dp = 12.dp) {
    val colors = LocalChatColors.current
    val color = when (status) {
        "online" -> colors.online
        "away" -> colors.away
        "dnd" -> colors.dnd
        else -> colors.offline
    }
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(color)
            .border(2.dp, MaterialTheme.colorScheme.surfaceContainerLow, CircleShape),
    )
}

fun statusLabel(status: String) = when (status) {
    "online" -> "Online"
    "away" -> "Away"
    "dnd" -> "Do not disturb"
    "invisible" -> "Invisible"
    else -> "Offline"
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.6.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}

@Composable
fun UnreadBadge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Box(
        modifier
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.error)
            .padding(horizontal = 6.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/** A dialog asking for one line of text. */
@Composable
fun TextPromptDialog(
    title: String,
    label: String,
    confirm: String,
    initial: String = "",
    description: String? = null,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                if (description != null) {
                    Text(description, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                }
                OutlinedTextField(value = value, onValueChange = { value = it }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(value.trim()) }, enabled = value.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, destructive: Boolean = false, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirm, color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun EmptyState(title: String, body: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun NameLine(name: String, sub: String?, modifier: Modifier = Modifier, nameColor: Color = Color.Unspecified) {
    Column(modifier) {
        Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1,
            overflow = TextOverflow.Ellipsis, color = nameColor)
        if (!sub.isNullOrBlank()) {
            Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun RowSpacer(width: Dp = 12.dp) = Spacer(Modifier.width(width))

/** The web app's crown (icons.jsx CrownIcon): three points with ball tips over a band. */
val CrownIcon: androidx.compose.ui.graphics.vector.ImageVector by lazy {
    fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0z"
    val fill = androidx.compose.ui.graphics.SolidColor(Color.Black)
    androidx.compose.ui.graphics.vector.ImageVector.Builder("Crown", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            androidx.compose.ui.graphics.vector.addPathNodes("M3 8.5 7.5 12 12 5.5l4.5 6.5L21 8.5l-2 9H5z"),
            fill = fill, stroke = fill, strokeLineWidth = 1.5f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round,
        )
        .addPath(androidx.compose.ui.graphics.vector.addPathNodes(circle(3f, 7.5f, 1.7f) + circle(12f, 4.2f, 1.9f) + circle(21f, 7.5f, 1.7f) +
            "M6.1 19h11.8a1.1 1.1 0 0 1 0 2.2H6.1a1.1 1.1 0 0 1 0-2.2z"), fill = fill)
        .build()
}

/** Gold, as on the web app's member list. */
val OwnerGold = Color(0xFFF0B232)

/** The crown shown beside a guild's or group's owner. */
@Composable
fun OwnerCrown(modifier: Modifier = Modifier, size: Dp = 16.dp) {
    androidx.compose.material3.Icon(CrownIcon, "Owner", modifier.size(size), tint = OwnerGold)
}
