package com.splatkit.engine

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import com.splatkit.CameraPose
import com.splatkit.CameraRequest
import com.splatkit.CameraResolution
import com.splatkit.CameraState
import com.splatkit.CharacterSettings
import com.splatkit.CoordinateFrame
import com.splatkit.LensSettings
import com.splatkit.WorldPoint
import com.splatkit.DeviceCapabilities
import com.splatkit.RenderPolicy
import com.splatkit.RenderPolicyResolution
import com.splatkit.SplatStats
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/**
 * Owns the native engine and drives it from a dedicated thread, at most one frame per vsync
 * and no more than the host's frame rate cap.
 *
 * The UI thread never touches the engine. Surface changes are posted here; the ones
 * that must complete before Android reclaims the surface block the caller until done.
 * The render thread never waits on the UI thread, so that cannot deadlock. Decoding
 * runs on its own loader thread so frames keep flowing; the engine uploads on its next
 * frame.
 */
internal class RenderThread(cacheDir: String) {
    private val thread = HandlerThread("SplatKitRender").apply { start() }
    private val handler = Handler(thread.looper)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val loader = Executors.newSingleThreadExecutor { Thread(it, "SplatKitLoader") }
    private lateinit var choreographer: Choreographer
    // Written on the render thread, read by the any-thread getters (stats, camera pose).
    @Volatile private var engine: SplatEngine? = null
    private var rendering = false
    private val pacing = FramePacing()
    private var worldReady = false
    private val pendingCamera = ArrayDeque<Pair<CameraRequest, ((CameraResolution) -> Unit)?>>()
    // Written by the host's thread. Each load reads it when asked for and applies it in its own
    // loader task, so a later change never reaches a load already queued.
    @Volatile private var sourceFrame: CoordinateFrame? = null

    /** GPU name and Vulkan version, or an empty string when the engine failed to start. */
    val gpuDescription: String

    /** False when Vulkan could not be brought up; every call is then a no-op. */
    val isAvailable: Boolean

    /** Loading outcomes, delivered on the main thread. */
    var onEvent: ((SplatEngine.Event, String, Int) -> Unit)? = null

    /** Handler on the render thread, for listeners that should deliver there. */
    val renderHandler: Handler get() = handler

    init {
        // Everything that must live on the render thread is created there.
        runBlockingOnThread {
            choreographer = Choreographer.getInstance()
            engine = SplatEngine(cacheDir)
        }
        gpuDescription = engine?.gpuDescription() ?: ""
        isAvailable = engine?.isValid == true
        engine?.onEvent = { event, message, splatCount ->
            if (event == SplatEngine.Event.WORLD_READY) {
                // Upload emits WORLD_READY inside render(). Apply before that render
                // continues to its first camera sample and world frame.
                if (Looper.myLooper() == thread.looper) markWorldReady()
                else handler.post { markWorldReady() }
            }
            mainHandler.post { onEvent?.invoke(event, message, splatCount) }
        }
    }

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!rendering) return
            if (pacing.isFrameDue(frameTimeNanos)) engine?.render(frameTimeNanos)
            choreographer.postFrameCallback(this)
        }
    }

    // Surface and lifecycle.

    fun surfaceCreated(surface: Surface) = runBlockingOnThread { engine?.setSurface(surface) }

    /** The surface kept its identity but changed size, typically a rotation. */
    fun surfaceResized(width: Int, height: Int) = post { engine?.surfaceResized(width, height) }

    /** Blocks: after this returns Android may destroy the surface. */
    fun surfaceDestroyed() = runBlockingOnThread { engine?.setSurface(null) }

    fun resume() = post {
        if (!rendering) {
            rendering = true
            choreographer.postFrameCallback(frameCallback)
        }
    }

    fun setMaxFramesPerSecond(fps: Float?) = post { pacing.maxFramesPerSecond = fps }

    fun pause() = runBlockingOnThread {
        rendering = false
        choreographer.removeFrameCallback(frameCallback)
    }

    /**
     * Stops rendering now and destroys the engine once any decode in flight has finished.
     * A decode touches engine state, so the destruction is queued behind it on the loader
     * instead of blocking the caller: a host calling this from onDestroy must not wait on
     * a slow file, and the engine must not die under a running decoder.
     */
    fun release() {
        runBlockingOnThread {
            rendering = false
            choreographer.removeFrameCallback(frameCallback)
        }
        if (loader.isShutdown) return
        loader.execute {
            runBlockingOnThread {
                engine?.destroy()
                engine = null
            }
            thread.quitSafely()
        }
        loader.shutdown()
    }

    // Loading, on the loader thread.

    fun loadWorld(spzBytes: ByteArray) = decode { it.loadWorld(spzBytes) }
    fun loadCollider(glbBytes: ByteArray) = decode { it.loadCollider(glbBytes) }
    fun loadWorldFile(path: String) = decode { it.loadWorldFile(path) }
    fun loadWorldFile(path: String, maxShDegree: Int, splatBudget: Int, residencyBudget: Int) {
        val frame = sourceFrame
        post {
            worldReady = false
            engine?.setMaxShDegree(maxShDegree)
            engine?.setSplatBudget(splatBudget)
            engine?.setResidencyBudget(residencyBudget)
            decode(frame) { it.loadWorldFile(path) }
        }
    }
    fun loadTiledWorldFile(path: String) = decode { it.loadTiledWorldFile(path) }
    fun loadColliderFile(path: String) = decode { it.loadColliderFile(path) }
    fun setSourceFrame(frame: CoordinateFrame?) { sourceFrame = frame }

    // Camera and input.

    fun setCameraPose(pose: CameraPose) = post { engine?.setCameraPose(pose) }

    fun lookAt(from: WorldPoint, target: WorldPoint, up: WorldPoint) =
        post { engine?.lookAt(from, target, up) }

    fun setAnchor(point: WorldPoint) = post { engine?.setAnchor(point) }

    fun orbit(deltaAzimuth: Float, deltaElevation: Float): Boolean = booleanOnRenderThread {
        engine?.orbit(deltaAzimuth, deltaElevation) ?: false
    }

    fun dolly(deltaRadius: Float): Boolean = booleanOnRenderThread {
        engine?.dolly(deltaRadius) ?: false
    }

    fun focus(x: Float, y: Float): Boolean = booleanOnRenderThread { engine?.focus(x, y) ?: false }

    fun animateOrbit(degrees: Float, degreesPerSecond: Float, easeInOut: Boolean): Boolean =
        booleanOnRenderThread { engine?.animateOrbit(degrees, degreesPerSecond, easeInOut) ?: false }

    /** The pose as of the last frame, or null before the engine exists. Any thread. */
    fun cameraPose(): CameraPose? = engine?.cameraPose()

    /** A request before load waits for world framing, then applies before the next frame. */
    fun applyCameraRequest(request: CameraRequest, completion: ((CameraResolution) -> Unit)? = null) = post {
        pendingCamera.addLast(request to completion)
        applyPendingCamera()
    }

    private fun applyPendingCamera() {
        if (!worldReady) return
        while (pendingCamera.isNotEmpty()) {
            val (request, completion) = pendingCamera.removeFirst()
            val resolution = engine?.applyCameraRequest(request) ?: return
            if (completion != null) mainHandler.post { completion(resolution) }
        }
    }

    private fun markWorldReady() {
        worldReady = true
        applyPendingCamera()
    }

    fun cameraState(): CameraState? {
        var snapshot: CameraState? = null
        runBlockingOnThread { snapshot = engine?.cameraState() }
        return snapshot
    }

    fun look(deltaYaw: Float, deltaPitch: Float) = post { engine?.look(deltaYaw, deltaPitch) }
    fun walk(forward: Float, right: Float) = post { engine?.walk(forward, right) }
    fun setVelocity(forward: Float, right: Float) = post { engine?.setVelocity(forward, right) }
    fun setAttitude(rowMajor: FloatArray) = post { engine?.setAttitude(rowMajor) }

    /** Waits: the caller learns whether the settings were walkable. */
    fun setCharacter(settings: CharacterSettings): Boolean {
        var accepted = false
        runBlockingOnThread { accepted = engine?.setCharacter(settings) ?: false }
        return accepted
    }

    /** Waits: the caller learns whether the lens was in range. */
    fun setLens(settings: LensSettings): Boolean = booleanOnRenderThread { engine?.setLens(settings) ?: false }

    fun setMotionEnabled(enabled: Boolean) = post { engine?.setMotionEnabled(enabled) }

    // Quality settings.

    fun setRenderScale(scale: Float) = post { engine?.setRenderScale(scale) }
    fun setCullMargin(degrees: Float) = post { engine?.setCullMargin(degrees) }
    fun setLinearBlending(linear: Boolean) = post { engine?.setLinearBlending(linear) }
    fun setSplatBudget(budget: Int) = post { engine?.setSplatBudget(budget) }
    fun setResidencyBudget(splats: Int) = post { engine?.setResidencyBudget(splats) }
    fun setMaxShDegree(degree: Int) = post { engine?.setMaxShDegree(degree) }
    fun setShDegree(degree: Int) = post { engine?.setShDegree(degree) }

    // Policy. Posted so it lands before any decode queued after it on the same handler.

    /** [completion] runs on the main thread, in request order; never after [release]. */
    fun applyRenderPolicy(policy: RenderPolicy, completion: ((RenderPolicyResolution) -> Unit)? = null) = post {
        val resolution = engine?.applyRenderPolicy(policy) ?: RenderPolicyResolution(
            RenderPolicy(), accepted = false, preparationFailed = true, error = "SplatKit engine is released")
        if (completion != null) mainHandler.post { completion(resolution) }
    }

    /** The policy currently applied. Any thread. */
    fun renderPolicy(): RenderPolicy? = engine?.renderPolicy()

    /** Native limits, features and accepted policy. Any thread. */
    fun deviceCapabilities(): DeviceCapabilities? = engine?.deviceCapabilities()

    // Diagnostics.

    fun startBenchmark(seconds: Float) = post { engine?.startBenchmark(seconds) }

    /** Fills [into] with the latest stats. Any thread. */
    fun readStats(into: SplatStats): SplatStats = engine?.readStats(into) ?: into

    // After release() the executor is shut down and would throw; a late load from a
    // host's background thread is a no-op like every other call after release.
    private fun decode(frame: CoordinateFrame? = sourceFrame, block: (SplatEngine) -> Unit) {
        if (loader.isShutdown) return
        try {
            loader.execute {
                engine?.let {
                    if (it.isValid && !it.setSourceFrame(frame)) Log.e(TAG, "native code rejected frame $frame")
                    block(it)
                }
            }
        } catch (e: RejectedExecutionException) {
            Log.w(TAG, "load after release ignored")
        }
    }

    private fun post(block: () -> Unit) {
        handler.post(block)
    }

    private fun runBlockingOnThread(block: () -> Unit) {
        if (Thread.currentThread() === thread) {
            block()
            return
        }
        val done = CountDownLatch(1)
        handler.post {
            try {
                block()
            } finally {
                done.countDown()
            }
        }
        // The framework calls surfaceDestroyed on the UI thread; a render thread stuck in
        // the driver must not turn into an ANR. Frame waits are bounded, so this is the
        // last line of defence and is logged loudly.
        if (!done.await(5, TimeUnit.SECONDS)) {
            Log.e(TAG, "render thread did not respond within 5 s")
        }
    }

    private fun booleanOnRenderThread(block: () -> Boolean): Boolean {
        var result = false
        runBlockingOnThread { result = block() }
        return result
    }

    private companion object {
        const val TAG = "SplatKit"
    }
}
