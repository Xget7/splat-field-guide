package com.margelo.nitro.ondevice

// Both microphone adapters acquire on main; asynchronous link cleanup holds ownership until ready.
internal object OnDeviceAudioOwnership {
  const val ALREADY_LISTENING = "Speech input or audio link is already listening"
  private var owner: Any? = null
  private var releasing = false
  val occupied: Boolean get() = owner != null
  private val waiting = ArrayDeque<() -> Unit>()

  fun whenReady(action: () -> Unit) {
    if (releasing) waiting.addLast(action) else action()
  }
  fun acquire(next: Any): Boolean {
    if (owner != null) return false
    owner = next
    return true
  }
  fun beginRelease(previous: Any) { if (owner === previous) releasing = true }
  fun release(previous: Any) {
    if (owner !== previous) return
    owner = null
    releasing = false
    val ready = waiting.toList()
    waiting.clear()
    ready.forEach { it() }
  }
}
