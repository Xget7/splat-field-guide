package com.splatkit

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.util.Log
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.splatkit.engine.SplatEngine
import com.splatkit.engine.RenderThread
import com.splatkit.input.MotionInput
import com.splatkit.input.TouchInput
import java.io.File

private const val TAG = "SplatKit"

private const val MIN_RENDER_SCALE = 0.1f
private const val MAX_RENDER_SCALE = 2f
private const val MAX_CULL_MARGIN_DEGREES = 80f
private const val MAX_SH_DEGREE = 3
private const val MIN_RESIDENCY_BUDGET = 100_000
private const val MAX_RESIDENCY_BUDGET = 8_000_000
private const val DEFAULT_RESIDENCY_BUDGET = 2_000_000
// A cap past the fastest panels changes nothing; one under a frame a second is a stalled view.
private const val MIN_FRAME_RATE_CAP = 1f
private const val MAX_FRAME_RATE_CAP = 240f

internal fun dispatchSplatEvent(
    listener: SplatSurfaceView.Listener,
    event: SplatEngine.Event,
    message: String,
    splatCount: Int,
) {
    when (event) {
        SplatEngine.Event.WORLD_READY -> listener.onWorldReady(splatCount)
        SplatEngine.Event.WORLD_FRAME_READY -> listener.onWorldFrameReady(splatCount)
        SplatEngine.Event.WORLD_FAILED -> listener.onWorldFailed(message)
        SplatEngine.Event.COLLIDER_READY -> listener.onColliderReady()
        SplatEngine.Event.COLLIDER_FAILED -> listener.onColliderFailed(message)
    }
}

/**
 * A SurfaceView that renders with SplatKit.
 *
 * The host activity forwards resume, pause and release. Everything else follows the
 * surface lifecycle: the engine gets the surface when Android creates it and gives it
 * back, synchronously, before Android destroys it.
 *
 * Gestures: a finger drags the view to look (yaw, and pitch when the gyroscope is off),
 * and that can be turned off. The view ships no walking control: the host draws its own,
 * wherever it likes, and drives [setWalkVelocity] or [walk] from it.
 * [com.splatkit.ui.JoystickView] is one such control, for a host that wants a ready-made one.
 */
class SplatSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SurfaceView(context, attrs), SurfaceHolder.Callback {

    private val renderThread = RenderThread(context.cacheDir.absolutePath)
    private val motion = MotionInput(context, renderThread.renderHandler) { renderThread.setAttitude(it) }
    private val touch = TouchInput(object : TouchInput.Listener {
        override fun onLook(deltaYaw: Float, deltaPitch: Float) = renderThread.look(deltaYaw, deltaPitch)
    })
    private var motionEnabled = false
    private var resumed = false
    private val poseHandler = Handler(Looper.getMainLooper())
    private var lastPose: CameraPose? = null
    private val reportPose = object : Runnable {
        override fun run() {
            val pose = cameraPose
            if (pose != lastPose) {
                lastPose = pose
                cameraPoseListener?.invoke(pose)
            }
            poseHandler.postDelayed(this, cameraPoseIntervalMillis)
        }
    }

    /** Radians per pixel dragged. */
    var lookSensitivity: Float
        get() = touch.lookSensitivity
        set(value) { touch.lookSensitivity = value }

    /**
     * Whether a drag on the view is allowed to turn the camera. A host that drives looking
     * from its own control, and scripted tours, turn it off.
     */
    var touchLookEnabled: Boolean
        get() = touch.lookEnabled
        set(value) {
            touch.lookEnabled = value
            if (!value) touch.letGo()
        }

    /**
     * Where the camera is, on the main thread, at most this often in milliseconds, and only
     * when it differs from the pose last delivered. Zero, the default, never reports.
     */
    var cameraPoseIntervalMillis: Long = 0
        set(value) {
            field = value.coerceAtLeast(0)
            startPoseReports()
        }

    /** Called with each pose [cameraPoseIntervalMillis] asks for. */
    var cameraPoseListener: ((CameraPose) -> Unit)? = null
        set(value) {
            field = value
            startPoseReports()
        }

    init {
        holder.addCallback(this)
        renderThread.onEvent = { event, message, splatCount ->
            listener?.let { dispatchSplatEvent(it, event, message, splatCount) }
        }
    }

    /** Loading and first-frame outcomes on the main thread. All methods have empty defaults. */
    interface Listener {
        /** The world is uploaded; its first GPU frame may still be pending. */
        fun onWorldReady(splatCount: Int) {}
        /** The GPU completed a frame drawing this world. Does not guarantee display scanout. */
        fun onWorldFrameReady(splatCount: Int) {}
        /** The bytes were not a readable SPZ, or the GPU refused them; the previous world stays. */
        fun onWorldFailed(message: String) {}
        /** Walk mode is on. */
        fun onColliderReady() {}
        fun onColliderFailed(message: String) {}
    }

    var listener: Listener? = null

    /** False when Vulkan could not be brought up on this device; the view stays blank. */
    val isAvailable: Boolean get() = renderThread.isAvailable

    /** Decodes and shows an SPZ world. Replaces the current one when ready. */
    fun loadWorld(spzBytes: ByteArray) = renderThread.loadWorld(spzBytes)

    /** Decodes a collider GLB; enables walk mode when ready. */
    fun loadCollider(glbBytes: ByteArray) = renderThread.loadCollider(glbBytes)

    /**
     * Decodes and shows a world from a file the app can read. The file is mapped, not
     * copied through the Java heap, so this is the way to load big worlds.
     */
    fun loadWorld(file: File) = renderThread.loadWorldFile(file.absolutePath)

    /** Applies load-time options on the render thread before scheduling this file's decode. */
    fun loadWorld(file: File, maxShDegree: Int, splatBudget: Int, residencyBudget: Int) {
        require(maxShDegree in 0..MAX_SH_DEGREE && splatBudget >= 0 &&
            residencyBudget in MIN_RESIDENCY_BUDGET..MAX_RESIDENCY_BUDGET)
        renderThread.loadWorldFile(file.absolutePath, maxShDegree, splatBudget, residencyBudget)
    }

    /** Decodes a collider GLB from a file; enables walk mode when ready. */
    fun loadCollider(file: File) = renderThread.loadColliderFile(file.absolutePath)

    /**
     * Shows a tiled world from its index, a `tileset.json` with its tiles beside it (made
     * offline by `splat-tile`). Only the index is read now; tiles stream in as the camera
     * needs them, nearest and biggest on screen first, within [residencyBudget].
     */
    fun loadTiledWorld(tileset: File) = renderThread.loadTiledWorldFile(tileset.absolutePath)

    /**
     * The camera's position and look direction. Reading gives the pose as of the last
     * frame; setting teleports, and when walking the camera settles on the floor under
     * the new point on the next frame. Any thread.
     */
    var cameraPose: CameraPose
        get() = renderThread.cameraPose() ?: CameraPose(0f, 0f, 0f)
        set(value) = renderThread.setCameraPose(value)

    /** Applies a complete camera request after world framing, with one outcome on the main thread. */
    fun applyCameraRequest(request: CameraRequest, completion: ((CameraResolution) -> Unit)? = null) =
        renderThread.applyCameraRequest(request, completion)

    val cameraState: CameraState? get() = renderThread.cameraState()

    /** Teleports to [from] and faces [target], keeping [up] at the top of the view. */
    fun lookAt(from: WorldPoint, target: WorldPoint, up: WorldPoint) =
        renderThread.lookAt(from, target, up)

    /** Starts orbiting [point] from the current camera pose. Orbit is a temporary fly mode. */
    fun setAnchor(point: WorldPoint) = renderThread.setAnchor(point)

    /** Orbits around the anchor by radians. False until an anchor is available. */
    fun orbit(deltaAzimuth: Float, deltaElevation: Float): Boolean =
        renderThread.orbit(deltaAzimuth, deltaElevation)

    /** Changes the orbit radius in metres. Positive values move away from the anchor. */
    fun dolly(deltaRadius: Float): Boolean = renderThread.dolly(deltaRadius)

    /**
     * Picks an anchor through normalized view coordinates. A miss returns false and keeps
     * the current anchor. A collider must be loaded.
     */
    fun focus(x: Float, y: Float): Boolean = renderThread.focus(x, y)

    /**
     * Runs a finite azimuth turn in degrees at the average degrees per second. The engine
     * keeps drawing while it moves and idles when it finishes.
     */
    fun animateOrbit(
        degrees: Float,
        degreesPerSecond: Float,
        easeInOut: Boolean = false,
    ): Boolean = renderThread.animateOrbit(degrees, degreesPerSecond, easeInOut)

    /**
     * Applies a [RenderQuality] preset by setting [renderScale], [shDegree],
     * [splatBudget], [linearBlending] and [cullMarginDegrees] from it. Set any of them
     * afterwards to depart from the preset. Everything but [splatBudget] takes effect on
     * the next frame; the budget reaches worlds loaded after the call.
     */
    fun applyQuality(quality: RenderQuality) {
        renderScale = quality.renderScale
        shDegree = quality.shDegree
        splatBudget = quality.splatBudget
        linearBlending = quality.linearBlending
        cullMarginDegrees = quality.cullMarginDegrees
    }

    /**
     * Fraction of the view's resolution the splats are drawn at, in [0.1, 2]. Below one
     * the frame is drawn smaller and upscaled; frame time scales almost directly with it,
     * because splat rendering is bound by blended fragments. Above one the frame is
     * supersampled and downscaled, which steadies thin splats that shimmer at about a
     * pixel each, for about the square of the scale in frame time.
     */
    var renderScale: Float = 1f
        set(value) {
            field = value.coerceIn(MIN_RENDER_SCALE, MAX_RENDER_SCALE)
            renderThread.setRenderScale(field)
        }

    /**
     * The most frames a second the view draws, clamped to 1 to 240, or null, the default, to
     * draw on every vsync at the panel's own rate. A 120 Hz panel capped at 60 draws every
     * other vsync, half the GPU time and battery for a view that holds still most of the time.
     * Throws [IllegalArgumentException] for a value that is not finite and positive.
     */
    var maxFramesPerSecond: Float? = null
        set(value) {
            require(value == null || value.isFinite() && value > 0) { "maxFramesPerSecond must be finite and positive" }
            field = value?.coerceIn(MIN_FRAME_RATE_CAP, MAX_FRAME_RATE_CAP)
            renderThread.setMaxFramesPerSecond(field)
        }

    /**
     * CPU fallback's angular culling margin, in degrees. The GPU path evaluates the
     * current camera each frame and uses projected splat bounds instead.
     */
    var cullMarginDegrees: Float = 10f
        set(value) {
            field = value.coerceIn(0f, MAX_CULL_MARGIN_DEGREES)
            renderThread.setCullMargin(field)
        }

    /**
     * Blend splats in linear light instead of the encoded colour space. The reference
     * rasterizer, and so the training, blend encoded values; linear blending gives
     * richer contrast that the training never saw and costs 40% of the frame on
     * Adreno 640. Off by default.
     */
    var linearBlending: Boolean = false
        set(value) {
            field = value
            renderThread.setLinearBlending(value)
        }

    /**
     * LOD selection capacity for subsequently loaded worlds. Zero disables automatic
     * hierarchy construction; a .lodsplat file already contains its hierarchy.
     * Vulkan GPU selection supports at most 4M nodes. Coarse parents are approximate,
     * and the full hierarchy must fit GPU memory. Non-LOD visibility above 4M survivors
     * fails closed instead of truncating or issuing an unsafe draw.
     */
    var splatBudget: Int = 0
        set(value) {
            field = value.coerceAtLeast(0)
            renderThread.setSplatBudget(field)
        }

    /**
     * Residency budget of a tiled world: the most splats held on the GPU at once, about
     * 32 bytes each plus the harmonics. Streaming fills it with what is nearest and
     * biggest on screen and evicts what the camera left. Applies to tiled worlds loaded
     * after it is set.
     */
    var residencyBudget: Int = DEFAULT_RESIDENCY_BUDGET
        set(value) {
            field = value.coerceIn(MIN_RESIDENCY_BUDGET, MAX_RESIDENCY_BUDGET)
            renderThread.setResidencyBudget(field)
        }

    /**
     * Spherical harmonics degree drawn, 0 to 3, capped by what the loaded world carries.
     * Takes effect on the next frame. Spherical harmonics make colour depend on the view
     * direction (highlights, sheen, the glint on water and leaves); 0 draws the base
     * colour only, which is what World Labs worlds carry anyway.
     */
    var shDegree: Int = 3
        set(value) {
            field = value.coerceIn(0, MAX_SH_DEGREE)
            renderThread.setShDegree(field)
        }

    /**
     * Highest spherical harmonics degree kept in GPU memory from the file, 0 to 3,
     * applied to worlds loaded after it is set. A memory cap, not a quality setting:
     * degree 3 costs 92 bytes per splat, so a host on a small phone can lower it before
     * [loadWorld] and [shDegree] then cannot go above it for that world.
     */
    var maxShDegree: Int = 3
        set(value) {
            field = value.coerceIn(0, MAX_SH_DEGREE)
            renderThread.setMaxShDegree(field)
        }

    /**
     * The frame worlds, tiles and colliders loaded after it is set were written in, for files
     * that store a frame other than the one they declare or their format's default. Null, the
     * default, keeps each file's own: an SPZ's coordinate system tag, else `rub`, and glTF's `rub`.
     * Untagged World Labs Marble exports need [CoordinateFrame.RDF]. A `.lodsplat` ignores it.
     * Each load reads it when called.
     */
    var sourceFrame: CoordinateFrame? = null
        set(value) {
            field = value
            renderThread.setSourceFrame(value)
        }

    /**
     * Walks continuously at the given speed in meters per second until called again with
     * zeros: what a joystick or a keyboard drives. Forward is where the camera looks,
     * flattened onto the floor while walking; right strafes.
     */
    fun setWalkVelocity(forward: Float, right: Float) = renderThread.setVelocity(forward, right)

    /**
     * One step, in meters, for a host that integrates movement itself. The collider stops
     * it at walls and the floor carries it, exactly as a velocity would.
     */
    fun walk(forward: Float, right: Float) = renderThread.walk(forward, right)

    /**
     * Turns the camera by these radians: what a look pad or a mouse drives. Pitch is
     * clamped, and ignored while the gyroscope drives the view.
     */
    fun look(deltaYaw: Float, deltaPitch: Float) = renderThread.look(deltaYaw, deltaPitch)

    /**
     * The walker's shape in walk mode, applied at once and to a collider loaded later.
     * False when a value is not a walkable one, and then the previous settings stay.
     */
    fun setCharacter(settings: CharacterSettings): Boolean {
        val accepted = renderThread.setCharacter(settings)
        if (accepted) character = settings
        return accepted
    }

    /** The walker's shape in effect. */
    var character = CharacterSettings()
        private set

    /**
     * The lens: vertical field of view and depth range. Applies at once and reframes the
     * default orbit. False when a value is out of range, and then the previous lens stays.
     */
    fun setLens(settings: LensSettings): Boolean {
        val accepted = renderThread.setLens(settings)
        if (accepted) lens = settings
        return accepted
    }

    /** The lens in effect. */
    var lens = LensSettings()
        private set

    /**
     * Runs a reproducible capture: the gyroscope goes off, the camera takes a fixed pose
     * and turns once over [seconds], then the frame time distribution is logged.
     * Starts as soon as a world is loaded.
     */
    fun startBenchmark(seconds: Float = 10f) {
        setMotionEnabled(false)
        renderThread.startBenchmark(seconds)
    }

    /** GPU name and Vulkan version reported by the driver. */
    val gpuDescription: String get() = renderThread.gpuDescription

    /**
     * Applies a render policy to this view's engine on the render thread, before any world
     * loaded afterwards. The engine re-validates the whole request: an invalid one, or one the
     * GPU cannot prepare, keeps the previous policy; unsupported valid choices fall back with a
     * warning each. [completion] receives the outcome on the main thread, in request order.
     */
    fun applyRenderPolicy(policy: RenderPolicy, completion: ((RenderPolicyResolution) -> Unit)? = null) =
        renderThread.applyRenderPolicy(policy, completion)

    /** The policy currently applied, or null before the engine exists. Any thread. */
    val renderPolicy: RenderPolicy? get() = renderThread.renderPolicy()

    /** Native limits, features and accepted policy, or null before the engine exists. */
    val deviceCapabilities: DeviceCapabilities? get() = renderThread.deviceCapabilities()

    /** True while the gyroscope drives the camera. */
    val isMotionEnabled: Boolean get() = motionEnabled

    /** Latest engine stats. Cheap; safe on the UI thread. */
    fun readStats(into: SplatStats = SplatStats()): SplatStats = renderThread.readStats(into)

    /** Drives the camera with the phone's orientation. No-op when the sensor is missing. */
    fun setMotionEnabled(enabled: Boolean) {
        motionEnabled = enabled && motion.isAvailable
        renderThread.setMotionEnabled(motionEnabled)
        if (resumed) {
            if (motionEnabled) motion.start() else motion.stop()
        }
    }

    fun resume() {
        resumed = true
        motion.displayRotation = display?.rotation ?: 0
        renderThread.resume()
        if (motionEnabled) motion.start()
        startPoseReports()
    }

    fun pause() {
        resumed = false
        motion.stop()
        renderThread.pause()
        poseHandler.removeCallbacks(reportPose)
    }

    fun release() {
        motion.stop()
        poseHandler.removeCallbacks(reportPose)
        holder.removeCallback(this)
        renderThread.release()
    }

    private fun startPoseReports() {
        poseHandler.removeCallbacks(reportPose)
        if (resumed && cameraPoseIntervalMillis > 0 && cameraPoseListener != null) {
            poseHandler.postDelayed(reportPose, cameraPoseIntervalMillis)
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        motion.displayRotation = display?.rotation ?: 0
        renderThread.surfaceCreated(holder.surface)
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        // Real drivers also report the change through the swapchain; the emulator does not,
        // so the size travels explicitly and the engine rebuilds when it differs.
        Log.i(TAG, "surface changed to ${width}x${height}, display rotation ${display?.rotation}")
        motion.displayRotation = display?.rotation ?: 0
        renderThread.surfaceResized(width, height)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        renderThread.surfaceDestroyed()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean = touch.onTouchEvent(event)
}
