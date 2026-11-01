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

@Composable
fun Avatar(userId: String?, name: String, size: Dp = 40.dp, status: String? = null) {
    val app = LocalContext.current.applicationContext as ChatApp
    Box {
        RemoteImage(userId?.let { app.avatarUrl(it) }, name, size)
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
