package com.splatkit

/** The distances the view draws between, in world units. Both bound one range, so they are set together. */
data class DepthRange(val nearPlane: Float, val farPlane: Float)

/**
 * The lens the view draws, picks and frames through. A null field keeps the engine default:
 * a 65 degree vertical field of view and a depth range of 0.05 to 200.
 *
 * [fieldOfViewDegrees] is vertical, 10 to 120. [depthRange] needs a positive near plane under
 * the far one, at most 100,000 times nearer: wider, the shaders lose the far plane to float
 * precision. A far plane past 200 also coarsens 16-bit sort keys, which span the range.
 */
data class LensSettings(
    val fieldOfViewDegrees: Float? = null,
    val depthRange: DepthRange? = null,
)
