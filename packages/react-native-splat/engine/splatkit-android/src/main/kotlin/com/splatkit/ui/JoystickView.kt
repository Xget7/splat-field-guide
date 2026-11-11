package com.splatkit.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

/**
 * A thumb stick: a base ring with a knob that follows the finger and snaps back on release.
 * Reports a direction in [-1, 1] on each axis, y positive upwards, through [onMove].
 *
 * Optional, and nothing in the SDK uses it: a host that wants walking lays this over its
 * [com.splatkit.SplatSurfaceView] and feeds `setWalkVelocity(y * speed, x * speed)`. A host
 * with its own controls ignores this class entirely.
 */
class JoystickView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    /** Called on every change, and with (0, 0) when the finger lifts. */
    var onMove: ((x: Float, y: Float) -> Unit)? = null

    private var knobX = 0f
    private var knobY = 0f

    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x40FFFFFF
        style = Paint.Style.FILL
    }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x80FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 3f * resources.displayMetrics.density
    }
    private val knobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xE0FFFFFF.toInt()
        style = Paint.Style.FILL
    }

    private val baseRadius get() = min(width, height) / 2f - ringPaint.strokeWidth
    private val knobRadius get() = baseRadius * 0.4f
    private val travel get() = baseRadius - knobRadius

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        canvas.drawCircle(cx, cy, baseRadius, basePaint)
        canvas.drawCircle(cx, cy, baseRadius, ringPaint)
        canvas.drawCircle(cx + knobX * travel, cy - knobY * travel, knobRadius, knobPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                var dx = (event.x - width / 2f) / travel
                var dy = -(event.y - height / 2f) / travel
                val length = hypot(dx, dy)
                if (length > 1f) {
                    dx /= length
                    dy /= length
                }
                update(dx, dy)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                update(0f, 0f)
            }
        }
        return true
    }

    private fun update(x: Float, y: Float) {
        if (x == knobX && y == knobY) return
        knobX = x
        knobY = y
        onMove?.invoke(x, y)
        invalidate()
    }
}
