package net.serble.chat.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.serble.chat.data.HubState
import net.serble.chat.data.parseInstant
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

const val MAX_STATUS_MESSAGE = 128

/** The types a user can pick, in menu order, with the web's labels and descriptions. */
val STATUS_TYPES = listOf(
    Triple("online", "Online", ""),
    Triple("away", "Away", ""),
    Triple("dnd", "Do Not Disturb", "Mutes all notifications and sounds"),
    Triple("invisible", "Invisible", "You'll appear offline"),
)

/** The "Clear after" presets, as on the web. `at` gives the expiry, or null for never. */
private data class Preset(val key: String, val label: String, val at: (ZoneId) -> Instant?)

private val PRESETS = listOf(
    Preset("never", "Don't clear") { null },
    Preset("30m", "30 minutes") { Instant.now().plus(30, ChronoUnit.MINUTES) },
    Preset("1h", "1 hour") { Instant.now().plus(1, ChronoUnit.HOURS) },
    Preset("4h", "4 hours") { Instant.now().plus(4, ChronoUnit.HOURS) },
    Preset("today", "Today") { zone -> LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant() },
    // Until the end of Sunday (the next Monday 00:00)
    Preset("week", "This week") { zone ->
        LocalDate.now(zone).with(TemporalAdjusters.next(DayOfWeek.MONDAY)).atStartOfDay(zone).toInstant()
    },
)

private enum class DurationUnit(val label: String, val minutes: Double) { Minutes("minutes", 1.0), Hours("hours", 60.0), Days("days", 1440.0) }

private val MAX_CUSTOM: Duration = Duration.ofDays(365)
private val timeFormat get() = net.serble.chat.data.Clock.time
private val dateFormat = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)

/** "until 17:30", "until Tue 09:00", "until 12 Nov 2026 09:00". */
fun formatStatusUntil(expires: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
    val local = expires.atZone(zone)
    val now = LocalDate.now(zone)
    val time = timeFormat.format(local)
    if (local.toLocalDate() == now) return "until $time"
    val withinWeek = Duration.between(Instant.now(), expires) < Duration.ofDays(6)
    val day = if (withinWeek) local.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()) else dateFormat.format(local)
    return "until $day $time"
}

/** "in 45 min", "in 3 h 20 min", "in 4 days". */
private fun formatRelative(d: Duration): String {
    val mins = maxOf(1L, Math.round(d.toMillis() / 60000.0))
    if (mins < 60) return "in $mins min"
    if (mins < 48 * 60) {
        val h = mins / 60
        val m = mins % 60
        return if (m != 0L) "in $h h $m min" else "in $h h"
    }
    return "in ${Math.round(mins / 1440.0)} days"
}

/** "today at 18:30", "at the end of tomorrow", "Tuesday at 09:00", "on 12 Nov 2026 at 09:00". */
private fun formatClearTime(at: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
    val local = at.atZone(zone)
    val today = LocalDate.now(zone)
    fun weekday(d: LocalDate) = d.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
    // Exactly midnight reads as the end of the day before, which is how Today and This week are meant
    if (local.toLocalTime() == LocalTime.MIDNIGHT) {
        val before = local.toLocalDate().minusDays(1)
        val diff = ChronoUnit.DAYS.between(today, before)
        when {
            diff == 0L -> return "at the end of today"
            diff == 1L -> return "at the end of tomorrow"
            diff in 2..6 -> return "at the end of ${weekday(before)}"
        }
    }
    val time = timeFormat.format(local)
    return when (ChronoUnit.DAYS.between(today, local.toLocalDate())) {
        0L -> "today at $time"
        1L -> "tomorrow at $time"
        in 2..6 -> "${weekday(local.toLocalDate())} at $time"
        else -> "on ${dateFormat.format(local)} at $time"
    }
}

/** Your profile, status and the way to settings, opened from your avatar. Like the web's status menu. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YouSheet(onDismiss: () -> Unit, onOpenSettings: () -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val account by store.account.collectAsStateWithLifecycle()
    val own by store.ownStatus.collectAsStateWithLifecycle()
    val hub by app.hub.state.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var custom by remember { mutableStateOf(false) }
    val type = own.effectiveType()
    val message = own.effectiveMessage()
    val expires = parseInstant(own.expiresAt)?.takeIf { it.isAfter(Instant.now()) }
    val hasCustom = message.isNotBlank() || type != "online"

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                val a = account
                Avatar(a?.id, a?.username ?: "?", 56.dp, status = if (hub != HubState.Connected) "offline" else if (type == "invisible") "offline" else type)
                RowSpacer(14.dp)
                Column(Modifier.weight(1f)) {
                    Text(a?.username ?: "…", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (expires != null) Text("Clears ${formatStatusUntil(expires).removePrefix("until ").let { "at $it" }}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            val itemColors = ListItemDefaults.colors(containerColor = Color.Transparent)
            STATUS_TYPES.forEach { (t, label, description) ->
                ListItem(
                    headlineContent = { Text(label) },
                    supportingContent = description.takeIf { it.isNotEmpty() }?.let { { Text(it) } },
                    leadingContent = { StatusDot(if (t == "invisible") "offline" else t, size = 14.dp) },
                    trailingContent = { if (t == type) Icon(Icons.Default.Check, "Current", tint = MaterialTheme.colorScheme.primary) },
                    colors = itemColors,
                    modifier = Modifier.clickable {
                        onDismiss()
                        if (t != type) messages.run(scope) {
                            // Picking a type keeps the message and its expiry; without a message the
                            // expiry belonged to the old type, so the new one lasts until changed
                            store.setStatus(t, message, if (message.isNotBlank()) expires else null)
                        }
                    },
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            ListItem(
                headlineContent = { Text(if (message.isNotBlank()) "Edit custom status" else "Set a custom status") },
                leadingContent = { Icon(Icons.Default.Edit, null) },
                colors = itemColors,
                modifier = Modifier.clickable { custom = true },
            )
            if (hasCustom) ListItem(
                headlineContent = { Text("Clear status", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.Default.Close, null, tint = MaterialTheme.colorScheme.error) },
                colors = itemColors,
                modifier = Modifier.clickable {
                    onDismiss()
                    messages.run(scope) { store.clearStatus() }
                },
            )
            ListItem(
                headlineContent = { Text("Settings") },
                leadingContent = { Icon(Icons.Default.Settings, null) },
                colors = itemColors,
                modifier = Modifier.clickable(onClick = onOpenSettings),
            )
        }
    }
    if (custom) CustomStatusDialog(onDismiss = { custom = false; onDismiss() })
}

/**
 * Pick a type, an optional message and when it clears, as the web's "Set your status": presets,
 * or a custom duration, or a custom date and time. A line underneath always says exactly when.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomStatusDialog(onDismiss: () -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val own by store.ownStatus.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val zone = remember { ZoneId.systemDefault() }
    val currentExpiry = remember { parseInstant(own.expiresAt)?.takeIf { it.isAfter(Instant.now()) } }

    var type by remember { mutableStateOf(own.effectiveType()) }
    var message by remember { mutableStateOf(own.effectiveMessage()) }
    // "keep" keeps an existing expiry as it is; otherwise a preset key or "custom"
    var choice by remember { mutableStateOf(if (currentExpiry != null) "keep" else "never") }
    var byTime by remember { mutableStateOf(false) }
    var amount by remember { mutableStateOf("2") }
    var unit by remember { mutableStateOf(DurationUnit.Hours) }
    // Custom time starts at the current expiry, or an hour from now rounded up to the quarter hour
    var at by remember {
        mutableStateOf(currentExpiry?.atZone(zone)?.toLocalDateTime() ?: LocalDateTime.now(zone).plusHours(1).let {
            val rounded = (it.minute + 14) / 15 * 15
            it.withMinute(0).withSecond(0).withNano(0).plusMinutes(rounded.toLong())
        })
    }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    val hasCurrent = own.effectiveMessage().isNotBlank() || own.effectiveType() != "online"

    /** The expiry the form describes, or an error. Worked out afresh each time, so "1 hour" counts from now. */
    fun resolve(): Pair<Instant?, String?> {
        val now = Instant.now()
        return when (choice) {
            "keep" -> currentExpiry to null
            "custom" -> if (!byTime) {
                val n = amount.replace(',', '.').toDoubleOrNull()
                if (n == null || n <= 0) null to "Enter how long it should last."
                else {
                    val d = Duration.ofSeconds((n * unit.minutes * 60).toLong())
                    when {
                        d < Duration.ofMinutes(1) -> null to "It needs to last at least a minute."
                        d > MAX_CUSTOM -> null to "That's over a year. Use “Don't clear” instead."
                        else -> now.plus(d) to null
                    }
                }
            } else {
                val instant = at.atZone(zone).toInstant()
                when {
                    instant <= now.plusSeconds(30) -> null to "Pick a time in the future."
                    Duration.between(now, instant) > MAX_CUSTOM -> null to "That's over a year away. Use “Don't clear” instead."
                    else -> instant to null
                }
            }
            else -> PRESETS.first { it.key == choice }.at(zone) to null
        }
    }
    val (resolved, problem) = resolve()
    val summary = problem ?: resolved?.let { "Clears ${formatClearTime(it, zone)} (${formatRelative(Duration.between(Instant.now(), it))})." }
        ?: "Stays until you change it."

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Set your status") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it.replace(Regex("[\\r\\n]+"), " ").take(MAX_STATUS_MESSAGE) },
                    label = { Text("Message") },
                    placeholder = { Text("What's happening?") },
                    singleLine = true,
                    supportingText = { Text("${message.length}/$MAX_STATUS_MESSAGE · Shown under your name, even while you're offline.") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Text("STATUS", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                STATUS_TYPES.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        pair.forEach { (t, label, _) ->
                            val selected = t == type
                            Surface(
                                onClick = { type = t },
                                shape = RoundedCornerShape(8.dp),
                                color = if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerLow,
                                border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                                modifier = Modifier.weight(1f),
                            ) {
                                Row(Modifier.padding(horizontal = 10.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    StatusDot(if (t == "invisible") "offline" else t, size = 10.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text(label, maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
                STATUS_TYPES.first { it.first == type }.third.takeIf { it.isNotEmpty() }?.let {
                    Text("$it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(14.dp))
                Text("CLEAR AFTER", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                val options = buildList {
                    if (currentExpiry != null) add("keep" to "Keep current (${formatStatusUntil(currentExpiry, zone)})")
                    PRESETS.forEach { add(it.key to it.label) }
                    add("custom" to "Custom…")
                }
                Dropdown(options.first { it.first == choice }.second, options) { choice = it }
                if (choice == "custom") {
                    Spacer(Modifier.height(8.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.padding(10.dp)) {
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                                SegmentedButton(!byTime, { byTime = false }, SegmentedButtonDefaults.itemShape(0, 2)) { Text("For a duration") }
                                SegmentedButton(byTime, { byTime = true }, SegmentedButtonDefaults.itemShape(1, 2)) { Text("Until a time") }
                            }
                            Spacer(Modifier.height(10.dp))
                            if (!byTime) Row(verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    amount, { amount = it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(6) },
                                    label = { Text("How long") }, singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    modifier = Modifier.width(110.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Dropdown(unit.label, DurationUnit.entries.map { it.name to it.label }, Modifier.weight(1f)) { unit = DurationUnit.valueOf(it) }
                            } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                androidx.compose.material3.FilledTonalButton(onClick = { pickDate = true }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.CalendarMonth, null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(dateFormat.format(at))
                                }
                                androidx.compose.material3.FilledTonalButton(onClick = { pickTime = true }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.Schedule, null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(timeFormat.format(at))
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(summary, style = MaterialTheme.typography.bodySmall,
                    color = if (problem != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                if (hasCurrent) {
                    Spacer(Modifier.height(8.dp))
                    TextButton(enabled = !busy, onClick = {
                        busy = true
                        scope.launchCatching({ error = it; busy = false }) {
                            store.clearStatus()
                            onDismiss()
                        }
                    }) { Text("Clear status", color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && problem == null, onClick = {
                val (expiry, err) = resolve()
                if (err != null) return@TextButton
                busy = true
                error = null
                scope.launchCatching({ error = it; busy = false }) {
                    store.setStatus(type, message.trim(), expiry)
                    onDismiss()
                }
            }) { Text(if (busy) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )

    if (pickDate) {
        val today = LocalDate.now(zone)
        val dateState = rememberDatePickerState(
            initialSelectedDateMillis = at.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                    val d = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                    return !d.isBefore(today) && !d.isAfter(today.plusDays(365))
                }
            },
        )
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    dateState.selectedDateMillis?.let { ms ->
                        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        at = LocalDateTime.of(d, at.toLocalTime())
                    }
                    pickDate = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("Cancel") } },
        ) { DatePicker(dateState) }
    }
    if (pickTime) {
        val context = LocalContext.current
        val timeState = rememberTimePickerState(at.hour, at.minute, android.text.format.DateFormat.is24HourFormat(context))
        AlertDialog(
            onDismissRequest = { pickTime = false },
            title = { Text("Clear at") },
            text = { TimePicker(timeState) },
            confirmButton = {
                TextButton(onClick = {
                    at = at.withHour(timeState.hour).withMinute(timeState.minute)
                    pickTime = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text("Cancel") } },
        )
    }
}

/** A read-only text field that opens a menu of options. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Dropdown(label: String, options: List<Pair<String, String>>, modifier: Modifier = Modifier, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }, modifier = modifier) {
        OutlinedTextField(
            value = label, onValueChange = {}, readOnly = true, singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(open, { open = false }) {
            options.forEach { (key, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(key) })
            }
        }
    }
}

private fun kotlinx.coroutines.CoroutineScope.launchCatching(onError: (String) -> Unit, block: suspend () -> Unit) {
    launch {
        try {
            block()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            onError(e.message ?: "Something went wrong.")
        }
    }
}
