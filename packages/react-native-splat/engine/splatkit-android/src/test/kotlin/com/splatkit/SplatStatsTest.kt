package com.splatkit

import org.junit.Assert.*
import org.junit.Test

class SplatStatsTest {
    @Test fun decodesTimingsFlagsAndCompletedCounts() {
        val snapshot = SplatStats()
        val result = decodeSplatStats(
            floatArrayOf(60f, 16f, 7f, 3f, 500000f, 1f, 0f, 123f, 2f), snapshot
        )
        assertSame(snapshot, result)
        assertEquals(60f, result.fps, 0f)
        assertEquals(16f, result.frameMillis, 0f)
        assertEquals(7f, result.gpuMillis, 0f)
        assertEquals(3f, result.sortMillis, 0f)
        assertEquals(500000, result.splatCount)
        assertEquals(500000, result.loadedSplatCount)
        assertTrue(result.walking)
        assertFalse(result.motion)
        assertEquals(123, result.drawnSplatCount)
        assertEquals(2, result.loadedShDegree)
    }

    @Test fun zeroCompletedCountsNeverFallBackToLoadedCount() {
        val snapshot = SplatStats().apply {
            drawnSplatCount = 99
            loadedShDegree = 3
        }
        decodeSplatStats(floatArrayOf(0f, 0f, 0f, 0f, 2000000f, 0f, 1f, 0f, 0f), snapshot)
        assertEquals(2000000, snapshot.loadedSplatCount)
        assertEquals(0, snapshot.drawnSplatCount)
        assertEquals(0, snapshot.loadedShDegree)
        assertFalse(snapshot.walking)
        assertTrue(snapshot.motion)
        decodeSplatStats(FloatArray(SPLAT_STATS_FLOATS), snapshot)
        assertEquals(0, snapshot.loadedSplatCount)
    }

    @Test fun sourceAliasDoesNotDriftOrChangeDrawnCount() {
        val snapshot = SplatStats().apply { drawnSplatCount = 3 }
        snapshot.splatCount = 12
        assertEquals(12, snapshot.loadedSplatCount)
        snapshot.loadedSplatCount = 24
        assertEquals(24, snapshot.splatCount)
        assertEquals(3, snapshot.drawnSplatCount)
    }

    @Test fun countsRetainFloatTransportPrecisionLimit() {
        val payload = FloatArray(SPLAT_STATS_FLOATS)
        payload[4] = 16777216f
        payload[7] = 16777217.toFloat()
        val result = decodeSplatStats(payload, SplatStats())
        assertEquals(16777216, result.loadedSplatCount)
        assertEquals(16777216, result.drawnSplatCount) // rounding already happened before decoding
    }

    @Test fun shortPayloadIsRejectedBeforeChangingSnapshot() {
        val snapshot = SplatStats().apply { splatCount = 77 }
        try {
            decodeSplatStats(FloatArray(7), snapshot)
            fail("Expected short-payload rejection")
        } catch (_: IllegalArgumentException) {
            assertEquals(77, snapshot.loadedSplatCount)
        }
    }
}
