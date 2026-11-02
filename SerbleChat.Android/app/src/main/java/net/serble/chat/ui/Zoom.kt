package net.serble.chat.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Pinch, pan and double-tap zoom for something that fills its box: a photo or a stream.
 * The content is scaled about the box's centre and moved by [offset], and never pulled so far
 * that an edge comes away from the side of the box.
 */
@Stable
class ZoomState(val maxScale: Float = 8f) {
    var scale by mutableFloatStateOf(1f)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set
    internal var size = IntSize.Zero
    private val animation = Animatable(Offset.Zero, Offset.VectorConverter)
    private var animating = false

    val zoomed: Boolean get() = scale > 1.01f

    private val centre get() = Offset(size.width / 2f, size.height / 2f)

    /**
     * Width over height of what's shown, once known: a photo or video fitted inside the box leaves
     * bars, and zoomed in it should stay centred along a side it doesn't yet fill.
     */
    var contentAspect by mutableFloatStateOf(0f)

    private fun clamp(o: Offset, s: Float): Offset {
        val w = size.width.toFloat()
        val h = size.height.toFloat()
        var cw = w
        var ch = h
        if (contentAspect > 0f && w > 0f && h > 0f) {
            if (contentAspect > w / h) ch = w / contentAspect else cw = h * contentAspect
        }
        val maxX = ((s * cw - w) / 2f).coerceAtLeast(0f)
        val maxY = ((s * ch - h) / 2f).coerceAtLeast(0f)
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    /** Zooms by [factor] keeping the point under [focus] (in box coordinates) where it is, then moves by [pan]. */
    fun transform(factor: Float, focus: Offset, pan: Offset = Offset.Zero) {
        val s = scale
        val next = (s * factor).coerceIn(1f, maxScale)
        val r = next / s
        val moved = (focus - centre) * (1f - r) + offset * r + pan
        scale = next
        offset = clamp(moved, next)
    }

    fun reset() {
        scale = 1f
        offset = Offset.Zero
    }

    /** Double tap: in to 2.5× at the tapped point, or back out. */
    suspend fun toggle(at: Offset) {
        if (animating) return
        animating = true
        try {
            val fromScale = scale
            val fromOffset = offset
            val toScale = if (zoomed) 1f else 2.5f
            val toOffset = if (toScale == 1f) Offset.Zero else clamp((at - centre) * (1f - toScale), toScale)
            animation.snapTo(Offset(0f, 0f))
            animation.animateTo(Offset(1f, 0f), tween(220)) {
                val t = value.x
                scale = fromScale + (toScale - fromScale) * t
                offset = fromOffset + (toOffset - fromOffset) * t
            }
        } finally {
            animating = false
        }
    }
}

@Composable
fun rememberZoomState(vararg keys: Any?): ZoomState = remember(*keys) { ZoomState() }

/** Applies the state's scale and offset to what this modifies. Put [zoomGestures] on the box around it. */
fun Modifier.zoomed(state: ZoomState): Modifier = graphicsLayer {
    scaleX = state.scale
    scaleY = state.scale
    translationX = state.offset.x
    translationY = state.offset.y
}

/**
 * Reads the gestures. One finger only pans once zoomed in, so a parent can still use single-finger
 * swipes at 1×; two fingers always zoom.
 */
fun Modifier.zoomGestures(state: ZoomState, scope: CoroutineScope, onTap: (() -> Unit)? = null): Modifier = this
    .onSizeChanged { state.size = it }
    .pointerInput(state) {
        detectTapGestures(
            onDoubleTap = { p -> scope.launch { state.toggle(p) } },
            onTap = { onTap?.invoke() },
        )
    }
    .pointerInput(state) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            do {
                val event = awaitPointerEvent()
                val pressed = event.changes.count { it.pressed }
                if (event.changes.any { it.isConsumed }) break
                val zoom = event.calculateZoom()
                val pan = event.calculatePan()
                if (pressed >= 2 || (state.zoomed && pan != Offset.Zero)) {
                    if (zoom != 1f || pan != Offset.Zero) {
                        state.transform(zoom, event.calculateCentroid(useCurrent = false), pan)
                    }
                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                }
            } while (event.changes.any { it.pressed })
        }
    }
