import NitroModules
import UIKit

final class HybridModelView: HybridModelViewSpec {
  private let nativeView = ModelNativeView()
  var view: UIView { nativeView }
  var modelPath = ""
  var sweep: Double = ModelNativeView.fullTurn
  var period: Double = ModelNativeView.defaultPeriod
  var onLoaded: (Bool) -> Void = { _ in } {
    didSet { nativeView.onLoaded = onLoaded }
  }

  func afterUpdate() {
    nativeView.configure(modelPath: modelPath, sweep: sweep, period: period)
  }

  func onDropView() { nativeView.shutdown() }

  deinit {
    let view = nativeView
    if Thread.isMainThread { view.shutdown() }
    else { DispatchQueue.main.async { view.shutdown() } }
  }
}
