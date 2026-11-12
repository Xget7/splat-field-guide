package com.margelo.nitro.splat

import android.os.Handler
import android.os.Looper
import com.margelo.nitro.core.Promise

class HybridWorldRetirement : HybridWorldRetirementSpec() {
  override fun waitForWorldsReleased(): Promise<Unit> {
    val promise = Promise<Unit>()
    // Cross the UI queue after prior native view mutations. Hosts register before queuing start,
    // and native engines remain registered while any JNI load/pick still retains them.
    val queued = Handler(Looper.getMainLooper()).post {
      try {
        SplatEngine.whenWorldsReleased(Runnable { promise.resolve(Unit) })
      } catch (error: Throwable) {
        promise.reject(error)
      }
    }
    if (!queued) promise.reject(IllegalStateException("The UI queue could not register world retirement"))
    return promise
  }
}
