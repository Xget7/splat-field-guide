import Metal
import QuartzCore
import UIKit

/// What the render thread draws from; the main and JS threads only write it under the lock.
struct SplatRenderState {
  var hue: Double = 0.6
  var highlight: [Double] = []
  var onReady: () -> Void = {}
}

/// Owns the GPU for one view: waits until something changed, then draws one frame.
/// Calls only enqueue work here; nothing blocks the caller.
final class SplatRenderThread: Thread {
  private static let saturation = 0.7
  private static let brightness = 0.8
  /// Sky blue (#38BDF8), mixed in while a part is highlighted.
  private static let highlightTint: (r: Double, g: Double, b: Double) = (0.22, 0.74, 0.97)
  private static let highlightMix = 0.5

  private let layer: SplatMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue

  private let condition = NSCondition()
  private var state = SplatRenderState()
  private var needsFrame = true
  private var firstFramePresented = false
  private var readyFired = false
  private var stopRequested = false

  init?(layer: SplatMetalLayer) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      return nil
    }
    self.layer = layer
    self.device = device
    self.queue = queue
    super.init()
    name = "splat.render"
    qualityOfService = .userInteractive
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
  }

  func update(_ change: (inout SplatRenderState) -> Void) {
    condition.lock()
    change(&state)
    needsFrame = true
    condition.signal()
    condition.unlock()
  }

  func requestFrame() {
    condition.lock()
    needsFrame = true
    condition.signal()
    condition.unlock()
  }

  func requestStop() {
    condition.lock()
    stopRequested = true
    condition.signal()
    condition.unlock()
  }

  override func main() {
    SplatInstrumentation.update {
      $0.liveRenderThreads += 1
      $0.renderThreadsStarted += 1
    }
    SplatInstrumentation.logger.info("render thread start \(Thread.current.name ?? "", privacy: .public)")

    while let work = nextWork() {
      if work.fireReady {
        SplatInstrumentation.logger.info(
          "onReady fired on thread=\(SplatInstrumentation.currentThreadName, privacy: .public)")
        work.state.onReady()
      }
      if work.draw {
        draw(work.state)
      }
    }

    SplatInstrumentation.update {
      $0.liveRenderThreads -= 1
      $0.renderThreadsStopped += 1
    }
    SplatInstrumentation.logger.info("render thread stop")
  }

  private struct Work {
    var state: SplatRenderState
    var draw: Bool
    var fireReady: Bool
  }

  private func nextWork() -> Work? {
    condition.lock()
    defer { condition.unlock() }
    while !stopRequested && !needsFrame && !(firstFramePresented && !readyFired) {
      condition.wait()
    }
    if stopRequested { return nil }
    let work = Work(
      state: state,
      draw: needsFrame,
      fireReady: firstFramePresented && !readyFired
    )
    needsFrame = false
    if work.fireReady { readyFired = true }
    return work
  }

  private func draw(_ state: SplatRenderState) {
    let size = layer.drawableSize
    guard size.width > 0, size.height > 0 else { return }
    guard let drawable = layer.nextDrawable(), let commands = queue.makeCommandBuffer() else { return }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = clearColor(for: state)
    guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
    encoder.endEncoding()

    // Presentation completes on a Metal thread; hand it back so onReady fires from this one.
    #if targetEnvironment(simulator)
      // The simulator SDK has no drawable presentation callback; GPU completion is the closest.
      commands.addCompletedHandler { [weak self] _ in
        self?.markPresented()
      }
    #else
      drawable.addPresentedHandler { [weak self] _ in
        self?.markPresented()
      }
    #endif
    commands.present(drawable)
    commands.commit()
  }

  private func markPresented() {
    SplatInstrumentation.update { $0.framesPresented += 1 }
    condition.lock()
    firstFramePresented = true
    condition.signal()
    condition.unlock()
  }

  private func clearColor(for state: SplatRenderState) -> MTLClearColor {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    UIColor(hue: state.hue, saturation: Self.saturation, brightness: Self.brightness, alpha: 1)
      .getRed(&red, green: &green, blue: &blue, alpha: nil)
    var (r, g, b) = (Double(red), Double(green), Double(blue))
    if !state.highlight.isEmpty {
      let mix = Self.highlightMix
      r += (Self.highlightTint.r - r) * mix
      g += (Self.highlightTint.g - g) * mix
      b += (Self.highlightTint.b - b) * mix
    }
    return MTLClearColor(red: r, green: g, blue: b, alpha: 1)
  }
}
