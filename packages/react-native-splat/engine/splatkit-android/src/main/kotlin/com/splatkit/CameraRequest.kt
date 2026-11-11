package com.splatkit

/** A complete camera transaction. Angles are radians and angular speed is radians per second. */
data class CameraRequest(
    val mode: CameraMode,
    val anchor: WorldPoint,
    val radius: Float,
    val azimuth: Float,
    val elevation: Float,
    val orbitRadiansPerSecond: Float,
)

enum class CameraMode(val wire: Int) { FIRST_PERSON(0), ORBIT(1);
    companion object { fun fromWire(value: Int): CameraMode? = entries.firstOrNull { it.wire == value } }
}

data class CameraState(
    val mode: CameraMode,
    val hasAnchor: Boolean,
    val anchor: WorldPoint,
    val radius: Float,
    val azimuth: Float,
    val elevation: Float,
    val orbitRadiansPerSecond: Float,
)

data class CameraResolution(val effective: CameraState, val accepted: Boolean, val error: String = "")
