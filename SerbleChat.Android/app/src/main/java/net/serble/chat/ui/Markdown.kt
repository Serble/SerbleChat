package net.serble.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.serble.chat.data.MENTION_RE
import net.serble.chat.ui.theme.ChatColors
import net.serble.chat.ui.theme.LocalChatColors

/** What a tap on something inside a message asks for. */
sealed interface MessageLink {
    data class Url(val url: String) : MessageLink
    data class UserMention(val userId: String) : MessageLink
    data class ChannelMention(val channelId: Long) : MessageLink
}

private sealed interface Block {
    data class Paragraph(val text: String) : Block
    data class Heading(val level: Int, val text: String) : Block
    data class Quote(val text: String) : Block
    data class Code(val code: String) : Block
    data class ListItem(val marker: String, val text: String) : Block
}

/** Splits content into the block-level pieces the web's remark (GFM + breaks) would find. */
private fun parseBlocks(content: String): List<Block> {
    val blocks = mutableListOf<Block>()
    val lines = content.replace("\r\n", "\n").split("\n")
    val paragraph = StringBuilder()
    fun flush() {
        if (paragraph.isNotEmpty()) {
            blocks += Block.Paragraph(paragraph.toString().trimEnd('\n'))
            paragraph.clear()
        }
    }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trimStart()
        when {
            trimmed.startsWith("```") -> {
                flush()
                val code = StringBuilder()
                val rest = trimmed.removePrefix("```")
                // ```one line``` on a single line
                if (rest.endsWith("```") && rest.length >= 3) {
                    blocks += Block.Code(rest.removeSuffix("```"))
                    i++
                    continue
                }
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    code.append(lines[i]).append('\n')
                    i++
                }
                blocks += Block.Code(code.toString().trimEnd('\n'))
            }
            Regex("^#{1,3}\\s+").containsMatchIn(trimmed) -> {
                flush()
                val level = trimmed.takeWhile { it == '#' }.length
                blocks += Block.Heading(level, trimmed.drop(level).trim())
            }
            trimmed.startsWith(">") -> {
                flush()
                val quote = StringBuilder()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    quote.append(lines[i].trimStart().removePrefix(">").removePrefix(" ")).append('\n')
                    i++
                }
                blocks += Block.Quote(quote.toString().trimEnd('\n'))
                continue
            }
            Regex("^([-*+])\\s+").containsMatchIn(trimmed) -> {
                flush()
                blocks += Block.ListItem("•", trimmed.drop(1).trim())
            }
            Regex("^\\d+[.)]\\s+").containsMatchIn(trimmed) -> {
                flush()
                val marker = trimmed.takeWhile { it.isDigit() } + "."
                blocks += Block.ListItem(marker, trimmed.dropWhile { it.isDigit() }.drop(1).trim())
            }
            line.isBlank() -> flush()
            else -> paragraph.append(line).append('\n')
        }
        i++
    }
    flush()
    return blocks
}

private val INLINE = Regex(
    "(`[^`\\n]+`)" +                                  // 1 code
        "|(\\*\\*(?=\\S)([\\s\\S]+?)(?<=\\S)\\*\\*)" +    // 2,3 bold
        "|(__(?=\\S)([\\s\\S]+?)(?<=\\S)__)" +            // 4,5 bold (GFM)
        "|(~~(?=\\S)([\\s\\S]+?)(?<=\\S)~~)" +            // 6,7 strikethrough
        "|((?<![\\w*])\\*(?=\\S)([\\s\\S]+?)(?<=\\S)\\*(?![\\w*]))" + // 8,9 italic *
        "|((?<![\\w_])_(?=\\S)([\\s\\S]+?)(?<=\\S)_(?![\\w_]))" +     // 10,11 italic _
        "|(\\[([^\\]]+)]\\((https?://[^)\\s]+)\\))" +    // 12,13,14 link
        "|(<@(user|role|channel):([^>\\s]+)>)" +         // 15,16,17 mention
        "|(https?://[^\\s<>()\"']+[^\\s<>()\"'.,;:!?])"   // 18 bare url
)

/** Message text with formatting, mentions and links, as one annotated string. */
fun buildInline(
    text: String,
    colors: ChatColors,
    codeColor: androidx.compose.ui.graphics.Color,
    mentionLabel: (kind: String, id: String) -> String,
    selfMention: (kind: String, id: String) -> Boolean,
    onLink: (MessageLink) -> Unit,
): AnnotatedString = buildAnnotatedString {
    fun render(source: String) {
        var last = 0
        for (m in INLINE.findAll(source)) {
            if (m.range.first > last) append(source.substring(last, m.range.first))
            val g = m.groups
            when {
                g[1] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = colors.codeBg, color = codeColor, fontSize = 13.5.sp)) {
                    append(" " + g[1]!!.value.trim('`') + " ")
                }
                g[2] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(g[3]!!.value) }
                g[4] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(g[5]!!.value) }
                g[6] != null -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(g[7]!!.value) }
                g[8] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[9]!!.value) }
                g[10] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[11]!!.value) }
                g[12] != null -> {
                    val url = g[14]!!.value
                    withLink(LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = colors.link))) { onLink(MessageLink.Url(url)) }) {
                        append(g[13]!!.value)
                    }
                }
                g[15] != null -> {
                    val kind = g[16]!!.value
                    val id = g[17]!!.value
                    val self = selfMention(kind, id)
                    val style = SpanStyle(
                        color = colors.mention,
                        background = if (self) colors.mentionBg.copy(alpha = 0.6f) else colors.mentionBg,
                        fontWeight = FontWeight.Medium,
                    )
                    val link: MessageLink? = when (kind) {
                        "user" -> MessageLink.UserMention(id)
                        "channel" -> id.toLongOrNull()?.let { MessageLink.ChannelMention(it) }
                        else -> null
                    }
                    if (link != null) {
                        withLink(LinkAnnotation.Clickable("$kind:$id", TextLinkStyles(style)) { onLink(link) }) {
                            append(mentionLabel(kind, id))
                        }
                    } else withStyle(style) { append(mentionLabel(kind, id)) }
                }
                g[18] != null -> {
                    val url = g[18]!!.value
                    withLink(LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = colors.link))) { onLink(MessageLink.Url(url)) }) {
                        append(url)
                    }
                }
            }
            last = m.range.last + 1
        }
        if (last < source.length) append(source.substring(last))
    }
    render(text)
}

/** Whether a message is only emoji (shown bigger, as on the web). */
private fun isJumbo(content: String): Boolean {
    val trimmed = content.trim()
    if (trimmed.isEmpty() || trimmed.length > 24) return false
    return trimmed.codePoints().allMatch { cp ->
        Character.isWhitespace(cp) || cp == 0x200D || cp == 0xFE0F || cp in 0x1F000..0x1FAFF || cp in 0x2600..0x27BF || cp in 0x1F1E6..0x1F1FF
    } && MENTION_RE.find(trimmed) == null
}

@Composable
fun MarkdownText(
    content: String,
    edited: Boolean,
    mentionLabel: (kind: String, id: String) -> String,
    selfMention: (kind: String, id: String) -> Boolean,
    onLink: (MessageLink) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalChatColors.current
    val scheme = MaterialTheme.colorScheme
    val blocks = remember(content) { parseBlocks(content) }
    val body = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.5.sp, lineHeight = 21.sp, color = scheme.onSurface)
    val jumbo = remember(content) { isJumbo(content) }
    Column(modifier) {
        blocks.forEachIndexed { index, block ->
            val isLast = index == blocks.lastIndex
            fun inline(text: String) = buildInline(text, colors, scheme.onSurface, mentionLabel, selfMention, onLink).let { built ->
                if (isLast && edited) buildAnnotatedString {
                    append(built)
                    withStyle(SpanStyle(fontSize = 11.sp, color = scheme.onSurfaceVariant)) { append(" (edited)") }
                } else built
            }
            when (block) {
                is Block.Paragraph -> Text(inline(block.text), style = if (jumbo) body.copy(fontSize = 40.sp, lineHeight = 46.sp) else body)
                is Block.Heading -> Text(inline(block.text), style = body.copy(
                    fontSize = when (block.level) { 1 -> 22.sp; 2 -> 19.sp; else -> 17.sp },
                    fontWeight = FontWeight.Bold, lineHeight = 28.sp))
                is Block.ListItem -> Row(Modifier.padding(start = 4.dp)) {
                    Text(block.marker, style = body, modifier = Modifier.width(22.dp))
                    Text(inline(block.text), style = body)
                }
                is Block.Quote -> Row(Modifier.height(IntrinsicSize.Min).padding(vertical = 2.dp)) {
                    Box(Modifier.width(4.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(scheme.outline))
                    Spacer(Modifier.width(10.dp))
                    Text(inline(block.text), style = body)
                }
                is Block.Code -> SelectionContainer {
                    Box(
                        Modifier
                            .padding(vertical = 4.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .background(colors.codeBg)
                            .horizontalScroll(rememberScrollState())
                            .padding(10.dp),
                    ) {
                        Text(block.code, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 18.sp, color = scheme.onSurface)
                    }
                }
            }
        }
    }
}
