package net.serble.chat.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.GraphicEq
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.serble.chat.data.ChannelType
import net.serble.chat.data.NoiseSuppression
import net.serble.chat.voice.CallPhase
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

    // The call ended (left from the notification, or dropped): nothing to show
    LaunchedEffect(call == null) { if (call == null) onBack() }
    val c = call ?: return
    val channel = store.channel(c.channelId)
    val title = channel?.let { store.channelTitle(it) } ?: "Voice"
    val participants = (voice[c.channelId] ?: emptyMap()).toMutableMap().apply {
        // Show ourselves straight away, before the server confirms we joined
        if (me != null && me !in this) put(me, net.serble.chat.data.VoiceState(me, c.muted, c.deafened))
    }.values.sortedBy { if (it.userId == me) "" else users[it.userId]?.username?.lowercase() ?: "~" }

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
                actions = { IconButton(onClick = { onOpenChat(c.channelId) }) { Icon(Icons.Default.ChatBubble, "Open chat") } },
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
                items(participants, key = { it.userId }) { p ->
                    val name = users[p.userId]?.username ?: "…"
                    val speaking = p.userId in c.speaking && !(if (p.userId == me) c.muted else p.muted)
                    val ring by animateDpAsState(if (speaking) 3.dp else 0.dp, label = "ring")
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(Modifier.size(84.dp).then(if (speaking) Modifier.border(ring, LocalChatColors.current.success, CircleShape) else Modifier).padding(4.dp)) {
                                Avatar(p.userId, name, 76.dp)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                val muted = if (p.userId == me) c.muted else p.muted
                                val deaf = if (p.userId == me) c.deafened else p.deafened
                                if (muted) Icon(Icons.Default.MicOff, "Muted", Modifier.padding(start = 4.dp).size(16.dp), tint = MaterialTheme.colorScheme.error)
                                if (deaf) Icon(Icons.Default.HeadsetOff, "Deafened", Modifier.padding(start = 2.dp).size(16.dp), tint = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
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
}

@Composable
private fun CallControls(modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val call by app.voice.call.collectAsStateWithLifecycle()
    val c = call ?: return
    var outputs by remember { mutableStateOf(false) }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        RoundButton(if (c.muted) Icons.Default.MicOff else Icons.Default.Mic, if (c.muted) "Unmute" else "Mute", active = c.muted) { app.voice.toggleMute() }
        RoundButton(if (c.deafened) Icons.Default.HeadsetOff else Icons.Default.Headset, if (c.deafened) "Undeafen" else "Deafen", active = c.deafened) { app.voice.toggleDeafen() }
        Box {
            RoundButton(Icons.AutoMirrored.Filled.VolumeUp, "Audio output", active = false) { outputs = true }
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
        FilledIconButton(
            onClick = { app.voice.leave() },
            modifier = Modifier.size(64.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = Color.White),
        ) { Icon(Icons.Default.CallEnd, "Leave call") }
    }
}

@Composable
private fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(56.dp),
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
                    Text(if (c.phase == CallPhase.Connected) "Voice connected" else "Connecting…", style = MaterialTheme.typography.labelLarge,
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
