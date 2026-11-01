package net.serble.chat.push

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import net.serble.chat.data.Api
import net.serble.chat.data.SettingsStore
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint

/** An app that can deliver push messages to us. Our own package is the built-in Google fallback. */
data class Distributor(val packageName: String, val label: String, val builtIn: Boolean)

data class PushStatus(
    val enabled: Boolean = true,
    val distributor: Distributor? = null,
    val registered: Boolean = false,
    val problem: String? = null,
)

/**
 * Push notifications through UnifiedPush. The user's distributor (ntfy, Sunup...) is preferred;
 * without one we fall back to Google's push service through the embedded FCM distributor, which
 * needs nothing set up beyond Play Services being on the phone. Either way the backend sends
 * ordinary Web Push, encrypted end to end, and the connector library decrypts it.
 */
class Push(
    private val context: Context,
    private val api: Api,
    private val settings: SettingsStore,
    private val scope: CoroutineScope,
    private val signedIn: () -> Boolean,
) {
    private val _status = MutableStateFlow(PushStatus())
    val status: StateFlow<PushStatus> = _status.asStateFlow()

    private val ownPackage = context.packageName

    fun distributors(): List<Distributor> = UnifiedPush.getDistributors(context).map { pkg ->
        Distributor(pkg, labelOf(pkg), builtIn = pkg == ownPackage)
    }.sortedBy { it.builtIn }

    private fun labelOf(pkg: String): String {
        if (pkg == ownPackage) return "Google Play Services"
        return runCatching {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        }.getOrDefault(pkg)
    }

    private fun hasPlayServices(): Boolean = try {
        context.packageManager.getPackageInfo("com.google.android.gms", 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** Registers for push with the saved distributor, picking one first if needed. */
    fun ensureRegistered() {
        scope.launch {
            val local = settings.current()
            if (!local.pushEnabled || !signedIn()) {
                _status.update { it.copy(enabled = local.pushEnabled) }
                return@launch
            }
            var saved = UnifiedPush.getAckDistributor(context) ?: UnifiedPush.getSavedDistributor(context)
            val available = distributors()
            if (saved != null && available.none { it.packageName == saved }) saved = null
            if (saved == null) {
                // Prefer a real distributor the user installed; else Google's, if the phone has it
                val pick = available.firstOrNull { !it.builtIn }
                    ?: available.firstOrNull { it.builtIn && hasPlayServices() }
                if (pick == null) {
                    _status.value = PushStatus(enabled = true, problem = "No way to receive notifications: install a UnifiedPush app such as ntfy.")
                    return@launch
                }
                UnifiedPush.saveDistributor(context, pick.packageName)
                saved = pick.packageName
            }
            _status.update { it.copy(enabled = true, distributor = available.firstOrNull { d -> d.packageName == saved }, problem = null) }
            try {
                val vapid = api.vapidPublicKey()
                UnifiedPush.register(context, INSTANCE, null, vapid)
            } catch (e: Exception) {
                Log.w(TAG, "Push registration failed", e)
                _status.update { it.copy(problem = "Couldn't set up notifications: ${e.message}") }
            }
        }
    }

    /** Switches to another distributor, e.g. from Google's to ntfy. */
    fun useDistributor(packageName: String) {
        scope.launch {
            unregisterFromServer()
            UnifiedPush.removeDistributor(context)
            UnifiedPush.saveDistributor(context, packageName)
            ensureRegistered()
        }
    }

    suspend fun setEnabled(enabled: Boolean) {
        settings.update { it.copy(pushEnabled = enabled) }
        if (enabled) ensureRegistered() else {
            unregisterFromServer()
            UnifiedPush.removeDistributor(context)
            _status.value = PushStatus(enabled = false)
        }
    }

    /** Called before signing out, while the token still works. */
    suspend fun signOut() {
        unregisterFromServer()
        runCatching { UnifiedPush.removeDistributor(context) }
        _status.value = PushStatus()
    }

    private suspend fun unregisterFromServer() {
        val endpoint = settings.pushEndpoint() ?: return
        runCatching { api.unregisterPush(endpoint) }
        settings.setPushEndpoint(null)
        _status.update { it.copy(registered = false) }
    }

    // ── Called from PushService ─────────────────────────────────────────────────────────

    fun onNewEndpoint(endpoint: PushEndpoint) {
        scope.launch {
            if (!signedIn()) return@launch
            val keys = endpoint.pubKeySet
            if (keys == null) {
                _status.update { it.copy(problem = "The distributor gave an endpoint without encryption keys.") }
                return@launch
            }
            try {
                val previous = settings.pushEndpoint()
                api.registerPush(endpoint.url, keys.pubKey, keys.auth)
                if (previous != null && previous != endpoint.url) runCatching { api.unregisterPush(previous) }
                settings.setPushEndpoint(endpoint.url)
                _status.update { it.copy(registered = true, problem = null) }
                Log.i(TAG, "Push endpoint registered")
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't register push endpoint with the server", e)
                _status.update { it.copy(problem = "Couldn't register with the server: ${e.message}") }
            }
        }
    }

    fun onRegistrationFailed(reason: FailedReason) {
        Log.w(TAG, "Push registration failed: $reason")
        _status.update {
            it.copy(registered = false, problem = when (reason) {
                FailedReason.NETWORK -> "The push service couldn't be reached. It'll try again."
                FailedReason.ACTION_REQUIRED -> "Your push app needs attention: open it to finish setting up."
                FailedReason.VAPID_REQUIRED -> "This push app is too old. Update it."
                FailedReason.INTERNAL_ERROR -> "The push app failed to register."
            })
        }
    }

    fun onUnregistered() {
        scope.launch {
            unregisterFromServer()
            _status.update { it.copy(registered = false) }
        }
    }

    companion object {
        const val INSTANCE = "default"
        private const val TAG = "Push"
    }
}
