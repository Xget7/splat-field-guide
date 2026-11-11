package com.splatkit.input

import android.view.MotionEvent

/**
 * The view's own gesture, and the only touch the SDK handles itself: a finger drags to
 * look (yaw, and pitch when the gyroscope is off).
 * Pixels become radians through [lookSensitivity].
 *
 * Walking comes from the host through `setWalkVelocity` or `walk`, so its own controls, on
 * its own views, keep every other touch.
 */
internal class TouchInput(private val listener: Listener) {
    interface Listener {
        fun onLook(deltaYaw: Float, deltaPitch: Float)
    }

    /** Radians per pixel dragged. */
    var lookSensitivity = 0.004f

    /** Whether a drag is allowed to turn the camera. */
    var lookEnabled = true

    // One finger leads the whole drag, by its id: a second one landing on the view neither
    // jumps the camera nor takes over when the first lifts.
    private var pointerId = MotionEvent.INVALID_POINTER_ID
    private var lastX = 0f
    private var lastY = 0f

    fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> grab(event, 0)
            MotionEvent.ACTION_MOVE -> {
                val index = event.findPointerIndex(pointerId)
                if (index >= 0) {
                    val x = event.getX(index)
                    val y = event.getY(index)
                    if (lookEnabled) {
                        listener.onLook((lastX - x) * lookSensitivity, (lastY - y) * lookSensitivity)
                    }
                    lastX = x
                    lastY = y
                }
            }
            MotionEvent.ACTION_POINTER_UP ->
                if (event.getPointerId(event.actionIndex) == pointerId) letGo()
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> letGo()
        }
        return true
    }

    /** Lets go of the finger, when looking is turned off or the view goes away. */
    fun letGo() {
        pointerId = MotionEvent.INVALID_POINTER_ID
    }

    private fun grab(event: MotionEvent, index: Int) {
        pointerId = event.getPointerId(index)
        lastX = event.getX(index)
        lastY = event.getY(index)
    }
}
