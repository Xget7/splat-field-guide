package com.splatkit

/**
 * Published snapshot, refreshed twice a second; completed-frame diagnostics may lag the view.
 * Counts cross JNI as floats: all integers through 16,777,216 are exact; larger values may round.
 */
class SplatStats {
    var fps = 0f
    var frameMillis = 0f
    /** GPU time of the last frame from timestamp queries; zero when unsupported. */
    var gpuMillis = 0f
    /** Sort duration; the GPU path reports zero when timestamp queries are unavailable. */
    var sortMillis = 0f
    /** Loaded source splats, not the number currently drawn or GPU-resident tree records. */
    var splatCount = 0
    /** Alias of [splatCount], with the same source-count meaning. */
    var loadedSplatCount: Int
        get() = splatCount
        set(value) { splatCount = value }
    /**
     * Spherical harmonics degree the loaded world holds on the GPU, its file degree capped by
     * [com.splatkit.SplatSurfaceView.maxShDegree] at load; zero without a world.
     */
    var loadedShDegree = 0
    var walking = false
    var motion = false
    /** Last completed visibility/order result; zero remains zero even when a source is loaded. */
    var drawnSplatCount = 0
}

internal const val SPLAT_STATS_FLOATS = 9

/** Mirrors nativeStats: timings, the loaded count and two flags, then the drawn count and the world's harmonics degree. */
internal fun decodeSplatStats(values: FloatArray, into: SplatStats): SplatStats {
    require(values.size >= SPLAT_STATS_FLOATS) { "Stats payload needs $SPLAT_STATS_FLOATS floats" }
    into.fps = values[0]
    into.frameMillis = values[1]
    into.gpuMillis = values[2]
    into.sortMillis = values[3]
    into.splatCount = values[4].toInt()
    into.walking = values[5] != 0f
    into.motion = values[6] != 0f
    into.drawnSplatCount = values[7].toInt()
    into.loadedShDegree = values[8].toInt()
    return into
}
