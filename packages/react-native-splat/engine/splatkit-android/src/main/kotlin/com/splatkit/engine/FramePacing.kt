package com.splatkit.engine

private const val NANOS_PER_SECOND = 1_000_000_000f

// Vsync timestamps wobble around the panel period, so a 60 Hz tick that lands slightly early
// under a cap of 60 must still draw instead of halving the rate to 30.
private const val VSYNC_JITTER_NANOS = 2_000_000L

/**
 * Decides which vsyncs the render loop draws on. Without a cap every vsync draws; with one, a
 * vsync that arrives sooner than one capped period after the last drawn frame is skipped, so a
 * 120 Hz panel capped at 60 draws every other tick. Render thread only.
 */
internal class FramePacing {
    private var minFrameNanos = 0L
    // Choreographer timestamps come from System.nanoTime, far from zero, so the first vsync draws.
    private var lastFrameNanos = 0L

    /** The most frames a second to draw, or null to draw on every vsync. */
    var maxFramesPerSecond: Float? = null
        set(value) {
            field = value
            minFrameNanos = if (value == null) 0L else (NANOS_PER_SECOND / value).toLong() - VSYNC_JITTER_NANOS
        }

    /** True when the vsync at [frameTimeNanos] should draw, which then counts as the last drawn frame. */
    fun isFrameDue(frameTimeNanos: Long): Boolean {
        if (frameTimeNanos - lastFrameNanos < minFrameNanos) return false
        lastFrameNanos = frameTimeNanos
        return true
    }
}
