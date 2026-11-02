package net.serble.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.SubcomposeAsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.serble.chat.data.Attachment
import net.serble.chat.data.ChannelUploads
import net.serble.chat.data.Files
import net.serble.chat.data.FilesAccount
import net.serble.chat.data.FilesLimits
import net.serble.chat.data.FilesStatus
import net.serble.chat.data.FilesUsage
import net.serble.chat.data.await
import net.serble.chat.data.formatBytes
import okhttp3.Request

// ── Settings › Serble Files ─────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(onBack: () -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val status by app.files.status.collectAsStateWithLifecycle()
    var account by remember { mutableStateOf<FilesAccount?>(null) }
    var limits by remember { mutableStateOf<FilesLimits?>(null) }
    var usage by remember { mutableStateOf<FilesUsage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { app.files.ensureConnected() }
    LaunchedEffect(status) {
        if (status != FilesStatus.Connected) return@LaunchedEffect
        error = null
        try {
            account = app.files.account()
            limits = app.files.refreshLimits()
            usage = app.files.usage()
        } catch (e: Exception) {
            error = "Couldn't load your Serble Files account: ${e.message}"
        }
    }

    Scaffold(modifier = Modifier.swipeBack(), topBar = {
        TopAppBar(title = { Text("Serble Files") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Files you attach in chat are uploaded to Serble Files with your Serble account. SerbleChat connects to it for you, so there's nothing to sign in to.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

            when (val s = status) {
                FilesStatus.Idle, FilesStatus.Connecting -> FilesCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        RowSpacer()
                        Text("Connecting to Serble Files…")
                    }
                }
                FilesStatus.Connected -> {
                    FilesCard {
                        Label("Account")
                        Text(account?.username ?: "Loading…", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (account?.isAdmin == true) Text("Admin", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                    }
                    val l = limits
                    val u = usage
                    if (l != null && u != null) FilesCard {
                        Label("Storage")
                        Row(Modifier.fillMaxWidth()) {
                            Text("Used", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${formatBytes(u.usedStorage)} / ${limitText(l.accountFilesSize)}", fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.height(8.dp))
                        val fraction = if (l.accountFilesSize > 0) (u.usedStorage.toFloat() / l.accountFilesSize).coerceIn(0f, 1f) else 0f
                        LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(10.dp))
                        LimitLine("Biggest file that never expires", limitText(l.noExpirySingleFileSize))
                        LimitLine("Biggest file that expires", limitText(l.expirySingleFileSize))
                        LimitLine("Longest expiry", if (l.maxExpiryHours == -1L) "Unlimited" else expiryLabel(l.maxExpiryHours))
                    }
                }
                else -> FilesCard {
                    Icon(if (s is FilesStatus.ConsentRequired) Icons.Default.Lock else Icons.Default.Warning, null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    Text(when (s) {
                        is FilesStatus.ConsentRequired -> "Allow SerbleChat to use Serble Files"
                        is FilesStatus.Denied -> "Serble Files is unavailable"
                        is FilesStatus.ReauthRequired -> "Sign in again to use Serble Files"
                        else -> "Couldn't connect to Serble Files"
                    }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text(if (s is FilesStatus.ConsentRequired)
                        "Serble needs your permission before SerbleChat can upload to your Serble Files account. Until then, uploads are anonymous and use the guest limits."
                        else Files.statusMessage(s) + " " + Files.ANON_HINT,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    if (s is FilesStatus.ConsentRequired && s.message != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(s.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(12.dp))
                    when (s) {
                        is FilesStatus.ConsentRequired -> Button(onClick = { scope.launch { startFilesConsent(context, app) } }) { Text("Allow access") }
                        is FilesStatus.ReauthRequired -> {}
                        else -> OutlinedButton(enabled = !working, onClick = {
                            scope.launch { working = true; app.files.reconnect(); working = false }
                        }) { Text(if (working) "Connecting…" else "Try again") }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilesCard(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) { content() }
    }
}

@Composable
private fun Label(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun LimitLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

private fun limitText(bytes: Long) = if (bytes == -1L) "Unlimited" else formatBytes(bytes)

// ── The composer's attachment queue ─────────────────────────────────────────────────────

private val EXPIRY_CHOICES = listOf(1L, 24L, 7 * 24L, 30 * 24L)

fun expiryLabel(hours: Long?): String = when {
    hours == null -> "Never expires"
    hours % (24 * 7) == 0L && hours >= 24 * 7 && hours != 30 * 24L -> "${hours / (24 * 7)} week" + if (hours / (24 * 7) == 1L) "" else "s"
    hours % 24 == 0L -> "${hours / 24} day" + if (hours / 24 == 1L) "" else "s"
    else -> "$hours hour" + if (hours == 1L) "" else "s"
}

/** Files waiting to go with the next message, each with its expiry. */
@Composable
fun AttachmentQueue(channelId: Long, uploads: ChannelUploads) {
    val app = LocalApp.current
    val limits by app.files.limits.collectAsStateWithLifecycle()
    val status by app.files.status.collectAsStateWithLifecycle()
    if (uploads.items.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        uploads.items.forEach { a -> AttachmentRow(channelId, a, uploads.uploading, limits) }
        val guest = when (status) {
            is FilesStatus.ConsentRequired -> "allow SerbleChat to use Serble Files in Settings to use your account."
            is FilesStatus.Denied -> "Serble Files won't accept SerbleChat right now."
            is FilesStatus.ReauthRequired -> "sign in again to use your Serble Files account."
            is FilesStatus.Unavailable -> "Serble Files couldn't be connected."
            else -> null
        }
        if (guest != null) Text("Uploading as a guest: $guest", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp))
    }
}

@Composable
private fun AttachmentRow(channelId: Long, a: Attachment, uploading: Boolean, limits: FilesLimits?) {
    val app = LocalApp.current
    var menu by remember { mutableStateOf(false) }
    val required = Files.expiryRequired(a.size, limits)
    val max = limits?.maxExpiryHours ?: -1L
    val choices = (if (required) emptyList() else listOf<Long?>(null)) + EXPIRY_CHOICES.filter { max == -1L || it <= max }
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            RowSpacer(10.dp)
            Column(Modifier.weight(1f)) {
                Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                Text(formatBytes(a.size), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                a.error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                if (uploading && a.error == null) Text("Uploading…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (!uploading) {
                Box {
                    TextButton(onClick = { menu = true }) {
                        Icon(Icons.Default.Schedule, null, Modifier.size(16.dp))
                        RowSpacer(4.dp)
                        Text(expiryLabel(a.expirationHours), style = MaterialTheme.typography.labelMedium)
                    }
                    DropdownMenu(menu, { menu = false }) {
                        choices.forEach { h ->
                            DropdownMenuItem(text = { Text(expiryLabel(h)) }, onClick = { menu = false; app.files.setExpiry(channelId, a.localId, h) })
                        }
                    }
                }
                IconButton(onClick = { app.files.remove(channelId, a.localId) }) { Icon(Icons.Default.Close, "Remove ${a.name}") }
            } else if (a.error == null) {
                CircularProgressIndicator(Modifier.padding(horizontal = 14.dp).size(18.dp), strokeWidth = 2.dp)
            }
        }
    }
}

// ── File links in messages ──────────────────────────────────────────────────────────────

/** Links to Serble Files (…/files/<id>), like the web app's FILE_RE. */
val FILE_RE = Regex("https?://[^\\s/]+/files/[^\\s]+")
private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp")

private data class FileMeta(val name: String?, val size: Long?, val missing: Boolean)
private val fileMetaCache = mutableStateMapOf<String, FileMeta>()

/** An image inline, or a card that opens the file. */
@Composable
fun FileEmbed(url: String) {
    val app = LocalApp.current
    val context = LocalContext.current
    val id = url.substringAfterLast('/').substringBefore('?')
    val ext = id.substringAfterLast('.', "").lowercase()
    var imageFailed by remember(url) { mutableStateOf(false) }
    val meta = fileMetaCache[url]

    LaunchedEffect(url) {
        if (fileMetaCache.containsKey(url)) return@LaunchedEffect
        val result = runCatching {
            withContext(Dispatchers.IO) {
                app.http.newCall(Request.Builder().url(url).head().build()).await().use { r ->
                    if (r.code == 404 || r.code == 410) FileMeta(null, null, missing = true)
                    else FileMeta(filenameFrom(r.header("Content-Disposition")), r.header("Content-Length")?.toLongOrNull(), missing = false)
                }
            }
        }.getOrNull()
        if (result != null) fileMetaCache[url] = result
    }

    val name = meta?.name ?: id
    if (meta?.missing == true) {
        FileCard(Icons.Default.Warning, "File unavailable", name, "It was deleted or has expired", null)
        return
    }
    if (ext in IMAGE_EXTENSIONS && !imageFailed) {
        var viewing by remember(url) { mutableStateOf(false) }
        if (viewing) ImageViewer(url, name) { viewing = false }
        SubcomposeAsyncImage(
            model = url,
            contentDescription = name,
            contentScale = ContentScale.Fit,
            loading = { Box(Modifier.size(200.dp, 140.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } },
            error = { imageFailed = true },
            modifier = Modifier.padding(top = 6.dp).widthIn(max = 320.dp).heightIn(max = 320.dp).clip(RoundedCornerShape(10.dp))
                .clickable { viewing = true },
        )
        return
    }
    FileCard(Icons.AutoMirrored.Filled.InsertDriveFile, "File", name, meta?.size?.let { formatBytes(it) }) { openUrl(context, url) }
}

@Composable
private fun FileCard(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, title: String, subtitle: String?, onOpen: (() -> Unit)?) {
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.padding(top = 6.dp).widthIn(max = 420.dp).let { if (onOpen != null) it.clickable(onClick = onOpen) else it }) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            RowSpacer()
            Column(Modifier.weight(1f, fill = false)) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                subtitle?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (onOpen != null) {
                RowSpacer()
                Icon(Icons.Default.Download, "Open", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

private fun filenameFrom(header: String?): String? {
    if (header == null) return null
    Regex("filename\\*=(?:UTF-8)?'[^']*'([^;]+)", RegexOption.IGNORE_CASE).find(header)?.let {
        return runCatching { java.net.URLDecoder.decode(it.groupValues[1], "UTF-8") }.getOrNull()
    }
    return Regex("filename=(?:\"([^\"]+)\"|([^;,\\s]+))", RegexOption.IGNORE_CASE).find(header)?.let { it.groupValues[1].ifEmpty { it.groupValues[2] } }
}
