package net.serble.chat.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import net.serble.chat.data.LocalSettings
import net.serble.chat.data.NoiseSuppression
import net.serble.chat.data.formatUntil
import net.serble.chat.data.parseInstant
import java.time.Instant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onOpenAppearance: () -> Unit, onOpenBlocked: () -> Unit, onOpenFiles: () -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val account by store.account.collectAsStateWithLifecycle()
    val own by store.ownStatus.collectAsStateWithLifecycle()
    val local by app.settings.settings.collectAsState(initial = LocalSettings())
    val push by app.push.status.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var statusDialog by remember { mutableStateOf(false) }
    var editProfile by remember { mutableStateOf(false) }
    var distributors by remember { mutableStateOf(false) }
    var signOut by remember { mutableStateOf(false) }
    var defaultsFor by remember { mutableStateOf<String?>(null) }

    fun patch(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) = messages.run(scope) { store.updateAccount(buildJsonObject(build)) }

    Scaffold(modifier = Modifier.swipeBack(), topBar = {
        TopAppBar(title = { Text("Settings") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            val a = account
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(a?.id, a?.username ?: "?", 64.dp, status = own.effectiveType().let { if (it == "invisible") "offline" else it })
                RowSpacer(16.dp)
                Column(Modifier.weight(1f)) {
                    Text(a?.username ?: "…", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    val expires = parseInstant(own.expiresAt)
                    Text(statusLabel(own.effectiveType()) + (own.effectiveMessage().takeIf { it.isNotBlank() }?.let { " — $it" } ?: "") +
                        (expires?.takeIf { it.isAfter(Instant.now()) }?.let { " · clears ${formatUntil(it)}" } ?: ""),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            SettingRow("Set status", "Online, away, do not disturb or invisible, with a message") { statusDialog = true }
            SettingRow("Edit profile", "About me and profile colour") { editProfile = true }
            SettingRow("Blocked users", "See and unblock people you've blocked", onOpenBlocked)
            SettingRow("Serble Files", "Where your attachments are stored, and how much room is left", onOpenFiles)

            SectionLabel("Notifications")
            SwitchRow("Push notifications", "On this phone, when the app isn't open", local.pushEnabled) { on ->
                scope.launch { app.push.setEnabled(on) }
            }
            if (local.pushEnabled) {
                SettingRow("Delivered by", push.distributor?.label ?: "Not set up") { distributors = true }
                push.problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp)) }
                if (push.problem == null && push.distributor != null && !push.registered) Text("Connecting to the push service…", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
            }
            if (a != null) {
                SwitchRow("Show message text", "Include what was said in notifications", a.webPushIncludeContent) { on -> patch { put("webPushIncludeContent", on) } }
                SwitchRow("Notify while away", "Still send notifications when your status is Away", a.notificationsWhileAway) { on -> patch { put("notificationsWhileAway", on) } }
                SwitchRow("Notify while online elsewhere", "Also notify this phone when you're active on another device", a.notificationsWhileOnline) { on -> patch { put("notificationsWhileOnline", on) } }
                SettingRow("Direct messages", levelLabel(a.defaultDmNotificationPreferences.notifications)) { defaultsFor = "Dm" }
                SettingRow("Group chats", levelLabel(a.defaultGroupNotificationPreferences.notifications)) { defaultsFor = "Group" }
                SettingRow("Guilds", levelLabel(a.defaultGuildNotificationPreferences.notifications)) { defaultsFor = "Guild" }
            }
            SettingRow("Sounds and vibration", "Android's settings for each kind of notification") {
                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
            }

            SectionLabel("Voice")
            Text("Noise suppression", fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            NoiseSuppression.entries.forEach { mode ->
                Row(
                    Modifier.fillMaxWidth().selectable(local.noiseSuppression == mode, role = Role.RadioButton) {
                        scope.launch { app.settings.update { it.copy(noiseSuppression = mode) } }
                        app.voice.applyNoiseSuppression(mode)
                    }.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(local.noiseSuppression == mode, null)
                    RowSpacer(8.dp)
                    Column {
                        Text(mode.label)
                        Text(mode.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (app.voice.call.collectAsStateWithLifecycle().value != null) {
                Text("Switching to or from Standard applies from your next call.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
            }
            SwitchRow("Echo cancellation", "Stops others hearing themselves through your speaker", local.echoCancellation) { on ->
                scope.launch { app.settings.update { it.copy(echoCancellation = on) } }
            }
            SwitchRow("Automatic gain", "Evens out how loud you are", local.autoGainControl) { on ->
                scope.launch { app.settings.update { it.copy(autoGainControl = on) } }
            }
            SwitchRow("Call sounds", "When people join or leave, start or stop streaming, and when you mute or deafen", local.callSounds) { on ->
                scope.launch { app.settings.update { it.copy(callSounds = on) } }
            }

            SectionLabel("Appearance")
            val theme by app.themes.active.collectAsStateWithLifecycle()
            SettingRow("Theme", theme.name + " · shared with the web app", onOpenAppearance)

            Spacer(Modifier.height(16.dp))
            HorizontalDivider()
            ListItem(
                headlineContent = { Text("Sign out", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { signOut = true },
            )
            Spacer(Modifier.height(24.dp))
        }
    }

    if (statusDialog) CustomStatusDialog(onDismiss = { statusDialog = false })
    if (editProfile) account?.let { a ->
        ProfileDialog(a.blurb, a.color, onDismiss = { editProfile = false }) { blurb, color ->
            editProfile = false
            patch {
                put("blurb", blurb)
                put("color", color)
            }
        }
    }
    if (distributors) {
        val list = remember { app.push.distributors() }
        AlertDialog(
            onDismissRequest = { distributors = false },
            title = { Text("Deliver notifications with") },
            text = {
                Column {
                    if (list.isEmpty()) Text("No push apps found. Install ntfy (or another UnifiedPush app) to get notifications.")
                    list.forEach { d ->
                        Row(Modifier.fillMaxWidth().selectable(push.distributor?.packageName == d.packageName) {
                            distributors = false
                            app.push.useDistributor(d.packageName)
                        }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(push.distributor?.packageName == d.packageName, null)
                            RowSpacer(8.dp)
                            Column {
                                Text(d.label)
                                Text(if (d.builtIn) "Google's push service, built in" else "UnifiedPush app", style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { distributors = false }) { Text("Close") } },
        )
    }
    defaultsFor?.let { kind ->
        val a = account ?: return@let
        val current = when (kind) {
            "Dm" -> a.defaultDmNotificationPreferences
            "Group" -> a.defaultGroupNotificationPreferences
            else -> a.defaultGuildNotificationPreferences
        }
        var level by remember(kind) { mutableStateOf(current.notifications) }
        AlertDialog(
            onDismissRequest = { defaultsFor = null },
            title = { Text(when (kind) { "Dm" -> "Direct messages"; "Group" -> "Group chats"; else -> "Guilds" }) },
            text = { Column { Text("By default, notify me about"); LevelPicker(level, includeDefault = false) { level = it } } },
            confirmButton = {
                TextButton(onClick = {
                    defaultsFor = null
                    patch {
                        putJsonObject("default${kind}NotificationPreferences") {
                            put("notifications", level)
                            put("unreads", current.unreads)
                        }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { defaultsFor = null }) { Text("Cancel") } },
        )
    }
    if (signOut) ConfirmDialog("Sign out?", "Notifications stop on this phone until you sign back in.", "Sign out", destructive = true,
        onDismiss = { signOut = false }) {
        signOut = false
        scope.launch { app.signOut() }
    }
}

private fun levelLabel(level: Int) = when (level) {
    1 -> "All messages"
    2 -> "Only mentions"
    3 -> "Nothing"
    else -> "Default"
}

@Composable
private fun SettingRow(title: String, sub: String?, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = sub?.let { { Text(it) } },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun SwitchRow(title: String, sub: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = sub?.let { { Text(it) } },
        trailingContent = { Switch(checked, onChange) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable { onChange(!checked) },
    )
}

@Composable
private fun ProfileDialog(blurb: String, color: String, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var about by remember { mutableStateOf(blurb) }
    var hex by remember { mutableStateOf(color) }
    val swatches = listOf("", "#7c3aed", "#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#1abc9c")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit profile") },
        text = {
            Column {
                OutlinedTextField(about, { about = it }, label = { Text("About me") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                Text("Profile colour", style = MaterialTheme.typography.labelLarge)
                Row(Modifier.padding(vertical = 8.dp)) {
                    swatches.forEach { s ->
                        val c = parseColor(s)
                        Box(
                            Modifier.padding(end = 6.dp).size(30.dp)
                                .clip(CircleShape)
                                .background(c ?: MaterialTheme.colorScheme.surfaceContainerHighest)
                                .clickable { hex = s },
                        ) {
                            if (hex.equals(s, ignoreCase = true)) Text("✓", color = Color.White, modifier = Modifier.align(Alignment.Center))
                        }
                    }
                }
                OutlinedTextField(hex, { hex = it }, label = { Text("Hex colour") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(onClick = { onSave(about.trim(), hex.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
