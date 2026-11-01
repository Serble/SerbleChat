package net.serble.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.serble.chat.data.GuildMember

/** Guild name, members and the guild itself. Roles and permissions stay on the web app for now. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuildSettingsScreen(guildId: Long, onBack: () -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val guilds by store.guilds.collectAsStateWithLifecycle()
    val perms by store.guildPermissions.collectAsStateWithLifecycle()
    val roles by store.roles.collectAsStateWithLifecycle()
    val guild = guilds.firstOrNull { it.id == guildId }
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var members by remember { mutableStateOf<List<GuildMember>>(emptyList()) }
    var rename by remember { mutableStateOf(false) }
    var delete by remember { mutableStateOf(false) }
    var profile by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(guildId) { members = runCatching { store.loadGuildMembers(guildId) }.getOrDefault(emptyList()) }
    LaunchedEffect(guild == null) { if (guild == null) onBack() }
    if (guild == null) return
    val owner = guild.ownerId == store.userId
    val my = perms[guildId]

    Scaffold(modifier = Modifier.swipeBack(), topBar = {
        TopAppBar(title = { Text(guild.name) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (owner || my?.canManageGuild == true) item {
                ListItem(headlineContent = { Text("Name") }, supportingContent = { Text(guild.name) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent), modifier = Modifier.clickable { rename = true })
            }
            val guildRoles = roles[guildId].orEmpty().sortedByDescending { it.priority }
            if (guildRoles.isNotEmpty()) {
                item { SectionLabel("Roles") }
                items(guildRoles, key = { "r" + it.id }) { role ->
                    ListItem(
                        headlineContent = { Text(role.name, color = parseColor(role.color) ?: MaterialTheme.colorScheme.onSurface) },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                }
            }
            item { SectionLabel("Members — ${members.size}") }
            items(members, key = { it.user.id }) { m ->
                ListRow(selected = false, onClick = { profile = m.user.id }) {
                    Avatar(m.user.id, m.user.username, 36.dp, status = m.user.status)
                    RowSpacer()
                    NameLine(m.user.username, if (m.user.id == guild.ownerId) "Owner" else null, Modifier.weight(1f),
                        nameColor = memberColor(m.color) ?: Color.Unspecified)
                }
            }
            if (owner) item {
                SectionLabel("Danger zone")
                ListItem(headlineContent = { Text("Delete guild", color = MaterialTheme.colorScheme.error) },
                    supportingContent = { Text("Removes every channel and message for everyone.") },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent), modifier = Modifier.clickable { delete = true })
            }
            item { Column(Modifier.padding(16.dp)) { Text("Roles and permissions can be edited in the web app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        }
    }

    if (rename) TextPromptDialog("Rename guild", "Name", "Save", initial = guild.name, onDismiss = { rename = false }) { name ->
        rename = false
        messages.run(scope) { store.renameGuild(guildId, name) }
    }
    if (delete) ConfirmDialog("Delete ${guild.name}?", "Everything in it goes, for everyone. This can't be undone.", "Delete", destructive = true,
        onDismiss = { delete = false }) {
        delete = false
        messages.run(scope) {
            store.deleteGuild(guildId)
            onBack()
        }
    }
    profile?.let { UserSheet(it, guildId, onDismiss = { profile = null }, onOpenChannel = { profile = null }) }
}
