package com.splatkit

/**
 * Where the camera is and where it looks: position in the world's frame in meters,
 * yaw about the up axis and pitch, both in radians. Pitch is clamped to 85 degrees.
 * Read it to save a viewpoint, set it to teleport or restore one.
 */
data class CameraPose(
    val x: Float,
    val y: Float,
    val z: Float,
    val yaw: Float = 0f,
    val pitch: Float = 0f,
)
