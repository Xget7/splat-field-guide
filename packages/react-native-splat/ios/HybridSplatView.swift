import NitroModules
import UIKit

class HybridSplatView: HybridSplatViewSpec {
  /// One full turn of hue per this many radians of azimuth.
  private static let radiansPerHueTurn = 2 * Double.pi

  private let metalView = SplatMetalView()
  private var renderThread: SplatRenderThread?

  var view: UIView { metalView }

  var highlight: [Double] = [] {
    didSet {
      let highlight = highlight
      renderThread?.update { $0.highlight = highlight }
    }
  }

  var onReady: () -> Void = {} {
    didSet {
      let onReady = onReady
      renderThread?.update { $0.onReady = onReady }
    }
  }

  override init() {
    super.init()
    if let thread = SplatRenderThread(layer: metalView.metalLayer) {
      renderThread = thread
      metalView.onLayout = { [weak thread] in thread?.requestFrame() }
      thread.start()
    } else {
      SplatInstrumentation.logger.error("no Metal device, the view stays black")
    }
  }

  func orbit(dAzimuth: Double, dElevation: Double) throws {
    SplatInstrumentation.recordOrbitCall()
    let hueDelta = dAzimuth / Self.radiansPerHueTurn
    renderThread?.update { state in
      state.hue = (state.hue + hueDelta).truncatingRemainder(dividingBy: 1)
      if state.hue < 0 { state.hue += 1 }
    }
  }

  func onDropView() {
    renderThread?.requestStop()
    renderThread = nil
  }

  deinit {
    renderThread?.requestStop()
  }
}
