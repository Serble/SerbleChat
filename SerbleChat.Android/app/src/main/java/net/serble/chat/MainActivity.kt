package net.serble.chat

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlinx.coroutines.flow.MutableSharedFlow
import net.serble.chat.ui.AppRoot

/** Things that arrive from outside the app: the sign-in redirect, notifications, links. */
sealed interface Incoming {
    data class SignIn(val uri: Uri) : Incoming
    data class OpenChannel(val channelId: Long, val messageId: Long? = null) : Incoming
    data class Invite(val id: String) : Incoming
    data class DebugToken(val token: String) : Incoming
}

class MainActivity : ComponentActivity() {
    private val incoming = MutableSharedFlow<Incoming>(replay = 1, extraBufferCapacity = 4)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        setContent { AppRoot(app = application as ChatApp, incoming = incoming) }
    }

    override fun onResume() {
        super.onResume()
        net.serble.chat.data.Clock.init(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        parse(uri)?.let { incoming.tryEmit(it) }
    }

    companion object {
        fun parse(uri: Uri): Incoming? {
            val segments = uri.pathSegments
            return when {
                uri.scheme == "serblechat" && uri.host == "auth" -> Incoming.SignIn(uri)
                uri.scheme == "serblechat" && uri.host == "channel" ->
                    segments.firstOrNull()?.toLongOrNull()?.let { Incoming.OpenChannel(it, uri.getQueryParameter("message")?.toLongOrNull()) }
                uri.scheme == "serblechat" && uri.host == "debug" && BuildConfig.DEV_SIGN_IN ->
                    uri.getQueryParameter("token")?.let { Incoming.DebugToken(it) }
                segments.firstOrNull() == "invite" -> segments.getOrNull(1)?.let { Incoming.Invite(it) }
                segments.getOrNull(0) == "app" && segments.getOrNull(1) == "channel" ->
                    segments.getOrNull(2)?.toLongOrNull()?.let { Incoming.OpenChannel(it, uri.getQueryParameter("message")?.toLongOrNull()) }
                else -> null
            }
        }
    }
}
