import Foundation
import NitroModules
import SplatKitCore

/// Render-thread ownership allows concurrent load, pick and project calls only while their callers
/// retain the engine.
final class SplatEngine {
  private static let retirements = DispatchQueue(label: "splat.retire", qos: .userInitiated)
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
    let retiredHandle = handle
    let retainedEvents = events
    // The final pick/project reference can be released on its caller's thread. GPU idle/destruction
    // must not block that caller or the UI; the C adapter retains its fence token until this ends.
    Self.retirements.async {
      withExtendedLifetime(retainedEvents) {
        sfg_destroy(retiredHandle)
      }
    }
  }
}

/// Events arrive on the reporting thread; Nitro forwards callbacks to the JS thread.
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

extension sfg_highlight_look {
  init(_ look: HighlightLook) {
    // An out-of-range colour maps past 0xFFFFFF so the adapter rejects it rather than wrapping.
    let rgb = look.tintRgb.isFinite && look.tintRgb >= 0 && look.tintRgb <= 0xFFFFFF
      ? UInt32(look.tintRgb) : UInt32.max
    self.init(tint_rgb: rgb, tint_amount: Float(look.tintAmount),
      part_brightness: Float(look.partBrightness), other_brightness: Float(look.otherBrightness))
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

func withOptionalPointer<T, Result>(to value: T?, _ body: (UnsafePointer<T>?) -> Result) -> Result {
  guard let value else { return body(nil) }
  return withUnsafePointer(to: value) { body($0) }
}
