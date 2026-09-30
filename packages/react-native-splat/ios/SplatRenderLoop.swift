import Foundation
import QuartzCore
import SplatKitCore

/// The thread that draws one view. Its run loop runs the view's commands in the order they
/// were sent, and a display link draws while the engine has something to do, stopping when it
/// rests. Every method may be called from any thread; none waits for the render thread.
final class SplatRenderLoop {
  /// ProMotion screens draw at up to 120 Hz while the camera or a fade moves.
  private static let frameRates = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
  private static let nanosPerSecond = 1e9

  /// One decode at a time across every view: each holds a whole cloud in memory.
  private static let loads = DispatchQueue(label: "splat.load", qos: .userInitiated)

  private let layer: CAMetalLayer
  private let events: SplatEvents

  private let lock = NSLock()
  // Under the lock.
  private var runLoop: CFRunLoop?
  private var sharedEngine: SplatEngine?
  private var latestLoad = 0

  // Render thread only.
  private var engine: SplatEngine?
  private var displayLink: CADisplayLink?
  private var drawableSize: (width: UInt32, height: UInt32) = (0, 0)
  private var paused = false

  init(layer: CAMetalLayer, events: SplatEvents) {
    self.layer = layer
    self.events = events
    let running = DispatchSemaphore(value: 0)
    // The thread keeps the loop until `stop`.
    let thread = Thread { [self] in run(signalling: running) }
    thread.name = "splat.render"
    thread.qualityOfService = .userInteractive
    thread.start()
    running.wait()
  }

  /// The engine the view's pick and project read, nil until `start` made one or after `stop`.
  var currentEngine: SplatEngine? {
    locked { sharedEngine }
  }

  /// Makes the engine and starts drawing on the layer; a GPU that cannot is an error event.
  func start() {
    perform { [self] in
      guard let engine = SplatEngine(events: events) else {
        events.fail(
          .gpuUnavailable, "This device's GPU cannot draw splats; it needs an A14 chip or later.")
        return
      }
      sfg_metal_set_layer(engine.handle, layer)
      let target = DisplayLinkTarget { [weak self] link in self?.tick(link) }
      let link = CADisplayLink(target: target, selector: #selector(DisplayLinkTarget.tick))
      link.preferredFrameRateRange = Self.frameRates
      link.isPaused = true
      link.add(to: .current, forMode: .default)
      displayLink = link
      self.engine = engine
      locked { sharedEngine = engine }
      applyDrawableSize()
      wake()
    }
  }

  /// Runs `command` with the engine on the render thread, then draws if it changed anything.
  /// Dropped while there is no engine.
  func post(_ command: @escaping (SplatEngine) -> Void) {
    perform { [self] in
      guard let engine else { return }
      command(engine)
      wake()
    }
  }

  /// Decodes on a background queue and shows the cloud on the frame after, keeping the current
  /// one until then. A newer load that arrives first replaces this one.
  func load(splatPath: String, labelsPath: String?) {
    let ticket = locked { () -> Int in
      latestLoad += 1
      return latestLoad
    }
    post { [self] engine in
      Self.loads.async { [self] in
        guard locked({ ticket == latestLoad }) else { return }
        // A failure is an error event.
        _ = sfg_load(engine.handle, splatPath, labelsPath)
        post { _ in }
      }
    }
  }

  /// The layer's size in pixels.
  func resize(width: UInt32, height: UInt32) {
    perform { [self] in
      drawableSize = (width, height)
      applyDrawableSize()
      wake()
    }
  }

  /// While paused nothing reaches the GPU, which an app in the background may not use.
  func setPaused(_ paused: Bool) {
    perform { [self] in
      self.paused = paused
      if paused {
        displayLink?.isPaused = true
      } else {
        wake()
      }
    }
  }

  /// Frees the engine once no load or pick holds it and ends the thread. Final.
  func stop() {
    locked {
      guard let runLoop else { return }
      Self.enqueue(on: runLoop) { [self] in
        displayLink?.invalidate()
        displayLink = nil
        if let engine { sfg_metal_set_layer(engine.handle, nil) }
        engine = nil
        CFRunLoopStop(CFRunLoopGetCurrent())
      }
      // Nothing runs after the stop.
      self.runLoop = nil
      sharedEngine = nil
      latestLoad += 1  // a queued load is dropped
    }
  }

  private func run(signalling running: DispatchSemaphore) {
    SplatInstrumentation.update {
      $0.liveRenderThreads += 1
      $0.renderThreadsStarted += 1
    }
    // A run loop without a source returns at once.
    RunLoop.current.add(NSMachPort(), forMode: .default)
    locked { runLoop = CFRunLoopGetCurrent() }
    running.signal()
    CFRunLoopRun()
    SplatInstrumentation.update {
      $0.liveRenderThreads -= 1
      $0.renderThreadsStopped += 1
    }
  }

  private func perform(_ block: @escaping () -> Void) {
    locked {
      guard let runLoop else { return }
      Self.enqueue(on: runLoop, block)
    }
  }

  private static func enqueue(on runLoop: CFRunLoop, _ block: @escaping () -> Void) {
    CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, block)
    CFRunLoopWakeUp(runLoop)
  }

  private func applyDrawableSize() {
    guard let engine, drawableSize.width > 0, drawableSize.height > 0 else { return }
    layer.drawableSize = CGSize(
      width: CGFloat(drawableSize.width), height: CGFloat(drawableSize.height))
    sfg_metal_set_drawable_size(engine.handle, drawableSize.width, drawableSize.height)
  }

  /// Starts the display link when the engine has something to draw.
  private func wake() {
    guard let engine, let displayLink, !paused, sfg_needs_frame(engine.handle) else { return }
    displayLink.isPaused = false
  }

  private func tick(_ link: CADisplayLink) {
    guard let engine else { return }
    if sfg_draw(engine.handle, Int64(link.targetTimestamp * Self.nanosPerSecond)) {
      SplatInstrumentation.update { $0.framesDrawn += 1 }
    }
    if !sfg_needs_frame(engine.handle) { link.isPaused = true }
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }
}

/// The display link retains its target, so the loop hands it this instead of itself.
private final class DisplayLinkTarget: NSObject {
  private let onTick: (CADisplayLink) -> Void

  init(onTick: @escaping (CADisplayLink) -> Void) {
    self.onTick = onTick
  }

  @objc func tick(_ link: CADisplayLink) {
    onTick(link)
  }
}
