package net.serble.chat.ui

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.SubcomposeAsyncImage

/**
 * A photo from a message, full screen: pinch or double-tap to zoom, drag to look around, tap to
 * hide the buttons. Saving, sharing and the browser are one tap away, but not where it opens.
 */
@Composable
fun ImageViewer(url: String, name: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val zoom = rememberZoomState(url)
    val scope = rememberCoroutineScope()
    var chrome by remember { mutableStateOf(true) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BackHandler(enabled = zoom.zoomed) { zoom.reset() }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Box(Modifier.fillMaxSize().zoomGestures(zoom, scope, onTap = { chrome = !chrome }), contentAlignment = Alignment.Center) {
                SubcomposeAsyncImage(
                    model = url,
                    contentDescription = name,
                    contentScale = ContentScale.Fit,
                    loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Color.White) } },
                    error = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Couldn't load the image", color = Color.White) } },
                    onSuccess = { state ->
                        val size = state.painter.intrinsicSize
                        if (size.width > 0f && size.height > 0f) zoom.contentAspect = size.width / size.height
                    },
                    modifier = Modifier.fillMaxSize().zoomed(zoom),
                )
            }
            AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut()) {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                        .statusBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Close", tint = Color.White) }
                    Text(name, color = Color.White, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(horizontal = 4.dp))
                    IconButton(onClick = { download(context, url, name) }) { Icon(Icons.Default.Download, "Save", tint = Color.White) }
                    IconButton(onClick = {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }, null))
                    }) { Icon(Icons.Default.Share, "Share", tint = Color.White) }
                    IconButton(onClick = { openUrl(context, url) }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, "Open in browser", tint = Color.White, modifier = Modifier.size(22.dp)) }
                }
            }
        }
    }
}

/** Saves a file to Downloads, with the system's progress notification. */
fun download(context: Context, url: String, name: String) {
    try {
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
        context.getSystemService(DownloadManager::class.java).enqueue(request)
        Toast.makeText(context, "Saving to Downloads…", Toast.LENGTH_SHORT).show()
    } catch (_: Exception) {
        // Older Android needs a storage permission for this; the browser can save it instead
        openUrl(context, url)
    }
}
