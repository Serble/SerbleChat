package net.serble.chat.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** The messages of one channel the app has loaded: a contiguous run ending at the newest. */
data class ChannelMessages(
    val messages: List<Message> = emptyList(),
    /** Oldest first, newest last. */
    val pending: List<PendingMessage> = emptyList(),
    val reachedStart: Boolean = false,
    val loadingOlder: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
)

data class OwnStatus(val type: String = "online", val message: String = "", val expiresAt: String? = null) {
    fun effectiveType(now: Instant = Instant.now()): String =
        if (expired(now)) "online" else type

    fun effectiveMessage(now: Instant = Instant.now()): String = if (expired(now)) "" else message
    private fun expired(now: Instant) = parseInstant(expiresAt)?.isBefore(now) ?: false
}

/** Something to tell the user that came from the server, not from what they just did. */
sealed interface StoreNotice {
    data class Info(val text: String) : StoreNotice
    data class IncomingMessage(val message: Message) : StoreNotice
}

@Serializable
private data class Snapshot(
    val account: Account? = null,
    val guilds: List<Guild> = emptyList(),
    val guildChannels: Map<Long, List<Channel>> = emptyMap(),
    val dms: List<DmChannel> = emptyList(),
    val groups: List<GroupChat> = emptyList(),
    val friends: List<Friendship> = emptyList(),
    val users: Map<String, User> = emptyMap(),
    val unreads: Map<Long, Int> = emptyMap(),
    val lastActivity: Map<Long, Long> = emptyMap(),
    val messages: Map<Long, List<Message>> = emptyMap(),
)

/**
 * Everything the app knows, as flows the UI collects. Fed by REST calls and the hub's live events,
 * and written to disk so the next launch opens on it at once.
 */
class ChatStore(
    private val api: Api,
    val hub: Hub,
    private val cache: JsonCache,
    private val scope: CoroutineScope,
) {
    var userId: String? = null
        private set

    private val _account = MutableStateFlow<Account?>(null)
    val account: StateFlow<Account?> = _account.asStateFlow()

    private val _ownStatus = MutableStateFlow(OwnStatus())
    val ownStatus: StateFlow<OwnStatus> = _ownStatus.asStateFlow()

    private val _guilds = MutableStateFlow<List<Guild>>(emptyList())
    val guilds: StateFlow<List<Guild>> = _guilds.asStateFlow()

    /** Guild ID to its channels, in display order. */
    private val _guildChannels = MutableStateFlow<Map<Long, List<Channel>>>(emptyMap())
    val guildChannels: StateFlow<Map<Long, List<Channel>>> = _guildChannels.asStateFlow()

    private val _dms = MutableStateFlow<List<DmChannel>>(emptyList())
    val dms: StateFlow<List<DmChannel>> = _dms.asStateFlow()

    private val _groups = MutableStateFlow<List<GroupChat>>(emptyList())
    val groups: StateFlow<List<GroupChat>> = _groups.asStateFlow()

    private val _friends = MutableStateFlow<List<Friendship>>(emptyList())
    val friends: StateFlow<List<Friendship>> = _friends.asStateFlow()

    private val _blocked = MutableStateFlow<Set<String>>(emptySet())
    val blocked: StateFlow<Set<String>> = _blocked.asStateFlow()

    private val _users = MutableStateFlow<Map<String, User>>(emptyMap())
    val users: StateFlow<Map<String, User>> = _users.asStateFlow()

    private val _unreads = MutableStateFlow<Map<Long, Int>>(emptyMap())
    val unreads: StateFlow<Map<Long, Int>> = _unreads.asStateFlow()

    /** Channel ID to the newest message ID seen in it, for ordering conversations. */
    private val _lastActivity = MutableStateFlow<Map<Long, Long>>(emptyMap())
    val lastActivity: StateFlow<Map<Long, Long>> = _lastActivity.asStateFlow()

    private val _messages = MutableStateFlow<Map<Long, ChannelMessages>>(emptyMap())
    val messages: StateFlow<Map<Long, ChannelMessages>> = _messages.asStateFlow()

    private val _typing = MutableStateFlow<Map<Long, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<Long, Set<String>>> = _typing.asStateFlow()

    /** Channel ID to who is in its call. */
    private val _voice = MutableStateFlow<Map<Long, Map<String, VoiceState>>>(emptyMap())
    val voice: StateFlow<Map<Long, Map<String, VoiceState>>> = _voice.asStateFlow()

    /** Channel ID to what I may do there. Missing means not loaded yet. */
    private val _permissions = MutableStateFlow<Map<Long, Permissions>>(emptyMap())
    val permissions: StateFlow<Map<Long, Permissions>> = _permissions.asStateFlow()

    private val _guildPermissions = MutableStateFlow<Map<Long, Permissions>>(emptyMap())
    val guildPermissions: StateFlow<Map<Long, Permissions>> = _guildPermissions.asStateFlow()

    /** Guild ID to member ID to their role colour. */
    private val _memberColors = MutableStateFlow<Map<Long, Map<String, String>>>(emptyMap())
    val memberColors: StateFlow<Map<Long, Map<String, String>>> = _memberColors.asStateFlow()

    /** Channel ID to the IDs of who can see it. Look people up in [users] for their current presence. */
    private val _channelMembers = MutableStateFlow<Map<Long, List<String>>>(emptyMap())
    val channelMembers: StateFlow<Map<Long, List<String>>> = _channelMembers.asStateFlow()

    private val _roles = MutableStateFlow<Map<Long, List<Role>>>(emptyMap())
    val roles: StateFlow<Map<Long, List<Role>>> = _roles.asStateFlow()

    private val _notices = MutableSharedFlow<StoreNotice>(extraBufferCapacity = 16)
    val notices: SharedFlow<StoreNotice> = _notices.asSharedFlow()

    private val guildNotifPrefs = ConcurrentHashMap<Long, NotifPrefs>()
    private val channelNotifPrefs = ConcurrentHashMap<Long, ChannelNotifPrefs>()

    /** The channel on screen, if any. New messages there are read straight away. */
    @Volatile var activeChannel: Long? = null
        private set
    @Volatile var foreground: Boolean = false

    private val pendingIds = AtomicLong(0)
    private val userFetches = ConcurrentHashMap<String, Job>()
    private val typingClears = ConcurrentHashMap<Pair<Long, String>, Job>()
    private val refreshLock = Mutex()
    private var saveJob: Job? = null
    private var hubJobs: List<Job> = emptyList()

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────

    fun loadSnapshot(userId: String) {
        this.userId = userId
        val text = cache.read("snapshot_$userId") ?: return
        val snap = runCatching { AppJson.decodeFromString(Snapshot.serializer(), text) }.getOrNull() ?: return
        _account.value = snap.account
        snap.account?.let { _ownStatus.value = OwnStatus(it.statusType, it.statusMessage, it.statusExpiresAt) }
        _guilds.value = snap.guilds
        _guildChannels.value = snap.guildChannels
        _dms.value = snap.dms
        _groups.value = snap.groups
        _friends.value = snap.friends
        // Presence from last time is stale: show everyone offline until the server says otherwise
        _users.value = snap.users.mapValues { (_, u) -> u.copy(status = "offline", isOnline = false) }
        _unreads.value = snap.unreads
        _lastActivity.value = snap.lastActivity
        _messages.value = snap.messages.mapValues { (_, list) -> ChannelMessages(messages = list) }
    }

    fun attach() {
        if (hubJobs.isNotEmpty()) return
        hubJobs = listOf(
            scope.launch { hub.events.collect { runCatching { handle(it) }.onFailure { e -> Log.e(TAG, "Event ${it.target} failed", e) } } },
            scope.launch { hub.connected.collect { onHubConnected() } },
        )
    }

    fun clear() {
        hubJobs.forEach { it.cancel() }
        hubJobs = emptyList()
        userId?.let { cache.write("snapshot_$it", "{}") }
        userId = null
        _account.value = null
        _guilds.value = emptyList()
        _guildChannels.value = emptyMap()
        _dms.value = emptyList()
        _groups.value = emptyList()
        _friends.value = emptyList()
        _users.value = emptyMap()
        _unreads.value = emptyMap()
        _messages.value = emptyMap()
        _voice.value = emptyMap()
        _permissions.value = emptyMap()
        _guildPermissions.value = emptyMap()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(1500)
            val id = userId ?: return@launch
            // Only the most recent conversations' messages, and only their newest page
            val recent = _lastActivity.value.entries.sortedByDescending { it.value }.take(30).map { it.key }.toSet()
            val snap = Snapshot(
                account = _account.value,
                guilds = _guilds.value,
                guildChannels = _guildChannels.value,
                dms = _dms.value,
                groups = _groups.value,
                friends = _friends.value,
                users = _users.value,
                unreads = _unreads.value,
                lastActivity = _lastActivity.value,
                messages = _messages.value.filterKeys { it in recent }.mapValues { it.value.messages.takeLast(50) },
            )
            cache.write("snapshot_$id", AppJson.encodeToString(Snapshot.serializer(), snap))
        }
    }

    /** Loads everything the home screens show. Safe to call often: it runs one at a time. */
    suspend fun refresh() = refreshLock.withLock {
        val results = listOf(
            scope.async { runCatching { loadAccount() } },
            scope.async { runCatching { loadGuilds() } },
            scope.async { runCatching { loadDms() } },
            scope.async { runCatching { loadGroups() } },
            scope.async { runCatching { loadFriends() } },
            scope.async { runCatching { _unreads.value = api.unreads().mapNotNull { (k, v) -> k.toLongOrNull()?.let { it to v } }.toMap() } },
            scope.async { runCatching { loadBlocks() } },
        ).awaitAll()
        results.firstOrNull { it.isFailure }?.exceptionOrNull()?.let { if (it is ApiException && it.offline) throw it }
        scheduleSave()
    }

    private suspend fun onHubConnected() {
        // Anything could have happened while we were away
        runCatching { refresh() }
        activeChannel?.let { channel -> scope.launch { catchUp(channel) } }
        scope.launch { refreshVoice() }
    }

    // ── Loading ─────────────────────────────────────────────────────────────────────────

    suspend fun loadAccount() {
        val account = api.account()
        _account.value = account
        _ownStatus.value = OwnStatus(account.statusType, account.statusMessage, account.statusExpiresAt)
        rememberUsers(listOf(User(account.id, account.username, blurb = account.blurb, color = account.color, status = "online", isOnline = true)))
    }

    private suspend fun loadGuilds() {
        val guilds = api.guilds()
        _guilds.value = guilds
        guilds.map { guild ->
            scope.async {
                runCatching { loadGuildChannels(guild.id) }
                runCatching { guildNotifPrefs[guild.id] = api.guildNotifPrefs(guild.id) }
                runCatching { _guildPermissions.update { it + (guild.id to api.myPermissions(guild.id)) } }
            }
        }.awaitAll()
    }

    suspend fun loadGuildChannels(guildId: Long) {
        val channels = api.guildChannels(guildId).sortedBy { it.index }.map { it.channel }
        _guildChannels.update { it + (guildId to channels) }
        scheduleSave()
    }

    private suspend fun loadDms() {
        val dms = api.dms()
        _dms.value = dms
        val me = userId
        if (me != null) ensureUsers(dms.map { it.otherUser(me) })
    }

    private suspend fun loadGroups() {
        val memberships = api.groupMemberships()
        val groups = memberships.map { m -> scope.async { runCatching { api.group(m.groupChatId) }.getOrNull() } }.awaitAll().filterNotNull()
        _groups.value = groups
    }

    suspend fun loadFriends() {
        val friends = api.friends()
        _friends.value = friends
        val me = userId ?: return
        ensureUsers(friends.map { it.other(me) })
    }

    /** Guild members with their colours and presence. */
    suspend fun loadGuildMembers(guildId: Long): List<GuildMember> {
        val members = api.guildMembers(guildId)
        rememberUsers(members.map { it.user })
        _memberColors.update { it + (guildId to members.associate { m -> m.user.id to m.color }) }
        runCatching { _roles.update { it + (guildId to api.guildRoles(guildId)) } }
        return members
    }

    /** Loads who is in a channel (a guild's members, or a DM's or group's people). */
    suspend fun loadMembers(channel: Channel): List<User> {
        val guildId = channel.guildId
        val list = if (channel.type == ChannelType.GUILD && guildId != null) loadGuildMembers(guildId).map { it.user }
        else loadChannelMembers(channel.id)
        _channelMembers.update { it + (channel.id to list.map { u -> u.id }) }
        return list
    }

    suspend fun loadChannelMembers(channelId: Long): List<User> {
        val members = api.channelMembers(channelId)
        rememberUsers(members)
        return members
    }

    fun rememberUsers(list: List<User>) {
        if (list.isEmpty()) return
        _users.update { map -> map + list.associateBy { it.id } }
    }

    /** Fetches any of these users we don't know yet, in the background. */
    fun ensureUsers(ids: Collection<String>) {
        val known = _users.value
        for (id in ids.toSet()) {
            if (id in known || userFetches[id]?.isActive == true) continue
            userFetches[id] = scope.launch {
                runCatching { rememberUsers(listOf(api.user(id))) }
                scheduleSave()
            }
        }
    }

    // ── Channels ────────────────────────────────────────────────────────────────────────

    fun channel(id: Long): Channel? {
        _guildChannels.value.values.forEach { list -> list.firstOrNull { it.id == id }?.let { return it } }
        _dms.value.firstOrNull { it.channelId == id }?.let { return it.channel }
        _groups.value.firstOrNull { it.channelId == id }?.let { return it.channel }
        return null
    }

    /** What to call a channel in titles and notifications. */
    fun channelTitle(channel: Channel): String = when (channel.type) {
        ChannelType.DM -> {
            val dm = _dms.value.firstOrNull { it.channelId == channel.id }
            val other = dm?.otherUser(userId ?: "")
            other?.let { _users.value[it]?.username } ?: "Direct message"
        }
        ChannelType.GROUP -> channel.name
        else -> "#" + channel.name
    }

    fun guildOf(channel: Channel): Guild? = channel.guildId?.let { id -> _guilds.value.firstOrNull { it.id == id } }

    fun setActiveChannel(id: Long?) {
        activeChannel = id
        if (id != null) {
            clearUnread(id)
        }
    }

    suspend fun loadPermissions(channel: Channel) {
        val guildId = channel.guildId
        val perms = if (channel.type == ChannelType.GUILD && guildId != null) api.myChannelPermissions(guildId, channel.id) else Permissions.Everything
        _permissions.update { it + (channel.id to perms) }
    }

    /** Opens a channel: shows what's cached, then brings it up to date. */
    suspend fun openChannel(id: Long) {
        val current = _messages.value[id]
        if (current == null || current.messages.isEmpty()) {
            loadLatest(id)
        } else {
            catchUp(id)
        }
        markLatestRead(id)
    }

    private suspend fun loadLatest(id: Long) {
        try {
            val page = api.messages(id, PAGE).reversed()
            onMessagesLoaded(page)
            updateChannelMessages(id) { it.copy(messages = page, reachedStart = page.size < PAGE, loaded = true, error = null) }
        } catch (e: ApiException) {
            updateChannelMessages(id) { it.copy(loaded = true, error = e.message) }
        }
    }

    /** Fetches what arrived since the newest message we have; starts over if that's a lot. */
    suspend fun catchUp(id: Long) {
        val have = _messages.value[id]?.messages ?: return loadLatest(id)
        val newest = have.lastOrNull()?.id ?: return loadLatest(id)
        try {
            val newer = api.messages(id, CATCH_UP, after = newest).reversed()
            if (newer.size >= CATCH_UP) return loadLatest(id)
            onMessagesLoaded(newer)
            // Edits and deletions in what we already had aren't covered by `after`, so refresh the
            // newest page as well: cheap, and keeps what's on screen honest.
            val latest = api.messages(id, PAGE).reversed()
            onMessagesLoaded(latest)
            updateChannelMessages(id) { state ->
                val oldestLatest = latest.firstOrNull()?.id ?: Long.MAX_VALUE
                val kept = state.messages.filter { it.id < oldestLatest }
                state.copy(messages = (kept + latest).distinctBy { it.id }, loaded = true, error = null)
            }
        } catch (e: ApiException) {
            updateChannelMessages(id) { it.copy(loaded = true, error = if (it.messages.isEmpty()) e.message else null) }
        }
    }

    suspend fun loadOlder(id: Long) {
        val state = _messages.value[id] ?: return
        if (state.loadingOlder || state.reachedStart) return
        val oldest = state.messages.firstOrNull()?.id ?: return
        updateChannelMessages(id) { it.copy(loadingOlder = true) }
        try {
            val page = api.messages(id, PAGE, before = oldest).reversed()
            onMessagesLoaded(page)
            updateChannelMessages(id) { s ->
                s.copy(messages = (page + s.messages).distinctBy { it.id }, reachedStart = page.size < PAGE, loadingOlder = false)
            }
        } catch (e: ApiException) {
            updateChannelMessages(id) { it.copy(loadingOlder = false) }
            throw e
        }
    }

    /** Fetches one message, e.g. to jump to a linked message far up the history. */
    suspend fun fetchMessage(channelId: Long, messageId: Long): Message = api.message(channelId, messageId)

    private fun onMessagesLoaded(list: List<Message>) {
        val authors = list.mapNotNull { it.authorId }
        ensureUsers(authors)
        list.lastOrNull()?.let { bumpActivity(it.channelId, it.id) }
    }

    private fun updateChannelMessages(id: Long, change: (ChannelMessages) -> ChannelMessages) {
        _messages.update { map -> map + (id to change(map[id] ?: ChannelMessages())) }
        scheduleSave()
    }

    private fun bumpActivity(channelId: Long, messageId: Long) {
        _lastActivity.update { map ->
            if ((map[channelId] ?: 0) >= messageId) map else map + (channelId to messageId)
        }
    }

    fun markLatestRead(id: Long) {
        clearUnread(id)
        val newest = _messages.value[id]?.messages?.lastOrNull()?.id ?: return
        scope.launch { runCatching { api.markRead(id, newest) } }
    }

    private fun clearUnread(id: Long) {
        if ((_unreads.value[id] ?: 0) != 0) _unreads.update { it - id }
        onChannelRead?.invoke(id)
    }

    /** Called when a channel is read here, so its notifications can go. */
    var onChannelRead: ((Long) -> Unit)? = null

    // ── Sending ─────────────────────────────────────────────────────────────────────────

    fun sendMessage(channelId: Long, content: String) {
        val text = content.trim()
        if (text.isEmpty()) return
        val pending = PendingMessage(pendingIds.incrementAndGet(), channelId, text)
        updateChannelMessages(channelId) { it.copy(pending = it.pending + pending) }
        scope.launch { deliver(pending) }
    }

    fun retry(pending: PendingMessage) {
        updateChannelMessages(pending.channelId) { s -> s.copy(pending = s.pending.map { if (it.localId == pending.localId) it.copy(failed = false) else it }) }
        scope.launch { deliver(pending.copy(failed = false)) }
    }

    fun discard(pending: PendingMessage) {
        updateChannelMessages(pending.channelId) { s -> s.copy(pending = s.pending.filterNot { it.localId == pending.localId }) }
    }

    private suspend fun deliver(pending: PendingMessage) {
        try {
            api.sendMessage(pending.channelId, pending.content)
            // The message itself arrives as NewMessage, which replaces the pending one. If the hub
            // is down, fetch it instead so it doesn't sit there looking unsent.
            delay(4000)
            val still = _messages.value[pending.channelId]?.pending?.any { it.localId == pending.localId } == true
            if (still) catchUp(pending.channelId).also { dropPendingMatching(pending.channelId, pending.content) }
        } catch (e: ApiException) {
            updateChannelMessages(pending.channelId) { s ->
                s.copy(pending = s.pending.map { if (it.localId == pending.localId) it.copy(failed = true) else it })
            }
            _notices.tryEmit(StoreNotice.Info(e.message ?: "Couldn't send."))
        }
    }

    private fun dropPendingMatching(channelId: Long, content: String) {
        updateChannelMessages(channelId) { s ->
            val idx = s.pending.indexOfFirst { it.content == content && !it.failed }
            if (idx < 0) s else s.copy(pending = s.pending.toMutableList().apply { removeAt(idx) })
        }
    }

    suspend fun editMessage(message: Message, content: String) {
        api.editMessage(message.channelId, message.id, content)
        replaceMessage(message.copy(content = content, editedAt = Instant.now().toString()))
    }

    suspend fun deleteMessage(message: Message) {
        api.deleteMessage(message.channelId, message.id)
        removeMessage(message.id)
    }

    private var lastTypingSent = 0L

    /** Tells the channel we're typing; called on each keystroke, sent at most every 3 seconds. */
    fun typing(channelId: Long) {
        val now = System.currentTimeMillis()
        if (now - lastTypingSent < 3000) return
        lastTypingSent = now
        hub.send("NotifyTyping", channelId)
    }

    // ── Polls ───────────────────────────────────────────────────────────────────────────

    suspend fun vote(poll: Poll, optionIds: List<Long>) {
        api.vote(poll.channelId, poll.id, optionIds)
        // PollUpdated brings the result; show the vote straight away regardless
        val me = userId ?: return
        applyPoll(poll.copy(options = poll.options.map { o ->
            val without = o.voterIds - me
            o.copy(voterIds = if (o.id in optionIds) without + me else without)
        }))
    }

    private fun applyPoll(poll: Poll) {
        updateChannelMessages(poll.channelId) { s ->
            s.copy(messages = s.messages.map { if (it.id == poll.messageId) it.copy(poll = poll) else it })
        }
    }

    // ── Status ──────────────────────────────────────────────────────────────────────────

    suspend fun setStatus(type: String, message: String?, expiresAt: Instant?) {
        api.setStatus(type, message?.takeIf { it.isNotBlank() }, expiresAt?.toString())
        _ownStatus.value = OwnStatus(type, message ?: "", expiresAt?.toString())
    }

    /** Back to plain Online with no message, as the web's "Clear status". */
    suspend fun clearStatus() {
        api.clearStatus()
        _ownStatus.value = OwnStatus()
    }

    suspend fun clearStatusMessage() {
        val current = _ownStatus.value
        api.setStatus(current.effectiveType(), null, null)
        _ownStatus.value = current.copy(message = "", expiresAt = null)
    }

    // ── Voice ───────────────────────────────────────────────────────────────────────────

    /** Loads who is in each voice-capable channel we know of. */
    suspend fun refreshVoice() {
        val channels = (_guildChannels.value.values.flatten() + _dms.value.map { it.channel } + _groups.value.map { it.channel })
            .filter { it.voiceCapable }
        val states = channels.map { c ->
            scope.async { runCatching { c.id to api.voiceUsers(c.id) }.getOrNull() }
        }.awaitAll().filterNotNull()
        _voice.value = states.associate { (id, vu) ->
            val byUser = vu.users.associateWith { u -> vu.states.firstOrNull { it.userId == u } ?: VoiceState(u) }
            id to byUser
        }.filterValues { it.isNotEmpty() }
        ensureUsers(_voice.value.values.flatMap { it.keys })
    }

    // ── Live events ─────────────────────────────────────────────────────────────────────

    private suspend fun handle(event: HubEvent) {
        val p = event.payload
        when (event.target) {
            "NewMessage" -> onNewMessage(AppJson.decodeFromJsonElement(Message.serializer(), p))
            "MessageEdited" -> {
                val message = p["message"] as? JsonObject ?: return
                replaceMessage(AppJson.decodeFromJsonElement(Message.serializer(), message))
            }
            "DeleteMessage" -> p.long("id")?.let { removeMessage(it) }
            "PollUpdated" -> applyPoll(AppJson.decodeFromJsonElement(Poll.serializer(), p))
            "MentionedInMessage" -> {
                val channelId = p.long("channelId") ?: p.long("ChannelId") ?: return
                if (channelId != activeChannel && unreadMode(channelId) == NotifyLevel.MENTIONS) {
                    _unreads.update { it + (channelId to ((it[channelId] ?: 0) + 1)) }
                }
            }
            "ReceiveNotification" -> {
                val message = p["message"] as? JsonObject ?: return
                val msg = AppJson.decodeFromJsonElement(Message.serializer(), message)
                if (msg.channelId != activeChannel || !foreground) _notices.tryEmit(StoreNotice.IncomingMessage(msg))
            }
            "UserTyping" -> {
                val user = p.string("userId") ?: return
                val channelId = p.long("channelId") ?: return
                if (user == userId) return
                _typing.update { it + (channelId to ((it[channelId] ?: emptySet()) + user)) }
                ensureUsers(listOf(user))
                val key = channelId to user
                typingClears[key]?.cancel()
                typingClears[key] = scope.launch {
                    delay(4000)
                    removeTyping(channelId, user)
                }
            }
            "FriendRequestReceived" -> {
                runCatching { loadFriends() }
                p.string("fromUserId")?.let { id ->
                    val name = runCatching { _users.value[id] ?: api.user(id).also { rememberUsers(listOf(it)) } }.getOrNull()?.username
                    _notices.tryEmit(StoreNotice.Info("${name ?: "Someone"} sent you a friend request"))
                }
            }
            "FriendRequestAccepted", "FriendRemoved" -> runCatching { loadFriends() }
            "NewChannel" -> {
                val channel = AppJson.decodeFromJsonElement(Channel.serializer(), p)
                if (channel.type == ChannelType.GUILD) channel.guildId?.let { runCatching { loadGuildChannels(it) } }
                else {
                    runCatching { loadDms() }
                    runCatching { loadGroups() }
                }
                // The server only adds a connection to channel groups when it connects
                hub.reconnect()
            }
            "ChannelDeleted" -> {
                val id = p.long("channelId") ?: return
                _guildChannels.update { map -> map.mapValues { (_, list) -> list.filterNot { it.id == id } } }
                _groups.update { list -> list.filterNot { it.channelId == id } }
                _dms.update { list -> list.filterNot { it.channelId == id } }
                _messages.update { it - id }
                _unreads.update { it - id }
            }
            "ChannelUpdated" -> {
                val id = p.long("channelId") ?: return
                val updated = runCatching { api.channel(id) }.getOrNull() ?: return
                applyChannel(updated)
            }
            "GuildUpdated" -> {
                val id = p.long("guildId") ?: return
                val guild = runCatching { api.guild(id) }.getOrNull() ?: return
                _guilds.update { list -> list.map { if (it.id == id) guild else it } }
                runCatching { loadGuildChannels(id) }
            }
            "LeftGuild" -> {
                val id = p.long("guildId") ?: return
                val name = _guilds.value.firstOrNull { it.id == id }?.name
                _guilds.update { list -> list.filterNot { it.id == id } }
                _guildChannels.update { it - id }
                _notices.tryEmit(StoreNotice.Info(if (name != null) "You're no longer in $name" else "You left a guild"))
            }
            "RolesUpdated" -> {
                val id = p.long("guildId") ?: return
                runCatching { _guildPermissions.update { it + (id to api.myPermissions(id)) } }
                val channelIds = _guildChannels.value[id]?.map { it.id }?.toSet() ?: emptySet()
                _permissions.update { map -> map.filterKeys { it !in channelIds } }
                runCatching { loadGuildMembers(id) }
            }
            "UserUpdated" -> {
                val id = p.string("id") ?: return
                runCatching { rememberUsers(listOf(api.user(id))) }
            }
            "UserLeft" -> Unit
            "ClientJoinVoice" -> {
                val user = p.string("userId") ?: return
                val channelId = p.long("channelId") ?: return
                ensureUsers(listOf(user))
                _voice.update { map -> map + (channelId to ((map[channelId] ?: emptyMap()) + (user to VoiceState(user)))) }
            }
            "ClientLeaveVoice" -> {
                val user = p.string("userId") ?: return
                val channelId = p.long("channelId") ?: return
                _voice.update { map ->
                    val rest = (map[channelId] ?: emptyMap()) - user
                    if (rest.isEmpty()) map - channelId else map + (channelId to rest)
                }
            }
            "ClientVoiceStateUpdated" -> {
                val user = p.string("userId") ?: return
                val channelId = p.long("channelId") ?: return
                val state = VoiceState(user, p.bool("muted") ?: false, p.bool("deafened") ?: false)
                _voice.update { map -> map + (channelId to ((map[channelId] ?: emptyMap()) + (user to state))) }
            }
            "UserStatusUpdated" -> {
                val user = p.string("userId") ?: return
                if (user == userId) return
                val status = p.string("status") ?: "offline"
                val existing = _users.value[user]
                if (existing != null) {
                    rememberUsers(listOf(existing.copy(status = status, isOnline = status != "offline",
                        statusMessage = p.string("statusMessage") ?: "", statusExpiresAt = p.string("statusExpiresAt"))))
                } else ensureUsers(listOf(user))
            }
            "OwnStatusUpdated" -> {
                _ownStatus.value = OwnStatus(p.string("statusType") ?: "online", p.string("statusMessage") ?: "", p.string("statusExpiresAt"))
            }
        }
    }

    private fun onNewMessage(message: Message) {
        val channelId = message.channelId
        message.authorId?.let { ensureUsers(listOf(it)); removeTyping(channelId, it) }
        bumpActivity(channelId, message.id)
        val existing = _messages.value[channelId]
        if (existing != null && existing.loaded || existing?.messages?.isNotEmpty() == true) {
            updateChannelMessages(channelId) { s ->
                // our own message coming back replaces its pending copy
                val pending = if (message.authorId == userId) {
                    val idx = s.pending.indexOfFirst { it.content == message.content }
                    if (idx >= 0) s.pending.toMutableList().apply { removeAt(idx) } else s.pending
                } else s.pending
                s.copy(messages = if (s.messages.any { it.id == message.id }) s.messages else s.messages + message, pending = pending)
            }
        }
        if (message.authorId == userId) return
        if (channelId == activeChannel && foreground) {
            scope.launch { runCatching { api.markRead(channelId, message.id) } }
        } else if (unreadMode(channelId) == NotifyLevel.ALL) {
            _unreads.update { it + (channelId to ((it[channelId] ?: 0) + 1)) }
        }
        // a group we haven't loaded yet (someone just added us)
        if (channel(channelId) == null) scope.launch { runCatching { loadGroups() }; runCatching { loadDms() } }
    }

    private fun replaceMessage(message: Message) {
        updateChannelMessages(message.channelId) { s ->
            s.copy(messages = s.messages.map { if (it.id == message.id) message.copy(poll = message.poll ?: it.poll) else it })
        }
    }

    private fun removeMessage(id: Long) {
        _messages.update { map ->
            map.mapValues { (_, s) -> if (s.messages.any { it.id == id }) s.copy(messages = s.messages.filterNot { it.id == id }) else s }
        }
        scheduleSave()
    }

    private fun removeTyping(channelId: Long, user: String) {
        _typing.update { map ->
            val rest = (map[channelId] ?: return@update map) - user
            if (rest.isEmpty()) map - channelId else map + (channelId to rest)
        }
    }

    private fun applyChannel(updated: Channel) {
        _guildChannels.update { map -> map.mapValues { (_, list) -> list.map { if (it.id == updated.id) updated else it } } }
        _groups.update { list -> list.map { if (it.channelId == updated.id) it.copy(channel = updated) else it } }
        _dms.update { list -> list.map { if (it.channelId == updated.id) it.copy(channel = updated) else it } }
    }

    /** The unread setting that applies to a channel: its own, else its guild's, else the account default. */
    private fun unreadMode(channelId: Long): Int {
        val channel = channel(channelId)
        channelNotifPrefs[channelId]?.unreads?.takeIf { it != NotifyLevel.INHERIT }?.let { return it }
        channel?.guildId?.let { g -> guildNotifPrefs[g]?.unreads?.takeIf { it != NotifyLevel.INHERIT }?.let { return it } }
        val account = _account.value
        val default = when (channel?.type) {
            ChannelType.DM -> account?.defaultDmNotificationPreferences
            ChannelType.GROUP -> account?.defaultGroupNotificationPreferences
            else -> account?.defaultGuildNotificationPreferences
        }
        return default?.unreads?.takeIf { it != NotifyLevel.INHERIT } ?: NotifyLevel.ALL
    }

    // ── Notification preferences ────────────────────────────────────────────────────────

    suspend fun channelPrefs(channelId: Long): ChannelNotifPrefs =
        api.channelNotifPrefs(channelId).also { channelNotifPrefs[channelId] = it }

    suspend fun setChannelPrefs(channelId: Long, prefs: ChannelNotifPrefs) {
        api.setChannelNotifPrefs(channelId, prefs)
        channelNotifPrefs[channelId] = prefs
    }

    suspend fun guildPrefs(guildId: Long): NotifPrefs = api.guildNotifPrefs(guildId).also { guildNotifPrefs[guildId] = it }

    suspend fun setGuildPrefs(guildId: Long, prefs: NotifPrefs) {
        api.setGuildNotifPrefs(guildId, prefs)
        guildNotifPrefs[guildId] = prefs
    }

    suspend fun updateAccount(body: JsonObject) {
        api.updateAccount(body)
        loadAccount()
        scheduleSave()
    }

    // ── Guild management ────────────────────────────────────────────────────────────────

    suspend fun createGuild(name: String): Guild {
        val guild = api.createGuild(name)
        _guilds.update { it + guild }
        runCatching { loadGuildChannels(guild.id) }
        runCatching { _guildPermissions.update { it + (guild.id to api.myPermissions(guild.id)) } }
        hub.reconnect()
        return guild
    }

    suspend fun joinInvite(id: String): Guild? {
        val invite = api.invite(id)
        api.acceptInvite(id)
        val guilds = api.guilds()
        _guilds.value = guilds
        runCatching { loadGuildChannels(invite.guildId) }
        runCatching { _guildPermissions.update { it + (invite.guildId to api.myPermissions(invite.guildId)) } }
        hub.reconnect()
        return guilds.firstOrNull { it.id == invite.guildId }
    }

    suspend fun leaveGuild(id: Long) {
        api.leaveGuild(id)
        _guilds.update { list -> list.filterNot { it.id == id } }
        _guildChannels.update { it - id }
    }

    suspend fun deleteGuild(id: Long) {
        api.deleteGuild(id)
        _guilds.update { list -> list.filterNot { it.id == id } }
        _guildChannels.update { it - id }
    }

    suspend fun renameGuild(id: Long, name: String) {
        api.renameGuild(id, name)
        _guilds.update { list -> list.map { if (it.id == id) it.copy(name = name) else it } }
    }

    suspend fun createGroup(name: String, users: List<String>): GroupChat {
        val group = api.createGroup(name, users)
        _groups.update { it + group }
        hub.reconnect()
        return group
    }

    suspend fun openDm(userId: String): Channel {
        val channel = api.openDm(userId)
        if (_dms.value.none { it.channelId == channel.id }) {
            runCatching { loadDms() }
            hub.reconnect()
        }
        return channel
    }

    // ── Friends and blocks ──────────────────────────────────────────────────────────────

    suspend fun addFriend(userId: String) {
        api.addFriend(userId)
        loadFriends()
    }

    suspend fun removeFriend(userId: String) {
        api.removeFriend(userId)
        loadFriends()
    }

    suspend fun loadBlocks() {
        val list = api.blocks()
        rememberUsers(list)
        _blocked.value = list.map { it.id }.toSet()
    }

    suspend fun block(userId: String) {
        api.block(userId)
        _blocked.update { it + userId }
    }

    suspend fun unblock(userId: String) {
        api.unblock(userId)
        _blocked.update { it - userId }
    }

    private companion object {
        const val TAG = "ChatStore"
        const val PAGE = 50
        const val CATCH_UP = 100
    }
}

private fun JsonObject.string(key: String): String? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
private fun JsonObject.long(key: String): Long? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }
private fun JsonObject.bool(key: String): Boolean? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull
