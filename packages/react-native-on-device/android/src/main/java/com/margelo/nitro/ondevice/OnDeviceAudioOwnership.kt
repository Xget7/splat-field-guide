package com.margelo.nitro.ondevice

// Both microphone adapters acquire and release on main, including recognition restarts.
internal object OnDeviceAudioOwnership {
  private var owner: Any? = null
  fun acquire(next: Any): Boolean {
    if (owner != null) return false
    owner = next
    return true
  }
  fun release(previous: Any) { if (owner === previous) owner = null }
}
