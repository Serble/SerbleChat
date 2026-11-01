package net.serble.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.serble.chat.data.ApiException
import net.serble.chat.data.User
import net.serble.chat.data.formatUntil
import net.serble.chat.data.parseInstant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendsScreen(onBack: () -> Unit, onOpenChannel: (Long) -> Unit, initialTab: Int = 0) {
    val app = LocalApp.current
    val store = app.store
    val friends by store.friends.collectAsStateWithLifecycle()
    val users by store.users.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val me = store.userId ?: ""
    var tab by remember { mutableIntStateOf(initialTab) }
    val blocked by store.blocked.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(false) }
    var profile by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { store.loadFriends() }
        runCatching { store.loadBlocks() }
    }

    val accepted = friends.filter { !it.pending }.map { it.other(me) }
        .sortedWith(compareBy({ users[it]?.status == "offline" }, { users[it]?.username?.lowercase() }))
    val incoming = friends.filter { it.incoming(me) }
    val outgoing = friends.filter { it.pending && !it.incoming(me) }

    Scaffold(
        modifier = Modifier.swipeBack(),
        topBar = {
            TopAppBar(
                title = { Text("Friends") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { adding = true }) { Icon(Icons.Default.PersonAdd, "Add friend") } },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            PrimaryTabRow(selectedTabIndex = tab) {
                Tab(tab == 0, { tab = 0 }, text = { Text("All") })
                Tab(tab == 1, { tab = 1 }, text = { Text(if (incoming.isEmpty()) "Pending" else "Pending (${incoming.size})") })
                Tab(tab == 2, { tab = 2 }, text = { Text("Blocked") })
            }
            LazyColumn(Modifier.fillMaxSize()) {
                if (tab == 0) {
                    if (accepted.isEmpty()) item { EmptyState("No friends yet", "Add someone by their Serble username.") }
                    items(accepted, key = { it }) { id ->
                        val user = users[id]
                        ListRow(selected = false, onClick = { profile = id }) {
                            Avatar(id, user?.username ?: "…", 40.dp, status = user?.status ?: "offline")
                            RowSpacer()
                            NameLine(user?.username ?: "…", user?.statusMessage?.takeIf { it.isNotBlank() } ?: statusLabel(user?.status ?: "offline"), Modifier.weight(1f))
                            TextButton(onClick = { messages.run(scope) { onOpenChannel(store.openDm(id).id) } }) { Text("Message") }
                        }
                    }
                } else if (tab == 2) {
                    val list = blocked.sortedBy { users[it]?.username?.lowercase() ?: "~" }
                    if (list.isEmpty()) item { EmptyState("No one blocked", "People you block show up here. Their messages are hidden from you.") }
                    items(list, key = { "b$it" }) { id ->
                        val user = users[id]
                        ListRow(selected = false, onClick = { profile = id }) {
                            Avatar(id, user?.username ?: "…", 40.dp)
                            RowSpacer()
                            NameLine(user?.username ?: "…", "Blocked", Modifier.weight(1f))
                            TextButton(onClick = {
                                messages.run(scope) {
                                    store.unblock(id)
                                    messages.show("Unblocked ${user?.username ?: ""}".trim())
                                }
                            }) { Text("Unblock") }
                        }
                    }
                } else {
                    if (incoming.isEmpty() && outgoing.isEmpty()) item { EmptyState("Nothing pending", "Friend requests you send or receive show up here.") }
                    if (incoming.isNotEmpty()) item { SectionLabel("Incoming") }
                    items(incoming, key = { "in" + it.id }) { f ->
                        val id = f.other(me)
                        ListRow(selected = false, onClick = { profile = id }) {
                            Avatar(id, users[id]?.username ?: "…", 40.dp)
                            RowSpacer()
                            NameLine(users[id]?.username ?: "…", "Wants to be friends", Modifier.weight(1f))
                            IconButton(onClick = { messages.run(scope) { store.addFriend(id) } }) { Icon(Icons.Default.Check, "Accept") }
                            IconButton(onClick = { messages.run(scope) { store.removeFriend(id) } }) { Icon(Icons.Default.Close, "Decline") }
                        }
                    }
                    if (outgoing.isNotEmpty()) item { SectionLabel("Sent") }
                    items(outgoing, key = { "out" + it.id }) { f ->
                        val id = f.other(me)
                        ListRow(selected = false, onClick = { profile = id }) {
                            Avatar(id, users[id]?.username ?: "…", 40.dp)
                            RowSpacer()
                            NameLine(users[id]?.username ?: "…", "Request sent", Modifier.weight(1f))
                            IconButton(onClick = { messages.run(scope) { store.removeFriend(id) } }) { Icon(Icons.Default.Close, "Cancel request") }
                        }
                    }
                }
            }
        }
    }

    if (adding) TextPromptDialog(
        title = "Add a friend",
        label = "Username",
        confirm = "Send request",
        description = "Their Serble username, exactly as it's spelt.",
        onDismiss = { adding = false },
        onConfirm = { name ->
            adding = false
            messages.run(scope) {
                val user = try {
                    app.api.userByName(name)
                } catch (e: ApiException) {
                    throw if (e.status == 404) ApiException(404, "There's no one called $name.") else e
                }
                store.rememberUsers(listOf(user))
                store.addFriend(user.id)
                messages.show("Friend request sent to ${user.username}")
            }
        },
    )
    profile?.let { UserSheet(it, guildId = null, onDismiss = { profile = null }, onOpenChannel = { id -> profile = null; onOpenChannel(id) }) }
}

/** Someone's profile, with what you can do about them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserSheet(userId: String, guildId: Long?, onDismiss: () -> Unit, onOpenChannel: (Long) -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val users by store.users.collectAsStateWithLifecycle()
    val friends by store.friends.collectAsStateWithLifecycle()
    val blocked by store.blocked.collectAsStateWithLifecycle()
    val colors by store.memberColors.collectAsStateWithLifecycle()
    val guilds by store.guilds.collectAsStateWithLifecycle()
    val perms by store.guildPermissions.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val me = store.userId
    var user by remember(userId) { mutableStateOf<User?>(users[userId]) }
    var confirmKick by remember { mutableStateOf(false) }

    LaunchedEffect(userId) {
        runCatching { app.api.user(userId) }.onSuccess { user = it; store.rememberUsers(listOf(it)) }
    }
    val u = user
    val friendship = friends.firstOrNull { it.other(me ?: "") == userId }
    val isMe = userId == me
    val accent = parseColor(u?.color) ?: memberColor(guildId?.let { colors[it]?.get(userId) }) ?: fallbackColor(u?.username ?: userId)
    val guild = guildId?.let { g -> guilds.firstOrNull { it.id == g } }
    val canKick = guild != null && !isMe && guild.ownerId != userId && (guild.ownerId == me || perms[guild.id]?.canKick == true)

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 16.dp)) {
            Box(Modifier.fillMaxWidth().height(72.dp).background(accent.copy(alpha = 0.7f)))
            Box(Modifier.padding(start = 20.dp).offset(y = (-36).dp)) {
                // A ring in the sheet's colour around the avatar. Drawn as a background, not a clip,
                // so the status dot over the avatar's edge isn't cut off.
                Box(Modifier.background(MaterialTheme.colorScheme.surfaceContainerLow, CircleShape).padding(5.dp)) {
                    Avatar(userId, u?.username ?: "?", 80.dp, status = if (isMe) null else u?.status ?: "offline")
                }
            }
            Column(Modifier.padding(horizontal = 20.dp).offset(y = (-24).dp)) {
                Text(u?.username ?: "…", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                if (u != null && !isMe) {
                    val expires = parseInstant(u.statusExpiresAt)
                    Text(statusLabel(u.status) + (u.statusMessage.takeIf { it.isNotBlank() }?.let { " — $it" } ?: "") +
                        (expires?.let { " (clears ${formatUntil(it)})" } ?: ""),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!u?.blurb.isNullOrBlank()) {
                    Spacer(Modifier.height(12.dp))
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text("ABOUT", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(4.dp))
                            MarkdownText(u.blurb, edited = false, mentionLabel = { _, id -> "@$id" }, selfMention = { _, _ -> false }, onLink = {})
                        }
                    }
                }
                if (!isMe) {
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Button(onClick = { messages.run(scope) { onOpenChannel(store.openDm(userId).id) } }) { Text("Message") }
                        RowSpacer(8.dp)
                        when {
                            friendship == null -> OutlinedButton(onClick = { messages.run(scope) { store.addFriend(userId); messages.show("Friend request sent") } }) { Text("Add friend") }
                            friendship.incoming(me ?: "") -> OutlinedButton(onClick = { messages.run(scope) { store.addFriend(userId) } }) { Text("Accept request") }
                            friendship.pending -> OutlinedButton(onClick = { messages.run(scope) { store.removeFriend(userId) } }) { Text("Cancel request") }
                            else -> OutlinedButton(onClick = { messages.run(scope) { store.removeFriend(userId) } }) { Text("Remove friend") }
                        }
                    }
                    Row {
                        TextButton(onClick = {
                            messages.run(scope) {
                                if (userId in blocked) store.unblock(userId) else store.block(userId)
                                messages.show(if (userId in blocked) "Unblocked" else "Blocked")
                            }
                        }) { Text(if (userId in blocked) "Unblock" else "Block", color = MaterialTheme.colorScheme.error) }
                        if (canKick) TextButton(onClick = { confirmKick = true }) { Text("Kick from ${guild.name}", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
    if (confirmKick && guild != null) ConfirmDialog("Kick ${u?.username}?", "They can come back with a new invite.", "Kick", destructive = true,
        onDismiss = { confirmKick = false }) {
        confirmKick = false
        messages.run(scope) {
            app.api.kick(guild.id, userId)
            onDismiss()
        }
    }
}
