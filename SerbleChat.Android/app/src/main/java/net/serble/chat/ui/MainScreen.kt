package net.serble.chat.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.gestures.snapTo
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import net.serble.chat.data.ChannelType
import kotlin.math.abs
import kotlin.math.roundToInt

/** Which panel is in front: the navigation on the left, the chat, or the members on the right. */
enum class Pane { Nav, Chat, Members }

/** A request to scroll the open chat to a message. Each one is new, so asking for the same message twice works. */
data class Jump(val messageId: Long, val serial: Long = System.nanoTime())

/** A request from outside (a notification, a link) to show a channel. */
data class ChannelRequest(val channelId: Long, val messageId: Long?, val serial: Long = System.nanoTime())

/**
 * The three panels, as Discord's app used to have them. The chat sits on top; dragging it right
 * uncovers guilds and channels underneath, dragging it left uncovers the member list. A sliver of
 * the chat stays visible at the edge, and tapping it brings the chat back.
 */
@Composable
fun MainScreen(
    request: ChannelRequest?,
    onOpenFriends: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenVoice: () -> Unit,
    onOpenGuildSettings: (Long) -> Unit,
    onOpenSearch: (Long) -> Unit,
) {
    val app = LocalApp.current
    val store = app.store
    val scope = rememberCoroutineScope()
    var channelId by rememberSaveable { mutableStateOf<Long?>(null) }
    var jumpTo by remember { mutableStateOf<Jump?>(null) }
    var guild by rememberSaveable { mutableStateOf(HOME) }
    var you by remember { mutableStateOf(false) }
    var restored by rememberSaveable { mutableStateOf(false) }
    // The last outside request acted on, so coming back from another page doesn't replay it
    var handledRequest by rememberSaveable { mutableStateOf<Long?>(null) }

    val density = LocalDensity.current
    // Which panel is out survives going to another page and back, so the screen underneath a back
    // swipe is already as it was left instead of sliding into place
    var savedPane by rememberSaveable { mutableStateOf(Pane.Nav) }
    val state = remember { AnchoredDraggableState(initialValue = savedPane) }
    LaunchedEffect(state.settledValue) { savedPane = state.settledValue }
    val animation = spring<Float>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)
    fun show(pane: Pane) {
        scope.launch { state.animateTo(pane, animation) }
    }

    fun open(id: Long, message: Long? = null) {
        channelId = id
        jumpTo = message?.let { Jump(it) }
        // Keep the left panel on the guild the channel is in
        val c = store.channel(id)
        guild = if (c?.type == ChannelType.GUILD) c.guildId ?: HOME else HOME
        scope.launch { app.settings.setLastChannel(id) }
        show(Pane.Chat)
    }

    // Reopen where we were last time, on the chat; with nothing to reopen, start on the channels
    LaunchedEffect(Unit) {
        if (restored) return@LaunchedEffect
        restored = true
        if (request == null) app.settings.lastChannel()?.let { last ->
            if (channelId == null) {
                channelId = last
                val c = store.channel(last)
                if (c?.type == ChannelType.GUILD) guild = c.guildId ?: HOME
                state.snapTo(Pane.Chat)
            }
        }
    }
    LaunchedEffect(request?.serial) {
        val r = request ?: return@LaunchedEffect
        if (r.serial == handledRequest) return@LaunchedEffect
        handledRequest = r.serial
        open(r.channelId, r.messageId)
    }

    // The channel went away (deleted, left the guild): back to the channel list
    val guildChannels by store.guildChannels.collectAsStateWithLifecycle()
    val dms by store.dms.collectAsStateWithLifecycle()
    val groups by store.groups.collectAsStateWithLifecycle()
    LaunchedEffect(guildChannels, dms, groups) {
        val id = channelId ?: return@LaunchedEffect
        val known = guildChannels.isNotEmpty() || dms.isNotEmpty() || groups.isNotEmpty()
        if (known && store.channel(id) == null) {
            channelId = null
            app.settings.setLastChannel(null)
            show(Pane.Nav)
        }
    }

    // Back from the chat slides it aside to the channel list, following the gesture
    val pane = state.currentValue
    val settled by remember { derivedStateOf { !state.isAnimationRunning } }
    PredictiveBackHandler(enabled = pane == Pane.Chat) { progress: Flow<androidx.activity.BackEventCompat> ->
        val target = state.anchors.positionOf(Pane.Nav)
        try {
            progress.collect { event ->
                val wanted = target * event.progress
                state.dispatchRawDelta(wanted - state.requireOffset())
            }
            state.animateTo(Pane.Nav, animation)
        } catch (e: CancellationException) {
            state.animateTo(Pane.Chat, animation)
            throw e
        }
    }
    BackHandler(enabled = pane == Pane.Members && settled) { show(Pane.Chat) }

    // The drag belongs to the whole screen. Children see touches first, so lists still scroll
    // vertically and anything that scrolls sideways (code blocks) keeps its own swipes.
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .anchoredDraggable(state, Orientation.Horizontal),
    ) {
        val width = constraints.maxWidth.toFloat()
        val peek = with(density) { 56.dp.toPx() }
        val side = width - peek
        LaunchedEffect(side) {
            state.updateAnchors(DraggableAnchors {
                Pane.Nav at side
                Pane.Chat at 0f
                Pane.Members at -side
            })
        }
        // Before the anchors are in (the first frame), place the chat where its panel says
        val offset = if (state.offset.isNaN()) when (state.currentValue) {
            Pane.Nav -> side
            Pane.Chat -> 0f
            Pane.Members -> -side
        } else state.offset
        val sideWidth = with(density) { side.toDp() }

        // Underneath: whichever side is being uncovered goes on top of the other
        NavPanel(
            selected = guild,
            onSelect = { guild = it },
            currentChannel = channelId,
            onOpenChannel = { open(it) },
            onOpenFriends = onOpenFriends,
            onOpenYou = { you = true },
            onOpenSettings = onOpenSettings,
            onOpenVoice = onOpenVoice,
            onOpenGuildSettings = onOpenGuildSettings,
            inFront = pane == Pane.Nav,
            modifier = Modifier.width(sideWidth).fillMaxHeight().align(Alignment.CenterStart).zIndex(if (offset >= 0) 1f else 0f),
        )
        MembersPanel(
            channelId = channelId,
            modifier = Modifier.width(sideWidth).fillMaxHeight().align(Alignment.CenterEnd).zIndex(if (offset < 0) 1f else 0f),
        )

        // On top: the chat, dragged by the whole screen
        val progress = (abs(offset) / side).coerceIn(0f, 1f)
        Box(
            Modifier
                .zIndex(2f)
                .fillMaxSize()
                .offset { IntOffset(offset.roundToInt(), 0) }
                .shadow(if (progress > 0f) 16.dp else 0.dp),
        ) {
            val id = channelId
            if (id != null) {
                androidx.compose.runtime.key(id) {
                    ChatScreen(
                        channelId = id,
                        jumpTo = jumpTo,
                        visible = pane == Pane.Chat && progress < 0.5f,
                        onOpenNav = { show(Pane.Nav) },
                        onOpenMembers = { show(Pane.Members) },
                        onLeft = {
                            channelId = null
                            show(Pane.Nav)
                        },
                        onOpenChannel = { open(it) },
                        onOpenVoice = onOpenVoice,
                        onOpenSearch = { onOpenSearch(id) },
                    )
                }
            } else {
                NothingOpen(onOpenNav = { show(Pane.Nav) }, onOpenFriends = onOpenFriends)
            }
            // While a side panel is out, the visible sliver of chat dims, and a tap on it returns
            if (progress > 0f) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.35f * progress))
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { show(Pane.Chat) },
                )
            }
        }

        // With a side panel out, one solid strip behind the status bar rather than a band of each
        // panel's colour. It fades in as the chat slides away, so the chat's own header still
        // colours the status bar while the chat is in front.
        if (progress > 0f) {
            Box(
                Modifier
                    .zIndex(3f)
                    .fillMaxWidth()
                    .windowInsetsTopHeight(WindowInsets.statusBars)
                    .graphicsLayer { alpha = progress }
                    .background(MaterialTheme.colorScheme.surfaceContainerLowest),
            )
        }
    }
    if (you) YouSheet(onDismiss = { you = false }, onOpenSettings = { you = false; onOpenSettings() })
}

@Composable
private fun NothingOpen(onOpenNav: () -> Unit, onOpenFriends: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.statusBarsPadding()) {
            androidx.compose.foundation.layout.Row(Modifier.height(56.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onOpenNav) { Icon(Icons.Default.Menu, "Channels") }
                Text("Serble Chat", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            EmptyState("Nothing open", "Swipe right, or tap the menu, to pick a conversation or channel.", Modifier.padding(top = 48.dp))
            androidx.compose.material3.TextButton(onClick = onOpenFriends, modifier = Modifier.padding(horizontal = 24.dp)) { Text("See your friends") }
        }
    }
}

/** The right panel: who can see the channel, online first. */
@Composable
private fun MembersPanel(channelId: Long?, modifier: Modifier) {
    val app = LocalApp.current
    val store = app.store
    val memberIds by store.channelMembers.collectAsStateWithLifecycle()
    val users by store.users.collectAsStateWithLifecycle()
    val memberColors by store.memberColors.collectAsStateWithLifecycle()
    var profile by remember { mutableStateOf<String?>(null) }
    val channel = channelId?.let { store.channel(it) }
    val colors = memberColors[channel?.guildId] ?: emptyMap()
    val guilds by store.guilds.collectAsStateWithLifecycle()
    val groups by store.groups.collectAsStateWithLifecycle()
    // Guilds and group chats have an owner; DMs don't
    val ownerId = channel?.guildId?.let { g -> guilds.firstOrNull { it.id == g }?.ownerId }
        ?: groups.firstOrNull { it.channelId == channelId }?.ownerId
    val members = memberIds[channelId].orEmpty().mapNotNull { users[it] }
    val online = members.filter { it.status != "offline" }.sortedBy { it.username.lowercase() }
    val offline = members.filter { it.status == "offline" }.sortedBy { it.username.lowercase() }

    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = modifier) {
        Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
            Text("Members", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 12.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerLowest)
            LazyColumn {
                if (members.isEmpty()) item { EmptyState("No one here yet", if (channelId == null) "Open a channel to see who's in it." else "Loading…") }
                if (online.isNotEmpty()) item { SectionLabel("Online — ${online.size}") }
                items(online, key = { "on" + it.id }) { MemberRow(it, colors[it.id], owner = it.id == ownerId) { id -> profile = id } }
                if (offline.isNotEmpty()) item { SectionLabel("Offline — ${offline.size}") }
                items(offline, key = { "off" + it.id }) { MemberRow(it, colors[it.id], owner = it.id == ownerId) { id -> profile = id } }
            }
        }
    }
    profile?.let { id ->
        UserSheet(id, guildId = channel?.guildId, onDismiss = { profile = null }, onOpenChannel = { profile = null })
    }
}
