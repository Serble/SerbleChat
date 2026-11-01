package net.serble.chat.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/** A server-to-client call on the hub: the method name and its arguments. */
data class HubEvent(val target: String, val args: JsonArray) {
    /** Most events carry a single object argument. */
    val payload: JsonObject get() = args.firstOrNull() as? JsonObject ?: JsonObject(emptyMap())
}

enum class HubState { Disconnected, Connecting, Connected }

/**
 * A small client for ASP.NET Core SignalR's JSON protocol over one WebSocket: no negotiate step
 * (the server accepts WebSockets straight away), a handshake, then records separated by 0x1E.
 *
 * It keeps itself connected while [start]ed, reconnecting with backoff, and sends the presence
 * heartbeat the backend expects every 30 seconds. [stop] closes the socket cleanly, which the
 * backend takes as "this device went away" and starts sending push notifications instead.
 */
class Hub(
    private val baseUrl: String,
    private val client: OkHttpClient,
    private val token: () -> String?,
    private val scope: CoroutineScope,
) {
    private val _events = MutableSharedFlow<HubEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<HubEvent> = _events.asSharedFlow()

    private val _state = MutableStateFlow(HubState.Disconnected)
    val state: StateFlow<HubState> = _state.asStateFlow()

    /** Emits each time a connection is (re-)established, so callers can resync what they missed. */
    private val _connected = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    val connected: SharedFlow<Unit> = _connected.asSharedFlow()

    private var socket: WebSocket? = null
    private var runner: Job? = null
    private var heartbeat: Job? = null
    private val invocationIds = AtomicLong(0)
    @Volatile private var lastReceived = 0L
    @Volatile private var wanted = false

    fun start() {
        wanted = true
        if (runner?.isActive == true) return
        runner = scope.launch { runLoop() }
    }

    fun stop() {
        wanted = false
        runner?.cancel()
        runner = null
        heartbeat?.cancel()
        socket?.close(1000, "bye")
        socket = null
        _state.value = HubState.Disconnected
    }

    /** Drops the connection and makes a new one, e.g. so the server re-adds us to new channel groups. */
    fun reconnect() {
        if (!wanted) return
        socket?.close(1000, "reconnect")
    }

    /** Fire-and-forget invocation. Returns false if there's no live connection. */
    fun send(target: String, vararg args: Any?): Boolean {
        val ws = socket ?: return false
        if (_state.value != HubState.Connected) return false
        val message = buildJsonObject {
            put("type", 1)
            put("invocationId", invocationIds.incrementAndGet().toString())
            put("target", target)
            put("arguments", buildJsonArray {
                for (arg in args) add(when (arg) {
                    null -> kotlinx.serialization.json.JsonNull
                    is Number -> JsonPrimitive(arg)
                    is Boolean -> JsonPrimitive(arg)
                    else -> JsonPrimitive(arg.toString())
                })
            })
        }
        return ws.send(message.toString() + RS)
    }

    private suspend fun runLoop() {
        var attempt = 0
        while (scope.isActive && wanted) {
            val jwt = token() ?: return
            _state.value = HubState.Connecting
            val closed = kotlinx.coroutines.CompletableDeferred<Unit>()
            val wsUrl = baseUrl.trimEnd('/').replaceFirst("http", "ws") + "/updates?access_token=" + Api.q(jwt)
            val ws = client.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
                private val partial = StringBuilder()

                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"protocol":"json","version":1}""" + RS)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    lastReceived = System.currentTimeMillis()
                    partial.append(text)
                    while (true) {
                        val end = partial.indexOf(RS.toString())
                        if (end < 0) break
                        val record = partial.substring(0, end)
                        partial.delete(0, end + 1)
                        handleRecord(webSocket, record)
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    closed.complete(Unit)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.w(TAG, "Hub connection failed: ${t.message}")
                    closed.complete(Unit)
                }
            })
            socket = ws
            // The server pings every 15s; if nothing at all arrives for 35s the connection is dead.
            lastReceived = System.currentTimeMillis()
            val watchdog = scope.launch {
                while (isActive) {
                    delay(5_000)
                    ws.send("""{"type":6}""" + RS)
                    if (System.currentTimeMillis() - lastReceived > 35_000) {
                        Log.w(TAG, "Hub timed out")
                        ws.cancel()
                        closed.complete(Unit)
                        break
                    }
                }
            }
            closed.await()
            watchdog.cancel()
            heartbeat?.cancel()
            if (socket === ws) socket = null
            val wasConnected = _state.value == HubState.Connected
            _state.value = HubState.Disconnected
            if (!wanted) break
            attempt = if (wasConnected) 0 else attempt + 1
            delay(min(30_000L, if (attempt == 0) 500L else 1_000L * (1L shl min(attempt, 5))))
        }
    }

    private fun handleRecord(webSocket: WebSocket, record: String) {
        if (record.isBlank()) return
        val obj = runCatching { AppJson.parseToJsonElement(record).jsonObject }.getOrNull() ?: return
        val type = obj["type"]?.jsonPrimitive?.int
        when (type) {
            null -> {
                // handshake response: {} or {"error": "..."}
                val error = obj["error"]?.jsonPrimitive?.content
                if (error != null) {
                    Log.w(TAG, "Hub handshake refused: $error")
                    webSocket.close(1000, null)
                    return
                }
                _state.value = HubState.Connected
                startHeartbeat()
                _connected.tryEmit(Unit)
            }
            1 -> {
                val target = obj["target"]?.jsonPrimitive?.content ?: return
                val args = obj["arguments"]?.jsonArray ?: JsonArray(emptyList())
                _events.tryEmit(HubEvent(target, args))
            }
            7 -> {
                Log.i(TAG, "Hub closed by server: ${obj["error"]}")
                webSocket.close(1000, null)
            }
            else -> Unit // 3 completions, 6 pings
        }
    }

    private fun startHeartbeat() {
        heartbeat?.cancel()
        heartbeat = scope.launch {
            while (isActive) {
                send("UpdateStatus")
                delay(30_000)
            }
        }
    }

    private companion object {
        const val TAG = "Hub"
        const val RS = '\u001e'
    }
}
