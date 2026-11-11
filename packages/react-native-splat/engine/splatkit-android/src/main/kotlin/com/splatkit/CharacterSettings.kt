package com.splatkit

/**
 * The walker in walk mode, in meters. The defaults are a standing adult: the eye 1.5 m over
 * the floor, 0.35 m kept from walls, and a 0.35 m rise walked onto, which climbs stairs and
 * doorsteps but not chairs or counters. A step onto anything higher is refused and the walker
 * slides along it instead.
 */
data class CharacterSettings(
    val eyeHeight: Float = 1.5f,
    val bodyRadius: Float = 0.35f,
    val stepHeight: Float = 0.35f,
)
