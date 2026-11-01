package net.serble.chat.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import net.serble.chat.data.Poll
import net.serble.chat.data.formatUntil
import net.serble.chat.data.parseInstant

@Composable
fun PollCard(poll: Poll, canManage: Boolean) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    val me = app.store.userId ?: ""
    val ended = poll.ended()
    val total = poll.options.sumOf { it.voterIds.size }
    val voters = poll.options.flatMap { it.voterIds }.toSet().size
    val mine = poll.options.filter { me in it.voterIds }.map { it.id }

    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.padding(top = 4.dp).widthIn(max = 460.dp).fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(poll.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(if (poll.allowMultiple) "Pick any" else "Pick one", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            poll.options.forEach { option ->
                val count = option.voterIds.size
                val share by animateFloatAsState(if (total == 0) 0f else count.toFloat() / total, label = "share")
                val chosen = option.id in mine
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .border(1.dp, if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
                        .clickable(enabled = !ended) {
                            val next = when {
                                poll.allowMultiple -> if (chosen) mine - option.id else mine + option.id
                                chosen -> emptyList()
                                else -> listOf(option.id)
                            }
                            messages.run(scope) { app.store.vote(poll, next) }
                        }
                        .heightIn(min = 44.dp),
                ) {
                    Box(Modifier.matchParentSize()) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(share).background(MaterialTheme.colorScheme.primary.copy(alpha = if (chosen) 0.28f else 0.14f)))
                    }
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (chosen) {
                            Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.size(8.dp))
                        }
                        Text(option.text, modifier = Modifier.weight(1f))
                        Text(if (total == 0) "0%" else "${(count * 100f / total).toInt()}%", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val expires = parseInstant(poll.expiresAt)
                val status = when {
                    poll.closedAt != null -> "Ended"
                    ended -> "Ended"
                    expires != null -> "Ends ${formatUntil(expires)}"
                    else -> "Open"
                }
                Text("$voters ${if (voters == 1) "vote" else "votes"} · $status", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                if (!ended && (poll.authorId == me || canManage)) {
                    TextButton(onClick = { messages.run(scope) { app.api.closePoll(poll.channelId, poll.id) } }) { Text("End poll") }
                }
            }
        }
    }
}

private val durations = listOf<Pair<String, Long?>>(
    "1 hour" to 3600L,
    "1 day" to 86_400L,
    "1 week" to 604_800L,
    "No end" to null,
)

@Composable
fun CreatePollDialog(channelId: Long, onDismiss: () -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiple by remember { mutableStateOf(false) }
    var duration by remember { mutableStateOf<Long?>(86_400L) }
    val filled = options.map { it.trim() }.filter { it.isNotEmpty() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create poll") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(question, { question = it }, label = { Text("Question") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                options.forEachIndexed { i, text ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(text, { options[i] = it }, label = { Text("Option ${i + 1}") }, singleLine = true, modifier = Modifier.weight(1f))
                        if (options.size > 2) IconButton(onClick = { options.removeAt(i) }) { Icon(Icons.Default.Close, "Remove option") }
                    }
                }
                if (options.size < 10) TextButton(onClick = { options.add("") }) { Text("Add option") }
                Row(Modifier.fillMaxWidth().clickable { multiple = !multiple }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(multiple, { multiple = it })
                    Text("Let people pick more than one")
                }
                Spacer(Modifier.height(8.dp))
                Text("Voting closes after", style = MaterialTheme.typography.labelLarge)
                Row {
                    durations.forEach { (label, seconds) ->
                        FilterChip(selected = duration == seconds, onClick = { duration = seconds }, label = { Text(label) }, modifier = Modifier.padding(end = 4.dp))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = question.isNotBlank() && filled.size >= 2, onClick = {
                messages.run(scope) {
                    app.api.createPoll(channelId, question.trim(), filled, multiple, duration)
                    onDismiss()
                }
            }) { Text("Post") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
