import QuartzCore

/// Counts live instances; `init(layer:)` makes presentation copies that are not counted.
final class SplatMetalLayer: CAMetalLayer {
  private var isCounted = false

  override init() {
    super.init()
    isCounted = true
    SplatInstrumentation.update { $0.liveMetalLayers += 1 }
  }

  override init(layer: Any) {
    super.init(layer: layer)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    if isCounted {
      SplatInstrumentation.update { $0.liveMetalLayers -= 1 }
    }
  }
}
