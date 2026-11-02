package net.serble.chat.ui

import androidx.activity.BackEventCompat
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Swiping right anywhere on a page goes back, the same as the system back gesture from the edge.
 * It drives the activity's back dispatcher with predictive back events, so the page underneath
 * shows through as the page slides off.
 *
 * It is meant to feel like dragging the chat aside on the main screen: the page stays under the
 * finger, and on release it springs the rest of the way (or back) carrying the fling's speed, with
 * the same thresholds. The settle is driven here as more progress events, and back is only
 * committed (or cancelled) once the page has arrived, so the navigation's own fixed-length finish
 * never runs. Vertical scrolling is untouched: only a drag that starts out sideways and rightwards
 * counts.
 */
@Composable
fun Modifier.swipeBack(): Modifier {
    val dispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher ?: return this
    val scope = rememberCoroutineScope()
    val settling = remember { arrayOfNulls<Job>(1) }
    // As AnchoredDraggable's defaults, which the main screen's panels use
    val flingVelocity = with(LocalDensity.current) { 125.dp.toPx() }
    return this.pointerInput(dispatcher) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            // Still sliding from the last swipe: let it finish
            if (settling[0]?.isActive == true) return@awaitEachGesture
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
            var y = drag.position.y
            fun event(dx: Float) = BackEventCompat(startX + dx, y, (dx / width).coerceIn(0f, 1f), BackEventCompat.EDGE_LEFT)

            // Fed every sample, batched ones included, as draggable does
            val tracker = VelocityTracker()
            tracker.addPointerInputChange(down)
            tracker.addPointerInputChange(drag)
            var dx = (drag.position.x - startX).coerceIn(0f, width)
            dispatcher.dispatchOnBackStarted(event(dx))
            val completed = horizontalDrag(drag.id) { change ->
                tracker.addPointerInputChange(change)
                dx = (change.position.x - startX).coerceIn(0f, width)
                y = change.position.y
                dispatcher.dispatchOnBackProgressed(event(dx))
                if (change.positionChange().x != 0f) change.consume()
            }
            val velocity = if (completed) tracker.calculateVelocity().x else 0f
            val leave = completed && when {
                velocity > flingVelocity -> true
                velocity < -flingVelocity -> false
                else -> dx > width / 2
            }

            settling[0] = scope.launch {
                var done = false
                try {
                    animate(
                        initialValue = dx,
                        targetValue = if (leave) width else 0f,
                        initialVelocity = velocity,
                        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
                    ) { value, _ -> dispatcher.dispatchOnBackProgressed(event(value)) }
                    done = true
                    if (leave) dispatcher.onBackPressed() else dispatcher.dispatchOnBackCancelled()
                } finally {
                    // Interrupted (the page went away some other way): don't leave the gesture open
                    if (!done) dispatcher.dispatchOnBackCancelled()
                }
            }
        }
    }
}
