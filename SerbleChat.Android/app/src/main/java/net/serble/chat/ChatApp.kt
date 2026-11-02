package net.serble.chat

import android.app.Application
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.serble.chat.data.Api
import net.serble.chat.data.AppJson
import net.serble.chat.data.ChatStore
import net.serble.chat.data.Hub
import net.serble.chat.data.ImageVersion
import net.serble.chat.data.JsonCache
import net.serble.chat.data.SettingsStore
import net.serble.chat.data.StoreNotice
import net.serble.chat.push.MessageNotifications
import net.serble.chat.push.Notifier
import net.serble.chat.push.Push
import net.serble.chat.voice.Voice
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Where things live. One of each for the whole app, no DI framework. */
class ChatApp : Application(), SingletonImageLoader.Factory {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var http: OkHttpClient private set
    lateinit var settings: SettingsStore private set
    lateinit var api: Api private set
    lateinit var hub: Hub private set
    lateinit var store: ChatStore private set
    lateinit var notifier: Notifier private set
    lateinit var messageNotifications: MessageNotifications private set
    lateinit var push: Push private set
    lateinit var voice: Voice private set
    lateinit var themes: net.serble.chat.data.ThemeStore private set
    lateinit var files: net.serble.chat.data.Files private set
    private lateinit var cache: JsonCache

    @Volatile private var token: String? = null

    /** Null while unknown (never, after onCreate), else whether someone is signed in. */
    private val _signedIn = MutableStateFlow<Boolean?>(null)
    val signedIn: StateFlow<Boolean?> = _signedIn.asStateFlow()

    override fun onCreate() {
        super.onCreate()
        http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .pingInterval(0, TimeUnit.SECONDS)
            .build()
        settings = SettingsStore(this)
        net.serble.chat.data.Clock.init(this)
        cache = JsonCache(filesDir)
        api = Api(BuildConfig.API_URL, http, token = { token }, onUnauthorized = { scope.launch { signOut(serverSide = false) } })
        hub = Hub(BuildConfig.API_URL, http, token = { token }, scope = scope)
        store = ChatStore(api, hub, cache, scope)
        themes = net.serble.chat.data.ThemeStore(api, cache, scope)
        files = net.serble.chat.data.Files(BuildConfig.FILES_API_URL, http, api, settings, store, contentResolver, scope)
        notifier = Notifier(this, http) { userId ->
            val version = store.users.value[userId]?.avatarVersion ?: ImageVersion.UNKNOWN
            Notifier.AvatarSource(avatarUrl(userId, version), version)
        }
        notifier.createChannels()
        messageNotifications = MessageNotifications(store, api, notifier)
        push = Push(this, api, settings, scope, signedIn = { token != null })
        voice = Voice(this, api, hub, scope, BuildConfig.LIVEKIT_URL, settings = { settings.current() },
            updateSettings = { change -> settings.update(change) })

        store.onChannelRead = { channelId -> notifier.clearRead(channelId) }

        // A few small files before the first frame is cheaper than an empty screen then the real one
        val session = runBlocking { settings.session() }
        if (session.token != null && session.userId != null) {
            token = session.token
            store.loadSnapshot(session.userId)
            store.attach()
            _signedIn.value = true
            push.ensureRegistered()
        } else {
            _signedIn.value = false
        }

        scope.launch {
            store.notices.collect { notice ->
                when (notice) {
                    is StoreNotice.IncomingMessage -> messageNotifications.onSocketNotification(notice.message)
                    is StoreNotice.Info -> if (!store.foreground) notifier.showInfo("Serble Chat", notice.text)
                }
            }
        }
        scope.launch { hub.connected.collect { voice.onHubConnected() } }

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                store.foreground = true
                if (token != null) {
                    hub.start()
                    scope.launch { themes.sync() }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                store.foreground = false
                // Closing the socket tells the server we're gone, so it pushes instead. In a call we
                // stay connected: voice state goes over it, and its notifications still reach us.
                if (voice.call.value == null) hub.stop()
            }
        })
        scope.launch {
            voice.call.collect { call ->
                if (call == null && !store.foreground) hub.stop()
            }
        }
    }

    /** A user's avatar, or null when they have none. Pass the version from their [net.serble.chat.data.User]. */
    fun avatarUrl(userId: String, version: Long): String? = imageUrl("pfp/${Api.q(userId)}.webp", version)
    fun guildIconUrl(guild: net.serble.chat.data.Guild): String? = imageUrl("guild-icons/${guild.id}.webp", guild.iconVersion)
    fun groupIconUrl(channel: net.serble.chat.data.Channel): String? = imageUrl("channel-icons/${channel.id}.webp", channel.iconVersion)

    /**
     * The version goes in the URL, which is also the image cache's key: a new picture is a new URL, so the old one
     * can't be shown in its place, and an unchanged one never has to be fetched again.
     */
    private fun imageUrl(key: String, version: Long): String? = when {
        version == ImageVersion.NONE -> null
        version > 0 -> "${BuildConfig.S3_URL.trimEnd('/')}/$key?v=$version"
        else -> "${BuildConfig.S3_URL.trimEnd('/')}/$key"
    }

    /** Finishes Serble sign-in with the code from the redirect. */
    suspend fun signIn(code: String) {
        val jwt = api.exchangeCode(code)
        useToken(jwt)
    }

    /** Signs in with a backend token directly (development builds use it with test accounts). */
    suspend fun useToken(jwt: String) {
        val userId = userIdFrom(jwt) ?: throw IllegalStateException("The server's token has no user in it.")
        settings.saveSession(jwt, userId)
        token = jwt
        store.loadSnapshot(userId)
        store.attach()
        _signedIn.value = true
        hub.start()
        // Already connected as someone else (a test account swapped in): connect again as this one
        hub.reconnect()
        scope.launch { runCatching { store.refresh() } }
        scope.launch { themes.sync() }
        push.ensureRegistered()
    }

    suspend fun signOut(serverSide: Boolean = true) {
        voice.leave()
        if (serverSide) runCatching { push.signOut() }
        hub.stop()
        store.clear()
        cache.clear()
        themes.reset()
        files.clear()
        settings.clearSession()
        token = null
        NotificationManagerCompat.from(this).cancelAll()
        _signedIn.value = false
    }

    private fun userIdFrom(jwt: String): String? = runCatching {
        val payload = jwt.split(".")[1]
        val json = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
        val obj = AppJson.parseToJsonElement(json).jsonObject
        (obj["nameid"] ?: obj["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"])?.jsonPrimitive?.content
    }.getOrNull()

    override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { http }, cacheStrategy = { SuccessOnlyCacheStrategy })) }
        .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.2).build() }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("images")).maxSizeBytes(64L * 1024 * 1024).build() }
        .crossfade(true)
        .build()
}

/**
 * Coil's default disk caching, minus error responses. By default it stores a 404 like any image and serves it
 * from then on, so someone without an avatar who later uploads one would never show it.
 *
 * Fresh copies come from versioned URLs (see [ChatApp.avatarUrl]), not from revalidating, so a successful response
 * is reused for as long as it stays in the cache.
 */
@OptIn(coil3.annotation.ExperimentalCoilApi::class)
private object SuccessOnlyCacheStrategy : coil3.network.CacheStrategy {
    override suspend fun read(
        cacheResponse: coil3.network.NetworkResponse,
        networkRequest: coil3.network.NetworkRequest,
        options: coil3.request.Options,
    ): coil3.network.CacheStrategy.ReadResult =
        // An error stored by an older version of the app: ask again
        if (cacheResponse.code in 200..299) coil3.network.CacheStrategy.ReadResult(cacheResponse)
        else coil3.network.CacheStrategy.ReadResult(networkRequest)

    override suspend fun write(
        cacheResponse: coil3.network.NetworkResponse?,
        networkRequest: coil3.network.NetworkRequest,
        networkResponse: coil3.network.NetworkResponse,
        options: coil3.request.Options,
    ): coil3.network.CacheStrategy.WriteResult =
        if (networkResponse.code in 200..299) coil3.network.CacheStrategy.WriteResult(networkResponse)
        else coil3.network.CacheStrategy.WriteResult.DISABLED
}
