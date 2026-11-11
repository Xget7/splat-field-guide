package com.splatkit.engine

import android.util.Log
import android.view.Surface
import com.splatkit.CameraPose
import com.splatkit.CameraMode
import com.splatkit.CameraRequest
import com.splatkit.CameraResolution
import com.splatkit.CameraState
import com.splatkit.CharacterSettings
import com.splatkit.CoordinateFrame
import com.splatkit.LensSettings
import com.splatkit.DeviceCapabilities
import com.splatkit.RenderPolicy
import com.splatkit.SplatStats
import com.splatkit.WorldPoint
import com.splatkit.SPLAT_STATS_FLOATS
import com.splatkit.CAPABILITY_FIELDS
import com.splatkit.RENDER_POLICY_FIELDS
import com.splatkit.RENDER_POLICY_RESOLUTION_FIELDS
import com.splatkit.RenderPolicyResolution
import com.splatkit.decodeDeviceCapabilities
import com.splatkit.decodeRenderPolicy
import com.splatkit.decodeRenderPolicyResolution
import com.splatkit.decodeSplatStats
import com.splatkit.encodeRenderPolicy
import com.splatkit.renderPolicyError

/**
 * The JNI boundary to the C++ engine: one opaque handle owned by native code, one
 * method per native entry point, and the two float array layouts the engine fills,
 * decoded here so that no other class knows them.
 *
 * Threads: every call runs on the render thread, except the loaders, which decode on
 * the calling thread, and the readers marked "any thread", which lock against [destroy]
 * or read a value the render thread publishes.
 */
internal class SplatEngine(cacheDir: String) {
    private var handle: Long = nativeCreate(cacheDir)
    private val poseScratch = FloatArray(POSE_FLOATS)
    private val statsScratch = FloatArray(SPLAT_STATS_FLOATS)
    private val policyScratch = DoubleArray(RENDER_POLICY_FIELDS)
    private val policyResultScratch = DoubleArray(RENDER_POLICY_RESOLUTION_FIELDS)
    private val cameraScratch = DoubleArray(CAMERA_REQUEST_FIELDS)
    private val cameraResultScratch = DoubleArray(CAMERA_RESOLUTION_FIELDS)

    // Written on the render thread and read from any thread without a native call: the
    // applied policy changes only in applyRenderPolicy, and a device's capabilities never do.
    @Volatile private var appliedPolicy: RenderPolicy? = null
    @Volatile private var capabilities: DeviceCapabilities? = null

    init {
        if (handle != 0L) {
            nativeRenderPolicy(handle, policyScratch)
            appliedPolicy = decodeRenderPolicy(policyScratch)
            val values = DoubleArray(CAPABILITY_FIELDS)
            nativeCapabilities(handle, values)
            capabilities = decodeDeviceCapabilities(values)
        }
    }

    /** False when Vulkan could not be brought up; every call is then a no-op. */
    val isValid: Boolean get() = handle != 0L

    /** Wire IDs match the shared engine's first four events and AndroidEngine's frame event. */
    enum class Event(val nativeId: Int) {
        WORLD_READY(0), WORLD_FAILED(1), COLLIDER_READY(2), COLLIDER_FAILED(3), WORLD_FRAME_READY(4);

        companion object {
            fun fromNative(kind: Int): Event? = entries.firstOrNull { it.nativeId == kind }
        }
    }

    /** Receives [Event]s on the thread that raised them: loader or render thread. */
    var onEvent: ((Event, String, Int) -> Unit)? = null

    // Called from JNI; the name and signature are part of the native contract.
    @Suppress("unused")
    private fun onNativeEvent(kind: Int, message: String, splatCount: Int) {
        val event = Event.fromNative(kind) ?: return
        onEvent?.invoke(event, message, splatCount)
    }

    // Surface and frames.

    fun setSurface(surface: Surface?) = nativeSetSurface(handle, surface)
    fun surfaceResized(width: Int, height: Int) = nativeSurfaceResized(handle, width, height)
    fun render(frameTimeNanos: Long) = nativeRender(handle, frameTimeNanos)

    // Loading: decodes on the calling thread.

    fun loadWorld(spzBytes: ByteArray) = nativeLoadWorld(handle, spzBytes)
    fun loadCollider(glbBytes: ByteArray) = nativeLoadCollider(handle, glbBytes)
    fun loadWorldFile(path: String) = nativeLoadWorldFile(handle, path)
    fun loadTiledWorldFile(path: String) = nativeLoadTiledWorldFile(handle, path)
    fun loadColliderFile(path: String) = nativeLoadColliderFile(handle, path)
    /** Null clears it. False when native code names no frame by these letters; the previous one stays. */
    fun setSourceFrame(frame: CoordinateFrame?): Boolean = nativeSetSourceFrame(handle, frame?.letters)

    // Camera and input.

    fun setCameraPose(pose: CameraPose) =
        nativeSetCameraPose(handle, pose.x, pose.y, pose.z, pose.yaw, pose.pitch)

    fun lookAt(from: WorldPoint, target: WorldPoint, up: WorldPoint) = nativeSetCameraLookAt(
        handle, from.x, from.y, from.z, target.x, target.y, target.z, up.x, up.y, up.z)

    fun setAnchor(point: WorldPoint) = nativeSetAnchor(handle, point.x, point.y, point.z)
    fun orbit(deltaAzimuth: Float, deltaElevation: Float): Boolean =
        nativeOrbit(handle, deltaAzimuth, deltaElevation)
    fun dolly(deltaRadius: Float): Boolean = nativeDolly(handle, deltaRadius)
    fun focus(x: Float, y: Float): Boolean = nativeFocus(handle, x, y)
    fun animateOrbit(degrees: Float, degreesPerSecond: Float, easeInOut: Boolean): Boolean =
        nativeStartOrbitAnimation(handle, degrees, degreesPerSecond, easeInOut)

    /** The pose as of the last frame, or null once destroyed. Any thread. */
    fun cameraPose(): CameraPose? = synchronized(this) {
        if (handle == 0L) return null
        nativeCameraPose(handle, poseScratch)
        CameraPose(poseScratch[0], poseScratch[1], poseScratch[2], poseScratch[3], poseScratch[4])
    }

    /** Applies and snapshots one complete camera request on the render thread. */
    fun applyCameraRequest(request: CameraRequest): CameraResolution {
        if (handle == 0L) return CameraResolution(defaultCameraState(), false,
            "SplatKit engine is unavailable")
        cameraScratch[0] = request.mode.wire.toDouble()
        cameraScratch[1] = request.anchor.x.toDouble()
        cameraScratch[2] = request.anchor.y.toDouble()
        cameraScratch[3] = request.anchor.z.toDouble()
        cameraScratch[4] = request.radius.toDouble()
        cameraScratch[5] = request.azimuth.toDouble()
        cameraScratch[6] = request.elevation.toDouble()
        cameraScratch[7] = request.orbitRadiansPerSecond.toDouble()
        val error = nativeApplyCameraRequest(handle, cameraScratch, cameraResultScratch)
        val effective = decodeCameraState(cameraResultScratch, 1)
        return CameraResolution(effective, cameraResultScratch[0] != 0.0, error)
    }

    /** Live state after any input command. Call only on the render thread. */
    fun cameraState(): CameraState? {
        if (handle == 0L) return null
        nativeCameraState(handle, cameraResultScratch)
        return decodeCameraState(cameraResultScratch, 0)
    }

    fun look(deltaYaw: Float, deltaPitch: Float) = nativeLook(handle, deltaYaw, deltaPitch)
    fun walk(forward: Float, right: Float) = nativeWalk(handle, forward, right)
    fun setVelocity(forward: Float, right: Float) = nativeSetVelocity(handle, forward, right)
    /** False when a value is not a walkable one; the previous settings stay. */
    fun setCharacter(settings: CharacterSettings): Boolean =
        nativeSetCharacter(handle, settings.eyeHeight, settings.bodyRadius, settings.stepHeight)

    /** False when a value is out of range; the previous lens stays. */
    fun setLens(settings: LensSettings): Boolean {
        val range = settings.depthRange
        return nativeSetLens(
            handle, settings.fieldOfViewDegrees != null, settings.fieldOfViewDegrees ?: 0f,
            range != null, range?.nearPlane ?: 0f, range?.farPlane ?: 0f)
    }

    fun setAttitude(rowMajor: FloatArray) = nativeSetAttitude(handle, rowMajor)
    fun setMotionEnabled(enabled: Boolean) = nativeSetMotionEnabled(handle, enabled)

    // Quality settings.

    fun setRenderScale(scale: Float) = nativeSetRenderScale(handle, scale)
    fun setCullMargin(degrees: Float) = nativeSetCullMargin(handle, degrees)
    fun setLinearBlending(linear: Boolean) = nativeSetLinearBlending(handle, linear)
    fun setSplatBudget(budget: Int) = nativeSetSplatBudget(handle, budget)
    fun setResidencyBudget(splats: Int) = nativeSetResidencyBudget(handle, splats)
    fun setMaxShDegree(degree: Int) = nativeSetMaxShDegree(handle, degree)
    fun setShDegree(degree: Int) = nativeSetShDegree(handle, degree)

    /**
     * Re-validates and applies a policy to this instance. Render thread. A rejection keeps
     * the previous policy and reports it as effective; unsupported choices fall back with a
     * warning each, which native also logs.
     */
    fun applyRenderPolicy(policy: RenderPolicy): RenderPolicyResolution {
        val current = appliedPolicy
        if (handle == 0L || current == null) {
            return RenderPolicyResolution(RenderPolicy(), accepted = false, preparationFailed = true,
                error = "SplatKit engine is unavailable")
        }
        // Kotlin checks the ranges first so no out-of-range integer reaches the native casts.
        renderPolicyError(policy)?.let { error ->
            Log.w(TAG, "render policy rejected: $error")
            return RenderPolicyResolution(current, accepted = false, error = error)
        }
        encodeRenderPolicy(policy, policyScratch)
        val messages = nativeApplyRenderPolicy(handle, policyScratch, policyResultScratch)
        val resolution = decodeRenderPolicyResolution(policyResultScratch, messages)
        appliedPolicy = resolution.effective
        return resolution
    }

    /** The policy currently applied, or null once destroyed. Any thread. */
    fun renderPolicy(): RenderPolicy? = appliedPolicy

    /** Native limits, features and accepted policy, or null once destroyed. Any thread. */
    fun deviceCapabilities(): DeviceCapabilities? = capabilities

    // Diagnostics.

    fun startBenchmark(seconds: Float) = nativeStartBenchmark(handle, seconds)

    /** GPU name and Vulkan version, or an empty string once destroyed. Any thread. */
    fun gpuDescription(): String = synchronized(this) {
        if (handle != 0L) nativeGpuDescription(handle) else ""
    }

    /** Fills [into] with the latest stats; leaves it once destroyed. Any thread. */
    fun readStats(into: SplatStats): SplatStats = synchronized(this) {
        if (handle == 0L) return into
        nativeStats(handle, statsScratch)
        decodeSplatStats(statsScratch, into)
    }

    // The any-thread readers above take the same lock, so none of them can run on a
    // handle that is being freed. Everything else runs on the render thread, like this.
    fun destroy(): Unit = synchronized(this) {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
            appliedPolicy = null
            capabilities = null
        }
    }

    private external fun nativeCreate(cacheDir: String): Long
    private external fun nativeDestroy(handle: Long)
    private external fun nativeGpuDescription(handle: Long): String
    private external fun nativeSetSurface(handle: Long, surface: Surface?)
    private external fun nativeSurfaceResized(handle: Long, width: Int, height: Int)
    private external fun nativeRender(handle: Long, frameTimeNanos: Long)
    private external fun nativeLoadWorld(handle: Long, spzBytes: ByteArray)
    private external fun nativeLoadCollider(handle: Long, glbBytes: ByteArray)
    private external fun nativeLoadWorldFile(handle: Long, path: String)
    private external fun nativeLoadTiledWorldFile(handle: Long, path: String)
    private external fun nativeLoadColliderFile(handle: Long, path: String)
    private external fun nativeSetSourceFrame(handle: Long, letters: String?): Boolean
    private external fun nativeSetCameraPose(handle: Long, x: Float, y: Float, z: Float, yaw: Float, pitch: Float)
    private external fun nativeSetCameraLookAt(
        handle: Long,
        fromX: Float,
        fromY: Float,
        fromZ: Float,
        targetX: Float,
        targetY: Float,
        targetZ: Float,
        upX: Float,
        upY: Float,
        upZ: Float,
    )
    private external fun nativeSetAnchor(handle: Long, x: Float, y: Float, z: Float)
    private external fun nativeOrbit(handle: Long, deltaAzimuth: Float, deltaElevation: Float): Boolean
    private external fun nativeDolly(handle: Long, deltaRadius: Float): Boolean
    private external fun nativeFocus(handle: Long, x: Float, y: Float): Boolean
    private external fun nativeStartOrbitAnimation(
        handle: Long,
        degrees: Float,
        degreesPerSecond: Float,
        easeInOut: Boolean,
    ): Boolean
    /** Fills [out] (at least [POSE_FLOATS]) with x, y, z, yaw, pitch. */
    private external fun nativeCameraPose(handle: Long, out: FloatArray)
    private external fun nativeApplyCameraRequest(handle: Long, requested: DoubleArray, out: DoubleArray): String
    private external fun nativeCameraState(handle: Long, out: DoubleArray)
    private external fun nativeSetCharacter(
        handle: Long,
        eyeHeight: Float,
        bodyRadius: Float,
        stepHeight: Float,
    ): Boolean
    private external fun nativeSetLens(
        handle: Long,
        hasFieldOfView: Boolean,
        fieldOfViewDegrees: Float,
        hasDepthRange: Boolean,
        nearPlane: Float,
        farPlane: Float,
    ): Boolean
    private external fun nativeLook(handle: Long, deltaYaw: Float, deltaPitch: Float)
    private external fun nativeWalk(handle: Long, forward: Float, right: Float)
    private external fun nativeSetVelocity(handle: Long, forward: Float, right: Float)
    private external fun nativeSetAttitude(handle: Long, rowMajor: FloatArray)
    private external fun nativeSetMotionEnabled(handle: Long, enabled: Boolean)
    private external fun nativeSetRenderScale(handle: Long, scale: Float)
    private external fun nativeSetCullMargin(handle: Long, degrees: Float)
    private external fun nativeSetLinearBlending(handle: Long, linear: Boolean)
    private external fun nativeSetSplatBudget(handle: Long, budget: Int)
    private external fun nativeSetResidencyBudget(handle: Long, splats: Int)
    private external fun nativeSetMaxShDegree(handle: Long, degree: Int)
    private external fun nativeSetShDegree(handle: Long, degree: Int)
    /**
     * Applies a policy and fills [out] ([RENDER_POLICY_RESOLUTION_FIELDS]) with accepted,
     * preparationFailed and the effective policy. Returns the rejection reason or the warnings.
     */
    private external fun nativeApplyRenderPolicy(handle: Long, requested: DoubleArray, out: DoubleArray): Array<String>
    /** Fills [out] (at least [RENDER_POLICY_FIELDS]) with the applied policy. */
    private external fun nativeRenderPolicy(handle: Long, out: DoubleArray)
    /** Fills [out] (at least [CAPABILITY_FIELDS]) with limits, flags, support and fallback. */
    private external fun nativeCapabilities(handle: Long, out: DoubleArray)
    private external fun nativeStartBenchmark(handle: Long, seconds: Float)
    /** Fills [out] using the [decodeSplatStats] layout ([SPLAT_STATS_FLOATS] floats). */
    private external fun nativeStats(handle: Long, out: FloatArray)

    private companion object {
        const val TAG = "SplatKit"
        const val POSE_FLOATS = 5
        const val CAMERA_REQUEST_FIELDS = 8
        const val CAMERA_RESOLUTION_FIELDS = 10

        fun defaultCameraState() = CameraState(CameraMode.FIRST_PERSON, false,
            WorldPoint(0f, 0f, 0f), 0f, 0f, 0f, 0f)

        fun decodeCameraState(values: DoubleArray, offset: Int) = CameraState(
            mode = CameraMode.fromWire(values[offset].toInt()) ?: CameraMode.FIRST_PERSON,
            hasAnchor = values[offset + 8] != 0.0,
            anchor = WorldPoint(values[offset + 1].toFloat(), values[offset + 2].toFloat(), values[offset + 3].toFloat()),
            radius = values[offset + 4].toFloat(),
            azimuth = values[offset + 5].toFloat(),
            elevation = values[offset + 6].toFloat(),
            orbitRadiansPerSecond = values[offset + 7].toFloat(),
        )

        init {
            System.loadLibrary("splatkit")
        }
    }
}
