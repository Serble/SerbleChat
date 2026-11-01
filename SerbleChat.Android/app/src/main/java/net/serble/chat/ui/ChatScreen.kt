package net.serble.chat.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import net.serble.chat.BuildConfig
import net.serble.chat.data.Channel
import net.serble.chat.data.ChannelType
import net.serble.chat.data.INVITE_RE
import net.serble.chat.data.Message
import net.serble.chat.data.PendingMessage
import net.serble.chat.data.Permissions
import net.serble.chat.data.User
import net.serble.chat.data.formatDay
import net.serble.chat.data.formatMessageTime
import net.serble.chat.data.formatTime
import net.serble.chat.data.mentionLabel
import net.serble.chat.data.plainText
import net.serble.chat.ui.theme.LocalChatColors
import java.time.Duration
import java.time.ZoneId

/** One row of the list: a message, an unsent one, or a day divider. Newest first. */
private sealed interface ChatRow {
    val key: Any
    data class Sent(val message: Message, val compact: Boolean) : ChatRow { override val key get() = message.id }
    data class Unsent(val pending: PendingMessage) : ChatRow { override val key get() = "p" + pending.localId }
    data class Day(val label: String, val id: Long) : ChatRow { override val key get() = "d$id" }
}

private fun buildRows(messages: List<Message>, pending: List<PendingMessage>): List<ChatRow> {
    val rows = ArrayList<ChatRow>(messages.size + pending.size + 8)
    pending.asReversed().forEach { rows += ChatRow.Unsent(it) }
    val zone = ZoneId.systemDefault()
    for (i in messages.indices.reversed()) {
        val m = messages[i]
        val prev = messages.getOrNull(i - 1)
        val sameDay = prev != null && prev.sentAt.atZone(zone).toLocalDate() == m.sentAt.atZone(zone).toLocalDate()
        val compact = prev != null && sameDay && prev.authorId == m.authorId && prev.webhookUsername == m.webhookUsername &&
            m.poll == null && prev.poll == null && Duration.between(prev.sentAt, m.sentAt).toMinutes() < 7
        rows += ChatRow.Sent(m, compact)
        if (!sameDay) rows += ChatRow.Day(formatDay(m.sentAt), m.id)
    }
    return rows
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    channelId: Long,
    jumpTo: Long?,
    /** Whether the chat is the panel in front. Only then do new messages count as read. */
    visible: Boolean,
    onOpenNav: () -> Unit,
    onOpenMembers: () -> Unit,
    onLeft: () -> Unit,
    onOpenChannel: (Long) -> Unit,
    onOpenVoice: () -> Unit,
) {
    val app = LocalApp.current
    val store = app.store
    val messagesUi = LocalMessages.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val guildChannels by store.guildChannels.collectAsStateWithLifecycle()
    val dms by store.dms.collectAsStateWithLifecycle()
    val groups by store.groups.collectAsStateWithLifecycle()
    val channel: Channel? = remember(guildChannels, dms, groups, channelId) { store.channel(channelId) }
    val allMessages by store.messages.collectAsStateWithLifecycle()
    val state = allMessages[channelId]
    val users by store.users.collectAsStateWithLifecycle()
    val typing by store.typing.collectAsStateWithLifecycle()
    val permsMap by store.permissions.collectAsStateWithLifecycle()
    val memberColors by store.memberColors.collectAsStateWithLifecycle()
    val roles by store.roles.collectAsStateWithLifecycle()
    val call by app.voice.call.collectAsStateWithLifecycle()
    val voice by store.voice.collectAsStateWithLifecycle()
    val perms = permsMap[channelId] ?: if (channel?.type == ChannelType.GUILD) null else Permissions.Everything
    val me = store.userId
    val colors = memberColors[channel?.guildId] ?: emptyMap()
    val guildRoles = roles[channel?.guildId] ?: emptyList()

    val memberIds by store.channelMembers.collectAsStateWithLifecycle()
    val members = remember(memberIds[channelId], users) { memberIds[channelId].orEmpty().mapNotNull { users[it] } }
    var actionsFor by remember { mutableStateOf<Message?>(null) }
    var editing by remember { mutableStateOf<Message?>(null) }
    var profileOf by remember { mutableStateOf<String?>(null) }
    var newPoll by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var notifPrefs by remember { mutableStateOf(false) }
    var addPeople by remember { mutableStateOf(false) }
    var leaveGroup by remember { mutableStateOf(false) }
    var highlight by remember { mutableStateOf<Long?>(null) }
    var deleting by remember { mutableStateOf<Message?>(null) }

    // Being in front: new messages here are read at once and its notifications go away
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var resumed by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> resumed = true
                Lifecycle.Event.ON_PAUSE -> resumed = false
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val active = visible && resumed
    DisposableEffect(channelId, active) {
        if (active) {
            store.setActiveChannel(channelId)
            store.markLatestRead(channelId)
            app.notifier.clearRead(channelId)
        }
        onDispose { if (store.activeChannel == channelId) store.setActiveChannel(null) }
    }

    LaunchedEffect(channelId) {
        launch { runCatching { store.openChannel(channelId) } }
        launch {
            val c = channel ?: runCatching { app.api.channel(channelId) }.getOrNull() ?: return@launch
            runCatching { store.loadPermissions(c) }
            runCatching { store.loadMembers(c) }
        }
    }

    val rows = remember(state?.messages, state?.pending) { buildRows(state?.messages ?: emptyList(), state?.pending ?: emptyList()) }
    val listState = rememberLazyListState()

    // Mark read as messages arrive while we're at the bottom
    LaunchedEffect(state?.messages?.lastOrNull()?.id) {
        if (active && listState.firstVisibleItemIndex <= 1) store.markLatestRead(channelId)
    }

    // The list keeps its place when items are added below it, so follow the newest message
    // ourselves when we were already at (or next to) the bottom
    LaunchedEffect(rows.firstOrNull()?.key) {
        if (listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }

    // Load older messages when near the top
    LaunchedEffect(listState, channelId) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { it >= rows.size - 10 }
            .collect { runCatching { store.loadOlder(channelId) } }
    }

    // Jump to a linked message, loading back to it if needed
    LaunchedEffect(jumpTo, state?.loaded) {
        val target = jumpTo ?: return@LaunchedEffect
        if (state?.loaded != true) return@LaunchedEffect
        fun have() = store.messages.value[channelId]?.messages?.any { it.id == target } == true
        // Newer than anything we have (it arrived while the app was closed): fetch forward first
        val newest = store.messages.value[channelId]?.messages?.lastOrNull()?.id ?: 0
        if (!have() && target > newest) runCatching { store.catchUp(channelId) }
        // Otherwise it's further back: page back to it
        var tries = 0
        while (!have() && tries < 20) {
            val s = store.messages.value[channelId] ?: break
            if (s.reachedStart || (s.messages.firstOrNull()?.id ?: 0) < target) break
            runCatching { store.loadOlder(channelId) }.onFailure { return@LaunchedEffect }
            tries++
        }
        val current = store.messages.value[channelId] ?: return@LaunchedEffect
        val index = buildRows(current.messages, current.pending).indexOfFirst { it is ChatRow.Sent && it.message.id == target }
        if (index >= 0) {
            // A third of the way up the screen rather than on its bottom edge, with what came after it below
            val lift = (listState.layoutInfo.viewportSize.height / 3).coerceAtLeast(0)
            listState.scrollToItem(index, -lift)
            highlight = target
            kotlinx.coroutines.delay(2500)
            highlight = null
        } else messagesUi.show("That message couldn't be found.")
    }

    val title = channel?.let { store.channelTitle(it) } ?: "…"
    val dmUser = if (channel?.type == ChannelType.DM) dms.firstOrNull { it.channelId == channelId }?.otherUser(me ?: "")?.let { users[it] } else null
    val inThisCall = call?.channelId == channelId
    val othersInCall = voice[channelId]?.size ?: 0
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            app.voice.join(channelId)
            onOpenVoice()
        } else messagesUi.show("Serble Chat needs the microphone for calls.")
    }
    val joinCall = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            app.voice.join(channelId)
            onOpenVoice()
        } else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().imePadding()) {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                navigationIcon = { IconButton(onClick = onOpenNav) { Icon(Icons.Default.Menu, "Channels") } },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(enabled = dmUser != null) { profileOf = dmUser?.id }) {
                        when (channel?.type) {
                            ChannelType.DM -> Avatar(dmUser?.id, title, 32.dp, status = dmUser?.status ?: "offline")
                            ChannelType.GROUP -> RemoteImage(app.groupIconUrl(channelId), title, 32.dp)
                            else -> Icon(Icons.Default.Tag, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        RowSpacer(10.dp)
                        Column {
                            Text(title.removePrefix("#"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val sub = when {
                                channel?.type == ChannelType.DM -> dmUser?.statusMessage?.takeIf { it.isNotBlank() } ?: statusLabel(dmUser?.status ?: "offline")
                                channel?.type == ChannelType.GUILD -> channel.let { store.guildOf(it)?.name }
                                else -> members.size.takeIf { it > 0 }?.let { "$it members" }
                            }
                            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                },
                actions = {
                    if (channel?.voiceCapable == true && perms?.canJoinVoice != false) {
                        IconButton(onClick = { if (inThisCall) onOpenVoice() else joinCall() }) {
                            Icon(Icons.Default.Call, if (inThisCall) "Open call" else "Join call",
                                tint = if (inThisCall || othersInCall > 0) LocalChatColors.current.success else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    if (channel?.type != ChannelType.DM) IconButton(onClick = onOpenMembers) { Icon(Icons.Default.People, "Members") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Notification settings") }, onClick = { menu = false; notifPrefs = true })
                        if (channel?.type == ChannelType.GROUP) {
                            DropdownMenuItem(text = { Text("Add people") }, onClick = { menu = false; addPeople = true })
                            DropdownMenuItem(text = { Text("Leave group", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; leaveGroup = true })
                        }
                        if (dmUser != null) DropdownMenuItem(text = { Text("View profile") }, onClick = { menu = false; profileOf = dmUser.id })
                    }
                },
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerLowest)

            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state == null || (!state.loaded && state.messages.isEmpty()) -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.messages.isEmpty() && state.pending.isEmpty() -> EmptyState(
                        if (state.error != null) "Couldn't load messages" else "No messages yet",
                        state.error ?: "Say hello!",
                        Modifier.align(Alignment.Center),
                    )
                    else -> LazyColumn(
                        state = listState,
                        reverseLayout = true,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                    ) {
                        items(rows, key = { it.key }, contentType = { it::class }) { row ->
                            when (row) {
                                is ChatRow.Day -> DayDivider(row.label)
                                is ChatRow.Unsent -> UnsentMessage(row.pending, users[me ?: ""]?.username ?: "You", me)
                                is ChatRow.Sent -> MessageItem(
                                    message = row.message,
                                    compact = row.compact,
                                    highlighted = highlight == row.message.id,
                                    author = row.message.authorId?.let { users[it] },
                                    nameColor = row.message.authorId?.let { memberColor(colors[it]) },
                                    mentionLabel = { kind, id -> mentionLabel(kind, id, users, guildRoles, store::channel) },
                                    selfMention = { kind, id -> kind == "user" && id == me },
                                    onLink = { link ->
                                        when (link) {
                                            is MessageLink.UserMention -> profileOf = link.userId
                                            is MessageLink.ChannelMention -> onOpenChannel(link.channelId)
                                            is MessageLink.Url -> {
                                                val parsed = net.serble.chat.MainActivity.parse(android.net.Uri.parse(link.url))
                                                when {
                                                    parsed is net.serble.chat.Incoming.OpenChannel && link.url.contains("/app/channel/") ->
                                                        if (parsed.channelId == channelId && parsed.messageId != null) highlight = parsed.messageId
                                                        else onOpenChannel(parsed.channelId)
                                                    else -> openUrl(context, link.url)
                                                }
                                            }
                                        }
                                    },
                                    onLongPress = { actionsFor = row.message },
                                    onAuthorClick = { row.message.authorId?.let { profileOf = it } },
                                    canManage = perms?.canManageMessages == true,
                                )
                            }
                        }
                        if (state.loadingOlder) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
                        if (state.reachedStart) item { ChannelStart(channel, title) }
                    }
                }
                val showJump by remember { derivedStateOf { listState.firstVisibleItemIndex > 8 } }
                if (showJump) {
                    SmallFloatingActionButton(onClick = { scope.launch { listState.animateScrollToItem(0) } }, modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)) {
                        Icon(Icons.Default.KeyboardArrowDown, "Jump to newest")
                    }
                }
            }

            TypingLine(typing[channelId]?.mapNotNull { users[it]?.username } ?: emptyList())
            Composer(
                channelId = channelId,
                canSend = perms?.canSend != false,
                canPoll = perms?.canCreatePolls != false,
                members = members,
                editing = editing,
                onCancelEdit = { editing = null },
                onNewPoll = { newPoll = true },
                placeholder = "Message " + title,
            )
        }
    }

    actionsFor?.let { message ->
        MessageActions(
            message = message,
            own = message.authorId == me,
            canManage = perms?.canManageMessages == true,
            plain = plainText(message.content, users, guildRoles, store::channel),
            onDismiss = { actionsFor = null },
            onEdit = { editing = message; actionsFor = null },
            onDelete = { deleting = message; actionsFor = null },
            onProfile = { profileOf = message.authorId; actionsFor = null },
        )
    }
    deleting?.let { message ->
        ConfirmDialog("Delete message?", "This can't be undone.", "Delete", destructive = true, onDismiss = { deleting = null }) {
            deleting = null
            messagesUi.run(scope) { store.deleteMessage(message) }
        }
    }
    profileOf?.let { id -> UserSheet(id, guildId = channel?.guildId, onDismiss = { profileOf = null }, onOpenChannel = { profileOf = null; onOpenChannel(it) }) }
    if (newPoll) CreatePollDialog(channelId, onDismiss = { newPoll = false })
    if (notifPrefs) NotificationPrefsDialog(title, guildId = null, channelId = channelId, onDismiss = { notifPrefs = false })
    if (addPeople) CreateGroupDialog(onDismiss = { addPeople = false }, onCreated = {
        addPeople = false
        scope.launch { channel?.let { runCatching { store.loadMembers(it) } } }
    }, addTo = channelId)
    if (leaveGroup) ConfirmDialog("Leave $title?", "You'll need someone to add you back.", "Leave", destructive = true, onDismiss = { leaveGroup = false }) {
        leaveGroup = false
        messagesUi.run(scope) {
            app.api.leaveGroup(channelId)
            store.refresh()
            onLeft()
        }
    }
}

@Composable
private fun DayDivider(label: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f))
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 10.dp))
        HorizontalDivider(Modifier.weight(1f))
    }
}

@Composable
private fun ChannelStart(channel: Channel?, title: String) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(if (channel?.type == ChannelType.GUILD) "Welcome to $title" else title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("This is the start of the conversation.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageItem(
    message: Message,
    compact: Boolean,
    highlighted: Boolean,
    author: User?,
    nameColor: Color?,
    mentionLabel: (String, String) -> String,
    selfMention: (String, String) -> Boolean,
    onLink: (MessageLink) -> Unit,
    onLongPress: () -> Unit,
    onAuthorClick: () -> Unit,
    canManage: Boolean,
) {
    val app = LocalApp.current
    val me = app.store.userId
    val mentionsMe = me != null && message.content.contains("<@user:$me>")
    val bg by animateColorAsState(when {
        highlighted -> MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
        mentionsMe -> Color(0x1AF0B232)
        else -> Color.Transparent
    }, label = "highlight")
    val name = author?.username ?: message.webhookUsername ?: "Unknown"
    Row(
        Modifier
            .fillMaxWidth()
            .background(bg)
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(start = 12.dp, end = 12.dp, top = if (compact) 1.dp else 10.dp, bottom = 1.dp),
    ) {
        if (compact) Spacer(Modifier.width(48.dp)) else {
            Box(Modifier.clip(CircleShape).clickable(onClick = onAuthorClick)) {
                if (message.authorId == null && message.webhookAvatarUrl != null) RemoteImage(message.webhookAvatarUrl, name, 38.dp)
                else Avatar(message.authorId, name, 38.dp)
            }
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f)) {
            if (!compact) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(name, fontWeight = FontWeight.SemiBold, color = nameColor ?: MaterialTheme.colorScheme.onSurface,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).clickable(onClick = onAuthorClick))
                    if (message.authorId == null) {
                        Spacer(Modifier.width(6.dp))
                        Text("BOT", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White,
                            modifier = Modifier.clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.primaryContainer).padding(horizontal = 4.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(formatMessageTime(message.sentAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (message.poll == null || !message.content.startsWith("📊")) {
                MarkdownText(message.content, edited = message.editedAt != null, mentionLabel = mentionLabel, selfMention = selfMention, onLink = onLink)
            }
            message.poll?.let { PollCard(it, canManage = canManage) }
            val invites = remember(message.content) { INVITE_RE.findAll(message.content).map { it.groupValues[1] }.distinct().take(3).toList() }
            invites.forEach { InviteEmbed(it) }
        }
    }
}

@Composable
private fun UnsentMessage(pending: PendingMessage, myName: String, me: String?) {
    val store = LocalApp.current.store
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 2.dp)) {
        Avatar(me, myName, 38.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(myName, fontWeight = FontWeight.SemiBold)
            Text(pending.content, color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (pending.failed) 1f else 0.5f))
            if (pending.failed) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("Not sent.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { store.retry(pending) }) { Text("Retry") }
                TextButton(onClick = { store.discard(pending) }) { Text("Discard") }
            }
        }
    }
}

@Composable
private fun TypingLine(names: List<String>) {
    val text = when (names.size) {
        0 -> null
        1 -> "${names[0]} is typing…"
        2 -> "${names[0]} and ${names[1]} are typing…"
        else -> "Several people are typing…"
    }
    AnimatedVisibility(text != null) {
        Text(text ?: "", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))
    }
}

private val MENTION_QUERY = Regex("(?:^|\\s)@([\\w.-]*)$")

@Composable
private fun Composer(
    channelId: Long,
    canSend: Boolean,
    canPoll: Boolean,
    members: List<User>,
    editing: Message?,
    onCancelEdit: () -> Unit,
    onNewPoll: () -> Unit,
    placeholder: String,
) {
    val app = LocalApp.current
    val store = app.store
    val messagesUi = LocalMessages.current
    val scope = rememberCoroutineScope()
    val users by store.users.collectAsStateWithLifecycle()
    // Kept per channel while the app runs, so a half-written message survives looking elsewhere
    var value by remember(channelId) { mutableStateOf(TextFieldValue(drafts[channelId] ?: "")) }
    val mentions = remember(channelId) { mutableStateMapOf<String, String>() }
    var plus by remember { mutableStateOf(false) }

    LaunchedEffect(editing?.id) {
        if (editing != null) {
            // Show mentions as @names while editing; they turn back into mentions on save
            val text = net.serble.chat.data.MENTION_RE.replace(editing.content) { m ->
                if (m.groupValues[1] == "user") {
                    val name = users[m.groupValues[2]]?.username
                    if (name != null) { mentions[name] = m.groupValues[2]; "@$name" } else m.value
                } else m.value
            }
            value = TextFieldValue(text, TextRange(text.length))
        }
    }

    if (!canSend) {
        Text("You can't send messages in this channel.", color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp))
        return
    }

    val query = MENTION_QUERY.find(value.text.substring(0, value.selection.end.coerceAtMost(value.text.length)))?.groupValues?.get(1)
    val suggestions = if (query == null) emptyList() else members.filter { it.username.startsWith(query, ignoreCase = true) && it.id != store.userId }.take(5)

    fun send() {
        var text = value.text.trim()
        if (text.isEmpty()) return
        for ((name, id) in mentions) text = text.replace(Regex("(?<![\\w@])@" + Regex.escape(name) + "(?![\\w.-])"), "<@user:$id>")
        val target = editing
        if (target != null) {
            messagesUi.run(scope) { store.editMessage(target, text) }
            onCancelEdit()
        } else store.sendMessage(channelId, text)
        value = TextFieldValue("")
        drafts.remove(channelId)
        mentions.clear()
    }

    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).navigationBarsPadding()) {
        if (suggestions.isNotEmpty()) {
            Surface(tonalElevation = 3.dp, shape = RoundedCornerShape(12.dp), modifier = Modifier.padding(horizontal = 8.dp)) {
                Column {
                    suggestions.forEach { user ->
                        Row(Modifier.fillMaxWidth().clickable {
                            val end = value.selection.end
                            val start = value.text.lastIndexOf('@', end - 1)
                            val insert = "@${user.username} "
                            val text = value.text.replaceRange(start, end, insert)
                            mentions[user.username] = user.id
                            value = TextFieldValue(text, TextRange(start + insert.length))
                        }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(user.id, user.username, 28.dp)
                            RowSpacer(10.dp)
                            Text(user.username)
                        }
                    }
                }
            }
        }
        if (editing != null) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Edit, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
            RowSpacer(8.dp)
            Text("Editing message", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f))
            IconButton(onClick = { onCancelEdit(); value = TextFieldValue("") }) { Icon(Icons.Default.Close, "Cancel editing") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            if (editing == null && canPoll) Box {
                IconButton(onClick = { plus = true }) { Icon(Icons.Default.AddCircle, "More", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                DropdownMenu(plus, { plus = false }) {
                    DropdownMenuItem(leadingIcon = { Icon(Icons.Default.Poll, null) }, text = { Text("Create poll") }, onClick = { plus = false; onNewPoll() })
                }
            }
            TextField(
                value = value,
                onValueChange = {
                    value = it
                    drafts[channelId] = it.text
                    if (it.text.isNotEmpty() && editing == null) store.typing(channelId)
                },
                placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp, max = 180.dp),
                shape = RoundedCornerShape(24.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = LocalChatColors.current.input,
                    unfocusedContainerColor = LocalChatColors.current.input,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            )
            RowSpacer(4.dp)
            IconButton(onClick = { send() }, enabled = value.text.isNotBlank()) {
                Icon(if (editing != null) Icons.Default.Edit else Icons.AutoMirrored.Filled.Send, if (editing != null) "Save" else "Send",
                    tint = if (value.text.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private val drafts = HashMap<Long, String>()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageActions(
    message: Message,
    own: Boolean,
    canManage: Boolean,
    plain: String,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onProfile: () -> Unit,
) {
    val copy = rememberCopy()
    val messagesUi = LocalMessages.current
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(plain.take(200), maxLines = 3, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            val itemColors = ListItemDefaults.colors(containerColor = Color.Transparent)
            ListItem(headlineContent = { Text("Copy text") }, leadingContent = { Icon(Icons.Default.ContentCopy, null) }, colors = itemColors,
                modifier = Modifier.clickable { copy(message.content); messagesUi.show("Copied"); onDismiss() })
            ListItem(headlineContent = { Text("Copy link") }, leadingContent = { Icon(Icons.Default.Link, null) }, colors = itemColors,
                modifier = Modifier.clickable {
                    copy("${BuildConfig.FRONTEND_URL.trimEnd('/')}/app/channel/${message.channelId}?message=${message.id}")
                    messagesUi.show("Link copied")
                    onDismiss()
                })
            if (message.authorId != null) ListItem(headlineContent = { Text("View profile") }, leadingContent = { Icon(Icons.Default.Person, null) },
                colors = itemColors, modifier = Modifier.clickable(onClick = onProfile))
            if (own && message.poll == null) ListItem(headlineContent = { Text("Edit") }, leadingContent = { Icon(Icons.Default.Edit, null) },
                colors = itemColors, modifier = Modifier.clickable(onClick = onEdit))
            if (own || canManage) ListItem(
                headlineContent = { Text("Delete", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                colors = itemColors, modifier = Modifier.clickable(onClick = onDelete))
            Text(formatTime(message.sentAt).let { "Sent $it" }, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        }
    }
}

@Composable
internal fun MemberRow(user: User, color: String?, onPick: (String) -> Unit) {
    ListRow(selected = false, onClick = { onPick(user.id) }) {
        Avatar(user.id, user.username, 36.dp, status = user.status)
        RowSpacer()
        NameLine(user.username, user.statusMessage.takeIf { it.isNotBlank() }, nameColor = memberColor(color) ?: Color.Unspecified,
            modifier = Modifier.weight(1f).widthIn(max = 400.dp))
    }
}

@Composable
private fun InviteEmbed(id: String) {
    val app = LocalApp.current
    val messagesUi = LocalMessages.current
    val scope = rememberCoroutineScope()
    val guilds by app.store.guilds.collectAsStateWithLifecycle()
    var guild by remember(id) { mutableStateOf<net.serble.chat.data.Guild?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id) { runCatching { app.api.invite(id).guild }.onSuccess { guild = it }.onFailure { failed = true } }
    val g = guild
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.padding(top = 6.dp).widthIn(max = 420.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (g != null) RemoteImage(app.guildIconUrl(g.id), g.name, 44.dp, RoundedCornerShape(14.dp))
            RowSpacer()
            Column(Modifier.weight(1f)) {
                Text("Invite to a guild", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(when { failed -> "Invalid invite"; g == null -> "Loading…"; else -> g.name }, fontWeight = FontWeight.SemiBold)
            }
            if (g != null) {
                val joined = guilds.any { it.id == g.id }
                TextButton(enabled = !joined, onClick = { messagesUi.run(scope) { app.store.joinInvite(id); messagesUi.show("Joined ${g.name}") } }) {
                    Text(if (joined) "Joined" else "Join")
                }
            }
        }
    }
}
