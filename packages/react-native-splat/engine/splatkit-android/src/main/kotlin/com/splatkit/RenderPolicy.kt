package com.splatkit

/**
 * The renderer-applicable policy, shared with the JS contract and the C++ engine. Enum
 * wire values and numeric ranges must stay identical across the three so the JS
 * authority and the native re-validation agree; keep them in step.
 */
/** Sort depth-key width: 16 quantizes camera depth linearly, 32 keeps the float bits. */
enum class SortDepth(val wire: Int) {
    BITS_16(16),
    BITS_32(32);

    companion object {
        fun fromWire(wire: Int): SortDepth? = entries.firstOrNull { it.wire == wire }
    }
}

/** Renderer policy values. See the C++ RenderPolicy for the field meanings. */
data class RenderPolicy(
    val lodErrorPixels: Float = 1f,
    val lodSplatLimit: Int = 0,
    val alphaThreshold: Float = 1f / 255f,
    val subpixelThreshold: Float = 1f,
    val enableFrustumCulling: Boolean = true,
    val enableHiZOcclusion: Boolean = false,
    val enableEarlyTermination: Boolean = true,
    val sortDepth: SortDepth = SortDepth.BITS_16,
)

/** Which fields one backend can apply. A false field resolves to [Fallback]. */
data class RenderPolicySupport(
    val lodErrorPixels: Boolean = false,
    val alphaThreshold: Boolean = false,
    val subpixelThreshold: Boolean = false,
    val enableFrustumCulling: Boolean = false,
    val enableHiZOcclusion: Boolean = false,
    val enableEarlyTermination: Boolean = false,
    val sortDepth: Boolean = false,
    val lodSplatLimit: Boolean = false,
    val minLodErrorPixels: Float = 0f,
    val maxLodErrorPixels: Float = 0f,
    val minSubpixelThreshold: Float = 0f,
    val maxSubpixelThreshold: Float = 0f,
)

/** Resource ceilings and device features, from the native adapter. */
data class SplatLimits(
    val maxLodCapacitySplats: Int,
    val minResidencyCapacitySplats: Int,
    val maxResidencyCapacitySplats: Int,
)

data class DeviceCapabilities(
    val limits: SplatLimits,
    val supportsHiZOcclusion: Boolean,
    val supportsSubgroups: Boolean,
    val maxTextureDimension: Int,
    val policy: RenderPolicySupport,
    val fallback: RenderPolicy,
)

/**
 * The outcome of applying a [RenderPolicy] to one view's engine. When [accepted] is false
 * the previous policy stays in effect and is reported as [effective], and [error] says why;
 * [preparationFailed] separates a valid request the backend could not prepare from an
 * invalid one. Otherwise [warnings] names every unsupported choice that fell back.
 */
data class RenderPolicyResolution(
    val effective: RenderPolicy,
    val warnings: List<String> = emptyList(),
    val accepted: Boolean = true,
    val preparationFailed: Boolean = false,
    val error: String? = null,
)

const val RENDER_POLICY_FIELDS = 8
/** accepted, preparationFailed, then the effective policy. */
const val RENDER_POLICY_RESOLUTION_FIELDS = RENDER_POLICY_FIELDS + 2
const val CAPABILITY_FIELDS = 26

/**
 * Structural validation shared with the JS contract. Returns null when [policy] is valid,
 * otherwise a message naming the first invalid field.
 */
fun renderPolicyError(policy: RenderPolicy): String? {
    if (!policy.lodErrorPixels.isFinite() || policy.lodErrorPixels <= 0f) {
        return "lodErrorPixels must be finite and positive"
    }
    if (policy.lodSplatLimit < 0) {
        return "lodSplatLimit must be non-negative"
    }
    if (!policy.alphaThreshold.isFinite() || policy.alphaThreshold < 0f || policy.alphaThreshold > 1f) {
        return "alphaThreshold must be finite and in [0, 1]"
    }
    if (!policy.subpixelThreshold.isFinite() || policy.subpixelThreshold < 0f) {
        return "subpixelThreshold must be finite and non-negative"
    }
    return null
}

/** Fills out[offset..offset+7] with the JNI policy layout. */
fun encodeRenderPolicy(policy: RenderPolicy, out: DoubleArray, offset: Int = 0) {
    out[offset] = policy.lodErrorPixels.toDouble()
    out[offset + 1] = policy.alphaThreshold.toDouble()
    out[offset + 2] = policy.subpixelThreshold.toDouble()
    out[offset + 3] = if (policy.enableFrustumCulling) 1.0 else 0.0
    out[offset + 4] = if (policy.enableHiZOcclusion) 1.0 else 0.0
    out[offset + 5] = if (policy.enableEarlyTermination) 1.0 else 0.0
    out[offset + 6] = policy.sortDepth.wire.toDouble()
    out[offset + 7] = policy.lodSplatLimit.toDouble()
}

fun decodeRenderPolicy(source: DoubleArray, offset: Int = 0): RenderPolicy = RenderPolicy(
    lodErrorPixels = source[offset].toFloat(),
    alphaThreshold = source[offset + 1].toFloat(),
    subpixelThreshold = source[offset + 2].toFloat(),
    enableFrustumCulling = source[offset + 3] != 0.0,
    enableHiZOcclusion = source[offset + 4] != 0.0,
    enableEarlyTermination = source[offset + 5] != 0.0,
    sortDepth = SortDepth.fromWire(source[offset + 6].toInt()) ?: SortDepth.BITS_16,
    lodSplatLimit = source[offset + 7].toInt(),
)

/**
 * Decodes the [RENDER_POLICY_RESOLUTION_FIELDS] JNI array with the messages native returned
 * beside it: the reason when rejected, otherwise one warning per fallback.
 */
fun decodeRenderPolicyResolution(source: DoubleArray, messages: Array<String>): RenderPolicyResolution {
    val accepted = source[0] != 0.0
    return RenderPolicyResolution(
        effective = decodeRenderPolicy(source, 2),
        warnings = if (accepted) messages.toList() else emptyList(),
        accepted = accepted,
        preparationFailed = !accepted && source[1] != 0.0,
        error = if (accepted) null else messages.firstOrNull() ?: "render policy rejected",
    )
}

/** Decodes the [CAPABILITY_FIELDS] JNI array: limits, flags, policy support, fallback. */
fun decodeDeviceCapabilities(source: DoubleArray, offset: Int = 0): DeviceCapabilities =
    DeviceCapabilities(
        limits = SplatLimits(
            maxLodCapacitySplats = source[offset].toInt(),
            minResidencyCapacitySplats = source[offset + 1].toInt(),
            maxResidencyCapacitySplats = source[offset + 2].toInt(),
        ),
        supportsHiZOcclusion = source[offset + 3] != 0.0,
        supportsSubgroups = source[offset + 4] != 0.0,
        maxTextureDimension = source[offset + 5].toInt(),
        policy = RenderPolicySupport(
            lodErrorPixels = source[offset + 6] != 0.0,
            alphaThreshold = source[offset + 7] != 0.0,
            subpixelThreshold = source[offset + 8] != 0.0,
            enableFrustumCulling = source[offset + 9] != 0.0,
            enableHiZOcclusion = source[offset + 10] != 0.0,
            enableEarlyTermination = source[offset + 11] != 0.0,
            sortDepth = source[offset + 12] != 0.0,
            minLodErrorPixels = source[offset + 13].toFloat(),
            maxLodErrorPixels = source[offset + 14].toFloat(),
            minSubpixelThreshold = source[offset + 15].toFloat(),
            maxSubpixelThreshold = source[offset + 16].toFloat(),
            lodSplatLimit = source[offset + 17] != 0.0,
        ),
        fallback = decodeRenderPolicy(source, offset + 18),
    )
