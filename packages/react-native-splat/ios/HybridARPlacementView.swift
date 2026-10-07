import NitroModules
import UIKit

final class HybridARPlacementView: HybridARPlacementViewSpec {
  private let nativeView = ARPlacementNativeView()
  var view: UIView { nativeView }
  var modelPath = ""
  var scale: Double = Double(ARPlacementGeometry.defaultScale)
  var elevation: Double?
  var scaleRequest: Double = 0
  var placementRequest: Double = 0
  var resetRequest: Double = 0
  var assemblyStep: Double?
  var assemblyRequest: Double?
  var assemblyOrder: [String]?
  var exploded: Bool?
  var onPlacementChanged: (ARPlacementEvent) -> Void = { _ in } {
    didSet { nativeView.setEventHandler(onPlacementChanged) }
  }
  var onAssemblyChanged: ((ARAssemblyEvent) -> Void)? {
    didSet { nativeView.setAssemblyEventHandler(onAssemblyChanged) }
  }

  func afterUpdate() {
    nativeView.configure(modelPath: modelPath, scale: scale, scaleRequest: scaleRequest,
      placementRequest: placementRequest, resetRequest: resetRequest,
      assemblyStep: assemblyStep, exploded: exploded, assemblyOrder: assemblyOrder,
      assemblyRequest: assemblyRequest, elevation: elevation)
  }

  func onDropView() { nativeView.shutdown() }

  deinit {
    let view = nativeView
    if Thread.isMainThread { view.shutdown() }
    else { DispatchQueue.main.async { view.shutdown() } }
  }
}
