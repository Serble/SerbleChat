package net.serble.chat.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit

val MENTION_RE = Regex("<@(user|role|channel):([^>\\s]+)>")
val INVITE_RE = Regex("https?://[^\\s/]+/invite/([a-zA-Z0-9_-]+)")
val MESSAGE_LINK_RE = Regex("https?://[^\\s/]+/app/channel/(\\d+)\\?message=(\\d+)")
val URL_RE = Regex("https?://[^\\s<>()\"']+[^\\s<>()\"'.,;:!?]")

/** What a mention looks like as text: @name, @role or #channel. */
fun mentionLabel(kind: String, id: String, users: Map<String, User>, roles: List<Role>, channel: (Long) -> Channel?): String = when (kind) {
    "user" -> "@" + (users[id]?.username ?: "unknown")
    "role" -> "@" + (roles.firstOrNull { it.id.toString() == id }?.name ?: "role")
    "channel" -> "#" + (id.toLongOrNull()?.let(channel)?.name ?: "channel")
    else -> "@$id"
}

/** Message content for places that can't show formatting: notifications and reply previews. */
fun plainText(content: String, users: Map<String, User>, roles: List<Role>, channel: (Long) -> Channel?): String {
    var text = MENTION_RE.replace(content) { m -> mentionLabel(m.groupValues[1], m.groupValues[2], users, roles, channel) }
    text = text
        .replace(Regex("```[a-zA-Z0-9]*\\n?"), "")
        .replace(Regex("(\\*\\*|__|~~|\\|\\|)"), "")
        .replace(Regex("(?<![\\w*])[*_](?=\\S)(.+?)(?<=\\S)[*_](?![\\w*])"), "$1")
        .replace(Regex("^#{1,6}\\s+", RegexOption.MULTILINE), "")
        .replace(Regex("^>\\s?", RegexOption.MULTILINE), "")
        .replace(Regex("\\[([^\\]]+)]\\(([^)]+)\\)"), "$1")
    return text.trim()
}

/** Follows the phone's 12/24-hour setting; [init] reads it (again on each resume, as it can change). */
object Clock {
    @Volatile var use24h: Boolean = true

    fun init(context: android.content.Context) {
        use24h = android.text.format.DateFormat.is24HourFormat(context)
    }

    val time: DateTimeFormatter get() = if (use24h) H24 else H12
    private val H24 = DateTimeFormatter.ofPattern("HH:mm")
    private val H12 = DateTimeFormatter.ofPattern("h:mm a")
}

private val timeFormat get() = Clock.time
private val dateFormat = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)

/** "14:05", "Yesterday 14:05" or "3 Feb 2026 14:05". */
fun formatMessageTime(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
    val local = instant.atZone(zone)
    val today = LocalDate.now(zone)
    val time = timeFormat.format(local)
    return when (ChronoUnit.DAYS.between(local.toLocalDate(), today)) {
        0L -> time
        1L -> "Yesterday $time"
        else -> "${dateFormat.format(local)} $time"
    }
}

fun formatTime(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String = timeFormat.format(instant.atZone(zone))

/** A day divider's label. */
fun formatDay(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
    val day = instant.atZone(zone).toLocalDate()
    return when (ChronoUnit.DAYS.between(day, LocalDate.now(zone))) {
        0L -> "Today"
        1L -> "Yesterday"
        else -> dateFormat.format(day)
    }
}

/** "in 5 minutes", "in 2 hours"... for when a status or poll ends. */
fun formatUntil(instant: Instant, now: Instant = Instant.now()): String {
    val minutes = ChronoUnit.MINUTES.between(now, instant)
    return when {
        minutes < 1 -> "in under a minute"
        minutes < 60 -> "in $minutes minute${if (minutes == 1L) "" else "s"}"
        minutes < 60 * 24 -> (minutes / 60).let { "in $it hour${if (it == 1L) "" else "s"}" }
        else -> (minutes / (60 * 24)).let { "in $it day${if (it == 1L) "" else "s"}" }
    }
}
