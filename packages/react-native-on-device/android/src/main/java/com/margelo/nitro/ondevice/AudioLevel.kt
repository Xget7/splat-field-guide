package com.margelo.nitro.ondevice

import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.sqrt

internal class AudioLevel(private val noiseFloorDB: Double = NOISE_FLOOR_DB,
  private val ceilingDB: Double = CEILING_DB) {
  private var level = MINIMUM_LEVEL
  private var lastUpdate: Long? = null
  private var lastEmission: Long? = null

  fun update(samples: ShortArray): Double? {
    if (samples.isEmpty()) return null
    val energy = samples.sumOf { sample ->
      val amplitude = sample.toDouble() / PCM_SCALE
      amplitude * amplitude
    }
    val rms = sqrt(energy / samples.size)
    val db = if (rms > MINIMUM_LEVEL) DECIBEL_FACTOR * log10(rms) else noiseFloorDB
    return update(db)
  }

  fun update(db: Double, now: Long = System.nanoTime()): Double? {
    val target = ((db - noiseFloorDB) / (ceilingDB - noiseFloorDB)).coerceIn(MINIMUM_LEVEL, MAXIMUM_LEVEL)
    val elapsed = lastUpdate?.let { (now - it).coerceAtLeast(0).toDouble() / NANOSECONDS_PER_SECOND }
      ?: LEVEL_INTERVAL_NS.toDouble() / NANOSECONDS_PER_SECOND
    lastUpdate = now
    val smoothing = if (target > level) ATTACK_SECONDS else RELEASE_SECONDS
    level += (target - level) * (MAXIMUM_LEVEL - exp(-elapsed / smoothing))
    if (target == MINIMUM_LEVEL && level < SILENCE_THRESHOLD) level = MINIMUM_LEVEL
    if (lastEmission?.let { now - it < LEVEL_INTERVAL_NS } == true) return null
    lastEmission = now
    return level
  }

  companion object {
    private const val DECIBEL_FACTOR = 20.0
    private const val MINIMUM_LEVEL = 0.0
    private const val MAXIMUM_LEVEL = 1.0
    private const val PCM_SCALE = 32768.0
    private const val NOISE_FLOOR_DB = -50.0
    private const val CEILING_DB = -10.0
    private const val ATTACK_SECONDS = 0.035
    private const val RELEASE_SECONDS = 0.18
    private const val SILENCE_THRESHOLD = 0.005
    private const val NANOSECONDS_PER_SECOND = 1_000_000_000.0
    private const val LEVEL_INTERVAL_NS = 33_333_334L
  }
}
