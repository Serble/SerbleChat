package net.serble.chat.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import net.serble.chat.data.Channel
import net.serble.chat.data.ChannelType
import net.serble.chat.data.HubState
import net.serble.chat.data.VoiceState
import net.serble.chat.ui.theme.LocalChatColors

const val HOME = -1L

/** The left panel: the guild rail and the conversation or channel list beside it. */
@Composable
fun NavPanel(
    selected: Long,
    onSelect: (Long) -> Unit,
    currentChannel: Long?,
    onOpenChannel: (Long) -> Unit,
    onOpenFriends: () -> Unit,
    onOpenYou: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenVoice: () -> Unit,
    onOpenGuildSettings: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val app = LocalApp.current
    val store = app.store
    val guilds by store.guilds.collectAsStateWithLifecycle()
    val guildChannels by store.guildChannels.collectAsStateWithLifecycle()
    val unreads by store.unreads.collectAsStateWithLifecycle()
    var addGuild by remember { mutableStateOf(false) }

    // A guild we were looking at that's gone
    LaunchedEffect(guilds) { if (selected != HOME && guilds.none { it.id == selected }) onSelect(HOME) }

    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = modifier) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.weight(1f)) {
                GuildRail(
                    selected = selected,
                    onSelect = onSelect,
                    onAdd = { addGuild = true },
                    guildUnread = { id -> guildChannels[id]?.any { (unreads[it.id] ?: 0) > 0 } == true },
                    homeUnread = unreads.filterKeys { id -> store.channel(id)?.type != ChannelType.GUILD }.values.sum(),
                )
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (selected == HOME) ConversationList(currentChannel, onOpenChannel, onOpenFriends)
                    else ChannelList(selected, currentChannel, onOpenChannel, onOpenGuildSettings)
                }
            }
            CallBar(onOpenVoice)
            UserBanner(onOpenYou = onOpenYou, onOpenSettings = onOpenSettings)
        }
    }

    if (addGuild) AddGuildDialog(onDismiss = { addGuild = false }, onDone = { id ->
        addGuild = false
        onSelect(id)
    })
}

@Composable
private fun GuildRail(
    selected: Long,
    onSelect: (Long) -> Unit,
    onAdd: () -> Unit,
    guildUnread: (Long) -> Boolean,
    homeUnread: Int,
) {
    val app = LocalApp.current
    val guilds by app.store.guilds.collectAsStateWithLifecycle()
    val colors = LocalChatColors.current
    Column(
        Modifier.width(72.dp).fillMaxHeight().background(colors.rail).statusBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LazyColumn(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp)) {
            item {
                RailItem(selected = selected == HOME, unread = homeUnread > 0, onClick = { onSelect(HOME) }) {
                    BadgedBox(badge = { if (homeUnread > 0) Badge { Text(if (homeUnread > 99) "99+" else "$homeUnread") } }) {
                        Box(Modifier.size(48.dp).clip(RoundedCornerShape(if (selected == HOME) 16.dp else 24.dp))
                            .background(if (selected == HOME) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface),
                            contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.ChatBubble, "Messages", tint = if (selected == HOME) Color.White else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
                HorizontalDivider(Modifier.width(32.dp).padding(vertical = 8.dp))
            }
            items(guilds, key = { it.id }) { guild ->
                RailItem(selected = selected == guild.id, unread = guildUnread(guild.id), onClick = { onSelect(guild.id) }) {
                    RemoteImage(app.guildIconUrl(guild), guild.name, 48.dp, RoundedCornerShape(if (selected == guild.id) 16.dp else 24.dp))
                }
            }
            item {
                RailItem(selected = false, unread = false, onClick = onAdd) {
                    Box(Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Add, "Add a guild", tint = colors.success)
                    }
                }
            }
        }
    }
}

/**
 * Who you are, across the whole bottom of the panel as on desktop, running down behind the gesture
 * bar. Tapping it sets your status; the gear opens settings.
 */
@Composable
private fun UserBanner(onOpenYou: () -> Unit, onOpenSettings: () -> Unit) {
    val app = LocalApp.current
    val account by app.store.account.collectAsStateWithLifecycle()
    val own by app.store.ownStatus.collectAsStateWithLifecycle()
    val hubState by app.hub.state.collectAsStateWithLifecycle()
    val colors = LocalChatColors.current
    val me = account
    val type = own.effectiveType()
    val connected = hubState == HubState.Connected
    val line = when {
        !connected -> "Connecting…"
        own.effectiveMessage().isNotBlank() -> own.effectiveMessage()
        else -> statusLabel(type)
    }
    Row(
        Modifier.fillMaxWidth().background(colors.userPanel).navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable(onClick = onOpenYou).padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(me?.id, me?.username ?: "?", 40.dp,
                status = if (connected) type.let { if (it == "invisible") "offline" else it } else "offline")
            RowSpacer(12.dp)
            Column(Modifier.weight(1f)) {
                Text(me?.username ?: "…", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        IconButton(onClick = onOpenSettings) { Icon(Icons.Default.Settings, "Settings", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun RailItem(selected: Boolean, unread: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        // The pill on the left edge, as on the web
        val pill = when {
            selected -> 36.dp
            unread -> 8.dp
            else -> 0.dp
        }
        if (pill > 0.dp) Box(Modifier.align(Alignment.CenterStart).width(4.dp).height(pill)
            .clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)).background(MaterialTheme.colorScheme.onSurface))
        Box(Modifier.clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)) { content() }
    }
}

@Composable
private fun PanelHeader(title: String, onTitleClick: (() -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).then(if (onTitleClick != null) Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onTitleClick) else Modifier),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (onTitleClick != null) Icon(Icons.Default.ExpandMore, null, Modifier.padding(start = 4.dp))
        }
        actions()
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerLowest)
}

@Composable
private fun ConversationList(currentChannel: Long?, onOpenChannel: (Long) -> Unit, onOpenFriends: () -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val dms by store.dms.collectAsStateWithLifecycle()
    val groups by store.groups.collectAsStateWithLifecycle()
    val users by store.users.collectAsStateWithLifecycle()
    val unreads by store.unreads.collectAsStateWithLifecycle()
    val activity by store.lastActivity.collectAsStateWithLifecycle()
    val friends by store.friends.collectAsStateWithLifecycle()
    val voice by store.voice.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var newGroup by remember { mutableStateOf(false) }
    val me = store.userId ?: ""
    val incoming = friends.count { it.incoming(me) }

    data class Row(val channel: Channel, val name: String, val userId: String?, val activity: Long)
    val rows = remember(dms, groups, users, activity) {
        (dms.map { dm ->
            val other = dm.otherUser(me)
            Row(dm.channel, users[other]?.username ?: "…", other, activity[dm.channelId] ?: dm.channelId)
        } + groups.map { g -> Row(g.channel, g.channel.name, null, activity[g.channelId] ?: g.channelId) })
            .sortedByDescending { it.activity }
    }

    Column(Modifier.fillMaxSize()) {
        PanelHeader("Messages") {
            IconButton(onClick = { newGroup = true }) { Icon(Icons.Default.GroupAdd, "New group") }
            IconButton(onClick = onOpenFriends) {
                BadgedBox(badge = { if (incoming > 0) Badge { Text("$incoming") } }) { Icon(Icons.Default.People, "Friends") }
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    runCatching { store.refresh() }.onFailure { messages.show(it.message ?: "Couldn't refresh") }
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    ListRow(selected = false, onClick = onOpenFriends) {
                        Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.People, null)
                        }
                        RowSpacer()
                        Text("Friends", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                        UnreadBadge(incoming)
                    }
                }
                if (rows.isEmpty()) item {
                    EmptyState("No conversations yet", "Message a friend, or start a group, and it'll show up here.")
                }
                items(rows, key = { it.channel.id }) { row ->
                    val unread = unreads[row.channel.id] ?: 0
                    val user = row.userId?.let { users[it] }
                    val inCall = (voice[row.channel.id]?.size ?: 0) > 0
                    ListRow(selected = row.channel.id == currentChannel, onClick = { onOpenChannel(row.channel.id) }) {
                        if (row.userId != null) Avatar(row.userId, row.name, 40.dp, status = user?.status ?: "offline")
                        else RemoteImage(app.groupIconUrl(row.channel), row.name, 40.dp)
                        RowSpacer()
                        NameLine(
                            row.name,
                            sub = when {
                                inCall -> "In a call"
                                user != null && user.statusMessage.isNotBlank() -> user.statusMessage
                                row.userId == null -> "Group"
                                else -> null
                            },
                            modifier = Modifier.weight(1f),
                            nameColor = if (unread > 0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.85f),
                        )
                        if (inCall) Icon(Icons.AutoMirrored.Filled.VolumeUp, "In a call", tint = LocalChatColors.current.success, modifier = Modifier.size(18.dp).padding(end = 2.dp))
                        UnreadBadge(unread)
                    }
                }
            }
        }
    }

    if (newGroup) CreateGroupDialog(onDismiss = { newGroup = false }, onCreated = { id ->
        newGroup = false
        onOpenChannel(id)
    })
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ListRow(selected: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun ChannelList(guildId: Long, currentChannel: Long?, onOpenChannel: (Long) -> Unit, onOpenGuildSettings: (Long) -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val guilds by store.guilds.collectAsStateWithLifecycle()
    val guild = guilds.firstOrNull { it.id == guildId } ?: return
    val channelsByGuild by store.guildChannels.collectAsStateWithLifecycle()
    val channels = channelsByGuild[guildId] ?: emptyList()
    val unreads by store.unreads.collectAsStateWithLifecycle()
    val voice by store.voice.collectAsStateWithLifecycle()
    val users by store.users.collectAsStateWithLifecycle()
    val perms by store.guildPermissions.collectAsStateWithLifecycle()
    val myPerms = perms[guildId]
    val isOwner = guild.ownerId == store.userId
    var menu by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf(false) }
    var newChannel by remember { mutableStateOf(false) }
    var notifPrefs by remember { mutableStateOf(false) }
    var editChannel by remember { mutableStateOf<Channel?>(null) }
    var channelPrefs by remember { mutableStateOf<Channel?>(null) }
    var leave by remember { mutableStateOf(false) }
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val canManageChannels = isOwner || myPerms?.canManageChannels == true

    LaunchedEffect(guildId) { runCatching { store.loadGuildChannels(guildId) } }

    Column(Modifier.fillMaxSize()) {
        PanelHeader(guild.name, onTitleClick = { menu = true })
        Box {
            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                if (isOwner || myPerms?.canInvite != false) DropdownMenuItem(text = { Text("Invite people") }, onClick = { menu = false; invite = true })
                DropdownMenuItem(text = { Text("Notification settings") }, onClick = { menu = false; notifPrefs = true })
                if (canManageChannels) DropdownMenuItem(text = { Text("Create channel") }, onClick = { menu = false; newChannel = true })
                if (isOwner || myPerms?.canManageGuild == true || myPerms?.canKick == true) DropdownMenuItem(text = { Text("Guild settings") }, onClick = { menu = false; onOpenGuildSettings(guildId) })
                if (!isOwner) DropdownMenuItem(text = { Text("Leave guild", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; leave = true })
            }
        }
        LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp)) {
            items(channels, key = { it.id }) { channel ->
                val unread = unreads[channel.id] ?: 0
                val inCall = voice[channel.id] ?: emptyMap()
                Column(Modifier.animateContentSize()) {
                    ListRow(selected = channel.id == currentChannel, onClick = { onOpenChannel(channel.id) }, onLongClick = {
                        if (canManageChannels) editChannel = channel else channelPrefs = channel
                    }) {
                        Icon(if (channel.voiceCapable) Icons.AutoMirrored.Filled.VolumeUp else Icons.Default.Tag, null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                        RowSpacer(10.dp)
                        Text(
                            channel.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal,
                            color = if (unread > 0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                        )
                        UnreadBadge(unread)
                    }
                    inCall.values.forEach { state -> VoiceParticipantRow(state, users[state.userId]?.username ?: "…") }
                }
            }
            if (channels.isEmpty()) item { EmptyState("No channels", if (canManageChannels) "Create one from the menu above." else "Nothing here yet.") }
        }
    }

    if (invite) InviteSheet(guildId, onDismiss = { invite = false })
    if (newChannel) ChannelDialog(guildId, null, onDismiss = { newChannel = false })
    editChannel?.let { ChannelDialog(guildId, it, onDismiss = { editChannel = null }, onNotifications = { channelPrefs = it; editChannel = null }) }
    if (notifPrefs) NotificationPrefsDialog(title = guild.name, guildId = guildId, channelId = null, onDismiss = { notifPrefs = false })
    channelPrefs?.let { NotificationPrefsDialog(title = "#" + it.name, guildId = null, channelId = it.id, onDismiss = { channelPrefs = null }) }
    if (leave) ConfirmDialog("Leave ${guild.name}?", "You'll need a new invite to come back.", "Leave", destructive = true,
        onDismiss = { leave = false }, onConfirm = {
            leave = false
            messages.run(scope) { store.leaveGuild(guildId) }
        })
}

@Composable
private fun VoiceParticipantRow(state: VoiceState, name: String) {
    Row(Modifier.fillMaxWidth().padding(start = 46.dp, end = 16.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(state.userId, name, 22.dp)
        RowSpacer(8.dp)
        Text(name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (state.muted) Icon(Icons.Default.MicOff, "Muted", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            if (state.deafened) Icon(Icons.Default.HeadsetOff, "Deafened", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
