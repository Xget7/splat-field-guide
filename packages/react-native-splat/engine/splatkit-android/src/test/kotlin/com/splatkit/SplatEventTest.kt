package com.splatkit

import com.splatkit.engine.SplatEngine
import org.junit.Assert.*
import org.junit.Test

class SplatEventTest {
    @Test fun preservesNativeEventIdsAndIgnoresUnknownIds() {
        val expected = listOf(
            SplatEngine.Event.WORLD_READY,
            SplatEngine.Event.WORLD_FAILED,
            SplatEngine.Event.COLLIDER_READY,
            SplatEngine.Event.COLLIDER_FAILED,
            SplatEngine.Event.WORLD_FRAME_READY,
        )
        expected.forEachIndexed { id, event ->
            assertEquals(id, event.nativeId)
            assertSame(event, SplatEngine.Event.fromNative(id))
        }
        listOf(-1, 5, Int.MIN_VALUE, Int.MAX_VALUE).forEach {
            assertNull(SplatEngine.Event.fromNative(it))
        }
    }

    @Test fun uploadAndGpuCompletionReachDifferentListenerCallbacks() {
        val calls = mutableListOf<String>()
        val listener = object : SplatSurfaceView.Listener {
            override fun onWorldReady(splatCount: Int) { calls += "upload:$splatCount" }
            override fun onWorldFrameReady(splatCount: Int) { calls += "frame:$splatCount" }
            override fun onWorldFailed(message: String) { calls += "world:$message" }
            override fun onColliderReady() { calls += "collider" }
            override fun onColliderFailed(message: String) { calls += "collider:$message" }
        }
        dispatchSplatEvent(listener, SplatEngine.Event.WORLD_READY, "", 123)
        assertEquals(listOf("upload:123"), calls)
        dispatchSplatEvent(listener, SplatEngine.Event.WORLD_FRAME_READY, "", 123)
        dispatchSplatEvent(listener, SplatEngine.Event.WORLD_FAILED, "decode", 0)
        dispatchSplatEvent(listener, SplatEngine.Event.COLLIDER_READY, "", 0)
        dispatchSplatEvent(listener, SplatEngine.Event.COLLIDER_FAILED, "collide", 0)
        assertEquals(listOf("upload:123", "frame:123", "world:decode", "collider", "collider:collide"), calls)
    }

    @Test fun existingListenerCanOmitFrameCallback() {
        dispatchSplatEvent(object : SplatSurfaceView.Listener {}, SplatEngine.Event.WORLD_FRAME_READY, "", 7)
    }
}
