package net.serble.chat.ui

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import net.serble.chat.BuildConfig
import net.serble.chat.data.Channel
import net.serble.chat.data.ChannelNotifPrefs
import net.serble.chat.data.Invite
import net.serble.chat.data.NotifPrefs
import net.serble.chat.data.NotifyLevel

/** Create a guild, or join one with an invite link or code. */
@Composable
fun AddGuildDialog(onDismiss: () -> Unit, onDone: (Long) -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var joining by remember { mutableStateOf(false) }
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (joining) "Join a guild" else "Create a guild") },
        text = {
            Column {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(!joining, { joining = false; value = "" }, SegmentedButtonDefaults.itemShape(0, 2)) { Text("Create") }
                    SegmentedButton(joining, { joining = true; value = "" }, SegmentedButtonDefaults.itemShape(1, 2)) { Text("Join") }
                }
                Spacer(Modifier.height(16.dp))
                OutlinedTextField(
                    value, { value = it },
                    label = { Text(if (joining) "Invite link or code" else "Guild name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = value.isNotBlank() && !busy, onClick = {
                busy = true
                messages.run(scope) {
                    try {
                        if (joining) {
                            val code = value.trim().substringAfterLast("/invite/").substringAfterLast('/').trim()
                            val guild = app.store.joinInvite(code) ?: return@run
                            onDone(guild.id)
                        } else {
                            onDone(app.store.createGuild(value.trim()).id)
                        }
                    } finally {
                        busy = false
                    }
                }
            }) { Text(if (joining) "Join" else "Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Start a group chat with some friends. */
@Composable
fun CreateGroupDialog(onDismiss: () -> Unit, onCreated: (Long) -> Unit, addTo: Long? = null) {
    val app = LocalApp.current
    val store = app.store
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val friends by store.friends.collectAsState()
    val users by store.users.collectAsState()
    val me = store.userId ?: ""
    val picked = remember { mutableStateListOf<String>() }
    var name by remember { mutableStateOf("") }
    val accepted = friends.filter { !it.pending }.map { it.other(me) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (addTo == null) "New group" else "Add people") },
        text = {
            Column {
                if (addTo == null) {
                    OutlinedTextField(name, { name = it }, label = { Text("Group name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(12.dp))
                }
                if (accepted.isEmpty()) Text("Add some friends first: groups are made from your friends.")
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(accepted) { id ->
                        val user = users[id]
                        Row(
                            Modifier.fillMaxWidth().clickable { if (id in picked) picked.remove(id) else picked.add(id) }.padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(id in picked, null)
                            RowSpacer(8.dp)
                            Avatar(id, user?.username ?: "?", 32.dp)
                            RowSpacer(10.dp)
                            Text(user?.username ?: "…")
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = picked.isNotEmpty() && (addTo != null || name.isNotBlank()), onClick = {
                messages.run(scope) {
                    if (addTo != null) {
                        app.api.addGroupMembers(addTo, picked.toList())
                        onCreated(addTo)
                    } else onCreated(store.createGroup(name.trim(), picked.toList()).channelId)
                }
            }) { Text(if (addTo == null) "Create" else "Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun inviteLink(id: String) = "${BuildConfig.FRONTEND_URL.trimEnd('/')}/invite/$id"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(guildId: Long, onDismiss: () -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val copy = rememberCopy()
    val context = LocalContext.current
    var invites by remember { mutableStateOf<List<Invite>>(emptyList()) }
    var created by remember { mutableStateOf<Invite?>(null) }

    LaunchedEffect(guildId) {
        runCatching { app.api.invites(guildId) }.onSuccess { invites = it }
        if (invites.isEmpty()) runCatching { app.api.createInvite(guildId) }.onSuccess { created = it; invites = listOf(it) }
        else created = invites.last()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp)) {
            Text("Invite people", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text("Anyone with the link can join.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            val link = created?.let { inviteLink(it.id) }
            OutlinedTextField(link ?: "Creating…", {}, readOnly = true, singleLine = true, modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
            Spacer(Modifier.height(12.dp))
            Row {
                Button(enabled = link != null, onClick = {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, link)
                    }, "Share invite"))
                }) {
                    Icon(Icons.Default.Share, null)
                    RowSpacer(8.dp)
                    Text("Share")
                }
                RowSpacer(8.dp)
                OutlinedButton(enabled = link != null, onClick = {
                    copy(link!!)
                    messages.show("Link copied")
                }) {
                    Icon(Icons.Default.ContentCopy, null)
                    RowSpacer(8.dp)
                    Text("Copy")
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = {
                    messages.run(scope) {
                        val fresh = app.api.createInvite(guildId)
                        created = fresh
                        invites = invites + fresh
                    }
                }) { Text("New link") }
            }
            if (invites.size > 1) {
                Spacer(Modifier.height(16.dp))
                SectionLabel("Active invites", Modifier.padding(start = 0.dp))
                invites.forEach { inv ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(inv.id, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                        IconButton(onClick = {
                            messages.run(scope) {
                                app.api.deleteInvite(inv.id)
                                invites = invites - inv
                                if (created == inv) created = invites.lastOrNull()
                            }
                        }) { Icon(Icons.Default.Delete, "Delete invite") }
                    }
                }
            }
        }
    }
}

/** Create a channel, or edit/delete an existing one. */
@Composable
fun ChannelDialog(guildId: Long, channel: Channel?, onDismiss: () -> Unit, onNotifications: (() -> Unit)? = null) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(channel?.name ?: "") }
    var voice by remember { mutableStateOf(channel?.voiceCapable ?: false) }
    var confirmDelete by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (channel == null) "Create channel" else "Edit #${channel.name}") },
        text = {
            Column {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth().clickable { voice = !voice }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Voice")
                        Text("People can talk in this channel as well as type.", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(voice, { voice = it })
                }
                if (channel != null) {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    if (onNotifications != null) TextButton(onClick = onNotifications) { Text("Notification settings") }
                    TextButton(onClick = { confirmDelete = true }) { Text("Delete channel", color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank(), onClick = {
                messages.run(scope) {
                    if (channel == null) app.api.createChannel(guildId, name.trim(), voice)
                    else app.api.updateChannel(guildId, channel.id, name.trim(), voice)
                    app.store.loadGuildChannels(guildId)
                    onDismiss()
                }
            }) { Text(if (channel == null) "Create" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
    if (confirmDelete && channel != null) ConfirmDialog("Delete #${channel.name}?", "Its messages go with it. This can't be undone.", "Delete",
        destructive = true, onDismiss = { confirmDelete = false }, onConfirm = {
            confirmDelete = false
            messages.run(scope) {
                app.api.deleteChannel(guildId, channel.id)
                app.store.loadGuildChannels(guildId)
                onDismiss()
            }
        })
}

private val levelNames = listOf(
    NotifyLevel.INHERIT to "Default",
    NotifyLevel.ALL to "All messages",
    NotifyLevel.MENTIONS to "Only mentions",
    NotifyLevel.NOTHING to "Nothing",
)

/** Notification and unread settings for a guild or a channel. */
@Composable
fun NotificationPrefsDialog(title: String, guildId: Long?, channelId: Long?, onDismiss: () -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var notifications by remember { mutableStateOf<Int?>(null) }
    var unreads by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(guildId, channelId) {
        runCatching {
            if (channelId != null) app.store.channelPrefs(channelId).let { notifications = it.notifications; unreads = it.unreads }
            else if (guildId != null) app.store.guildPrefs(guildId).let { notifications = it.notifications; unreads = it.unreads }
        }.onFailure { messages.show(it.message ?: "Couldn't load settings") }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                if (notifications == null) Text("Loading…") else {
                    Text("Notify me about", fontWeight = FontWeight.SemiBold)
                    LevelPicker(notifications!!) { notifications = it }
                    Spacer(Modifier.height(12.dp))
                    Text("Show as unread", fontWeight = FontWeight.SemiBold)
                    LevelPicker(unreads!!) { unreads = it }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = notifications != null, onClick = {
                messages.run(scope) {
                    if (channelId != null) app.store.setChannelPrefs(channelId, ChannelNotifPrefs(notifications!!, unreads!!))
                    else if (guildId != null) app.store.setGuildPrefs(guildId, NotifPrefs(notifications!!, unreads!!))
                    onDismiss()
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun LevelPicker(value: Int, includeDefault: Boolean = true, onChange: (Int) -> Unit) {
    Column(Modifier.selectableGroup()) {
        levelNames.filter { includeDefault || it.first != NotifyLevel.INHERIT }.forEach { (level, label) ->
            Row(
                Modifier.fillMaxWidth().selectable(value == level, role = Role.RadioButton) { onChange(level) }.padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(value == level, null)
                RowSpacer(8.dp)
                Text(label)
            }
        }
    }
}
