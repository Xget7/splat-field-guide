import Foundation
import NitroModules
import SplatKitCore

final class HybridWorldRetirement: HybridWorldRetirementSpec {
  func waitForWorldsReleased() throws -> Promise<Void> {
    let promise = Promise<Void>()
    // React's native removal/start mutations run on the main queue. Existing hosts remain
    // registered across queued stops, so this never mistakes enqueueing stop for destruction.
    DispatchQueue.main.async {
      let retained = Unmanaged.passRetained(promise).toOpaque()
      sfg_when_worlds_released({ context in
        guard let context else { return }
        Unmanaged<Promise<Void>>.fromOpaque(context).takeRetainedValue().resolve()
      }, retained)
    }
    return promise
  }
}
