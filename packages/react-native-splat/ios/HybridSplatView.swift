import NitroModules
import SplatKitCore
import UIKit

/// Props arrive on the main thread; methods arrive on their calling thread.
final class HybridSplatView: HybridSplatViewSpec {
  private enum Prop {
    case source, highlight, cameraLimits, revealSeconds
  }

  private static let partLabels = 1.0...255.0
  private static let bytesPerPoint = 3 * MemoryLayout<Float>.size
  private static let bytesPerViewPoint = 2 * MemoryLayout<Float>.size

  private let metalView = SplatMetalView()
  private let events = SplatEvents()
  private let loop: SplatRenderLoop
  private let pickQueue = DispatchQueue(label: "splat.pick", qos: .userInitiated)

  // Main thread only.
  private var changed: Set<Prop> = []
  private var started = false
  private var inWindow = false
  private var appActive = UIApplication.shared.applicationState != .background
  private var observers: [NSObjectProtocol] = []

  var view: UIView { metalView }

  var source = SplatSource(splatPath: "", labelsPath: "", splatSha256: "", labelsSha256: "",
    expectedSplatCount: 0) {
    didSet { changed.insert(.source) }
  }

  var highlight: [Double] = [] {
    didSet { changed.insert(.highlight) }
  }

  var cameraLimits: CameraLimits? {
    didSet { changed.insert(.cameraLimits) }
  }

  var revealSeconds: Double? {
    didSet { changed.insert(.revealSeconds) }
  }

  var onReady: () -> Void = {} {
    didSet { events.setOnReady(onReady) }
  }

  var onError: (SplatError) -> Void = { _ in } {
    didSet { events.setOnError(onError) }
  }

  override init() {
    loop = SplatRenderLoop(layer: metalView.metalLayer, events: events)
    super.init()
    metalView.onResize = { [loop] width, height in loop.resize(width: width, height: height) }
    metalView.onWindowChange = { [weak self] inWindow in
      self?.inWindow = inWindow
      self?.updatePaused()
    }
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.appActive = false
        self?.updatePaused()
      },
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.appActive = true
        self?.updatePaused()
      },
    ]
    updatePaused()
  }

  /// Callbacks must be installed before the first prop batch starts the engine.
  func afterUpdate() {
    if !started {
      started = true
      loop.start()
    }
    if changed.contains(.cameraLimits) {
      let limits = cameraLimits.map(sfg_camera_limits.init)
      loop.post { engine in
        let accepted = withOptionalPointer(to: limits) { sfg_set_camera_limits(engine.handle, $0) }
        if !accepted {
          SplatInstrumentation.logger.error(
            "cameraLimits refused: not finite, inverted, over a full turn or past a pole")
        }
      }
    }
    if changed.contains(.revealSeconds) {
      let seconds = Float(revealSeconds ?? 0)
      loop.post { engine in sfg_set_reveal(engine.handle, seconds) }
    }
    if changed.contains(.highlight) {
      let labels = partLabels(highlight)
      loop.post { engine in sfg_set_highlight(engine.handle, labels, labels.count) }
    }
    if changed.contains(.source) {
      loop.load(source: SplatSource(splatPath: Self.resolved(source.splatPath),
        labelsPath: Self.resolved(source.labelsPath), splatSha256: source.splatSha256,
        labelsSha256: source.labelsSha256, expectedSplatCount: source.expectedSplatCount))
    }
    changed.removeAll()
  }

  func orbit(dAzimuth: Double, dElevation: Double) throws {
    SplatInstrumentation.recordOrbitCall()
    loop.post { engine in _ = sfg_orbit(engine.handle, Float(dAzimuth), Float(dElevation)) }
  }

  func dolly(factor: Double) throws {
    loop.post { engine in _ = sfg_dolly(engine.handle, Float(factor)) }
  }

  func frame(bounds: Bounds, seconds: Double, from: ViewDirection?) throws {
    let box = sfg_bounds(bounds)
    let direction = from.map(sfg_view_direction.init)
    loop.post { engine in
      let framed = withUnsafePointer(to: box) { box in
        withOptionalPointer(to: direction) { sfg_frame(engine.handle, box, Float(seconds), $0) }
      }
      if !framed {
        SplatInstrumentation.logger.error("frame refused: bounds not finite or inverted")
      }
    }
  }

  func pick(x: Double, y: Double) throws -> Promise<Double> {
    return Promise.parallel(pickQueue) { [loop] in
      guard let engine = loop.currentEngine else { return 0 }
      return Double(sfg_pick(engine.handle, Float(x), Float(y)))
    }
  }

  func project(points: ArrayBuffer, out: ArrayBuffer) throws -> Double {
    guard points.size % Self.bytesPerPoint == 0 else {
      throw RuntimeError("project: points holds \(points.size) bytes, not float32 x, y, z triples")
    }
    let count = points.size / Self.bytesPerPoint
    guard out.size >= count * Self.bytesPerViewPoint else {
      throw RuntimeError(
        "project: out holds \(out.size) bytes, too few for \(count) float32 x, y pairs")
    }
    let from = UnsafeRawPointer(points.data).assumingMemoryBound(to: Float.self)
    let to = UnsafeMutableRawPointer(out.data).assumingMemoryBound(to: Float.self)
    guard let engine = loop.currentEngine else {
      to.update(repeating: .nan, count: count * 2)
      return 0
    }
    return Double(sfg_project(engine.handle, from, count, to))
  }

  func drawnDirection() throws -> ViewDirection? {
    guard let engine = loop.currentEngine else { return nil }
    var direction = sfg_view_direction()
    guard sfg_drawn_direction(engine.handle, &direction) else { return nil }
    return ViewDirection(azimuth: Double(direction.azimuth), elevation: Double(direction.elevation))
  }

  func onDropView() {
    shutDown()
  }

  deinit {
    shutDown()
  }

  private func shutDown() {
    events.detach()
    loop.stop()
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
  }

  private func updatePaused() {
    loop.setPaused(!(inWindow && appActive))
  }

  private static func resolved(_ path: String) -> String {
    guard !path.isEmpty, !path.hasPrefix("/"), let resources = Bundle.main.resourceURL else {
      return path
    }
    return resources.appendingPathComponent(path).path
  }

  private func partLabels(_ highlight: [Double]) -> [UInt8] {
    let valid = highlight.filter { Self.partLabels.contains($0) && $0.rounded() == $0 }
    if valid.count != highlight.count {
      SplatInstrumentation.logger.error(
        "highlight: dropped \(highlight.count - valid.count) values that are not part labels 1-255")
    }
    return valid.map { UInt8($0) }
  }
}
