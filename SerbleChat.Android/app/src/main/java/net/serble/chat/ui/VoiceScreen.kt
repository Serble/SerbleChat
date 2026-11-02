package net.serble.chat.ui

import android.Manifest
import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.StopScreenShare
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.track.RemoteVideoTrack
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.video.ViewVisibility
import livekit.org.webrtc.RendererCommon
import net.serble.chat.data.ChannelType
import net.serble.chat.data.NoiseSuppression
import net.serble.chat.data.VoiceState
import net.serble.chat.voice.CallPhase
import net.serble.chat.voice.VideoFeed
import net.serble.chat.ui.theme.LocalChatColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceScreen(onBack: () -> Unit, onOpenChat: (Long) -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val call by app.voice.call.collectAsStateWithLifecycle()
    val voice by store.voice.collectAsStateWithLifecycle()
    val users by store.users.collectAsStateWithLifecycle()
    val me = store.userId
    // The stream open full screen, by its track's key, so it survives the phone turning
    var watching by rememberSaveable { mutableStateOf<String?>(null) }
    var outputs by remember { mutableStateOf(false) }

    // The call ended (left from the notification, or dropped): nothing to show
    LaunchedEffect(call == null) { if (call == null) onBack() }
    val c = call ?: return
    val channel = store.channel(c.channelId)
    val title = channel?.let { store.channelTitle(it) } ?: "Voice"
    val participants = (voice[c.channelId] ?: emptyMap()).toMutableMap().apply {
        // Show ourselves straight away, before the server confirms we joined
        if (me != null && me !in this) put(me, VoiceState(me, c.muted, c.deafened))
    }.values.sortedBy { if (it.userId == me) "" else users[it.userId]?.username?.lowercase() ?: "~" }
    val screens = c.videos.filter { it.screen }
    val cameras = c.videos.filter { !it.screen }.associateBy { it.userId }
    fun nameOf(userId: String) = users[userId]?.username ?: "…"

    Scaffold(
        modifier = Modifier.swipeBack(),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(when (c.phase) {
                            CallPhase.Connecting -> "Connecting…"
                            CallPhase.Reconnecting -> "Reconnecting…"
                            CallPhase.Connected -> channel?.let { ch -> if (ch.type == ChannelType.GUILD) store.guildOf(ch)?.name else null } ?: "Voice connected"
                        }, style = MaterialTheme.typography.bodySmall, color = if (c.phase == CallPhase.Connected) LocalChatColors.current.success else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    if (c.cameraOn) IconButton(onClick = { app.voice.flipCamera() }) { Icon(Icons.Default.Cameraswitch, "Switch camera") }
                    Box {
                        IconButton(onClick = { outputs = true }) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Audio output") }
                        DropdownMenu(outputs, { outputs = false }) {
                            if (c.outputs.isEmpty()) DropdownMenuItem(text = { Text("No other outputs") }, onClick = { outputs = false })
                            c.outputs.forEach { o ->
                                DropdownMenuItem(
                                    text = { Text(o.name + if (o.name == c.output?.name) "  ✓" else "") },
                                    onClick = { outputs = false; app.voice.selectOutput(o) },
                                )
                            }
                        }
                    }
                    IconButton(onClick = { onOpenChat(c.channelId) }) { Icon(Icons.Default.ChatBubble, "Open chat") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(screens, key = { "s" + it.key }, span = { GridItemSpan(maxLineSpan) }) { feed ->
                    ScreenTile(feed, nameOf(feed.userId), audioMuted = feed.userId in c.mutedStreams,
                        onOpen = { watching = feed.key }, onStop = { app.voice.stopScreenShare() },
                        onSetAudioMuted = { app.voice.setStreamMuted(feed.userId, it) })
                }
                items(participants, key = { it.userId }) { p ->
                    val isMe = p.userId == me
                    val muted = if (isMe) c.muted else p.muted
                    val deaf = if (isMe) c.deafened else p.deafened
                    val camera = cameras[p.userId]
                    ParticipantTile(
                        userId = p.userId,
                        name = nameOf(p.userId),
                        camera = camera,
                        mirror = camera?.local == true && c.frontCamera,
                        speaking = p.userId in c.speaking && !muted,
                        muted = muted,
                        deafened = deaf,
                        onOpen = { camera?.let { watching = it.key } },
                    )
                }
            }
            if (c.noiseSuppression == NoiseSuppression.RnNoise) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.GraphicEq, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.size(6.dp))
                    Text("RNNoise noise suppression on", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            CallControls(Modifier.navigationBarsPadding().padding(bottom = 16.dp, top = 8.dp))
        }
    }

    val open = c.videos.firstOrNull { it.key == watching }
    // The stream ended while open
    LaunchedEffect(watching, open == null) { if (watching != null && open == null) watching = null }
    if (open != null) {
        StreamViewer(
            feed = open,
            title = if (open.screen) "${nameOf(open.userId)}'s screen" else nameOf(open.userId),
            mirror = !open.screen && open.local && c.frontCamera,
            audioMuted = if (open.screen && open.hasAudio && !open.local) open.userId in c.mutedStreams else null,
            onSetAudioMuted = { app.voice.setStreamMuted(open.userId, it) },
            onDismiss = { watching = null },
        )
    }
}

/** A participant: their camera when it's on, otherwise their picture. */
@Composable
private fun ParticipantTile(
    userId: String,
    name: String,
    camera: VideoFeed?,
    mirror: Boolean,
    speaking: Boolean,
    muted: Boolean,
    deafened: Boolean,
    onOpen: () -> Unit,
) {
    val success = LocalChatColors.current.success
    val ring by animateDpAsState(if (speaking) 3.dp else 0.dp, label = "ring")
    val shape = RoundedCornerShape(16.dp)
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.aspectRatio(1f)
            .then(if (camera != null && speaking) Modifier.border(ring, success, shape) else Modifier)
            .clip(shape)
            .then(if (camera != null) Modifier.clickable(onClick = onOpen) else Modifier),
    ) {
        if (camera != null) {
            Box(Modifier.fillMaxSize()) {
                VideoView(camera.track, Modifier.fillMaxSize(), fit = false, mirror = mirror)
                Row(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f))))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(name, color = Color.White, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false))
                    StateIcons(muted, deafened)
                }
            }
        } else {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(84.dp).then(if (speaking) Modifier.border(ring, success, CircleShape) else Modifier).padding(4.dp)) {
                    Avatar(userId, name, 76.dp)
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    StateIcons(muted, deafened)
                }
            }
        }
    }
}

@Composable
private fun StateIcons(muted: Boolean, deafened: Boolean) {
    if (muted) Icon(Icons.Default.MicOff, "Muted", Modifier.padding(start = 4.dp).size(16.dp), tint = MaterialTheme.colorScheme.error)
    if (deafened) Icon(Icons.Default.HeadsetOff, "Deafened", Modifier.padding(start = 2.dp).size(16.dp), tint = MaterialTheme.colorScheme.error)
}

/**
 * Someone's shared screen, a whole row wide. Your own isn't shown back to you: it would only show itself.
 * Long-press someone else's for their stream audio.
 */
@Composable
private fun ScreenTile(
    feed: VideoFeed,
    name: String,
    audioMuted: Boolean,
    onOpen: () -> Unit,
    onStop: () -> Unit,
    onSetAudioMuted: (Boolean) -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    var menu by remember { mutableStateOf(false) }
    Surface(
        shape = shape,
        color = Color.Black,
        modifier = Modifier.fillMaxWidth().aspectRatio(16 / 9f).clip(shape)
            .then(if (feed.local) Modifier else Modifier.combinedClickable(onClick = onOpen, onLongClick = { menu = true })),
    ) {
        Box(Modifier.fillMaxSize()) {
            if (feed.local) {
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(Icons.Default.ScreenShare, null, Modifier.size(36.dp), tint = Color.White)
                    Spacer(Modifier.height(8.dp))
                    Text("You're sharing your screen", color = Color.White, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onStop, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = Color.White)) {
                        Text("Stop sharing")
                    }
                }
            } else {
                VideoView(feed.track, Modifier.fillMaxSize(), fit = true)
                Row(
                    Modifier.align(Alignment.BottomStart).padding(8.dp)
                        .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.ScreenShare, null, Modifier.size(14.dp), tint = Color.White)
                    Spacer(Modifier.size(6.dp))
                    Text("$name's screen", color = Color.White, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (feed.hasAudio) {
                        Spacer(Modifier.size(6.dp))
                        if (audioMuted) Icon(Icons.AutoMirrored.Filled.VolumeOff, "Stream audio muted", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.error)
                        else Icon(Icons.AutoMirrored.Filled.VolumeUp, "Has audio", Modifier.size(14.dp), tint = Color.White)
                    }
                }
                Icon(Icons.Default.Fullscreen, "Full screen", Modifier.align(Alignment.TopEnd).padding(8.dp)
                    .background(Color.Black.copy(alpha = 0.55f), CircleShape).padding(4.dp).size(20.dp), tint = Color.White)
                DropdownMenu(menu, { menu = false }) {
                    if (feed.hasAudio) {
                        DropdownMenuItem(
                            text = { Text(if (audioMuted) "Unmute stream audio" else "Mute stream audio") },
                            leadingIcon = { Icon(if (audioMuted) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeOff, null) },
                            onClick = { menu = false; onSetAudioMuted(!audioMuted) },
                        )
                    } else {
                        DropdownMenuItem(text = { Text("This stream has no audio") }, enabled = false, onClick = { menu = false })
                    }
                }
            }
        }
    }
}

/**
 * A stream full screen, to read what's on someone's screen: pinch or double-tap to zoom, drag to
 * look around, tap to hide the buttons, and a button to turn it sideways.
 */
@Composable
private fun StreamViewer(
    feed: VideoFeed,
    title: String,
    mirror: Boolean,
    /** Null when there's no stream audio to mute. */
    audioMuted: Boolean?,
    onSetAudioMuted: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val zoom = rememberZoomState(feed.key)
    val scope = rememberCoroutineScope()
    var chrome by remember { mutableStateOf(true) }
    val activity = LocalActivity.current

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        // Edge to edge: the status and navigation bars come back with a swipe
        DisposableEffect(Unit) {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    hide(WindowInsetsCompat.Type.systemBars())
                }
            }
            onDispose { }
        }
        // Put the phone's orientation back when the viewer closes, but not when it's only being recreated for turning
        DisposableEffect(activity) {
            onDispose {
                if (activity != null && !activity.isChangingConfigurations) activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
        androidx.activity.compose.BackHandler(enabled = zoom.zoomed) { zoom.reset() }

        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Box(Modifier.fillMaxSize().clipToBounds()) {
                VideoView(feed.track, Modifier.fillMaxSize().zoomed(zoom), fit = true, mirror = mirror,
                    onAspect = { zoom.contentAspect = it })
                // Gestures on a layer of their own over the video, which as an Android view would otherwise get the touches
                Box(Modifier.fillMaxSize().zoomGestures(zoom, scope, onTap = { chrome = !chrome }))
            }
            AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut()) {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                        .safeDrawingPadding()
                        .padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Close", tint = Color.White) }
                    Text(title, color = Color.White, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(horizontal = 4.dp))
                    if (zoom.zoomed) {
                        Text("${(zoom.scale * 100).toInt()}%", color = Color.White, style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { zoom.reset() }.padding(horizontal = 8.dp, vertical = 6.dp))
                    }
                    if (audioMuted != null) IconButton(onClick = { onSetAudioMuted(!audioMuted) }) {
                        if (audioMuted) Icon(Icons.AutoMirrored.Filled.VolumeOff, "Unmute stream audio", tint = MaterialTheme.colorScheme.error)
                        else Icon(Icons.AutoMirrored.Filled.VolumeUp, "Mute stream audio", tint = Color.White)
                    }
                    if (activity != null) IconButton(onClick = { activity.toggleLandscape() }) { Icon(Icons.Default.ScreenRotation, "Rotate", tint = Color.White) }
                }
            }
        }
    }
}

private fun Activity.toggleLandscape() {
    val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
    requestedOrientation = if (landscape) ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
}

/**
 * Draws a call's video track. [fit] shows all of it, letterboxed (screens); otherwise it fills the
 * box, cropped (cameras).
 */
@Composable
fun VideoView(track: VideoTrack, modifier: Modifier = Modifier, fit: Boolean, mirror: Boolean = false, onAspect: ((Float) -> Unit)? = null) {
    val voice = LocalApp.current.voice
    val aspectListener by androidx.compose.runtime.rememberUpdatedState(onAspect)
    // WebRTC's renderer always fills its view, cropping what doesn't fit; it only letterboxes by
    // measuring itself to the video's shape. So for fit it gets room to do that, centred in the box.
    Box(modifier, contentAlignment = Alignment.Center) {
        key(track) {
            AndroidView(
                factory = { context ->
                    object : TextureViewRenderer(context) {
                        override fun onFrameResolutionChanged(videoWidth: Int, videoHeight: Int, rotation: Int) {
                            super.onFrameResolutionChanged(videoWidth, videoHeight, rotation)
                            val turned = rotation % 180 != 0
                            val w = if (turned) videoHeight else videoWidth
                            val h = if (turned) videoWidth else videoHeight
                            if (w > 0 && h > 0) post { aspectListener?.invoke(w.toFloat() / h) }
                        }
                    }.apply {
                        if (voice.initRenderer(this)) {
                            setEnableHardwareScaler(true)
                            // Adaptive streaming sends a size to match the view, and nothing while it's hidden
                            if (track is RemoteVideoTrack) track.addRenderer(this, ViewVisibility(this)) else track.addRenderer(this)
                        }
                    }
                },
                update = { r ->
                    r.setMirror(mirror)
                    r.setScalingType(if (fit) RendererCommon.ScalingType.SCALE_ASPECT_FIT else RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                },
                onRelease = { r ->
                    track.removeRenderer(r)
                    r.release()
                },
                modifier = if (fit) Modifier.wrapContentSize() else Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun CallControls(modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val context = LocalContext.current
    val messages = LocalMessages.current
    val call by app.voice.call.collectAsStateWithLifecycle()
    val c = call ?: return
    val connected = c.phase == CallPhase.Connected

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) app.voice.setCamera(true) else messages.show("Serble Chat needs the camera permission for video.")
    }
    val screenCapture = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) app.voice.startScreenShare(data)
    }

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        RoundButton(if (c.muted) Icons.Default.MicOff else Icons.Default.Mic, if (c.muted) "Unmute" else "Mute", active = c.muted) { app.voice.toggleMute() }
        RoundButton(if (c.deafened) Icons.Default.HeadsetOff else Icons.Default.Headset, if (c.deafened) "Undeafen" else "Deafen", active = c.deafened) { app.voice.toggleDeafen() }
        RoundButton(if (c.cameraOn) Icons.Default.Videocam else Icons.Default.VideocamOff, if (c.cameraOn) "Turn camera off" else "Turn camera on",
            active = c.cameraOn, enabled = connected) {
            when {
                c.cameraOn -> app.voice.setCamera(false)
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> app.voice.setCamera(true)
                else -> cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }
        RoundButton(if (c.screenSharing) Icons.Default.StopScreenShare else Icons.Default.ScreenShare,
            if (c.screenSharing) "Stop sharing your screen" else "Share your screen", active = c.screenSharing, enabled = connected) {
            if (c.screenSharing) app.voice.stopScreenShare()
            else screenCapture.launch(context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
        }
        FilledIconButton(
            onClick = { app.voice.leave() },
            modifier = Modifier.size(60.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = Color.White),
        ) { Icon(Icons.Default.CallEnd, "Leave call") }
    }
}

@Composable
private fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    FilledIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(54.dp),
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surface,
            contentColor = if (active) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
        ),
    ) { Icon(icon, label) }
}

/** A strip shown at the bottom of the home screen while in a call. */
@Composable
fun CallBar(onOpen: () -> Unit) {
    val app = LocalApp.current
    val call by app.voice.call.collectAsStateWithLifecycle()
    AnimatedVisibility(call != null) {
        val c = call ?: return@AnimatedVisibility
        val channel = app.store.channel(c.channelId)
        Surface(color = MaterialTheme.colorScheme.surfaceContainerLowest) {
            Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (c.phase == CallPhase.Connected) LocalChatColors.current.success else LocalChatColors.current.away))
                RowSpacer(10.dp)
                Column(Modifier.weight(1f)) {
                    val streams = c.videos.count { it.screen && !it.local }
                    Text(when {
                        c.phase != CallPhase.Connected -> "Connecting…"
                        c.screenSharing -> "Sharing your screen"
                        streams > 0 -> if (streams == 1) "Voice connected · 1 stream" else "Voice connected · $streams streams"
                        else -> "Voice connected"
                    }, style = MaterialTheme.typography.labelLarge,
                        color = if (c.phase == CallPhase.Connected) LocalChatColors.current.success else MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(channel?.let { app.store.channelTitle(it) } ?: "", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { app.voice.toggleMute() }) { Icon(if (c.muted) Icons.Default.MicOff else Icons.Default.Mic, "Mute") }
                IconButton(onClick = { app.voice.toggleDeafen() }) { Icon(if (c.deafened) Icons.Default.HeadsetOff else Icons.Default.Headset, "Deafen") }
                IconButton(onClick = { app.voice.leave() }) { Icon(Icons.Default.CallEnd, "Leave", tint = MaterialTheme.colorScheme.error) }
            }
        }
    }
}
