import UIKit

/// The main thread measures the layer; the render thread sizes its drawables and draws.
final class SplatMetalView: UIView {
  /// The layer's size in pixels, after every layout.
  var onResize: ((_ width: UInt32, _ height: UInt32) -> Void)?
  var onWindowChange: ((_ inWindow: Bool) -> Void)?

  override class var layerClass: AnyClass { SplatMetalLayer.self }

  var metalLayer: SplatMetalLayer { layer as! SplatMetalLayer }

  override init(frame: CGRect) {
    super.init(frame: frame)
    SplatInstrumentation.update { $0.liveViews += 1 }
    backgroundColor = .black
    metalLayer.isOpaque = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    SplatInstrumentation.update { $0.liveViews -= 1 }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Without a window there is no screen to size the drawable for; didMoveToWindow lays out again.
    guard let scale = window?.screen.scale else { return }
    metalLayer.contentsScale = scale
    onResize?(
      UInt32((bounds.width * scale).rounded()), UInt32((bounds.height * scale).rounded()))
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    onWindowChange?(window != nil)
    setNeedsLayout()
  }
}
