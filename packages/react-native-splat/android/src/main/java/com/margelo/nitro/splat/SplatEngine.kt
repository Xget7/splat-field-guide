package com.margelo.nitro.splat

import android.view.Surface
import java.nio.ByteBuffer

internal object SplatEngine {
  external fun create(owner: HybridSplatView): Long
  external fun destroy(id: Long)
  external fun surface(id: Long, surface: Surface?)
  external fun resize(id: Long, width: Int, height: Int)
  external fun beginLoad(id: Long): Long
  external fun load(id: Long, request: Long, cloud: String, labels: String)
  external fun draw(id: Long, nanos: Long): Boolean
  external fun orbit(id: Long, azimuth: Float, elevation: Float)
  external fun dolly(id: Long, factor: Float)
  external fun frame(id: Long, bounds: FloatArray, seconds: Float, from: FloatArray?)
  external fun limits(id: Long, values: FloatArray?)
  external fun highlight(id: Long, labels: ByteArray)
  external fun reveal(id: Long, seconds: Float)
  external fun pick(id: Long, x: Float, y: Float): Int
  external fun project(id: Long, points: ByteBuffer, out: ByteBuffer): Int
  external fun direction(id: Long): FloatArray?
  external fun gpuMillis(id: Long): Double
}
