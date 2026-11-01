package net.serble.chat.ui

import androidx.activity.BackEventCompat
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Swiping right anywhere on a page goes back, the same as the system back gesture from the edge.
 * It drives the activity's back dispatcher with predictive back events, so the page follows the
 * finger with the same animation, and the page underneath shows through, exactly as with the edge
 * swipe. Vertical scrolling is untouched: only a drag that starts out sideways and rightwards counts.
 */
@Composable
fun Modifier.swipeBack(): Modifier {
    val dispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher ?: return this
    val flingVelocity = with(LocalDensity.current) { 800.dp.toPx() }
    return this.pointerInput(dispatcher) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var started = false
            val drag = awaitHorizontalTouchSlopOrCancellation(down.id) { change, over ->
                // Only rightwards; leftwards drags are left alone
                if (over > 0) {
                    change.consume()
                    started = true
                }
            } ?: return@awaitEachGesture
            if (!started) return@awaitEachGesture

            val width = size.width.toFloat().coerceAtLeast(1f)
            val startX = down.position.x
            val tracker = VelocityTracker()
            tracker.addPosition(drag.uptimeMillis, drag.position)
            fun event(x: Float, y: Float) =
                BackEventCompat(x, y, ((x - startX) / width).coerceIn(0f, 1f), BackEventCompat.EDGE_LEFT)

            dispatcher.dispatchOnBackStarted(event(drag.position.x, drag.position.y))
            var last = drag.position
            val completed = horizontalDrag(drag.id) { change ->
                tracker.addPosition(change.uptimeMillis, change.position)
                last = change.position
                dispatcher.dispatchOnBackProgressed(event(change.position.x, change.position.y))
                if (change.positionChange().x != 0f) change.consume()
            }
            val progress = (last.x - startX) / width
            val velocity = tracker.calculateVelocity().x
            if (completed && (progress > 0.35f || velocity > flingVelocity)) dispatcher.onBackPressed()
            else dispatcher.dispatchOnBackCancelled()
        }
    }
}
