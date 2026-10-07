package com.margelo.nitro.ondevice

internal const val PCM16_BYTES_PER_SAMPLE = 2
private const val BYTE_BITS = 8

internal fun pcm16Bytes(samples: ShortArray): ByteArray {
  val bytes = ByteArray(samples.size * PCM16_BYTES_PER_SAMPLE)
  samples.forEachIndexed { index, sample ->
    bytes[index * PCM16_BYTES_PER_SAMPLE] = sample.toByte()
    bytes[index * PCM16_BYTES_PER_SAMPLE + 1] = (sample.toInt() shr BYTE_BITS).toByte()
  }
  return bytes
}
