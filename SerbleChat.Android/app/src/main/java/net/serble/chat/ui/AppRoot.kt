package net.serble.chat.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import net.serble.chat.BuildConfig
import net.serble.chat.ChatApp
import net.serble.chat.Incoming
import net.serble.chat.data.ApiException
import net.serble.chat.data.Guild
import net.serble.chat.data.StoreNotice
import net.serble.chat.ui.theme.SerbleChatTheme
import java.security.SecureRandom

/** Shows short messages at the bottom of the screen. */
class Messages(private val host: SnackbarHostState, private val scope: CoroutineScope) {
    fun show(text: String) {
        scope.launch {
            host.currentSnackbarData?.dismiss()
            host.showSnackbar(text)
        }
    }

    /** Runs an action, showing its failure as a message. */
    fun run(scope: CoroutineScope, action: suspend () -> Unit) {
        scope.launch {
            try {
                action()
            } catch (e: ApiException) {
                show(e.message ?: "Something went wrong.")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                show(e.message ?: "Something went wrong.")
            }
        }
    }
}

val LocalApp = staticCompositionLocalOf<ChatApp> { error("no app") }
val LocalMessages = staticCompositionLocalOf<Messages> { error("no messages") }

object Routes {
    const val HOME = "home"
    const val APPEARANCE = "appearance"
    const val THEME = "theme/{id}"
    fun theme(id: String) = "theme/$id"
    const val FRIENDS = "friends?tab={tab}"
    fun friends(tab: Int = 0) = "friends?tab=$tab"
    const val SETTINGS = "settings"
    const val VOICE = "voice"
    const val FILES = "files"
    const val GUILD_SETTINGS = "guild/{guildId}"
    fun guildSettings(guildId: Long) = "guild/$guildId"
    const val SEARCH = "search/{channelId}"
    fun search(channelId: Long) = "search/$channelId"
}

@Composable
fun AppRoot(app: ChatApp, incoming: Flow<Incoming>) {
    val signedIn by app.signedIn.collectAsStateWithLifecycle()
    val snackbars = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val messages = remember { Messages(snackbars, scope) }
    val context = LocalContext.current

    val theme by app.themes.active.collectAsStateWithLifecycle()
    SerbleChatTheme(theme.colors) {
        val avatarVersions by app.store.avatarVersions.collectAsStateWithLifecycle()
        CompositionLocalProvider(LocalApp provides app, LocalMessages provides messages, LocalAvatarVersions provides avatarVersions) {
            val nav = rememberNavController()
            var pendingInvite by remember { mutableStateOf<String?>(null) }
            // Opening a channel from anywhere: back to the panels, which show it
            var channelRequest by remember { mutableStateOf<ChannelRequest?>(null) }
            val openChannel: (Long, Long?) -> Unit = { id, message ->
                channelRequest = ChannelRequest(id, message)
                nav.popBackStack(Routes.HOME, inclusive = false)
            }
            var signingIn by remember { mutableStateOf(false) }

            LaunchedEffect(Unit) {
                incoming.collect { event ->
                    when (event) {
                        is Incoming.SignIn -> {
                            val uri = event.uri
                            val expected = app.settings.oauthState()
                            val code = uri.getQueryParameter("code")
                            when {
                                uri.getQueryParameter("authorized") != "true" || code == null -> messages.show("Sign-in was cancelled.")
                                expected != null && uri.getQueryParameter("state") != expected -> messages.show("Sign-in didn't match. Try again.")
                                else -> {
                                    signingIn = true
                                    try {
                                        app.signIn(code)
                                    } catch (e: Exception) {
                                        messages.show(e.message ?: "Couldn't sign in.")
                                    } finally {
                                        app.settings.setOauthState(null)
                                        signingIn = false
                                    }
                                }
                            }
                        }
                        is Incoming.FilesConsent -> if (app.signedIn.value == true) messages.show(app.files.finishConsent(event.uri))
                        is Incoming.DebugToken -> runCatching { app.useToken(event.token) }.onFailure { messages.show(it.message ?: "Bad token") }
                        is Incoming.OpenChannel -> {
                            if (app.signedIn.value == true) openChannel(event.channelId, event.messageId)
                        }
                        is Incoming.Invite -> pendingInvite = event.id
                    }
                }
            }

            // Server notices: shown here while the app is open
            LaunchedEffect(Unit) {
                app.store.notices.collect { if (it is StoreNotice.Info) messages.show(it.text) }
            }
            val voiceError by app.voice.errors.collectAsStateWithLifecycle()
            LaunchedEffect(voiceError) {
                voiceError?.let {
                    messages.show(it)
                    app.voice.clearError()
                }
            }

            Box(Modifier.fillMaxSize()) {
                when (signedIn) {
                    null -> Unit
                    false -> SignInScreen(
                        busy = signingIn,
                        onSignIn = { scope.launch { startSignIn(context, app) } },
                        onDevSignIn = if (BuildConfig.DEV_SIGN_IN) ({ token -> messages.run(scope) { app.useToken(token) } }) else null,
                    )
                    true -> {
                        RequestNotificationPermission()
                        MainNav(nav, channelRequest, openChannel)
                    }
                }
                SnackbarHost(snackbars, Modifier.align(Alignment.BottomCenter))
            }

            val invite = pendingInvite
            if (invite != null && signedIn == true) {
                InviteDialog(invite, onDismiss = { pendingInvite = null }, onJoined = { guild ->
                    pendingInvite = null
                    val first = app.store.guildChannels.value[guild.id]?.firstOrNull()
                    if (first != null) openChannel(first.id, null)
                })
            }
        }
    }
}

/**
 * Pages slide in from the right over the one before, which drifts left a little. Going back is the
 * same in reverse, and a back gesture scrubs through it under the finger instead of the default
 * shrink-and-fade.
 */
private const val NAV_MS = 320
private val enterPage: androidx.compose.animation.EnterTransition =
    slideInHorizontally(tween(NAV_MS, easing = androidx.compose.animation.core.FastOutSlowInEasing)) { it }
private val coverPage: androidx.compose.animation.ExitTransition =
    slideOutHorizontally(tween(NAV_MS, easing = androidx.compose.animation.core.FastOutSlowInEasing)) { -it / 4 } +
        fadeOut(tween(NAV_MS), targetAlpha = 0.6f)
private val uncoverPage: androidx.compose.animation.EnterTransition =
    slideInHorizontally(tween(NAV_MS, easing = androidx.compose.animation.core.FastOutSlowInEasing)) { -it / 4 } +
        fadeIn(tween(NAV_MS), initialAlpha = 0.6f)
private val leavePage: androidx.compose.animation.ExitTransition =
    slideOutHorizontally(tween(NAV_MS, easing = androidx.compose.animation.core.FastOutSlowInEasing)) { it }

// The back gesture seeks through these, so they're linear: the page then sits exactly under the
// finger instead of running ahead of it. The swipe's own spring supplies the easing on release.
private val gestureUncoverPage: androidx.compose.animation.EnterTransition =
    slideInHorizontally(tween(NAV_MS, easing = LinearEasing)) { -it / 4 } + fadeIn(tween(NAV_MS, easing = LinearEasing), initialAlpha = 0.6f)
private val gestureLeavePage: androidx.compose.animation.ExitTransition =
    slideOutHorizontally(tween(NAV_MS, easing = LinearEasing)) { it }

@Composable
private fun MainNav(nav: NavHostController, channelRequest: ChannelRequest?, openChannel: (Long, Long?) -> Unit) {
    NavHost(
        navController = nav,
        startDestination = Routes.HOME,
        enterTransition = { enterPage },
        exitTransition = { coverPage },
        popEnterTransition = { uncoverPage },
        popExitTransition = { leavePage },
        predictivePopEnterTransition = { gestureUncoverPage },
        predictivePopExitTransition = { gestureLeavePage },
    ) {
        composable(Routes.HOME) {
            MainScreen(
                request = channelRequest,
                onOpenFriends = { nav.navigate(Routes.friends()) },
                onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                onOpenVoice = { nav.navigate(Routes.VOICE) },
                onOpenGuildSettings = { nav.navigate(Routes.guildSettings(it)) },
                onOpenSearch = { nav.navigate(Routes.search(it)) },
            )
        }
        composable(Routes.SEARCH, arguments = listOf(navArgument("channelId") { type = NavType.LongType })) { entry ->
            val channelId = entry.arguments?.getLong("channelId") ?: return@composable
            SearchScreen(channelId = channelId, onBack = { nav.popBackStack() }, onOpenMessage = { openChannel(channelId, it) })
        }
        composable(Routes.FRIENDS, arguments = listOf(navArgument("tab") { type = NavType.IntType; defaultValue = 0 })) { entry ->
            FriendsScreen(onBack = { nav.popBackStack() }, onOpenChannel = { openChannel(it, null) }, initialTab = entry.arguments?.getInt("tab") ?: 0)
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { nav.popBackStack() },
                onOpenAppearance = { nav.navigate(Routes.APPEARANCE) },
                onOpenBlocked = { nav.navigate(Routes.friends(2)) },
                onOpenFiles = { nav.navigate(Routes.FILES) },
            )
        }
        composable(Routes.FILES) { FilesScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.APPEARANCE) { AppearanceScreen(onBack = { nav.popBackStack() }, onEdit = { nav.navigate(Routes.theme(it)) }) }
        composable(Routes.THEME, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            ThemeEditorScreen(id = entry.arguments?.getString("id") ?: return@composable, onBack = { nav.popBackStack() })
        }
        composable(Routes.VOICE) {
            VoiceScreen(onBack = { nav.popBackStack() }, onOpenChat = { openChannel(it, null) })
        }
        composable(Routes.GUILD_SETTINGS, arguments = listOf(navArgument("guildId") { type = NavType.LongType })) { entry ->
            GuildSettingsScreen(guildId = entry.arguments?.getLong("guildId") ?: return@composable, onBack = { nav.popBackStack() })
        }
    }
}

@Composable
private fun RequestNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }
}

@Composable
private fun InviteDialog(id: String, onDismiss: () -> Unit, onJoined: (Guild) -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var guild by remember { mutableStateOf<Guild?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) {
        try {
            guild = app.api.invite(id).guild
        } catch (e: ApiException) {
            error = if (e.status == 404) "This invite doesn't exist or has expired." else e.message
        }
    }
    val already = guild?.let { g -> app.store.guilds.value.any { it.id == g.id } } == true
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(guild?.name ?: "Invite") },
        text = { Text(error ?: if (guild == null) "Loading…" else if (already) "You're already in this guild." else "You've been invited to join ${guild?.name}.") },
        confirmButton = {
            TextButton(enabled = guild != null && error == null, onClick = {
                messages.run(scope) {
                    val joined = if (already) guild!! else app.store.joinInvite(id)
                    if (joined != null) onJoined(joined) else onDismiss()
                }
            }) { Text(if (already) "Open" else "Join") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Not now") } },
    )
}

private suspend fun startSignIn(context: Context, app: ChatApp) {
    val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val state = bytes.joinToString("") { "%02x".format(it) }
    app.settings.setOauthState(state)
    val url = Uri.parse("https://serble.net/oauth/authorize").buildUpon()
        .appendQueryParameter("client_id", BuildConfig.OAUTH_CLIENT_ID)
        .appendQueryParameter("redirect_uri", BuildConfig.OAUTH_REDIRECT)
        .appendQueryParameter("response_type", "code")
        .appendQueryParameter("scope", "user_info")
        .appendQueryParameter("state", state)
        .build()
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, url)
    } catch (_: Exception) {
        context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** Opens Serble's page asking the user to allow SerbleChat into Serble Files. */
suspend fun startFilesConsent(context: Context, app: ChatApp) {
    val url = app.files.consentUrl(BuildConfig.FILES_CONSENT_REDIRECT) ?: return
    openUrl(context, url.toString())
}

/** Opens a web link in a browser tab. */
fun openUrl(context: Context, url: String) {
    val uri = Uri.parse(url)
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
    } catch (_: Exception) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
