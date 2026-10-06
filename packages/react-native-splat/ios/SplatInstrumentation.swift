import Foundation
import os

enum SplatInstrumentation {
  struct Counts {
    var liveViews = 0
    var liveMetalLayers = 0
    var liveRenderThreads = 0
    var renderThreadsStarted = 0
    var renderThreadsStopped = 0
    var framesDrawn = 0
    var orbitCallsOnMainThread = 0
    var orbitCallsOffMainThread = 0
    var lastOrbitThread = ""
  }

  static let logger = Logger(subsystem: "com.fieldguide.splat", category: "view")
  #if DEBUG
  private static let lock = NSLock()
  private static var counts = Counts()

  /// Every Nth orbit call is logged, so a pan does not flood the log.
  private static let orbitLogInterval = 60

  #endif

  static func update(_ change: (inout Counts) -> Void) {
    #if DEBUG
    lock.lock()
    defer { lock.unlock() }
    change(&counts)
    #endif
  }

  static func snapshot() -> Counts {
    #if DEBUG
    lock.lock()
    defer { lock.unlock() }
    return counts
    #else
    return Counts()
    #endif
  }

  static var currentThreadName: String {
    if Thread.isMainThread { return "main" }
    let name = Thread.current.name ?? ""
    return name.isEmpty ? "unnamed" : name
  }

  static func recordOrbitCall() {
    #if DEBUG
    let onMain = Thread.isMainThread
    let name = currentThreadName
    var total = 0
    update { counts in
      if onMain {
        counts.orbitCallsOnMainThread += 1
      } else {
        counts.orbitCallsOffMainThread += 1
      }
      counts.lastOrbitThread = name
      total = counts.orbitCallsOnMainThread + counts.orbitCallsOffMainThread
    }
    if total == 1 || total % orbitLogInterval == 0 {
      logger.info("orbit call #\(total) on thread=\(name, privacy: .public) isMain=\(onMain)")
    }
    #endif
  }
}
