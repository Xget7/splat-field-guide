import NitroModules

class HybridSplatDiagnostics: HybridSplatDiagnosticsSpec {
  func snapshot() throws -> SplatDiagnosticsSnapshot {
    let counts = SplatInstrumentation.snapshot()
    return SplatDiagnosticsSnapshot(
      liveViews: Double(counts.liveViews),
      liveMetalLayers: Double(counts.liveMetalLayers),
      liveRenderThreads: Double(counts.liveRenderThreads),
      renderThreadsStarted: Double(counts.renderThreadsStarted),
      renderThreadsStopped: Double(counts.renderThreadsStopped),
      framesPresented: Double(counts.framesPresented),
      orbitCallsOnMainThread: Double(counts.orbitCallsOnMainThread),
      orbitCallsOffMainThread: Double(counts.orbitCallsOffMainThread),
      lastOrbitThread: counts.lastOrbitThread
    )
  }
}
