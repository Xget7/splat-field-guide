import Foundation
import NitroModules
import SplatKitCore

/// One view's engine over Metal, through the C interface in sfg.h. It belongs to the view's
/// render thread, except for `sfg_load`, `sfg_pick` and `sfg_project`, which any thread may
/// call; the last reference destroys it, so each of those callers holds one through the call.
final class SplatEngine {
  let handle: OpaquePointer
  // The C callback's context: unretained there, so kept alive here.
  private let events: SplatEvents

  /// Nil when the device's GPU cannot draw splats.
  init?(events: SplatEvents) {
    guard let handle = sfg_metal_create() else { return nil }
    self.handle = handle
    self.events = events
    sfg_set_event_callback(
      handle,
      { context, event, message, _ in
        guard let context else { return }
        Unmanaged<SplatEvents>.fromOpaque(context).takeUnretainedValue()
          .deliver(event, message: String(cString: message))
      },
      Unmanaged.passUnretained(events).toOpaque())
  }

  deinit {
    sfg_destroy(handle)
  }
}

/// Hands the engine's events to the view's current callbacks, from whichever thread reports
/// them. Nitro takes each call on to the JS thread.
final class SplatEvents {
  private let lock = NSLock()
  private var onReady: () -> Void = {}
  private var onError: (SplatError) -> Void = { _ in }

  func setOnReady(_ onReady: @escaping () -> Void) {
    locked { self.onReady = onReady }
  }

  func setOnError(_ onError: @escaping (SplatError) -> Void) {
    locked { self.onError = onError }
  }

  /// The view is gone: nothing more reaches its callbacks.
  func detach() {
    locked {
      onReady = {}
      onError = { _ in }
    }
  }

  func fail(_ code: SplatErrorCode, _ message: String) {
    let onError = locked { self.onError }
    onError(SplatError(code: code, message: message))
  }

  fileprivate func deliver(_ event: sfg_event, message: String) {
    switch event {
    case SFG_EVENT_WORLD_READY:
      let onReady = locked { self.onReady }
      onReady()
    case SFG_EVENT_LOAD_FAILED:
      fail(.loadFailed, message)
    case SFG_EVENT_LABELS_MISMATCH:
      fail(.labelsMismatch, message)
    case SFG_EVENT_GPU_FAILED:
      fail(.gpuUnavailable, message)
    default:
      SplatInstrumentation.logger.fault("unknown engine event \(event.rawValue)")
    }
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }
}

extension sfg_vec3 {
  init(_ point: Vec3) {
    self.init(x: Float(point.x), y: Float(point.y), z: Float(point.z))
  }
}

extension sfg_bounds {
  init(_ bounds: Bounds) {
    self.init(min: sfg_vec3(bounds.min), max: sfg_vec3(bounds.max))
  }
}

extension sfg_view_direction {
  init(_ direction: ViewDirection) {
    self.init(azimuth: Float(direction.azimuth), elevation: Float(direction.elevation))
  }
}

extension sfg_camera_limits {
  init(_ limits: CameraLimits) {
    self.init(
      min_azimuth: Float(limits.minAzimuth), max_azimuth: Float(limits.maxAzimuth),
      min_elevation: Float(limits.minElevation), max_elevation: Float(limits.maxElevation),
      min_radius: Float(limits.minRadius), max_radius: Float(limits.maxRadius))
  }
}

/// Calls `body` with a pointer to `value`, or with nil, for the C interface's optional inputs.
func withOptionalPointer<T, Result>(to value: T?, _ body: (UnsafePointer<T>?) -> Result) -> Result {
  guard let value else { return body(nil) }
  return withUnsafePointer(to: value) { body($0) }
}
