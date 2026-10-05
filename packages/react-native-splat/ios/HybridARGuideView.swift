import NitroModules
import UIKit

/// The registration experiment: React Native supplies local files and receives state JSON.
/// Nitro applies view props in a batch on the main thread.
final class HybridARGuideView: HybridARGuideViewSpec {
  private let nativeView = ARGuideNativeView()

  var view: UIView { nativeView }
  var referencePath = ""
  var landmarksPath = ""
  var torchEnabled = false
  var onTrackingStateChanged: (String) -> Void = { _ in } {
    didSet { nativeView.setEventHandler(onTrackingStateChanged) }
  }

  func afterUpdate() {
    nativeView.configure(referencePath: referencePath, landmarksPath: landmarksPath, torchEnabled: torchEnabled)
  }

  func onDropView() {
    nativeView.shutdown()
  }

  deinit {
    // Nitro's last release can originate outside UIKit's thread.
    let view = nativeView
    if Thread.isMainThread {
      view.shutdown()
    } else {
      DispatchQueue.main.async { view.shutdown() }
    }
  }
}
