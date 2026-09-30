import UIKit

/// Hosts the CAMetalLayer; layout is the only thing the main thread does for it.
final class SplatMetalView: UIView {
  var onLayout: (() -> Void)?

  override class var layerClass: AnyClass { SplatMetalLayer.self }

  var metalLayer: SplatMetalLayer { layer as! SplatMetalLayer }

  override init(frame: CGRect) {
    super.init(frame: frame)
    SplatInstrumentation.update { $0.liveViews += 1 }
    backgroundColor = .black
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    SplatInstrumentation.update { $0.liveViews -= 1 }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let scale = window?.screen.scale ?? UIScreen.main.scale
    metalLayer.contentsScale = scale
    metalLayer.drawableSize = CGSize(
      width: bounds.width * scale,
      height: bounds.height * scale
    )
    onLayout?()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    setNeedsLayout()
  }
}
