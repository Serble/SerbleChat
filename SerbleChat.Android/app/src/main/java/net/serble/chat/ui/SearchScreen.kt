package net.serble.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import net.serble.chat.data.ApiException
import net.serble.chat.data.Message
import net.serble.chat.data.formatMessageTime
import net.serble.chat.data.matchRanges
import net.serble.chat.data.plainText
import net.serble.chat.data.searchTerms

private const val SEARCH_PAGE = 25

/** Searching one channel's messages. Tapping a result goes back to the chat, scrolled to that message. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(channelId: Long, onBack: () -> Unit, onOpenMessage: (Long) -> Unit) {
    val app = LocalApp.current
    val store = app.store
    val scope = rememberCoroutineScope()
    val users by store.users.collectAsStateWithLifecycle()
    val roles by store.roles.collectAsStateWithLifecycle()
    val channel = remember(channelId) { store.channel(channelId) }
    val guildRoles = roles[channel?.guildId] ?: emptyList()
    val title = channel?.let { store.channelTitle(it) } ?: "this chat"

    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Message>>(emptyList()) }
    /** The query [results] are for, so a stale page can't land on a newer search. */
    var resultsFor by remember { mutableStateOf<String?>(null) }
    var total by remember { mutableStateOf<Int?>(null) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    val terms = remember(resultsFor) { searchTerms(resultsFor ?: "") }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) { focus.requestFocus() }

    // Search as the user types, once they pause
    LaunchedEffect(query, retry) {
        val q = query.trim()
        if (searchTerms(q).isEmpty()) {
            results = emptyList(); resultsFor = null; total = null; hasMore = false; loading = false; error = null
            return@LaunchedEffect
        }
        loading = true
        delay(300)
        try {
            val page = app.api.searchMessages(channelId, q, limit = SEARCH_PAGE)
            store.ensureUsers(page.messages.mapNotNull { it.authorId })
            results = page.messages
            resultsFor = q
            total = page.totalCount
            hasMore = page.hasMore
            error = null
            listState.scrollToItem(0)
        } catch (e: ApiException) {
            error = e.message ?: "Couldn't search."
        } finally {
            loading = false
        }
    }

    fun loadMore() {
        val q = resultsFor ?: return
        val before = results.lastOrNull()?.id ?: return
        if (loadingMore || !hasMore) return
        loadingMore = true
        scope.launch {
            try {
                val page = app.api.searchMessages(channelId, q, before = before, limit = SEARCH_PAGE)
                if (resultsFor != q) return@launch
                store.ensureUsers(page.messages.mapNotNull { it.authorId })
                results = (results + page.messages).distinctBy { it.id }
                hasMore = page.hasMore
            } catch (_: ApiException) {
                // Leave hasMore set: scrolling to the end again retries
            } finally {
                loadingMore = false
            }
        }
    }

    LaunchedEffect(listState) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 5
        }.distinctUntilChanged().collect { nearEnd -> if (nearEnd) loadMore() }
    }

    Scaffold(
        modifier = Modifier.swipeBack().onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onBack(); true } else false
        },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = {
                    TextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Search $title", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                        trailingIcon = {
                            if (query.isNotEmpty()) IconButton(onClick = { query = ""; focus.requestFocus() }) { Icon(Icons.Default.Close, "Clear") }
                        },
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                        ),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerLowest)
            when {
                error != null && results.isEmpty() -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    EmptyState("Couldn't search", error ?: "")
                    TextButton(onClick = { retry++ }) { Text("Try again") }
                }
                resultsFor == null && !loading -> EmptyState("Search messages", "Find messages in $title. Use \"quotes\" for an exact phrase.", Modifier.fillMaxSize())
                resultsFor == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                results.isEmpty() -> EmptyState("No results", "Nothing in $title matches \"$resultsFor\".", Modifier.fillMaxSize())
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    item(key = "count") {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            val n = total ?: results.size
                            Text(if (n == 1) "1 result" else "$n results", style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            if (loading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        }
                    }
                    items(results, key = { it.id }) { message ->
                        val author = message.authorId?.let { users[it] }
                        val name = author?.username ?: message.webhookUsername ?: "Unknown"
                        val text = remember(message.content, users, guildRoles) { plainText(message.content, users, guildRoles, store::channel) }
                        SearchResult(message, name, text, terms) {
                            keyboard?.hide()
                            onOpenMessage(message.id)
                        }
                        HorizontalDivider(Modifier.padding(start = 64.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh)
                    }
                    if (hasMore) item(key = "more") {
                        Box(Modifier.fillMaxWidth().padding(16.dp).navigationBarsPadding(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp))
                        }
                    } else item(key = "end") { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
}

@Composable
private fun SearchResult(message: Message, name: String, text: String, terms: List<String>, onClick: () -> Unit) {
    val highlight = SpanStyle(background = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f), fontWeight = FontWeight.SemiBold)
    val shown = remember(text, terms, highlight) { highlighted(text, terms, highlight) }
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp)) {
        if (message.authorId == null && message.webhookAvatarUrl != null) RemoteImage(message.webhookAvatarUrl, name, 40.dp)
        else Avatar(message.authorId, name, 40.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.width(8.dp))
                Text(formatMessageTime(message.sentAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Text(shown, style = MaterialTheme.typography.bodyMedium, maxLines = 6, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** [text] with every match of [terms] marked. A long message is cut to start near its first match. */
private fun highlighted(text: String, terms: List<String>, style: SpanStyle): AnnotatedString {
    var ranges = matchRanges(text, terms)
    var shown = text
    val first = ranges.firstOrNull()?.first ?: 0
    if (first > 120) {
        // Start at a word boundary a little before the first match, so it's on screen
        val cut = text.lastIndexOf(' ', first - 40).takeIf { it > 0 } ?: (first - 40)
        shown = "…" + text.substring(cut + 1)
        val shift = cut + 1 - 1
        ranges = ranges.map { (it.first - shift)..(it.last - shift) }.filter { it.first >= 1 }
    }
    return buildAnnotatedString {
        append(shown)
        for (r in ranges) if (r.last < shown.length) addStyle(style, r.first, r.last + 1)
    }
}
