package com.splatkit

/**
 * Starting points applied by [SplatSurfaceView.applyQuality]; customize with `copy`.
 * Historical Mi 9 measurements are in `docs/BENCHMARKS.md`, not FPS guarantees.
 * LOD, reduced SH and render scale trade detail for work; validate against matched captures.
 * HIGH disables LOD but still uses renderer visibility and representation approximations.
 */
data class RenderQuality(
    /** See [SplatSurfaceView.renderScale]. */
    val renderScale: Float,
    /** See [SplatSurfaceView.shDegree]. */
    val shDegree: Int,
    /** See [SplatSurfaceView.splatBudget]; 0 disables LOD, not visibility culling. */
    val splatBudget: Int,
    /** See [SplatSurfaceView.linearBlending]. */
    val linearBlending: Boolean = false,
    /** See [SplatSurfaceView.cullMarginDegrees]. */
    val cullMarginDegrees: Float = 10f,
) {
    companion object {
        val LOW = RenderQuality(renderScale = 0.5f, shDegree = 0, splatBudget = 500_000)
        val MEDIUM = RenderQuality(renderScale = 0.7f, shDegree = 1, splatBudget = 0)
        val HIGH = RenderQuality(renderScale = 1f, shDegree = 3, splatBudget = 0)
        val ULTRA = RenderQuality(renderScale = 1.5f, shDegree = 3, splatBudget = 0, cullMarginDegrees = 20f)

        /** The preset named by [name], case insensitive, or null. */
        fun named(name: String): RenderQuality? = when (name.lowercase()) {
            "low" -> LOW
            "medium" -> MEDIUM
            "high" -> HIGH
            "ultra" -> ULTRA
            else -> null
        }
    }
}
