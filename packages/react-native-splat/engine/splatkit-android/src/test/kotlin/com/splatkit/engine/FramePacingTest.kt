package com.splatkit.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class FramePacingTest {
    @Test fun aCapOfSixtyHalvesAOneHundredTwentyHertzPanel() {
        assertEquals(CAP_60, framesDrawnInOneSecond(PANEL_120_HZ, CAP_60.toFloat(), jitterNanos = 0))
    }

    @Test fun aSixtyHertzPanelCappedAtSixtyDrawsEveryTickEvenWhenOneArrivesEarly() {
        assertEquals(PANEL_60_HZ, framesDrawnInOneSecond(PANEL_60_HZ, CAP_60.toFloat(), EARLY_TICK_NANOS))
    }

    @Test fun withoutACapEveryTickDraws() {
        assertEquals(PANEL_120_HZ, framesDrawnInOneSecond(PANEL_120_HZ, null, EARLY_TICK_NANOS))
    }

    /** Runs the pacing over one second of vsync ticks, every other tick arriving [jitterNanos] early. */
    private fun framesDrawnInOneSecond(refreshHz: Int, maxFramesPerSecond: Float?, jitterNanos: Long): Int {
        val pacing = FramePacing().apply { this.maxFramesPerSecond = maxFramesPerSecond }
        val period = NANOS_PER_SECOND / refreshHz
        var drawn = 0
        for (tick in 0 until refreshHz) {
            val early = if (tick % 2 == 1) jitterNanos else 0L
            if (pacing.isFrameDue(START_NANOS + tick * period - early)) drawn++
        }
        return drawn
    }

    private companion object {
        const val NANOS_PER_SECOND = 1_000_000_000L
        const val PANEL_60_HZ = 60
        const val PANEL_120_HZ = 120
        const val CAP_60 = 60
        const val EARLY_TICK_NANOS = 500_000L
        // Choreographer timestamps come from System.nanoTime, far from zero.
        const val START_NANOS = 5_000_000_000L
    }
}
